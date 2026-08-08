(function () {
  const ROOT = (window.BTE = window.BTE || {});

  const PERSISTENT_CACHE_KEY =
    (ROOT.BTE_KEYS && ROOT.BTE_KEYS.PERSISTENT_CACHE_KEY) || "btePersistentCacheV2";
  const NEGATIVE_CACHE_SENTINEL = "__BTE_NO_TRANSLATION__";
  const NEGATIVE_CACHE_TTL_MS = 2 * 60 * 1000;

  const COUNT_LABEL_MAX_CHARS = 4;
  const COUNT_UNIT_VALUE = {
    亿: 1e8, 億: 1e8,
    千万: 1e7, 千萬: 1e7,
    百万: 1e6, 百萬: 1e6,
    十万: 1e5, 十萬: 1e5,
    万: 1e4, 萬: 1e4,
    千: 1e3,
  };
  const COUNT_UNIT = "亿|億|千万|千萬|百万|百萬|十万|十萬|万|萬|千";
  const COUNT_PART = new RegExp("(\\d+(?:\\.\\d+)?)\\s*(" + COUNT_UNIT + ")", "g");
  const CHINESE_COUNT = new RegExp("(?:\\d+(?:\\.\\d+)?\\s*(?:" + COUNT_UNIT + "))+", "g");

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
      const yandexEngine = typeof ROOT.YandexEngine === "function" ? new ROOT.YandexEngine() : null;
      const baiduEngine = typeof ROOT.BaiduEngine === "function" ? new ROOT.BaiduEngine() : null;
      const youdaoEngine = typeof ROOT.YoudaoEngine === "function" ? new ROOT.YoudaoEngine() : null;
      const papagoEngine = typeof ROOT.PapagoEngine === "function" ? new ROOT.PapagoEngine() : null;
      this.engines = {
        google: googleEngine,
        deepl: deeplEngine,
        microsoft: microsoftEngine,
        yandex: yandexEngine,
        baidu: baiduEngine,
        youdao: youdaoEngine,
        papago: papagoEngine,
      };
      this.memoryCache = new LruCache(2000);
      this.persistentCache = new Map();
      this.sessionCache = new Map();
      this.sessionBytes = 0;
      this.SESSION_TTL_MS = 10 * 60 * 1000;
      this.SESSION_MAX_BYTES = 1024 * 1024;
      this.SESSION_TARGET_BYTES = 700 * 1024;
      this._lastSessionSweep = 0;

      this.IMPORTANT_MAX_LEN = 40;
      this.EPHEMERAL_AREAS = new Set(["danmaku", "comments"]);
      this.seenCounts = new Map();
      this.SEEN_COUNTS_MAX = 4000;
      this.persistBytes = 0;
      this.persistDirty = 0;
      this.PERSIST_DEBOUNCE_MS = 5000;
      this.PERSIST_MIN_DIRTY = 25;
      this.pending = new Map();
      this.pendingDeferreds = new Set();
      this.knownOutputs = new Map();
      this.persistTimer = null;
      this.ready = false;
      this.changeUnsubscribe = null;
      this.singleQueue = [];
      this.singleQueueTimer = null;
      this.singleQueueDelayMs = 16;
      this.maxConcurrentBatches = 3;
      this._batchDurationSamples = [];
      this.statusListener = null;
      this.lastStatusOk = true;
      this._failStreak = 0;
      this._statusErrorThreshold = 3;
      this._engineWarnAt = {};
      this.engineStatus = null;
      this.properNouns = typeof ROOT.ProperNounResolver === "function" ? new ROOT.ProperNounResolver() : null;
      this.engineHealth = {};
    }

    _health(name) {
      if (!this.engineHealth[name]) {
        this.engineHealth[name] = { ok: 0, fail: 0, avgMs: 0, cooldownUntil: 0 };
      }
      return this.engineHealth[name];
    }

    noteEngineResult(name, succeeded, ms) {
      const h = this._health(name);
      if (h.ok + h.fail > 8) {
        h.ok *= 0.7;
        h.fail *= 0.7;
      }
      if (succeeded) {
        h.ok += 1;
        h.cooldownUntil = 0;
        h.avgMs = h.avgMs ? Math.round(h.avgMs * 0.7 + ms * 0.3) : ms;
      } else {
        h.fail += 1;
        h.cooldownUntil = Date.now() + Math.min(5 * 60 * 1000, 15000 * Math.min(h.fail, 8));
      }
    }

    _engineScore(name) {
      const h = this._health(name);
      const inCooldown = Date.now() < h.cooldownUntil;
      const total = h.ok + h.fail;
      const failRate = total ? h.fail / total : 0;
      const latency = h.avgMs || 400;
      return (inCooldown ? 1e6 : 0) + failRate * 1500 + latency;
    }

    applyProperNoun(sourceText, translated) {
      if (!this.properNouns || !this.properNouns.enabled) return translated;
      const canonical = this.properNouns.lookup(sourceText);
      return canonical || translated;
    }

    getEngineStatus() {
      return this.engineStatus || { selected: null, active: null, fellBack: false, reason: null, ok: true, at: 0 };
    }

    _recordEngineStatus(primaryEngine, usedEngineBatch, anyTranslated) {
      const active = anyTranslated ? (usedEngineBatch.find((engine) => engine) || primaryEngine) : null;
      const fellBack = !!(anyTranslated && active && active !== primaryEngine);
      let reason = null;
      if (fellBack || !anyTranslated) {
        const engine = this.engines[primaryEngine];
        reason = (engine && engine.lastError) || (anyTranslated ? "unavailable" : "failed");
      }
      this.engineStatus = {
        selected: primaryEngine,
        active: active || primaryEngine,
        fellBack,
        reason,
        ok: !!anyTranslated,
        at: Date.now(),
      };
    }

    _warnEngineThrottled(engineName, error) {
      if (ROOT.isExtensionAlive && !ROOT.isExtensionAlive()) return;
      const now = Date.now();
      if (now - (this._engineWarnAt[engineName] || 0) < 30000) return;
      this._engineWarnAt[engineName] = now;
      console.warn(`BTE ${engineName} unavailable, falling back:`, error && error.message ? error.message : error);
    }

    setStatusListener(fn) {
      this.statusListener = typeof fn === "function" ? fn : null;
    }

    notifyStatus(state) {
      const s = state === true ? "ok" : state === false ? "error" : state;
      this.lastStatusOk = s !== "error";
      if (this.statusListener) {
        try {
          this.statusListener(s);
        } catch (_error) {
        }
      }
    }

    async initialize() {
      if (this.ready) return;
      this.settings = await this.settingsManager.initialize();
      this.memoryCache.setLimit(this.settings.cache.maxEntries);
      await this.loadPersistentCache();
      this.changeUnsubscribe = this.settingsManager.onChange((nextSettings) => {
        const prevLanguage = this.settings && this.settings.targetLanguage;
        this.settings = nextSettings;
        if (this.properNouns) {
          this.properNouns.setEnabled(nextSettings.learn && nextSettings.learn.properNouns);
          this.properNouns.setTargetLanguage(nextSettings.targetLanguage);
        }
        this.memoryCache.setLimit(nextSettings.cache.maxEntries);
        if (!nextSettings.cache.enabled) {
          this.memoryCache.clear();
        }
        if (prevLanguage && prevLanguage !== nextSettings.targetLanguage) {
          this.dropCachesForOtherLanguages(nextSettings.targetLanguage);
        }
        this.prunePersistentCache();
      });
      if (this.properNouns) {
        this.properNouns.setEnabled(this.settings.learn && this.settings.learn.properNouns);
        this.properNouns.setTargetLanguage(this.settings.targetLanguage);
      }
      this.ready = true;
      this.warmUpEngines();
    }

    warmUpEngines() {
      try {
        if (!this.settings || !this.settings.enabled) return;
        const engine = this.resolveEngine(this.settings, null);
        const microsoft = this.engines.microsoft;
        if (engine === "microsoft" && microsoft && typeof microsoft.ensureToken === "function") {
          Promise.resolve(microsoft.ensureToken()).catch(() => {});
        }
        const yandex = this.engines.yandex;
        if (engine === "yandex" && yandex && typeof yandex.ensureSid === "function") {
          Promise.resolve(yandex.ensureSid(false)).catch(() => {});
        }
      } catch (_error) {
      }
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
      this.settlePendingWork();
    }

    normalizeWhitespacePreservingLines(text) {
      const s = String(text || "");
      if (!s) return "";
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
      if (/https?:\/\//.test(s)) return s;
      if (!/[A-Za-z0-9+\/|]/.test(s)) return s;
      const protected_ = [];
      const protect = (m) => {
        protected_.push(m);
        return `\x02${protected_.length - 1}\x03`;
      };
      let working = s.replace(/\bBV[1-9A-Za-z]{10}\b/g, protect);
      working = working.replace(/\b\d+(?:[PpKk]|FPS|fps|Fps|HDR|hdr|Hz|hz|HZ|bit|BIT|Bit)\b/g, protect);
      working = working
        .replace(/([A-Za-z])(\d)/g, "$1 $2")
        .replace(/(\d)([A-Za-z])/g, "$1 $2")
        .replace(/([\u4e00-\u9fff])(\d)/g, "$1 $2")
        .replace(/(\d)([\u4e00-\u9fff])/g, "$1 $2")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/([A-Za-z0-9])([+|])([A-Za-z0-9])/g, "$1 $2 $3")
        .replace(/\s{2,}/g, " ");
      if (protected_.length) {
        working = working.replace(/\x02(\d+)\x03/g, (_, i) => protected_[Number(i)]);
      }
      return working;
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
      if (/https?:\/\//.test(text)) return String(text || "");
      const input = String(text || "");
      const BV_RE = /^BV[1-9A-Za-z]{10}$/;
      const processLine = (line) => {
        const tokens = line.split(/\s+/).filter(Boolean);
        const out = [];
        tokens.forEach((token) => {
          if (BV_RE.test(token) || /^\x02\d+\x03$/.test(token)) {
            out.push(token);
            return;
          }
          const parts = this.splitMixedAlphaNumericToken(token);
          if (parts.length > 1) {
            out.push(...parts);
          } else {
            out.push(token);
          }
        });
        return out.join(" ");
      };
      if (!input.includes("\n")) return processLine(input);
      return input.split("\n").map(processLine).join("\n");
    }

    groupDigits(value) {
      if (!Number.isFinite(value)) return String(value);
      return (Math.round(value * 100) / 100).toLocaleString("en-US");
    }

    formatCompactCount(value, targetLanguage, style) {
      if (!Number.isFinite(value)) return String(value);
      const long = style === "long";
      let out;
      try {
        out = new Intl.NumberFormat(String(targetLanguage || "en"), {
          notation: "compact",
          compactDisplay: long ? "long" : "short",
          maximumFractionDigits: 1,
        }).format(value);
      } catch (_error) {
        return this.groupDigits(value);
      }
      if (long) return out;
      return out.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
    }

    countStyleFor(text) {
      const remainder = String(text || "")
        .replace(CHINESE_COUNT, "")
        .replace(/[\s　+＋~～\-—]/g, "");
      if (/[。．.!！?？,，、;；:：]/.test(remainder)) return "long";
      return remainder.length <= COUNT_LABEL_MAX_CHARS ? "short" : "long";
    }

    resolveTargetLanguage(targetLanguage) {
      if (targetLanguage) return targetLanguage;
      if (this.settings && this.settings.targetLanguage) return this.settings.targetLanguage;
      return window.languageManager && window.languageManager.getCurrentLanguage
        ? window.languageManager.getCurrentLanguage()
        : "en";
    }

    parseCountChain(chain) {
      let total = 0;
      let matched = false;
      COUNT_PART.lastIndex = 0;
      let part;
      while ((part = COUNT_PART.exec(chain)) !== null) {
        const unitValue = COUNT_UNIT_VALUE[part[2]];
        if (!unitValue) continue;
        total += Number(part[1]) * unitValue;
        matched = true;
      }
      return matched ? total : null;
    }

    expandChineseCounts(text, targetLanguage) {
      const s = String(text || "");
      if (!/[万亿萬億千]/.test(s)) return s;
      const style = this.countStyleFor(s);
      return s.replace(CHINESE_COUNT, (chain) => {
        const value = this.parseCountChain(chain);
        return value === null ? chain : this.formatCompactCount(value, targetLanguage, style);
      });
    }

    localizeCountOnly(normalizedRaw, targetLanguage) {
      if (!/[万亿萬億千]/.test(normalizedRaw)) return null;
      const remainder = normalizedRaw.replace(CHINESE_COUNT, "").replace(/[\s　+＋~～\-—]/g, "");
      if (remainder) return null;
      return this.expandChineseCounts(normalizedRaw, this.resolveTargetLanguage(targetLanguage)) || null;
    }

    preprocessInputText(text, targetLanguage) {
      const counted = this.expandChineseCounts(text, this.resolveTargetLanguage(targetLanguage));
      const spaced = this.applyBoundarySpacing(counted);
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
        .replace(/(\w)\s+['\u2019\u02bc]\s*(\w)/g, "$1'$2")
        .replace(/(\w)\s*['\u2019\u02bc]\s+(\w)/g, "$1'$2")
        .replace(/[\u2019\u02bc]/g, "'")
        .replace(/(\d)\s+\/\s+([a-zA-Z])/g, "$1/$2")
        .replace(/\/\s+([a-zA-Z])/g, "/$1")
        .trim();
      if (input && input.includes("\n") && !out.includes("\n")) {
        const restored = out.replace(/\s+([\u2460-\u2473\u2474-\u2487\u2488-\u249b])/g, "\n$1");
        if (restored.includes("\n")) out = restored.trimStart();
      }
      out = this.applyEnglishGrammar(out, options);
      out = this.applyProperNoun(input, out);
      out = this.applyCaseShape(input, out);
      if (options?.titleCase && this.shouldTitleCase(out)) {
        out = this.toTitleCase(out);
      }
      if (!out) return null;
      if (out === input) return null;
      return out;
    }

    applyEnglishGrammar(text, options) {
      const target = String((options && options.targetLanguage) || "en").toLowerCase();
      if (!target.startsWith("en")) return text;
      let out = String(text || "");
      if (!out) return out;

      const vowelSound = (word) => {
        const w = word.toLowerCase();
        if (/^(hour|honest|honou?r|heir)/.test(w)) return true;
        if (/^(uni|use|user|usu|euro|eu|one|once|ubiq)/.test(w)) return false;
        return /^[aeiou]/.test(w);
      };
      out = out.replace(/\b(a|an)\s+([A-Za-z][\w'-]*)/g, (match, article, word) => {
        const needsAn = vowelSound(word);
        const isUpper = article[0] === article[0].toUpperCase();
        const fixed = needsAn ? "an" : "a";
        return (isUpper ? fixed[0].toUpperCase() + fixed.slice(1) : fixed) + " " + word;
      });

      out = out.replace(/\bi\b/g, "I");

      out = out
        .replace(/\s+([,.;:!?%])/g, "$1")
        .replace(/([,;])(?=[^\s\d])/g, "$1 ")
        .replace(/([.!?])(?=[A-Za-z])/g, "$1 ")
        .replace(/\s{2,}/g, " ")
        .replace(/\(\s+/g, "(").replace(/\s+\)/g, ")")
        .trim();

      out = out.replace(/([.!?]\s+|\n)([a-z])/g, (m, lead, ch) => lead + ch.toUpperCase());

      return out;
    }

    applyCaseShape(input, output) {
      if (!input || !output) return output;
      const inFirst = input.trim().charAt(0);
      const outTrimmed = output.trim();
      const outFirst = outTrimmed.charAt(0);
      if (!inFirst || !outFirst) return output;
      if (/[A-Z]/.test(inFirst) && /[a-z]/.test(outFirst)) {
        return outFirst.toUpperCase() + outTrimmed.slice(1);
      }
      if (/[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff]/.test(inFirst) && /[a-z]/.test(outFirst)) {
        return outFirst.toUpperCase() + outTrimmed.slice(1);
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
      const isConfigured = (name) => {
        if (name === "deepl") {
          return !!(settings.deepl && settings.deepl.apiKey && settings.deepl.apiKey.trim());
        }
        if (name === "baidu") {
          return !!(settings.baidu && settings.baidu.appid && settings.baidu.appid.trim() &&
            settings.baidu.secret && settings.baidu.secret.trim());
        }
        if (name === "youdao") {
          return !!(settings.youdao && settings.youdao.appKey && settings.youdao.appKey.trim() &&
            settings.youdao.appSecret && settings.youdao.appSecret.trim());
        }
        if (name === "papago") {
          return !!(settings.papago && settings.papago.clientId && settings.papago.clientId.trim() &&
            settings.papago.clientSecret && settings.papago.clientSecret.trim());
        }
        return true;
      };
      const add = (name) => {
        if (!name) return;
        if (chain.includes(name)) return;
        if (!this.engines[name]) return;
        if (!isConfigured(name)) return;
        chain.push(name);
      };

      if (selected === "auto") {
        const keyless = ["google", "microsoft", "yandex"]
          .filter((name) => this.engines[name])
          .sort((a, b) => this._engineScore(a) - this._engineScore(b));
        keyless.forEach(add);
        ["deepl", "baidu", "youdao", "papago"]
          .filter((name) => this.engines[name] && isConfigured(name))
          .sort((a, b) => this._engineScore(a) - this._engineScore(b))
          .forEach(add);
        return chain;
      }

      add(selected);
      if (selected === "deepl") {
        if (deeplFallbackEnabled) {
          add("microsoft");
          add("google");
        }
      } else if (selected === "yandex") {
        add("microsoft");
        add("google");
        add("deepl");
      } else if (selected === "baidu" || selected === "youdao") {
        if (settings[selected] && settings[selected].fallback !== false) {
          add(selected === "baidu" ? "youdao" : "baidu");
          add("microsoft");
          add("google");
        }
      } else if (selected === "papago") {
        if (settings.papago && settings.papago.fallback !== false) {
          add("microsoft");
          add("google");
          add("deepl");
        }
      } else {
        add(selected === "google" ? "microsoft" : "google");
        add("microsoft");
        add("deepl");
      }
      return chain;
    }

    resolveEngine(settings, options) {
      const chain = this.resolveEngineChain(settings, options);
      if (chain.length) return chain[0];
      const deeplKey = settings.deepl && settings.deepl.apiKey ? settings.deepl.apiKey.trim() : "";
      if (deeplKey) return "deepl";
      if (settings.deepl && settings.deepl.fallbackToGoogle !== false) {
        if (this.engines.microsoft) return "microsoft";
        if (this.engines.google) return "google";
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

    _entryBytes(key, value) {
      return (String(key).length + String(value).length) * 2 + 48;
    }

    pruneSessionCache(force) {
      const now = Date.now();
      if (!force && now - this._lastSessionSweep < 1000) return;
      this._lastSessionSweep = now;
      for (const [key, entry] of this.sessionCache) {
        if (now - entry.at > this.SESSION_TTL_MS) {
          this.sessionBytes -= entry.bytes;
          this.sessionCache.delete(key);
        }
      }
      if (this.sessionBytes <= this.SESSION_MAX_BYTES) return;
      for (const [key, entry] of this.sessionCache) {
        if (this.sessionBytes <= this.SESSION_TARGET_BYTES) break;
        this.sessionBytes -= entry.bytes;
        this.sessionCache.delete(key);
      }
    }

    dropCachesForOtherLanguages(targetLanguage) {
      const lang = String(targetLanguage || "");
      if (!lang) return;
      const matches = (key) => String(key).split("::")[2] === lang;
      for (const [key, entry] of this.sessionCache) {
        if (!matches(key)) {
          this.sessionBytes -= entry.bytes;
          this.sessionCache.delete(key);
        }
      }
      this.persistentCache.forEach((entry, key) => {
        if (matches(key)) return;
        this.persistBytes -= this._entryBytes(key, entry && entry.value);
        this.persistentCache.delete(key);
      });
      if (this.persistBytes < 0) this.persistBytes = 0;
      this.memoryCache.clear();
      this.schedulePersist();
    }

    lookupCache(key) {
      const sessionEntry = this.sessionCache.get(key);
      if (sessionEntry !== undefined) {
        if (Date.now() - sessionEntry.at <= this.SESSION_TTL_MS) return sessionEntry.value;
        this.sessionBytes -= sessionEntry.bytes;
        this.sessionCache.delete(key);
      }
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
        memoryHit.hits = (memoryHit.hits || 0) + 1;
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
      persistentHit.hits = (persistentHit.hits || 0) + 1;
      this.memoryCache.set(key, persistentHit);
      return persistentHit.value;
    }

    isWorthPersisting(sourceText, area) {
      const text = String(sourceText || "");
      if (!text) return false;
      const seen = (this.seenCounts.get(text) || 0) + 1;
      if (this.seenCounts.size >= this.SEEN_COUNTS_MAX) {
        const oldest = this.seenCounts.keys().next().value;
        this.seenCounts.delete(oldest);
      }
      this.seenCounts.set(text, seen);
      if (seen >= 2) return true;
      if (this.EPHEMERAL_AREAS.has(area)) return false;
      return text.length <= this.IMPORTANT_MAX_LEN;
    }

    _keyText(key) {
      const parts = String(key).split("::");
      return parts.length > 3 ? parts.slice(3).join("::") : "";
    }

    storeCache(key, value, ttlMsOverride, options) {
      if (value == null) {
        return;
      }
      const bytes = this._entryBytes(key, value);
      const priorSession = this.sessionCache.get(key);
      if (priorSession) {
        this.sessionBytes -= priorSession.bytes;
        this.sessionCache.delete(key);
      }
      this.sessionCache.set(key, { value, at: Date.now(), bytes });
      this.sessionBytes += bytes;
      this.pruneSessionCache();
      if (!this.settings || !this.settings.cache || !this.settings.cache.enabled) return;
      const existing = this.persistentCache.get(key);
      const isNegative = value === NEGATIVE_CACHE_SENTINEL;
      if (!existing && !isNegative) {
        const area = options && options.area;
        if (!this.isWorthPersisting(this._keyText(key), area)) return;
      }
      const now = Date.now();
      const entry = {
        value,
        updatedAt: now,
        expiresAt: now + (Number.isFinite(ttlMsOverride) ? ttlMsOverride : this.settings.cache.ttlMs),
        hits: (existing && existing.hits) || 0,
      };
      if (existing) this.persistBytes -= this._entryBytes(key, existing.value);
      this.persistBytes += bytes;
      this.memoryCache.set(key, entry);
      this.persistentCache.set(key, entry);
      this.persistDirty += 1;
      this.schedulePersist();
    }

    storeNegativeCache(key) {
      this.storeCache(key, NEGATIVE_CACHE_SENTINEL, NEGATIVE_CACHE_TTL_MS);
    }

    prunePersistentCache() {
      const now = Date.now();
      this.persistentCache.forEach((entry, key) => {
        if (!entry || (entry.expiresAt && entry.expiresAt <= now)) {
          this.persistBytes -= this._entryBytes(key, entry && entry.value);
          this.persistentCache.delete(key);
        }
      });
      const cacheSettings = (this.settings && this.settings.cache) || {};
      const maxBytes = Number.isFinite(cacheSettings.maxBytes) && cacheSettings.maxBytes > 64 * 1024
        ? cacheSettings.maxBytes
        : 4 * 1024 * 1024;
      if (this.persistBytes <= maxBytes) return;
      let totalBytes = 0;
      this.persistentCache.forEach((entry, key) => {
        totalBytes += this._entryBytes(key, entry && entry.value);
      });
      this.persistBytes = totalBytes;
      if (totalBytes <= maxBytes) return;
      const HIT_WEIGHT_MS = 30 * 60 * 1000;
      const score = (entry) => (entry.updatedAt || 0) + (entry.hits || 0) * HIT_WEIGHT_MS;
      const sorted = Array.from(this.persistentCache.entries()).sort((a, b) => score(a[1]) - score(b[1]));
      const target = maxBytes * 0.8;
      for (const [key, entry] of sorted) {
        if (totalBytes <= target) break;
        totalBytes -= this._entryBytes(key, entry.value);
        this.persistentCache.delete(key);
      }
      this.persistBytes = totalBytes;
    }

    schedulePersist() {
      if (this.persistTimer) {
        clearTimeout(this.persistTimer);
      }
      this.persistTimer = setTimeout(() => {
        this.persistTimer = null;
        const write = () => {
          if (this.persistDirty < this.PERSIST_MIN_DIRTY) return;
          this.persistDirty = 0;
          this.prunePersistentCache();
          const entries = {};
          this.persistentCache.forEach((value, key) => {
            entries[key] = value;
          });
          void storageLocalSet({
            [PERSISTENT_CACHE_KEY]: { version: 2, updatedAt: Date.now(), entries },
          });
        };
        if (typeof requestIdleCallback === "function") {
          requestIdleCallback(write, { timeout: 4000 });
        } else {
          write();
        }
      }, this.PERSIST_DEBOUNCE_MS);
    }

    flushPersist() {
      if (this.persistTimer) {
        clearTimeout(this.persistTimer);
        this.persistTimer = null;
      }
      if (!this.persistDirty) return;
      this.persistDirty = 0;
      const entries = {};
      this.persistentCache.forEach((value, key) => {
        entries[key] = value;
      });
      void storageLocalSet({
        [PERSISTENT_CACHE_KEY]: { version: 2, updatedAt: Date.now(), entries },
      });
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
        this.persistBytes += this._entryBytes(key, entry.value);
      });
      this.prunePersistentCache();
    }

    settlePendingWork() {
      const droppedQueue = this.singleQueue.splice(0);
      droppedQueue.forEach((item) => {
        try {
          item.resolve(this.buildResult(null, null, false));
        } catch (_error) {
        }
      });
      const droppedDeferreds = Array.from(this.pendingDeferreds);
      this.pendingDeferreds.clear();
      droppedDeferreds.forEach((deferred) => {
        try {
          deferred.resolve(null);
        } catch (_error) {
        }
      });
    }

    async clearAllCaches() {
      this.settlePendingWork();
      this.sessionCache.clear();
      this.sessionBytes = 0;
      this.memoryCache.clear();
      this.persistentCache.clear();
      this.persistBytes = 0;
      this.persistDirty = 0;
      this.seenCounts.clear();
      this.pending.clear();
      this.knownOutputs.clear();
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
        priority: options.priority,
      };
      if (engineName === "deepl") {
        engineOptions.deeplApiKey = this.settings.deepl.apiKey;
        engineOptions.endpointMode = this.settings.deepl.endpointMode;
      } else if (engineName === "microsoft") {
        engineOptions.microsoftApiKey = this.settings.microsoft?.apiKey || "";
        engineOptions.microsoftRegion = this.settings.microsoft?.region || "";
        engineOptions.microsoftUseAzure = this.settings.microsoft?.useAzure !== false;
      } else if (engineName === "baidu") {
        engineOptions.baiduAppid = this.settings.baidu?.appid || "";
        engineOptions.baiduSecret = this.settings.baidu?.secret || "";
      } else if (engineName === "youdao") {
        engineOptions.youdaoAppKey = this.settings.youdao?.appKey || "";
        engineOptions.youdaoAppSecret = this.settings.youdao?.appSecret || "";
      } else if (engineName === "papago") {
        engineOptions.papagoClientId = this.settings.papago?.clientId || "";
        engineOptions.papagoClientSecret = this.settings.papago?.clientSecret || "";
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
      let threw = false;
      let threwHard = false;
      let lastError = null;
      let lastErrorEngine = null;
      for (const engineName of engineChain) {
        if (!unresolved.length) break;
        const subsetTexts = unresolved.map((idx) => batchTexts[idx]);
        let subsetOut = new Array(subsetTexts.length).fill(null);
        let threwThisEngine = false;
        const startedAt = Date.now();
        try {
          subsetOut = await this.callEngine(engineName, subsetTexts, { ...options, priority: options.priority });
          this.noteEngineResult(engineName, subsetOut.some(Boolean), Date.now() - startedAt);
        } catch (error) {
          this.noteEngineResult(engineName, false, Date.now() - startedAt);
          threw = true;
          threwThisEngine = true;
          if (!(Number(error?.status) > 0)) threwHard = true;
          lastError = error;
          lastErrorEngine = engineName;
        }
        const nextUnresolved = [];
        let produced = 0;
        unresolved.forEach((originalIndex, subsetIndex) => {
          const translated = subsetOut[subsetIndex];
          if (translated) {
            produced += 1;
            values[originalIndex] = translated;
            usedEngine[originalIndex] = engineName;
          } else {
            nextUnresolved.push(originalIndex);
          }
        });
        unresolved = nextUnresolved;
        if (!threwThisEngine && produced > 0) {
          unresolved = [];
          break;
        }
      }
      return { values, usedEngine, threw, threwHard, lastError, lastErrorEngine };
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
      if (this.settings && this.settings.enabled === false) {
        return this.buildResult(null, null, false);
      }
      const raw = typeof text === "string" ? text : "";
      const normalizedRaw = this.normalizeText(raw);
      if (!normalizedRaw) return this.buildResult(null, null, false);
      const prepared = this.preprocessInputText(normalizedRaw, options && options.targetLanguage);
      if (!prepared) return this.buildResult(null, null, false);
      const countOnly = this.localizeCountOnly(normalizedRaw, options && options.targetLanguage);
      if (countOnly) return this.buildResult(countOnly, "local", false);
      if (!(options && options.skipDictionary)) {
        const dictHit = this.getDictionaryTranslation(normalizedRaw) || this.getDictionaryTranslation(prepared);
        if (dictHit) {
          const normalizedDict = this.postprocessTranslationText(dictHit, prepared, options) || dictHit;
          return this.buildResult(normalizedDict, "dict", false);
        }
      }
      if (!this.ready || !this.settings) return this.buildResult(null, null, false);
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
        const prepared = this.preprocessInputText(normalizedRaw, targetLanguage);
        if (!prepared) continue;
        const countOnly = this.localizeCountOnly(normalizedRaw, options && options.targetLanguage);
        if (countOnly) {
          results[index] = this.buildResult(countOnly, "local", false);
          if (typeof options?.onPartial === "function") {
            options.onPartial({ source: prepared, translation: countOnly, engine: "local" });
          }
          continue;
        }
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
        if (this.properNouns) this.properNouns.observe(normalizedRaw);
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
        this.pendingDeferreds.add(deferred);
        const wrapped = deferred.promise.finally(() => {
          this.pending.delete(item.key);
          this.pendingDeferreds.delete(deferred);
        });
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
        let batchThrew = false;
        let batchThrewHard = false;
        let batchError = null;
        let batchErrorEngine = null;
        try {
          const t0 = Date.now();
          const fallbackOutput = await this.translateBatchWithFallback(engineChain, batchTexts, {
            targetLanguage,
            sourceLanguage,
            priority: options?.priority,
          });
          this._recordBatchDuration(Date.now() - t0);
          translatedBatch = fallbackOutput.values;
          usedEngineBatch = fallbackOutput.usedEngine;
          batchThrew = fallbackOutput.threw;
          batchThrewHard = fallbackOutput.threwHard;
          batchError = fallbackOutput.lastError;
          batchErrorEngine = fallbackOutput.lastErrorEngine;
        } catch (error) {
          batchThrew = true;
          batchThrewHard = true;
          batchError = error;
        }
        const anyTranslated = translatedBatch.some(Boolean);
        this._recordEngineStatus(primaryEngine, usedEngineBatch, anyTranslated);
        if (anyTranslated) {
          this._failStreak = 0;
          this.notifyStatus(batchThrew && !batchThrewHard ? "busy" : "ok");
        } else if (batchThrewHard) {
          this._failStreak += 1;
          if (this._failStreak >= this._statusErrorThreshold) {
            this.notifyStatus("error");
          }
        } else if (batchThrew) {
          this.notifyStatus("busy");
        }
        if (!anyTranslated && batchThrew && batchError) {
          this._warnEngineThrottled(batchErrorEngine || "translation", batchError);
        }
        batch.forEach((item, index) => {
          const normalized = this.postprocessTranslationText(translatedBatch[index], item.text, options);
          if (normalized) {
            this.storeCache(item.key, normalized, undefined, { area: options && options.area });
          } else if (!batchThrew) {
            this.storeNegativeCache(item.key);
          }
          const usedEngine = usedEngineBatch[index];
          if (normalized && usedEngine && usedEngine !== primaryEngine) {
            const usedKey = this.buildKey(usedEngine, sourceLanguage, targetLanguage, item.text);
            this.storeCache(usedKey, normalized, undefined, { area: options && options.area });
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
      this._adaptConcurrency();

      if (waits.length) {
        await Promise.all(waits);
      }
      return results;
    }

    _recordBatchDuration(ms) {
      this._batchDurationSamples.push(ms);
      if (this._batchDurationSamples.length > 10) {
        this._batchDurationSamples.shift();
      }
    }

    _adaptConcurrency() {
      const samples = this._batchDurationSamples;
      if (samples.length < 3) return;
      const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
      if (avg < 400 && this.maxConcurrentBatches < 6) {
        this.maxConcurrentBatches = Math.min(6, this.maxConcurrentBatches + 1);
      } else if (avg > 1200 && this.maxConcurrentBatches > 1) {
        this.maxConcurrentBatches = Math.max(1, this.maxConcurrentBatches - 1);
      }
    }
  }

  ROOT.TranslationManager = TranslationManager;
})();
