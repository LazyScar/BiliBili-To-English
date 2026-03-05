(function () {
  const ROOT = (window.BTE = window.BTE || {});

  const PERSISTENT_CACHE_KEY =
    (ROOT.BTE_KEYS && ROOT.BTE_KEYS.PERSISTENT_CACHE_KEY) || "btePersistentCacheV2";
  const NEGATIVE_CACHE_SENTINEL = "__BTE_NO_TRANSLATION__";
  const NEGATIVE_CACHE_TTL_MS = 2 * 60 * 1000;

  function storageLocalGet(keys) {
    if (!globalThis.chrome || !globalThis.chrome.storage || !globalThis.chrome.storage.local) {
      return Promise.resolve({});
    }
    return new Promise((resolve) => globalThis.chrome.storage.local.get(keys, resolve));
  }

  function storageLocalSet(payload) {
    if (!globalThis.chrome || !globalThis.chrome.storage || !globalThis.chrome.storage.local) {
      return Promise.resolve();
    }
    return new Promise((resolve) => globalThis.chrome.storage.local.set(payload, resolve));
  }

  function storageLocalRemove(keys) {
    if (!globalThis.chrome || !globalThis.chrome.storage || !globalThis.chrome.storage.local) {
      return Promise.resolve();
    }
    return new Promise((resolve) => globalThis.chrome.storage.local.remove(keys, resolve));
  }

  function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  class LruCache {
    constructor(limit) {
      this.limit = Math.max(50, limit || 2000);
      this.map = new Map();
    }

    setLimit(limit) {
      this.limit = Math.max(50, limit || 2000);
      this.prune();
    }

    get(key) {
      if (!this.map.has(key)) return undefined;
      const value = this.map.get(key);
      this.map.delete(key);
      this.map.set(key, value);
      return value;
    }

    set(key, value) {
      if (this.map.has(key)) {
        this.map.delete(key);
      }
      this.map.set(key, value);
      this.prune();
    }

    delete(key) {
      this.map.delete(key);
    }

    clear() {
      this.map.clear();
    }

    prune() {
      while (this.map.size > this.limit) {
        const oldest = this.map.keys().next().value;
        this.map.delete(oldest);
      }
    }
  }

  class TranslationManager {
    constructor(settingsManager) {
      this.settingsManager = settingsManager;
      this.settings = null;
      const googleEngine = typeof ROOT.GoogleEngine === "function" ? new ROOT.GoogleEngine() : null;
      const deeplEngine = typeof ROOT.DeepLEngine === "function" ? new ROOT.DeepLEngine() : null;
      const microsoftEngine = typeof ROOT.MicrosoftEngine === "function" ? new ROOT.MicrosoftEngine() : null;
      this.engines = {
        google: googleEngine,
        deepl: deeplEngine,
        microsoft: microsoftEngine,
      };
      this.memoryCache = new LruCache(2000);
      this.persistentCache = new Map();
      this.pending = new Map();
      this.knownOutputs = new Map();
      this.persistTimer = null;
      this.ready = false;
      this.changeUnsubscribe = null;
      this.singleQueue = [];
      this.singleQueueTimer = null;
      this.singleQueueDelayMs = 16;
      this.maxConcurrentBatches = 3;
    }

    async initialize() {
      if (this.ready) return;
      this.settings = await this.settingsManager.initialize();
      this.memoryCache.setLimit(this.settings.cache.maxEntries);
      await this.loadPersistentCache();
      this.changeUnsubscribe = this.settingsManager.onChange((nextSettings) => {
        this.settings = nextSettings;
        this.memoryCache.setLimit(nextSettings.cache.maxEntries);
        if (!nextSettings.cache.enabled) {
          this.memoryCache.clear();
        }
        this.prunePersistentCache();
      });
      this.ready = true;
    }

    destroy() {
      if (this.changeUnsubscribe) {
        this.changeUnsubscribe();
        this.changeUnsubscribe = null;
      }
      if (this.persistTimer) {
        clearTimeout(this.persistTimer);
        this.persistTimer = null;
      }
      if (this.singleQueueTimer) {
        clearTimeout(this.singleQueueTimer);
        this.singleQueueTimer = null;
      }
    }

    normalizeWhitespacePreservingLines(text) {
      const s = String(text || "");
      if (!s) return "";
      // Fast path: no line breaks — avoids the split/map/filter/join pipeline.
      if (!s.includes("\r") && !s.includes("\n")) {
        return s.replace(/\s+/g, " ").trim();
      }
      return s
        .replace(/\r/g, "")
        .split("\n")
        .map((line) => line.replace(/\s+/g, " ").trim())
        .filter((line) => line.length > 0)
        .join("\n")
        .trim();
    }

    normalizeText(text) {
      return this.normalizeWhitespacePreservingLines(text);
    }

    applyBoundarySpacing(text) {
      const s = String(text || "");
      if (!s) return s;
      // Fast path: no Latin letters, digits, or operator characters present —
      // none of the boundary rules can match, so skip all 7 regex passes.
      // This covers the overwhelming majority of CJK subtitle lines.
      if (!/[A-Za-z0-9+\/|]/.test(s)) return s;
      return s
        .replace(/([A-Za-z])(\d)/g, "$1 $2")
        .replace(/(\d)([A-Za-z])/g, "$1 $2")
        .replace(/([\u4e00-\u9fff])(\d)/g, "$1 $2")
        .replace(/(\d)([\u4e00-\u9fff])/g, "$1 $2")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/([A-Za-z0-9])([+\/|])([A-Za-z0-9])/g, "$1 $2 $3")
        .replace(/\s{2,}/g, " ");
    }

    splitMixedAlphaNumericToken(token) {
      const out = [];
      const walk = (value) => {
        if (!value) return;
        const match = String(value).match(/([A-Za-z]+)(\d+)([A-Za-z]*)/);
        if (!match) {
          out.push(value);
          return;
        }
        const start = match.index || 0;
        const end = start + match[0].length;
        const prefix = value.slice(0, start);
        const alphaLeft = match[1];
        const digits = match[2];
        const alphaRight = match[3];
        const suffix = value.slice(end);
        if (prefix) walk(prefix);
        if (alphaLeft) out.push(alphaLeft);
        if (digits) out.push(digits);
        if (alphaRight) walk(alphaRight);
        if (suffix) walk(suffix);
      };
      walk(token);
      return out.filter(Boolean);
    }

    splitMixedAlphaNumericRecursively(text) {
      const tokens = String(text || "").split(/\s+/).filter(Boolean);
      const out = [];
      tokens.forEach((token) => {
        const parts = this.splitMixedAlphaNumericToken(token);
        if (parts.length > 1) {
          out.push(...parts);
        } else {
          out.push(token);
        }
      });
      return out.join(" ");
    }

    preprocessInputText(text) {
      const spaced = this.applyBoundarySpacing(text);
      const splitMixed = this.splitMixedAlphaNumericRecursively(spaced);
      return this.normalizeText(splitMixed);
    }

    toTitleCase(text) {
      return String(text || "")
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(" ");
    }

    shouldTitleCase(text) {
      const value = String(text || "").trim();
      if (!value) return false;
      if (/[.?!,:;]/.test(value)) return false;
      const words = value.split(/\s+/);
      if (words.length > 4) return false;
      return words.every((word) => /^[A-Za-z][A-Za-z-]*$/.test(word));
    }

    postprocessTranslationText(value, input, options) {
      if (typeof value !== "string") return null;
      let out = this.normalizeWhitespacePreservingLines(value);
      out = this.applyBoundarySpacing(out);
      out = out
        .replace(/\s+([,.;:!?])/g, "$1")
        .replace(/([([{])\s+/g, "$1")
        .replace(/\s+([)\]}])/g, "$1")
        .replace(/\s{2,}/g, " ")
        .trim();
      out = this.applyCaseShape(input, out);
      if (options?.titleCase && this.shouldTitleCase(out)) {
        out = this.toTitleCase(out);
      }
      if (!out) return null;
      if (out === input) return null;
      return out;
    }

    applyCaseShape(input, output) {
      if (!input || !output) return output;
      const inFirst = input.trim().charAt(0);
      const outFirst = output.trim().charAt(0);
      if (!inFirst || !outFirst) return output;
      if (/[A-Z]/.test(inFirst) && /[a-z]/.test(outFirst)) {
        return outFirst.toUpperCase() + output.trim().slice(1);
      }
      return output;
    }

    buildResult(translation, source, fromCache) {
      return {
        translation: translation || null,
        source: source || null,
        engine: source || null,
        fromCache: !!fromCache,
      };
    }

    buildKey(engine, sourceLanguage, targetLanguage, text) {
      return `${engine}::${sourceLanguage || "auto"}::${targetLanguage}::${text}`;
    }

    getDictionaryTranslation(text) {
      if (!window.languageManager || typeof window.languageManager.getTranslation !== "function") {
        return null;
      }
      return window.languageManager.getTranslation(text) || null;
    }

    resolveEngineChain(settings, options) {
      const selected = (options && options.engine) || settings.engine || "google";
      const chain = [];
      const deeplFallbackEnabled = settings?.deepl?.fallbackToGoogle !== false;
      const add = (name) => {
        if (!name) return;
        if (chain.includes(name)) return;
        const engine = this.engines[name];
        if (!engine) return;
        if (name === "deepl") {
          const deeplKey = settings.deepl && settings.deepl.apiKey ? settings.deepl.apiKey.trim() : "";
          if (!deeplKey) return;
        }
        chain.push(name);
      };

      add(selected);
      if (selected !== "deepl" || deeplFallbackEnabled) {
        add(selected === "google" ? "microsoft" : "google");
        add("microsoft");
      }
      if (selected !== "deepl" || deeplFallbackEnabled) {
        add("deepl");
      }
      return chain;
    }

    resolveEngine(settings, options) {
      const chain = this.resolveEngineChain(settings, options);
      if (chain.length) return chain[0];
      const deeplKey = settings.deepl && settings.deepl.apiKey ? settings.deepl.apiKey.trim() : "";
      if (deeplKey) return "deepl";
      if (settings.deepl && settings.deepl.fallbackToGoogle !== false && this.engines.google) {
        return "google";
      }
      return null;
    }

    isKnownTranslated(text, targetLanguage) {
      const bucket = this.knownOutputs.get(targetLanguage);
      if (!bucket) return false;
      return bucket.set.has(text);
    }

    rememberKnownTranslated(text, targetLanguage) {
      const normalized = this.preprocessInputText(text);
      if (!normalized) return;
      if (!this.knownOutputs.has(targetLanguage)) {
        this.knownOutputs.set(targetLanguage, { set: new Set(), queue: [] });
      }
      const bucket = this.knownOutputs.get(targetLanguage);
      if (bucket.set.has(normalized)) return;
      bucket.set.add(normalized);
      bucket.queue.push(normalized);
      while (bucket.queue.length > 6000) {
        const oldest = bucket.queue.shift();
        bucket.set.delete(oldest);
      }
    }

    isExpired(entry) {
      if (!entry) return true;
      if (!entry.expiresAt) return false;
      return entry.expiresAt <= Date.now();
    }

    lookupCache(key) {
      if (!this.settings || !this.settings.cache || !this.settings.cache.enabled) return undefined;
      const memoryHit = this.memoryCache.get(key);
      if (memoryHit !== undefined) {
        if (this.isExpired(memoryHit)) {
          this.memoryCache.delete(key);
          this.persistentCache.delete(key);
          return undefined;
        }
        if (memoryHit.value == null) {
          this.memoryCache.delete(key);
          this.persistentCache.delete(key);
          return undefined;
        }
        memoryHit.updatedAt = Date.now();
        return memoryHit.value;
      }
      if (!this.persistentCache.has(key)) {
        return undefined;
      }
      const persistentHit = this.persistentCache.get(key);
      if (this.isExpired(persistentHit)) {
        this.persistentCache.delete(key);
        return undefined;
      }
      if (persistentHit.value == null) {
        this.persistentCache.delete(key);
        return undefined;
      }
      persistentHit.updatedAt = Date.now();
      this.memoryCache.set(key, persistentHit);
      return persistentHit.value;
    }

    storeCache(key, value, ttlMsOverride) {
      if (!this.settings || !this.settings.cache || !this.settings.cache.enabled) return;
      if (value == null) {
        return;
      }
      const now = Date.now();
      const entry = {
        value,
        updatedAt: now,
        expiresAt: now + (Number.isFinite(ttlMsOverride) ? ttlMsOverride : this.settings.cache.ttlMs),
      };
      this.memoryCache.set(key, entry);
      this.persistentCache.set(key, entry);
      this.schedulePersist();
    }

    storeNegativeCache(key) {
      this.storeCache(key, NEGATIVE_CACHE_SENTINEL, NEGATIVE_CACHE_TTL_MS);
    }

    prunePersistentCache() {
      const now = Date.now();
      this.persistentCache.forEach((entry, key) => {
        if (!entry || (entry.expiresAt && entry.expiresAt <= now)) {
          this.persistentCache.delete(key);
        }
      });
      const maxEntries = this.settings && this.settings.cache ? this.settings.cache.maxEntries : 2000;
      if (this.persistentCache.size <= maxEntries) return;
      const sortedKeys = Array.from(this.persistentCache.entries())
        .sort((a, b) => (a[1].updatedAt || 0) - (b[1].updatedAt || 0))
        .map((item) => item[0]);
      const removeCount = this.persistentCache.size - maxEntries;
      for (let i = 0; i < removeCount; i += 1) {
        this.persistentCache.delete(sortedKeys[i]);
      }
    }

    schedulePersist() {
      if (this.persistTimer) return;
      this.persistTimer = setTimeout(async () => {
        this.persistTimer = null;
        this.prunePersistentCache();
        const entries = {};
        this.persistentCache.forEach((value, key) => {
          entries[key] = value;
        });
        await storageLocalSet({
          [PERSISTENT_CACHE_KEY]: {
            version: 2,
            updatedAt: Date.now(),
            entries,
          },
        });
      }, 1000);
    }

    async loadPersistentCache() {
      const data = await storageLocalGet([PERSISTENT_CACHE_KEY]);
      const blob = data[PERSISTENT_CACHE_KEY];
      const entries = blob && typeof blob === "object" ? blob.entries : null;
      if (!entries || typeof entries !== "object") {
        return;
      }
      Object.keys(entries).forEach((key) => {
        const entry = entries[key];
        if (!entry || entry.value == null) return;
        this.persistentCache.set(key, entry);
      });
      this.prunePersistentCache();
    }

    async clearAllCaches() {
      this.memoryCache.clear();
      this.persistentCache.clear();
      this.pending.clear();
      this.knownOutputs.clear();
      this.singleQueue = [];
      if (this.persistTimer) {
        clearTimeout(this.persistTimer);
        this.persistTimer = null;
      }
      if (this.singleQueueTimer) {
        clearTimeout(this.singleQueueTimer);
        this.singleQueueTimer = null;
      }
      await storageLocalRemove([PERSISTENT_CACHE_KEY]);
    }

    buildBatches(items, engine) {
      const maxItems = engine?.maxItemsPerRequest || 25;
      const maxChars = engine?.maxCharsPerRequest || 4000;
      const batches = [];
      let current = [];
      let chars = 0;
      items.forEach((item) => {
        const add = item.text.length;
        if (current.length > 0 && (current.length >= maxItems || chars + add > maxChars)) {
          batches.push(current);
          current = [];
          chars = 0;
        }
        current.push(item);
        chars += add;
      });
      if (current.length) {
        batches.push(current);
      }
      return batches;
    }

    async callEngine(engineName, texts, options) {
      const engine = this.engines[engineName];
      if (!engine) {
        return new Array(texts.length).fill(null);
      }
      const engineOptions = {
        sourceLanguage: options.sourceLanguage || "auto",
        targetLanguage: options.targetLanguage || "en",
      };
      if (engineName === "deepl") {
        engineOptions.deeplApiKey = this.settings.deepl.apiKey;
        engineOptions.endpointMode = this.settings.deepl.endpointMode;
      } else if (engineName === "microsoft") {
        engineOptions.microsoftApiKey = this.settings.microsoft?.apiKey || "";
        engineOptions.microsoftRegion = this.settings.microsoft?.region || "";
        engineOptions.microsoftUseAzure = this.settings.microsoft?.useAzure !== false;
      }
      const output = await engine.translate(texts, engineOptions);
      if (!Array.isArray(output)) {
        return new Array(texts.length).fill(null);
      }
      return output;
    }

    async translateBatchWithFallback(engineChain, batchTexts, options) {
      const values = new Array(batchTexts.length).fill(null);
      const usedEngine = new Array(batchTexts.length).fill(null);
      let unresolved = batchTexts.map((_text, index) => index);
      for (const engineName of engineChain) {
        if (!unresolved.length) break;
        const subsetTexts = unresolved.map((idx) => batchTexts[idx]);
        let subsetOut = new Array(subsetTexts.length).fill(null);
        try {
          subsetOut = await this.callEngine(engineName, subsetTexts, options);
        } catch (error) {
          console.warn(`BTE engine ${engineName} failed:`, error);
        }
        const nextUnresolved = [];
        unresolved.forEach((originalIndex, subsetIndex) => {
          const translated = subsetOut[subsetIndex];
          if (translated) {
            values[originalIndex] = translated;
            usedEngine[originalIndex] = engineName;
          } else {
            nextUnresolved.push(originalIndex);
          }
        });
        unresolved = nextUnresolved;
      }
      return { values, usedEngine };
    }

    async runWithConcurrency(tasks, concurrency) {
      const output = new Array(tasks.length);
      let cursor = 0;
      const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
        while (true) {
          const index = cursor;
          cursor += 1;
          if (index >= tasks.length) break;
          output[index] = await tasks[index]();
        }
      });
      await Promise.allSettled(workers);
      return output;
    }

    buildQueueSignature(options) {
      const payload = {
        targetLanguage: options?.targetLanguage || "",
        sourceLanguage: options?.sourceLanguage || "auto",
        area: options?.area || "page",
        engine: options?.engine || "",
        skipDictionary: !!options?.skipDictionary,
        skipKnownTranslated: options?.skipKnownTranslated !== false,
      };
      return JSON.stringify(payload);
    }

    enqueueSingleTranslate(text, options) {
      return new Promise((resolve) => {
        this.singleQueue.push({ text, options: options || {}, resolve });
        if (this.singleQueueTimer) return;
        this.singleQueueTimer = setTimeout(() => {
          this.singleQueueTimer = null;
          this.flushSingleQueue().catch((error) => {
            console.warn("BTE single queue flush failed:", error);
          });
        }, this.singleQueueDelayMs);
      });
    }

    async flushSingleQueue() {
      if (!this.singleQueue.length) return;
      const queue = this.singleQueue.splice(0, this.singleQueue.length);
      const grouped = new Map();
      queue.forEach((item) => {
        const signature = this.buildQueueSignature(item.options);
        if (!grouped.has(signature)) {
          grouped.set(signature, { options: item.options, items: [] });
        }
        grouped.get(signature).items.push(item);
      });
      const groupEntries = Array.from(grouped.values());
      await Promise.all(
        groupEntries.map(async (group) => {
          try {
            const texts = group.items.map((item) => item.text);
            const results = await this.translateMany(texts, group.options);
            group.items.forEach((item, index) => {
              item.resolve(results[index] || this.buildResult(null, null, false));
            });
          } catch (error) {
            console.warn("BTE queue group translation failed:", error);
            group.items.forEach((item) => item.resolve(this.buildResult(null, null, false)));
          }
        })
      );
    }

    peekCached(text, options) {
      if (!this.ready || !this.settings || !this.settings.enabled) {
        return this.buildResult(null, null, false);
      }
      const raw = typeof text === "string" ? text : "";
      const normalizedRaw = this.normalizeText(raw);
      if (!normalizedRaw) return this.buildResult(null, null, false);
      const prepared = this.preprocessInputText(normalizedRaw);
      if (!prepared) return this.buildResult(null, null, false);
      if (!(options && options.skipDictionary)) {
        const dictHit = this.getDictionaryTranslation(normalizedRaw) || this.getDictionaryTranslation(prepared);
        if (dictHit) {
          const normalizedDict = this.postprocessTranslationText(dictHit, prepared, options) || dictHit;
          return this.buildResult(normalizedDict, "dict", false);
        }
      }
      const targetLanguage =
        (options && options.targetLanguage) ||
        this.settings.targetLanguage ||
        (window.languageManager && window.languageManager.getCurrentLanguage
          ? window.languageManager.getCurrentLanguage()
          : "en");
      const sourceLanguage = (options && options.sourceLanguage) || "auto";
      const chain = this.resolveEngineChain(this.settings, options);
      if (!chain.length) return this.buildResult(null, null, false);
      for (const engineName of chain) {
        const key = this.buildKey(engineName, sourceLanguage, targetLanguage, prepared);
        const cached = this.lookupCache(key);
        if (cached === NEGATIVE_CACHE_SENTINEL) {
          return this.buildResult(null, engineName, true);
        }
        if (cached !== undefined) {
          return this.buildResult(cached, engineName, true);
        }
      }
      return this.buildResult(null, null, false);
    }

    async translate(text, options) {
      await this.initialize();
      return this.enqueueSingleTranslate(text, options);
    }

    async translateMany(texts, options) {
      await this.initialize();
      const settings = this.settings;
      const targetLanguage =
        (options && options.targetLanguage) ||
        settings.targetLanguage ||
        (window.languageManager && window.languageManager.getCurrentLanguage
          ? window.languageManager.getCurrentLanguage()
          : "en");
      const sourceLanguage = (options && options.sourceLanguage) || "auto";
      const engineChain = this.resolveEngineChain(settings, options);
      const primaryEngine = engineChain[0] || null;
      const results = new Array(texts.length).fill(null).map(() => this.buildResult(null, null, false));
      if (!settings.enabled) {
        return results;
      }

      const waits = [];
      const newItemsByKey = new Map();
      for (let index = 0; index < texts.length; index += 1) {
        const raw = typeof texts[index] === "string" ? texts[index] : "";
        const normalizedRaw = this.normalizeText(raw);
        if (!normalizedRaw) continue;
        const prepared = this.preprocessInputText(normalizedRaw);
        if (!prepared) continue;
        if ((options && options.skipKnownTranslated !== false) && this.isKnownTranslated(prepared, targetLanguage)) {
          continue;
        }
        if (!(options && options.skipDictionary)) {
          const dictHit = this.getDictionaryTranslation(normalizedRaw) || this.getDictionaryTranslation(prepared);
          if (dictHit) {
            const normalizedDict = this.postprocessTranslationText(dictHit, prepared, options) || dictHit;
            results[index] = this.buildResult(normalizedDict, "dict", false);
            this.rememberKnownTranslated(normalizedDict, targetLanguage);
            if (typeof options?.onPartial === "function") {
              options.onPartial({
                source: prepared,
                translation: normalizedDict,
                engine: "dict",
              });
            }
            continue;
          }
        }
        if (!primaryEngine) continue;
        let cacheHit = false;
        for (const engineName of engineChain) {
          const key = this.buildKey(engineName, sourceLanguage, targetLanguage, prepared);
          const cached = this.lookupCache(key);
          if (cached === NEGATIVE_CACHE_SENTINEL) {
            cacheHit = true;
            break;
          }
          if (cached !== undefined) {
            results[index] = this.buildResult(cached, engineName, true);
            if (cached) this.rememberKnownTranslated(cached, targetLanguage);
            if (cached && typeof options?.onPartial === "function") {
              options.onPartial({
                source: prepared,
                translation: cached,
                engine: engineName,
              });
            }
            cacheHit = true;
            break;
          }
        }
        if (cacheHit) continue;
        const key = this.buildKey(primaryEngine, sourceLanguage, targetLanguage, prepared);
        if (this.pending.has(key)) {
          waits.push(
            this.pending.get(key).then((value) => {
              results[index] = this.buildResult(value, primaryEngine, true);
              if (value) this.rememberKnownTranslated(value, targetLanguage);
            })
          );
          continue;
        }
        if (!newItemsByKey.has(key)) {
          newItemsByKey.set(key, { key, text: prepared, indexes: [] });
        }
        newItemsByKey.get(key).indexes.push(index);
      }

      if (!primaryEngine || newItemsByKey.size === 0) {
        if (waits.length) {
          await Promise.all(waits);
        }
        return results;
      }

      const newItems = Array.from(newItemsByKey.values());
      const deferredByKey = new Map();
      newItems.forEach((item) => {
        const deferred = createDeferred();
        const wrapped = deferred.promise.finally(() => this.pending.delete(item.key));
        this.pending.set(item.key, wrapped);
        deferredByKey.set(item.key, deferred);
        item.indexes.forEach((index) => {
          waits.push(
            wrapped.then((value) => {
              results[index] = this.buildResult(value, primaryEngine, false);
              if (value) this.rememberKnownTranslated(value, targetLanguage);
            })
          );
        });
      });

      const engine = this.engines[primaryEngine];
      const batches = this.buildBatches(newItems, engine);
      const tasks = batches.map((batch) => async () => {
        const batchTexts = batch.map((item) => item.text);
        let translatedBatch = new Array(batch.length).fill(null);
        let usedEngineBatch = new Array(batch.length).fill(primaryEngine);
        try {
          const fallbackOutput = await this.translateBatchWithFallback(engineChain, batchTexts, {
            targetLanguage,
            sourceLanguage,
          });
          translatedBatch = fallbackOutput.values;
          usedEngineBatch = fallbackOutput.usedEngine;
        } catch (error) {
          console.warn("BTE translation batch failed:", error);
        }
        batch.forEach((item, index) => {
          const normalized = this.postprocessTranslationText(translatedBatch[index], item.text, options);
          if (normalized) {
            this.storeCache(item.key, normalized);
          } else {
            this.storeNegativeCache(item.key);
          }
          const usedEngine = usedEngineBatch[index];
          if (normalized && usedEngine && usedEngine !== primaryEngine) {
            const usedKey = this.buildKey(usedEngine, sourceLanguage, targetLanguage, item.text);
            this.storeCache(usedKey, normalized);
          }
          if (normalized && typeof options?.onPartial === "function") {
            options.onPartial({
              source: item.text,
              translation: normalized,
              engine: usedEngine || primaryEngine,
            });
          }
          deferredByKey.get(item.key).resolve(normalized);
        });
      });
      const concurrency = primaryEngine === "deepl" ? 2 : this.maxConcurrentBatches;
      await this.runWithConcurrency(tasks, concurrency);

      if (waits.length) {
        await Promise.all(waits);
      }
      return results;
    }
  }

  ROOT.TranslationManager = TranslationManager;
})();
