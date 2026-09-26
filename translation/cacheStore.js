(function () {
  // Content scripts share window.BTE (Firefox's globalThis there is a sandbox); workers have no window.
  const HOST = typeof window !== "undefined" ? window : globalThis;
  const ROOT = (HOST.BTE = HOST.BTE || {});

  // One compacted base plus one small log per page, so tabs never overwrite each other.
  const BASE_KEY = "bteCacheV3";
  const LOG_PREFIX = "bteCacheV3:log:";
  const LEGACY_KEY = "btePersistentCacheV2";
  const NEGATIVE = "__BTE_NO_TRANSLATION__";
  const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
  const HIT_WEIGHT_MS = 30 * 60 * 1000;

  function local() {
    try {
      const api = globalThis.chrome;
      return api && api.storage && api.storage.local ? api.storage.local : null;
    } catch (_error) {
      return null;
    }
  }

  // After an extension update, old pages' storage calls throw; they just do nothing then.
  function call(method, arg) {
    const area = local();
    return new Promise((resolve) => {
      try {
        if (!area) resolve(undefined);
        else area[method](arg, resolve);
      } catch (_error) {
        resolve(undefined);
      }
    });
  }

  async function getAll() {
    return (await call("get", null)) || null;
  }

  function isCacheKey(key) {
    return key === BASE_KEY || key === LEGACY_KEY || key === "bteNamesV1" || String(key).startsWith(LOG_PREFIX);
  }

  function entryBytes(key, value) {
    return (String(key).length + String(value == null ? "" : value).length) * 2;
  }

  function mergeEntry(map, key, entry) {
    const prior = map.get(key);
    if (!prior) {
      map.set(key, entry);
      return;
    }
    const newer = (entry.updatedAt || 0) >= (prior.updatedAt || 0) ? entry : prior;
    const hits = Math.max(entry.hits || 0, prior.hits || 0);
    if (newer.hits !== hits) newer.hits = hits;
    map.set(key, newer);
  }

  function decodeRows(text, into, now) {
    let rows;
    try {
      rows = JSON.parse(text);
    } catch (_error) {
      return;
    }
    if (!Array.isArray(rows)) return;
    rows.forEach((row) => {
      if (!Array.isArray(row) || row[1] == null) return;
      const entry = { value: row[1], updatedAt: row[2] || 0, expiresAt: row[3] || 0, hits: row[4] || 0 };
      if (entry.expiresAt && entry.expiresAt <= now) return;
      mergeEntry(into, row[0], entry);
    });
  }

  function encodeRows(entries) {
    const rows = [];
    entries.forEach((entry, key) => {
      if (entry && entry.value != null) rows.push([key, entry.value, entry.updatedAt || 0, entry.expiresAt || 0, entry.hits || 0]);
    });
    return JSON.stringify(rows);
  }

  function decodeAll(data) {
    const now = Date.now();
    const entries = new Map();
    const logKeys = [];
    let legacy = false;
    const old = data[LEGACY_KEY];
    if (old && typeof old === "object" && old.entries && typeof old.entries === "object") {
      legacy = true;
      Object.keys(old.entries).forEach((key) => {
        const entry = old.entries[key];
        if (!entry || entry.value == null || (entry.expiresAt && entry.expiresAt <= now)) return;
        mergeEntry(entries, key, { value: entry.value, updatedAt: entry.updatedAt || 0, expiresAt: entry.expiresAt || 0, hits: entry.hits || 0 });
      });
    } else if (old !== undefined) {
      legacy = true;
    }
    if (typeof data[BASE_KEY] === "string") decodeRows(data[BASE_KEY], entries, now);
    Object.keys(data).forEach((key) => {
      if (!key.startsWith(LOG_PREFIX)) return;
      logKeys.push(key);
      if (typeof data[key] === "string") decodeRows(data[key], entries, now);
    });
    return { entries, logKeys, legacy };
  }

  async function readAll() {
    return decodeAll((await getAll()) || {});
  }

  function prune(entries, maxBytes) {
    const now = Date.now();
    let total = 0;
    entries.forEach((entry, key) => {
      if (!entry || (entry.expiresAt && entry.expiresAt <= now)) {
        entries.delete(key);
        return;
      }
      total += entryBytes(key, entry.value);
    });
    const budget = Number.isFinite(maxBytes) && maxBytes > 64 * 1024 ? maxBytes : DEFAULT_MAX_BYTES;
    if (total <= budget) return total;
    const score = (entry) => (entry.updatedAt || 0) + (entry.hits || 0) * HIT_WEIGHT_MS;
    const sorted = Array.from(entries.entries()).sort((a, b) => score(a[1]) - score(b[1]));
    const target = budget * 0.8;
    for (const [key, entry] of sorted) {
      if (total <= target) break;
      total -= entryBytes(key, entry.value);
      entries.delete(key);
    }
    return total;
  }

  async function compact(maxBytes) {
    const data = await getAll();
    if (!data) return;
    const { entries, logKeys, legacy } = decodeAll(data);
    prune(entries, maxBytes);
    await call("set", { [BASE_KEY]: encodeRows(entries) });
    const stale = logKeys.concat(legacy ? [LEGACY_KEY] : []);
    if (stale.length) await call("remove", stale);
  }

  async function removeAll() {
    const keys = Object.keys((await getAll()) || {}).filter(isCacheKey);
    if (keys.length) await call("remove", keys);
  }

  function stats(entries) {
    let count = 0;
    let bytes = 0;
    entries.forEach((entry, key) => {
      if (!entry || entry.value === NEGATIVE) return;
      count += 1;
      bytes += entryBytes(key, entry.value);
    });
    return { count, bytes };
  }

  ROOT.CacheStore = {
    BASE_KEY,
    LOG_PREFIX,
    LEGACY_KEY,
    isCacheKey,
    entryBytes,
    encodeRows,
    decodeAll,
    readAll,
    prune,
    compact,
    removeAll,
    stats,
  };
})();
