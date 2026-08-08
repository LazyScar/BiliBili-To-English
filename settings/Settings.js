(function () {
  const ROOT = (window.BTE = window.BTE || {});

  const STORAGE_KEY = "bteSettingsV2";
  const LOCAL_DEEPL_KEY = "bteDeepLApiKey";
  const LOCAL_MICROSOFT_KEY = "bteMicrosoftApiKey";
  const LOCAL_MICROSOFT_REGION = "bteMicrosoftRegion";
  const LOCAL_BAIDU_APPID = "bteBaiduAppid";
  const LOCAL_BAIDU_SECRET = "bteBaiduSecret";
  const LOCAL_YOUDAO_APPKEY = "bteYoudaoAppKey";
  const LOCAL_YOUDAO_APPSECRET = "bteYoudaoAppSecret";
  const LOCAL_PAPAGO_CLIENTID = "btePapagoClientId";
  const LOCAL_PAPAGO_CLIENTSECRET = "btePapagoClientSecret";
  const PERSISTENT_CACHE_KEY = "btePersistentCacheV2";
  const LOCAL_CREDENTIAL_KEYS = [
    LOCAL_DEEPL_KEY,
    LOCAL_MICROSOFT_KEY,
    LOCAL_MICROSOFT_REGION,
    LOCAL_BAIDU_APPID,
    LOCAL_BAIDU_SECRET,
    LOCAL_YOUDAO_APPKEY,
    LOCAL_YOUDAO_APPSECRET,
    LOCAL_PAPAGO_CLIENTID,
    LOCAL_PAPAGO_CLIENTSECRET,
  ];

  const DEFAULT_SETTINGS = {
    enabled: true,
    targetLanguage: "en",
    engine: "auto",
    deepl: {
      apiKey: "",
      endpointMode: "auto",
      fallbackToGoogle: true,
      optimizeUsage: false,
    },
    microsoft: {
      apiKey: "",
      region: "",
      useAzure: false,
    },
    baidu: {
      appid: "",
      secret: "",
      optimizeUsage: false,
      fallback: true,
    },
    youdao: {
      appKey: "",
      appSecret: "",
      optimizeUsage: false,
      fallback: true,
    },
    papago: {
      clientId: "",
      clientSecret: "",
      optimizeUsage: false,
      fallback: true,
    },
    bilingual: {
      captions: "off",
      page: "off",
      comments: "off",
      dynamic: "off",
      danmaku: "off",
    },
    areas: {
      page: true,
      comments: true,
      dynamic: true,
      danmaku: true,
      captions: true,
      creatorPages: true,
    },
    cache: {
      enabled: true,
      ttlMs: 7 * 24 * 60 * 60 * 1000,
      maxEntries: 2000,
      maxBytes: 4 * 1024 * 1024,
    },
    learn: {
      blurCaption: false,
      hoverTranslate: false,
      fitText: false,
      properNouns: false,
    },
    strictCreatorMode: false,
    darkMode: true,
  };

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function deepMerge(base, patch) {
    if (!patch || typeof patch !== "object") {
      return base;
    }
    const output = Array.isArray(base) ? base.slice() : { ...base };
    Object.keys(patch).forEach((key) => {
      const incoming = patch[key];
      const current = output[key];
      if (
        incoming &&
        typeof incoming === "object" &&
        !Array.isArray(incoming) &&
        current &&
        typeof current === "object" &&
        !Array.isArray(current)
      ) {
        output[key] = deepMerge(current, incoming);
      } else {
        output[key] = incoming;
      }
    });
    return output;
  }

  function normalizeMode(value) {
    const valid = new Set(["off", "stacked", "sideBySide"]);
    return valid.has(value) ? value : "off";
  }

  function normalizeEndpoint(value) {
    const valid = new Set(["auto", "free", "pro"]);
    return valid.has(value) ? value : "auto";
  }

  function normalizeEngine(value) {
    if (value === "auto") return "auto";
    if (value === "deepl") return "deepl";
    if (value === "microsoft") return "microsoft";
    if (value === "yandex") return "yandex";
    if (value === "baidu") return "baidu";
    if (value === "youdao") return "youdao";
    if (value === "papago") return "papago";
    return "google";
  }

  function normalizeLanguage(value) {
    return typeof value === "string" && value.trim() ? value.trim() : "en";
  }

  function normalizeSettings(raw) {
    const merged = deepMerge(deepClone(DEFAULT_SETTINGS), raw || {});
    merged.enabled = merged.enabled !== false;
    merged.targetLanguage = normalizeLanguage(merged.targetLanguage);
    merged.engine = normalizeEngine(merged.engine);
    merged.deepl = merged.deepl || {};
    merged.deepl.apiKey = typeof merged.deepl.apiKey === "string" ? merged.deepl.apiKey.trim() : "";
    merged.deepl.endpointMode = normalizeEndpoint(merged.deepl.endpointMode);
    merged.deepl.fallbackToGoogle = merged.deepl.fallbackToGoogle !== false;
    merged.deepl.optimizeUsage = merged.deepl.optimizeUsage === true;
    merged.microsoft = merged.microsoft || {};
    merged.microsoft.apiKey = typeof merged.microsoft.apiKey === "string" ? merged.microsoft.apiKey.trim() : "";
    merged.microsoft.region = typeof merged.microsoft.region === "string" ? merged.microsoft.region.trim() : "";
    merged.microsoft.useAzure = merged.microsoft.useAzure === true && !!merged.microsoft.apiKey;
    merged.baidu = merged.baidu || {};
    merged.baidu.appid = typeof merged.baidu.appid === "string" ? merged.baidu.appid.trim() : "";
    merged.baidu.secret = typeof merged.baidu.secret === "string" ? merged.baidu.secret.trim() : "";
    merged.baidu.optimizeUsage = merged.baidu.optimizeUsage === true;
    merged.baidu.fallback = merged.baidu.fallback !== false;
    merged.youdao = merged.youdao || {};
    merged.youdao.appKey = typeof merged.youdao.appKey === "string" ? merged.youdao.appKey.trim() : "";
    merged.youdao.appSecret = typeof merged.youdao.appSecret === "string" ? merged.youdao.appSecret.trim() : "";
    merged.youdao.optimizeUsage = merged.youdao.optimizeUsage === true;
    merged.youdao.fallback = merged.youdao.fallback !== false;
    merged.papago = merged.papago || {};
    merged.papago.clientId = typeof merged.papago.clientId === "string" ? merged.papago.clientId.trim() : "";
    merged.papago.clientSecret = typeof merged.papago.clientSecret === "string" ? merged.papago.clientSecret.trim() : "";
    merged.papago.optimizeUsage = merged.papago.optimizeUsage === true;
    merged.papago.fallback = merged.papago.fallback !== false;
    merged.bilingual = merged.bilingual || {};
    merged.bilingual.captions = normalizeMode(merged.bilingual.captions);
    merged.bilingual.page = normalizeMode(merged.bilingual.page);
    merged.bilingual.comments = normalizeMode(merged.bilingual.comments);
    merged.bilingual.dynamic = normalizeMode(merged.bilingual.dynamic);
    merged.bilingual.danmaku = normalizeMode(merged.bilingual.danmaku);
    merged.areas = merged.areas || {};
    merged.areas.page = merged.areas.page !== false;
    merged.areas.comments = merged.areas.comments !== false;
    merged.areas.dynamic = merged.areas.dynamic !== false;
    merged.areas.danmaku = !!merged.areas.danmaku;
    merged.areas.captions = merged.areas.captions !== false;
    merged.areas.creatorPages = !!merged.areas.creatorPages;
    merged.cache = merged.cache || {};
    merged.cache.enabled = merged.cache.enabled !== false;
    merged.cache.ttlMs = Number.isFinite(merged.cache.ttlMs) && merged.cache.ttlMs > 10_000 ? merged.cache.ttlMs : DEFAULT_SETTINGS.cache.ttlMs;
    merged.cache.maxEntries =
      Number.isFinite(merged.cache.maxEntries) && merged.cache.maxEntries >= 100
        ? Math.floor(merged.cache.maxEntries)
        : DEFAULT_SETTINGS.cache.maxEntries;
    merged.cache.maxBytes =
      Number.isFinite(merged.cache.maxBytes) && merged.cache.maxBytes >= 64 * 1024
        ? Math.floor(merged.cache.maxBytes)
        : DEFAULT_SETTINGS.cache.maxBytes;
    merged.strictCreatorMode = false;
    merged.learn = merged.learn || {};
    merged.learn.blurCaption = merged.learn.blurCaption === true;
    merged.learn.hoverTranslate = merged.learn.hoverTranslate === true;
    merged.learn.fitText = merged.learn.fitText === true;
    merged.learn.properNouns = merged.learn.properNouns === true;
    merged.darkMode = merged.darkMode !== false;
    return merged;
  }

  function getStorage(area) {
    if (!globalThis.chrome || !globalThis.chrome.storage || !globalThis.chrome.storage[area]) {
      return null;
    }
    return globalThis.chrome.storage[area];
  }

  function storageGet(area, keys) {
    const storage = getStorage(area);
    if (!storage) return Promise.resolve({});
    return new Promise((resolve) => storage.get(keys, resolve));
  }

  function storageSet(area, payload) {
    const storage = getStorage(area);
    if (!storage) return Promise.resolve();
    return new Promise((resolve) => storage.set(payload, resolve));
  }

  function storageRemove(area, keys) {
    const storage = getStorage(area);
    if (!storage) return Promise.resolve();
    return new Promise((resolve) => storage.remove(keys, resolve));
  }

  class SettingsManager {
    constructor() {
      this.settings = null;
      this.listeners = new Set();
      this.handleStorageChange = this.handleStorageChange.bind(this);
      this.initialized = false;
      this.storageListenerAttached = false;
    }

    async initialize() {
      if (this.initialized && this.settings) {
        return this.getSettings();
      }
      const [syncData, localData] = await Promise.all([
        storageGet("sync", [STORAGE_KEY, "enabled", "selectedLanguage", "language", "darkMode"]),
        storageGet("local", LOCAL_CREDENTIAL_KEYS),
      ]);
      const migrated = this.migrate(syncData, localData);
      this.settings = normalizeSettings(migrated);
      await this.persist(this.settings, { silent: true });
      if (
        !this.storageListenerAttached &&
        globalThis.chrome &&
        globalThis.chrome.storage &&
        globalThis.chrome.storage.onChanged
      ) {
        globalThis.chrome.storage.onChanged.addListener(this.handleStorageChange);
        this.storageListenerAttached = true;
      }
      this.initialized = true;
      return this.getSettings();
    }

    destroy() {
      if (
        this.storageListenerAttached &&
        globalThis.chrome &&
        globalThis.chrome.storage &&
        globalThis.chrome.storage.onChanged
      ) {
        globalThis.chrome.storage.onChanged.removeListener(this.handleStorageChange);
        this.storageListenerAttached = false;
      }
    }

    getSettings() {
      return deepClone(this.settings || DEFAULT_SETTINGS);
    }

    onChange(callback) {
      if (typeof callback !== "function") return () => {};
      this.listeners.add(callback);
      return () => this.listeners.delete(callback);
    }

    async refresh() {
      const [syncData, localData] = await Promise.all([
        storageGet("sync", [STORAGE_KEY, "enabled", "selectedLanguage", "language", "darkMode"]),
        storageGet("local", LOCAL_CREDENTIAL_KEYS),
      ]);
      this.settings = normalizeSettings(this.migrate(syncData, localData));
      this.initialized = true;
      return this.getSettings();
    }

    async update(partial) {
      const current = this.settings || (await this.initialize());
      const merged = normalizeSettings(deepMerge(current, partial || {}));
      this.settings = merged;
      await this.persist(merged, { silent: true });
      this.emit(merged);
      return this.getSettings();
    }

    async setEnabled(enabled) {
      return this.update({ enabled: !!enabled });
    }

    async setTargetLanguage(targetLanguage) {
      return this.update({ targetLanguage });
    }

    async clearPersistentCache() {
      await storageRemove("local", [PERSISTENT_CACHE_KEY]);
    }

    migrate(syncData, localData) {
      const legacyLanguage = syncData.selectedLanguage || syncData.language || DEFAULT_SETTINGS.targetLanguage;
      const legacyEnabled = syncData.enabled !== false;
      const legacyDarkMode = syncData.darkMode !== false;
      const storedV2 = syncData[STORAGE_KEY] || {};
      const merged = deepMerge(DEFAULT_SETTINGS, storedV2);
      merged.enabled = typeof storedV2.enabled === "boolean" ? storedV2.enabled : legacyEnabled;
      merged.targetLanguage = storedV2.targetLanguage || legacyLanguage;
      merged.darkMode = typeof storedV2.darkMode === "boolean" ? storedV2.darkMode : legacyDarkMode;
      const hasCreatorFlag =
        !!storedV2.areas && Object.prototype.hasOwnProperty.call(storedV2.areas, "creatorPages");
      if (!hasCreatorFlag) {
        merged.areas = merged.areas || {};
        merged.areas.creatorPages = true;
      }
      if (!Object.prototype.hasOwnProperty.call(storedV2, "strictCreatorMode")) {
        merged.strictCreatorMode = false;
      }
      merged.deepl = merged.deepl || {};
      merged.deepl.apiKey = (localData && localData[LOCAL_DEEPL_KEY]) || merged.deepl.apiKey || "";
      merged.microsoft = merged.microsoft || {};
      merged.microsoft.apiKey =
        (localData && localData[LOCAL_MICROSOFT_KEY]) || merged.microsoft.apiKey || "";
      merged.microsoft.region =
        (localData && localData[LOCAL_MICROSOFT_REGION]) || merged.microsoft.region || "";
      merged.baidu = merged.baidu || {};
      merged.baidu.appid = (localData && localData[LOCAL_BAIDU_APPID]) || merged.baidu.appid || "";
      merged.baidu.secret = (localData && localData[LOCAL_BAIDU_SECRET]) || merged.baidu.secret || "";
      merged.youdao = merged.youdao || {};
      merged.youdao.appKey = (localData && localData[LOCAL_YOUDAO_APPKEY]) || merged.youdao.appKey || "";
      merged.youdao.appSecret =
        (localData && localData[LOCAL_YOUDAO_APPSECRET]) || merged.youdao.appSecret || "";
      merged.papago = merged.papago || {};
      merged.papago.clientId = (localData && localData[LOCAL_PAPAGO_CLIENTID]) || merged.papago.clientId || "";
      merged.papago.clientSecret =
        (localData && localData[LOCAL_PAPAGO_CLIENTSECRET]) || merged.papago.clientSecret || "";
      return merged;
    }

    async persist(settings, options) {
      const safe = deepClone(settings);
      const deeplKey = safe.deepl?.apiKey || "";
      const microsoftKey = safe.microsoft?.apiKey || "";
      const microsoftRegion = safe.microsoft?.region || "";
      const baiduAppid = safe.baidu?.appid || "";
      const baiduSecret = safe.baidu?.secret || "";
      const youdaoAppKey = safe.youdao?.appKey || "";
      const youdaoAppSecret = safe.youdao?.appSecret || "";
      const papagoClientId = safe.papago?.clientId || "";
      const papagoClientSecret = safe.papago?.clientSecret || "";
      if (safe.deepl) {
        delete safe.deepl.apiKey;
      }
      if (safe.microsoft) {
        delete safe.microsoft.apiKey;
        delete safe.microsoft.region;
      }
      if (safe.baidu) {
        delete safe.baidu.appid;
        delete safe.baidu.secret;
      }
      if (safe.youdao) {
        delete safe.youdao.appKey;
        delete safe.youdao.appSecret;
      }
      if (safe.papago) {
        delete safe.papago.clientId;
        delete safe.papago.clientSecret;
      }
      await Promise.all([
        storageSet("sync", {
          [STORAGE_KEY]: safe,
          enabled: safe.enabled,
          selectedLanguage: safe.targetLanguage,
          language: safe.targetLanguage,
          darkMode: safe.darkMode,
        }),
        storageSet("local", {
          [LOCAL_DEEPL_KEY]: deeplKey,
          [LOCAL_MICROSOFT_KEY]: microsoftKey,
          [LOCAL_MICROSOFT_REGION]: microsoftRegion,
          [LOCAL_BAIDU_APPID]: baiduAppid,
          [LOCAL_BAIDU_SECRET]: baiduSecret,
          [LOCAL_YOUDAO_APPKEY]: youdaoAppKey,
          [LOCAL_YOUDAO_APPSECRET]: youdaoAppSecret,
          [LOCAL_PAPAGO_CLIENTID]: papagoClientId,
          [LOCAL_PAPAGO_CLIENTSECRET]: papagoClientSecret,
        }),
      ]);
      if (!options || !options.silent) {
        this.emit(settings);
      }
    }

    async handleStorageChange(changes, areaName) {
      const syncChanged =
        areaName === "sync" &&
        (Object.prototype.hasOwnProperty.call(changes, STORAGE_KEY) ||
          Object.prototype.hasOwnProperty.call(changes, "enabled") ||
          Object.prototype.hasOwnProperty.call(changes, "selectedLanguage") ||
          Object.prototype.hasOwnProperty.call(changes, "language"));
      const localChanged =
        areaName === "local" &&
        LOCAL_CREDENTIAL_KEYS.some((key) => Object.prototype.hasOwnProperty.call(changes, key));
      if (!syncChanged && !localChanged) return;
      const latest = await this.refresh();
      this.emit(latest);
    }

    emit(settings) {
      const snapshot = deepClone(settings);
      this.listeners.forEach((listener) => {
        try {
          listener(snapshot);
        } catch (error) {
          console.error("BTE settings listener error:", error);
        }
      });
    }
  }

  ROOT.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
  ROOT.BTE_KEYS = {
    STORAGE_KEY,
    LOCAL_DEEPL_KEY,
    LOCAL_MICROSOFT_KEY,
    LOCAL_MICROSOFT_REGION,
    LOCAL_BAIDU_APPID,
    LOCAL_BAIDU_SECRET,
    LOCAL_YOUDAO_APPKEY,
    LOCAL_YOUDAO_APPSECRET,
    LOCAL_PAPAGO_CLIENTID,
    LOCAL_PAPAGO_CLIENTSECRET,
    PERSISTENT_CACHE_KEY,
  };
  ROOT.SettingsManager = SettingsManager;
})();
