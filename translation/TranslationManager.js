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
      // Page cache: prevents re-translating the same string on one page. Never persisted, dies
      // with the page, and works even when the durable cache is disabled.
      this.sessionCache = new Map(); // key -> { value, at, bytes }
      this.sessionBytes = 0;
      this.SESSION_TTL_MS = 10 * 60 * 1000;
      this.SESSION_MAX_BYTES = 1024 * 1024;      // hard ceiling the user asked for
      this.SESSION_TARGET_BYTES = 700 * 1024;    // prune down to here, so we sit well under the cap
      this._lastSessionSweep = 0;

      // Durable tier. Serialising a 1MB cache costs ~32ms of main-thread time, so the cache is
      // kept small (importance gate below) and written rarely.
      this.IMPORTANT_MAX_LEN = 40;      // at/below this a string behaves like a reusable UI label
      this.EPHEMERAL_AREAS = new Set(["danmaku", "comments"]);
      this.seenCounts = new Map();      // candidate source text -> times observed (memory only)
      this.SEEN_COUNTS_MAX = 4000;
      this.persistBytes = 0;            // running total, so pruning never recounts the whole map
      this.persistDirty = 0;            // entries added since the last write
      this.PERSIST_DEBOUNCE_MS = 5000;  // was 1000: a full serialise is expensive, do it rarely
      this.PERSIST_MIN_DIRTY = 25;      // ...and only when enough has actually changed
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
      // Only surface an on-page error after this many consecutive all-failed batches, so a
      // single transient failure (that the fallback chain or a retry immediately recovers from)
      // never flashes the badge.
      this._failStreak = 0;
      this._statusErrorThreshold = 3;
      // Throttle repeated engine-failure logs so a broken engine (e.g. Microsoft's Edge auth
      // returning 404) doesn't flood the console once per batch.
      this._engineWarnAt = {};
      // Last real engine outcome, so the popup can tell the user when their selected engine fell
      // back to another one (e.g. Yandex blocked by captcha -> Google) instead of it happening
      // silently. Updated only on actual network batches (cache/dict hits don't change it).
      this.engineStatus = null;
      // Canonical names for series/games/people, resolved from Wikidata when confident.
      this.properNouns = typeof ROOT.ProperNounResolver === "function" ? new ROOT.ProperNounResolver() : null;
      // Per-engine health, used by the "auto" service to pick whichever one is actually working
      // and fastest right now. Session-only: a service being down is a temporary fact.
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
      // Decay both counters so RECENT behaviour dominates. Without this a single old failure would
      // hold an engine back permanently, even after it had been working for hours.
      if (h.ok + h.fail > 8) {
        h.ok *= 0.7;
        h.fail *= 0.7;
      }
      if (succeeded) {
        h.ok += 1;
        h.cooldownUntil = 0;
        // Rolling average, weighted toward recent calls.
        h.avgMs = h.avgMs ? Math.round(h.avgMs * 0.7 + ms * 0.3) : ms;
      } else {
        h.fail += 1;
        // Back off an engine that keeps failing so "auto" stops choosing it, with the pause
        // growing as failures repeat (capped) and clearing on the next success.
        h.cooldownUntil = Date.now() + Math.min(5 * 60 * 1000, 15000 * Math.min(h.fail, 8));
      }
    }

    // Lower is better. An engine in cooldown is pushed to the back rather than removed, so it can
    // still be used if nothing else is available.
    _engineScore(name) {
      const h = this._health(name);
      const inCooldown = Date.now() < h.cooldownUntil;
      const total = h.ok + h.fail;
      const failRate = total ? h.fail / total : 0;
      // Unproven engines get a neutral latency so they are tried before known-slow ones.
      const latency = h.avgMs || 400;
      // A 10% failure rate costs ~150ms of "equivalent latency": reliability matters, but not so
      // much that it outweighs an engine being several times faster.
      return (inCooldown ? 1e6 : 0) + failRate * 1500 + latency;
    }

    // Prefer an official name over the engine's literal translation, when we have one.
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
      // Silent once the extension context is gone — otherwise every failing batch logs to
      // chrome://extensions after an extension reload, which is pure noise.
      if (ROOT.isExtensionAlive && !ROOT.isExtensionAlive()) return;
      const now = Date.now();
      if (now - (this._engineWarnAt[engineName] || 0) < 30000) return;
      this._engineWarnAt[engineName] = now;
      console.warn(`BTE ${engineName} unavailable, falling back:`, error && error.message ? error.message : error);
    }

    setStatusListener(fn) {
      this.statusListener = typeof fn === "function" ? fn : null;
    }

    // "ok" | "busy" (rate-limited but working) | "error" (sustained failure). Booleans accepted
    // for back-compat.
    notifyStatus(state) {
      const s = state === true ? "ok" : state === false ? "error" : state;
      this.lastStatusOk = s !== "error";
      if (this.statusListener) {
        try {
          this.statusListener(s);
        } catch (_error) {
          /* a broken listener must never break translation */
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
        // Switching target language makes every cached entry for the old language unreachable —
        // drop them so the budget goes to the language actually in use.
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

    // Warm the engine's auth/session so the first translation isn't delayed. Fire-and-forget.
    warmUpEngines() {
      try {
        if (!this.settings || !this.settings.enabled) return;
        const engine = this.resolveEngine(this.settings, null);
        const microsoft = this.engines.microsoft;
        if (engine === "microsoft" && microsoft && typeof microsoft.ensureToken === "function") {
          Promise.resolve(microsoft.ensureToken()).catch(() => {});
        }
        // Yandex has the same cold-start cost (a sid scrape); pre-fetch it so the first
        // subtitle/DOM translation isn't delayed by the round trip.
        const yandex = this.engines.yandex;
        if (engine === "yandex" && yandex && typeof yandex.ensureSid === "function") {
          Promise.resolve(yandex.ensureSid(false)).catch(() => {});
        }
      } catch (_error) {
        /* never let warm-up break initialization */
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
      // URLs contain letter+digit runs that must stay joined.
      if (/https?:\/\//.test(s)) return s;
      // Fast path: without Latin/digits none of the boundary rules can match. Covers most CJK.
      if (!/[A-Za-z0-9+\/|]/.test(s)) return s;
      // Protect BV video IDs from being split apart.
      const protected_ = [];
      const protect = (m) => {
        protected_.push(m);
        return `\x02${protected_.length - 1}\x03`;
      };
      let working = s.replace(/\bBV[1-9A-Za-z]{10}\b/g, protect);
      // Media/quality tokens must stay glued: the digit-then-letter rule below would turn "720P"
      // into "720 P", which mangled the player menus and broke dictionary matching.
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
          // Never split BV video IDs or placeholder tokens
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
        // Collapse spaces around apostrophes in contractions: "don ' t" → "don't"
        .replace(/(\w)\s+['\u2019\u02bc]\s*(\w)/g, "$1'$2")
        .replace(/(\w)\s*['\u2019\u02bc]\s+(\w)/g, "$1'$2")
        // Normalize curly/modifier apostrophes to straight apostrophe
        .replace(/[\u2019\u02bc]/g, "'")
        // Collapse unit-slash spacing: "768500 / h" → "768500/h", "32 / h" → "32/h"
        .replace(/(\d)\s+\/\s+([a-zA-Z])/g, "$1/$2")
        // Remove space before unit letter after slash: "32/ h" → "32/h"
        .replace(/\/\s+([a-zA-Z])/g, "/$1")
        .trim();
      // If the source had line breaks but the translation lost them, try to restore them
      // before circled/enclosed numbers (①②③ etc.) which are common in Chinese lists.
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

    // Mechanical fixes for recurring MT errors in English output. English targets only.
    applyEnglishGrammar(text, options) {
      const target = String((options && options.targetLanguage) || "en").toLowerCase();
      if (!target.startsWith("en")) return text;
      let out = String(text || "");
      if (!out) return out;

      // Article by SOUND, not spelling: "a user"/"a unique" but "an hour"/"an honest".
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

      // A standalone "i" is always "I".
      out = out.replace(/\bi\b/g, "I");

      // Punctuation first: "hello.next" must become "hello. next" before the capitaliser can see
      // the sentence boundary.
      out = out
        .replace(/\s+([,.;:!?%])/g, "$1")   // no space before punctuation
        // Space after a comma/semicolon, but never inside a number (1,000) and never after a colon
        // — a colon is commonly part of a token ("10:24", "Note:值") where a space would be wrong.
        .replace(/([,;])(?=[^\s\d])/g, "$1 ")
        .replace(/([.!?])(?=[A-Za-z])/g, "$1 ") // "end.Next" -> "end. Next"
        .replace(/\s{2,}/g, " ")
        .replace(/\(\s+/g, "(").replace(/\s+\)/g, ")")
        .trim();

      // Sentence ends and line breaks only. Position 0 is left to applyCaseShape: Bilibili splits
      // a comment across inline nodes, so a fragment may legitimately start mid-sentence.
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
      // CJK source → always capitalize first letter of English output
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
      // Keyed engines are only usable once their credentials are configured, so they're
      // silently dropped from the chain when unconfigured (both as a primary and a fallback).
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

      // "auto": use whichever service is actually working and fastest. Keyless engines first
      // (no quota to burn), ordered by measured health; a configured keyed engine is only reached
      // if the free ones are failing.
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
        // DeepL falls back to Microsoft first (free, reliable), then Google.
        if (deeplFallbackEnabled) {
          add("microsoft");
          add("google");
        }
      } else if (selected === "yandex") {
        // Yandex's free web endpoint is best-effort (sid rotation / rate limits), so it always
        // falls back to the reliable free engines, then DeepL if the user keyed one.
        add("microsoft");
        add("google");
        add("deepl");
      } else if (selected === "baidu" || selected === "youdao") {
        // China-friendly engines: the other China engine is the most useful fallback (Google/
        // Microsoft/DeepL are often VPN-gated in China), then the free engines as a last resort.
        // Skipped when the user turned the engine's fallback toggle off.
        if (settings[selected] && settings[selected].fallback !== false) {
          add(selected === "baidu" ? "youdao" : "baidu");
          add("microsoft");
          add("google");
        }
      } else if (selected === "papago") {
        // Papago (keyed) falls back to the reliable free engines, then DeepL if keyed.
        if (settings.papago && settings.papago.fallback !== false) {
          add("microsoft");
          add("google");
          add("deepl");
        }
      } else {
        // A free engine is primary: try the other free engine, then DeepL if keyed.
        // Yandex/Baidu/Youdao are intentionally NOT auto-appended here — they're opt-in only,
        // so a best-effort or keyed engine never slows the default Microsoft/Google paths.
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

    // Approximate stored size of an entry (UTF-16 ≈ 2 bytes per char, plus a little overhead).
    _entryBytes(key, value) {
      return (String(key).length + String(value).length) * 2 + 48;
    }

    // Drop expired page-cache entries, then evict oldest-first until we are back under target.
    // Cheap: runs at most once a second, and only walks the page cache.
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
      // Map preserves insertion order, so iterating gives us oldest-first.
      for (const [key, entry] of this.sessionCache) {
        if (this.sessionBytes <= this.SESSION_TARGET_BYTES) break;
        this.sessionBytes -= entry.bytes;
        this.sessionCache.delete(key);
      }
    }

    // When the target language changes, translations for the old language can never be reused, so
    // they are dead weight — dropping them frees the budget for the language now in use.
    dropCachesForOtherLanguages(targetLanguage) {
      const lang = String(targetLanguage || "");
      if (!lang) return;
      // Keys look like: engine::sourceLang::targetLang::text
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
      // Page cache first: applies even when the durable cache is disabled.
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
        memoryHit.hits = (memoryHit.hits || 0) + 1; // feeds eviction scoring
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

    // Worth keeping beyond this page? Short labels recur everywhere; anything seen twice has
    // proven it recurs. A long line seen once never will, so it only costs space.
    isWorthPersisting(sourceText, area) {
      const text = String(sourceText || "");
      if (!text) return false;
      const seen = (this.seenCounts.get(text) || 0) + 1;
      // Bounded: this is a heuristic counter, not a cache.
      if (this.seenCounts.size >= this.SEEN_COUNTS_MAX) {
        const oldest = this.seenCounts.keys().next().value;
        this.seenCounts.delete(oldest);
      }
      this.seenCounts.set(text, seen);
      // Seen more than once anywhere: proven reusable, always keep.
      if (seen >= 2) return true;
      // Comments/danmaku are inherently one-off; require the repeat proof for them.
      if (this.EPHEMERAL_AREAS.has(area)) return false;
      // Otherwise a short label from the page chrome — exactly the reusable material.
      return text.length <= this.IMPORTANT_MAX_LEN;
    }

    // Extract the source text from a cache key (engine::source::target::text).
    _keyText(key) {
      const parts = String(key).split("::");
      return parts.length > 3 ? parts.slice(3).join("::") : "";
    }

    storeCache(key, value, ttlMsOverride, options) {
      if (value == null) {
        return;
      }
      // Always remember it for this page, regardless of the persistent-cache setting. Size-capped
      // and time-limited (see pruneSessionCache) so it can never grow unbounded or go stale.
      const bytes = this._entryBytes(key, value);
      const priorSession = this.sessionCache.get(key);
      if (priorSession) {
        this.sessionBytes -= priorSession.bytes;
        this.sessionCache.delete(key); // re-insert so insertion order stays age order
      }
      this.sessionCache.set(key, { value, at: Date.now(), bytes });
      this.sessionBytes += bytes;
      this.pruneSessionCache();
      if (!this.settings || !this.settings.cache || !this.settings.cache.enabled) return;
      const existing = this.persistentCache.get(key);
      // Importance gate: only promote to the durable tier if this is the kind of text that gets
      // reused. Already-stored entries always refresh (they proved themselves by being stored).
      // Negative-cache markers are short-lived bookkeeping and bypass the gate.
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
        // Preserve accumulated importance when re-storing an already-seen entry.
        hits: (existing && existing.hits) || 0,
      };
      // Running byte total, so pruning never has to re-measure the whole map.
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
      // Budgeted in bytes, not entries: entry sizes vary hugely, so a count limit either wastes
      // space or blows past it.
      const cacheSettings = (this.settings && this.settings.cache) || {};
      const maxBytes = Number.isFinite(cacheSettings.maxBytes) && cacheSettings.maxBytes > 64 * 1024
        ? cacheSettings.maxBytes
        : 4 * 1024 * 1024;
      // persistBytes is an estimate used to skip the common case; recount exactly before evicting
      // so the total self-corrects if anything wrote to the map directly.
      if (this.persistBytes <= maxBytes) return;
      let totalBytes = 0;
      this.persistentCache.forEach((entry, key) => {
        totalBytes += this._entryBytes(key, entry && entry.value);
      });
      this.persistBytes = totalBytes;
      if (totalBytes <= maxBytes) return;
      // Evict by recency + frequency: each prior lookup is worth ~30 min of recency.
      const HIT_WEIGHT_MS = 30 * 60 * 1000;
      const score = (entry) => (entry.updatedAt || 0) + (entry.hits || 0) * HIT_WEIGHT_MS;
      const sorted = Array.from(this.persistentCache.entries()).sort((a, b) => score(a[1]) - score(b[1]));
      // Prune to 80% of budget so we are not re-pruning on every single write.
      const target = maxBytes * 0.8;
      for (const [key, entry] of sorted) {
        if (totalBytes <= target) break;
        totalBytes -= this._entryBytes(key, entry.value);
        this.persistentCache.delete(key);
      }
      this.persistBytes = totalBytes;
    }

    // Writing serialises the whole map (~32ms at 1MB), so wait for a lull, skip small changes,
    // and run in idle time.
    schedulePersist() {
      if (this.persistTimer) {
        // Something else changed — restart the timer so the write lands during a lull, not mid-burst.
        clearTimeout(this.persistTimer);
      }
      this.persistTimer = setTimeout(() => {
        this.persistTimer = null;
        const write = () => {
          // Not enough changed to justify a full serialise. Leave the pending count alone and do
          // NOT re-arm here — the next storeCache will schedule us again. (Re-arming unconditionally
          // created a timer that could never settle.) flushPersist() still writes these on unload.
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

    // Called when the page is going away: write whatever is pending, no debounce.
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
      // Settle every outstanding promise BEFORE the maps are torn down so callers
      // waiting on a translation are never left hanging. Queued single-translate
      // items haven't started yet, so resolve them with an empty (cancelled) result;
      // in-flight batch deferreds resolve with null (the batch's onPartial/storeCache
      // may still complete later — a second resolve on a settled promise is a no-op).
      const droppedQueue = this.singleQueue.splice(0);
      droppedQueue.forEach((item) => {
        try {
          item.resolve(this.buildResult(null, null, false));
        } catch (_error) {
          /* never let one bad callback strand the rest */
        }
      });
      const droppedDeferreds = Array.from(this.pendingDeferreds);
      this.pendingDeferreds.clear();
      droppedDeferreds.forEach((deferred) => {
        try {
          deferred.resolve(null);
        } catch (_error) {
          /* already settled or rejected — ignore */
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
        // Priority hint for the engine's paced scheduler: captions outrank page/comment text.
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
          // A network-level failure (fetch rejected, no HTTP status) is a genuine "can't reach
          // the internet" signal worth surfacing. HTTP errors — 429 rate-limit, 5xx, auth — are
          // engine-specific and handled by the fallback/backoff/retry path, so they must NOT
          // raise the on-page "unavailable" badge (that was the false alarm during heavy load).
          if (!(Number(error?.status) > 0)) threwHard = true;
          // Do NOT log here: a primary engine failing and a fallback engine succeeding is the
          // normal, healthy path (e.g. Microsoft's Edge token 404 → Google). Logging every
          // fall-back floods the console. We only surface the error (throttled) if the WHOLE
          // chain fails to translate the batch — see the caller.
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
        // Only move to the next engine when this one actually FAILED. A null for an individual
        // item usually means "no translation needed" (already English, a number, a name), and
        // retrying those on every other engine is what made selecting one engine hit all of them.
        // An all-null response with no error is treated as a silent failure, so we still fall back.
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
      const prepared = this.preprocessInputText(normalizedRaw);
      if (!prepared) return this.buildResult(null, null, false);
      if (!(options && options.skipDictionary)) {
        const dictHit = this.getDictionaryTranslation(normalizedRaw) || this.getDictionaryTranslation(prepared);
        if (dictHit) {
          const normalizedDict = this.postprocessTranslationText(dictHit, prepared, options) || dictHit;
          return this.buildResult(normalizedDict, "dict", false);
        }
      }
      // The dictionary above needs no storage, so it answers immediately. The cache below does, so
      // it is skipped until initialize() has loaded it.
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
        // Report health for the on-page badge. Any success clears it. We only raise it after a
        // sustained run of HARD (network-level) failures — never for rate-limits / HTTP errors
        // (self-healing) and never for all-empty batches that didn't throw (untranslatable text).
        if (anyTranslated) {
          this._failStreak = 0;
          // Succeeded — but if a soft rate-limit/HTTP error was hit along the way, report "busy"
          // (translating, just paced). There is no on-page indicator for busy, but the status is
          // still tracked so a genuine sustained failure is distinguishable.
          this.notifyStatus(batchThrew && !batchThrewHard ? "busy" : "ok");
        } else if (batchThrewHard) {
          this._failStreak += 1;
          if (this._failStreak >= this._statusErrorThreshold) {
            this.notifyStatus("error");
          }
        } else if (batchThrew) {
          this.notifyStatus("busy");
        }
        // Only log when the ENTIRE chain failed to translate this batch (a genuine problem the
        // fallback did not recover from) — throttled per engine. A primary failing and a fallback
        // succeeding produces no output here, so it never reaches the console.
        if (!anyTranslated && batchThrew && batchError) {
          this._warnEngineThrottled(batchErrorEngine || "translation", batchError);
        }
        batch.forEach((item, index) => {
          const normalized = this.postprocessTranslationText(translatedBatch[index], item.text, options);
          if (normalized) {
            this.storeCache(item.key, normalized, undefined, { area: options && options.area });
          } else if (!batchThrew) {
            // Only negative-cache a genuine "no translation" (engine responded, text
            // unchanged). When the batch threw (network/engine failure) we skip caching
            // so the line retries instead of staying blank for the negative-cache TTL.
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
      // Fast: avg < 400ms → scale up; slow: avg > 1200ms → scale down
      if (avg < 400 && this.maxConcurrentBatches < 6) {
        this.maxConcurrentBatches = Math.min(6, this.maxConcurrentBatches + 1);
      } else if (avg > 1200 && this.maxConcurrentBatches > 1) {
        this.maxConcurrentBatches = Math.max(1, this.maxConcurrentBatches - 1);
      }
    }
  }

  ROOT.TranslationManager = TranslationManager;
})();
