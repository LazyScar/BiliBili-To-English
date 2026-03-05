(function () {
  const ROOT = (window.BTE = window.BTE || {});

  let settingsManager = null;
  let translationManager = null;
  let domTranslator = null;
  let captionManager = null;
  let routePoll = null;
  let routeChangeDebounceTimer = null;
  let currentSettings = null;
  let initialized = false;
  let lastUrl = location.href;

  function isBilibiliHost(hostname) {
    const host = String(hostname || "").toLowerCase();
    return host === "bilibili.com" || host.endsWith(".bilibili.com");
  }

  function shouldActivateHere() {
    if (isBilibiliHost(location.hostname)) return true;
    if (window.top === window.self) return false;
    const ref = String(document.referrer || "");
    return /https?:\/\/([^/]*\.)?bilibili\.com(\/|$)/i.test(ref);
  }

  function ensureLanguageManagerFallback() {
    if (window.languageManager) return;
    window.languageManager = {
      currentLanguage: "en",
      getCurrentLanguage() {
        return this.currentLanguage;
      },
      switchLanguage(lang) {
        this.currentLanguage = lang;
        return true;
      },
      getTranslation(text) {
        const dict = window[`${this.currentLanguage}Dictionary`] || {};
        return dict[text] ?? dict[text.toLowerCase()] ?? null;
      },
    };
  }

  function applyLanguage(settings) {
    if (!window.languageManager || typeof window.languageManager.switchLanguage !== "function") {
      return;
    }
    const lang = settings?.targetLanguage || "en";
    if (window.languageManager.getCurrentLanguage?.() !== lang) {
      window.languageManager.switchLanguage(lang);
    }
  }

  async function applySettings(settings) {
    currentSettings = settings;
    applyLanguage(settings);
    if (!settings.enabled) {
      domTranslator?.stop({ restore: true });
      captionManager?.stop({ restore: true });
      return;
    }
    domTranslator?.updateSettings(settings);
    captionManager?.updateSettings(settings);
  }

  async function clearCaches() {
    if (translationManager) {
      await translationManager.clearAllCaches();
    }
    if (settingsManager) {
      await settingsManager.clearPersistentCache();
    }
  }

  function handleRouteChange() {
    if (!currentSettings?.enabled) return;
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    const settings = settingsManager.getSettings();
    currentSettings = settings;
    applyLanguage(settings);
    // DomTranslator: only restart if it was stopped (e.g. navigating back from an
    // excluded route). When already running, intentionally skip queueNode(document.body):
    // at navigation time the DOM still holds the previous page's content, and scanning
    // it causes a visible flash of stale cached translations moments before BiliBili's
    // SPA re-render replaces everything with fresh Chinese. The running MutationObserver
    // handles new nodes as they are inserted; the rescanPoll is the safety net.
    if (domTranslator && !domTranslator.running) {
      domTranslator.updateSettings(settings);
    }
    // Caption manager clears old video state and starts prefetching the new video.
    captionManager?.updateSettings(settings);
  }

  function scheduleRouteChange() {
    if (routeChangeDebounceTimer) clearTimeout(routeChangeDebounceTimer);
    routeChangeDebounceTimer = setTimeout(() => {
      routeChangeDebounceTimer = null;
      handleRouteChange();
    }, 50);
  }

  function patchHistoryNavigate() {
    // Guard against double-patching (e.g. two content script injections).
    if (history.pushState?.__bte_patched) return;
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    history.pushState = function (...args) {
      const result = origPush.apply(this, args);
      scheduleRouteChange();
      return result;
    };
    history.pushState.__bte_patched = true;
    history.replaceState = function (...args) {
      const result = origReplace.apply(this, args);
      scheduleRouteChange();
      return result;
    };
    history.replaceState.__bte_patched = true;
    window.addEventListener("popstate", scheduleRouteChange);
  }

  function startRoutePolling() {
    patchHistoryNavigate();
    if (routePoll) clearInterval(routePoll);
    // Safety-net poll: catches hash-only changes and rare edge cases
    // where pushState/replaceState was already overridden by another script.
    routePoll = setInterval(handleRouteChange, 5000);
  }

  function registerRuntimeHandlers() {
    if (!chrome?.runtime?.onMessage) return;
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      const respond = (payload) => {
        try {
          sendResponse(payload);
        } catch (_error) {
          // no-op
        }
      };

      if (msg?.type === "bte:updateSettings" || msg?.action === "bte:updateSettings") {
        settingsManager
          .update(msg.payload || {})
          .then((settings) => applySettings(settings).then(() => settings))
          .then((settings) => respond({ success: true, settings }))
          .catch((error) => respond({ success: false, error: String(error) }));
        return true;
      }

      if (msg?.type === "bte:clearCache" || msg?.action === "bte:clearCache") {
        clearCaches()
          .then(() => respond({ success: true }))
          .catch((error) => respond({ success: false, error: String(error) }));
        return true;
      }

      if (msg?.action === "switchLanguage" && msg.language) {
        settingsManager
          .update({ targetLanguage: msg.language })
          .then((settings) => applySettings(settings).then(() => settings))
          .then((settings) => respond({ success: true, settings }))
          .catch((error) => respond({ success: false, error: String(error) }));
        return true;
      }

      if (
        msg?.type === "toggleTranslation" ||
        msg?.action === "toggleTranslation" ||
        msg?.action === "setEnabled"
      ) {
        settingsManager
          .update({ enabled: !!msg.enabled })
          .then((settings) => applySettings(settings).then(() => settings))
          .then((settings) => respond({ success: true, settings }))
          .catch((error) => respond({ success: false, error: String(error) }));
        return true;
      }

      if (msg?.type === "bte:getSettings") {
        respond({ success: true, settings: settingsManager?.getSettings() || null });
      }

      return false;
    });
  }

  async function initialize() {
    if (initialized) return;
    initialized = true;
    if (!shouldActivateHere()) {
      return;
    }
    ensureLanguageManagerFallback();

    settingsManager = new ROOT.SettingsManager();
    currentSettings = await settingsManager.initialize();
    applyLanguage(currentSettings);

    translationManager = new ROOT.TranslationManager(settingsManager);
    await translationManager.initialize();

    domTranslator = new ROOT.DomTranslator(translationManager, settingsManager);
    await domTranslator.initialize();

    captionManager = new ROOT.CaptionManager(translationManager, settingsManager);
    await captionManager.initialize();

    settingsManager.onChange((next) => {
      applySettings(next);
    });

    await applySettings(currentSettings);
    registerRuntimeHandlers();
    startRoutePolling();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
