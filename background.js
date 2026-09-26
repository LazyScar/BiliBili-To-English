if (typeof importScripts === "function" && typeof window === "undefined") {
  try {
    importScripts("translation/cacheStore.js");
  } catch (_error) {
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "bte:bgFetch" || !message.payload) {
    return false;
  }
  if (sender && sender.id && sender.id !== chrome.runtime.id) {
    return false;
  }

  const payload = message.payload;
  const url = String(payload.url || "");
  if (!url) {
    sendResponse({ ok: false, error: "Missing URL" });
    return true;
  }

  // A hung request would otherwise keep the content script's callback (and the engine queue
  // behind it) waiting forever.
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeoutMs = Math.min(30000, Math.max(1000, Number(payload.timeoutMs) || 15000));
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  const init = {
    method: payload.method || "GET",
    headers: payload.headers || {},
    body: payload.body,
    credentials: payload.credentials || "omit",
    redirect: "follow",
  };
  if (controller) init.signal = controller.signal;

  fetch(url, init)
    .then(async (response) => {
      const text = await response.text();
      sendResponse({
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        text,
      });
    })
    .catch((error) => {
      sendResponse({
        ok: false,
        status: 0,
        statusText: "Network Error",
        error: String(error),
      });
    })
    .finally(() => {
      if (timer) clearTimeout(timer);
    });

  return true;
});

const SETTINGS_KEY = "bteSettingsV2";
if (chrome.commands && chrome.commands.onCommand) {
  chrome.commands.onCommand.addListener((command) => {
    if (command !== "toggle-translation") return;
    chrome.storage.sync.get([SETTINGS_KEY, "enabled"], (data) => {
      if (chrome.runtime.lastError) return;
      const stored = (data && data[SETTINGS_KEY]) || {};
      const current = typeof stored.enabled === "boolean" ? stored.enabled : data.enabled !== false;
      const next = { ...stored, enabled: !current };
      chrome.storage.sync.set({ [SETTINGS_KEY]: next, enabled: !current }, () => {
        void chrome.runtime.lastError;
      });
    });
  });
}

let cacheCompaction = null;
chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || message.type !== "bte:cacheCompact") return false;
  if (sender && sender.id && sender.id !== chrome.runtime.id) return false;
  const host = typeof window !== "undefined" ? window : globalThis;
  const store = host.BTE && host.BTE.CacheStore;
  if (store && !cacheCompaction) {
    cacheCompaction = new Promise((resolve) => chrome.storage.sync.get(SETTINGS_KEY, resolve))
      .then((data) => {
        const cache = data && data[SETTINGS_KEY] && data[SETTINGS_KEY].cache;
        return store.compact(cache && cache.maxBytes);
      })
      .catch(() => {})
      .finally(() => {
        cacheCompaction = null;
      });
  }
  return false;
});

// After an update, pages that were already open lost their connection to the extension:
// load the new version into them so they keep translating without a reload.
if (chrome.runtime.onInstalled && chrome.scripting && chrome.scripting.executeScript) {
  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason !== "update") return;
    const scripts = (chrome.runtime.getManifest().content_scripts || []).find((cs) => !cs.world || cs.world === "ISOLATED");
    if (!scripts) return;
    chrome.tabs.query({ url: ["*://*.bilibili.com/*", "*://bilibili.com/*"] }, (tabs) => {
      if (chrome.runtime.lastError || !tabs) return;
      tabs.forEach((tab) => {
        if (tab.discarded) return;
        chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: scripts.js }).catch(() => {});
      });
    });
  });
}
