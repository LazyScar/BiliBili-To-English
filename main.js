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
  let lastAppliedSignature = "";

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

  // Small, unobtrusive page badge shown when translations can't be fetched (network /
  // engine errors). Lives bottom-left so it never collides with captions (bottom-center)
  // or Bilibili's back-to-top control (bottom-right). Owned by us so it is never itself
  // translated or scanned. Top-frame only.
  class StatusIndicator {
    constructor() {
      this.el = null;
      this.state = "ok";
      this.hideTimer = null;
    }

    ensureEl() {
      if (this.el && this.el.isConnected) return this.el;
      const el = document.createElement("div");
      el.setAttribute("data-bte-owned", "1");
      el.setAttribute("role", "status");
      el.style.cssText = [
        "position:fixed", "left:16px", "bottom:16px", "z-index:2147483647",
        "display:flex", "align-items:center", "gap:8px",
        "padding:8px 12px", "border-radius:999px",
        "background:rgba(15,17,22,0.92)", "color:#e9edf7",
        "font:600 12px/1 'Segoe UI',system-ui,sans-serif",
        "border:1px solid rgba(251,114,153,0.45)",
        "box-shadow:0 8px 24px rgba(0,0,0,0.45)", "backdrop-filter:blur(6px)",
        "pointer-events:none", "opacity:0", "transform:translateY(6px)",
        "transition:opacity .2s ease, transform .2s ease",
      ].join(";");
      const dot = document.createElement("span");
      dot.style.cssText =
        "width:8px;height:8px;border-radius:50%;background:#fb7299;box-shadow:0 0 8px #fb7299;flex:0 0 auto;";
      const label = document.createElement("span");
      label.textContent = "Translation unavailable — retrying";
      el.appendChild(dot);
      el.appendChild(label);
      (document.body || document.documentElement).appendChild(el);
      this.el = el;
      return el;
    }

    show() {
      const el = this.ensureEl();
      requestAnimationFrame(() => {
        el.style.opacity = "1";
        el.style.transform = "translateY(0)";
      });
    }

    hide() {
      if (!this.el) return;
      this.el.style.opacity = "0";
      this.el.style.transform = "translateY(6px)";
    }

    update(status) {
      if (this.hideTimer) {
        clearTimeout(this.hideTimer);
        this.hideTimer = null;
      }
      if (status === "error") {
        if (this.state !== "error") {
          this.state = "error";
          this.show();
        }
        // Auto-recover the badge if the errors simply stop arriving.
        this.hideTimer = setTimeout(() => {
          this.state = "ok";
          this.hide();
        }, 6000);
      } else if (this.state === "error") {
        this.state = "ok";
        this.hideTimer = setTimeout(() => this.hide(), 1200);
      }
    }
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
    // A single popup change reaches us through both the runtime message AND the
    // storage-change/onChange path, so applySettings can be invoked 2–3 times with
    // identical settings. Each invocation triggers a full DOM rescan + caption
    // re-prefetch, so skip when nothing actually changed. (Route changes go through
    // handleRouteChange, not here, so navigation re-applies are unaffected.)
    const signature = JSON.stringify(settings);
    if (signature === lastAppliedSignature) return;
    lastAppliedSignature = signature;
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

    // Surface fetch/engine failures on the page (top frame only).
    if (window.top === window.self) {
      const statusIndicator = new StatusIndicator();
      translationManager.setStatusListener((status) => statusIndicator.update(status));
    }

    domTranslator = new ROOT.DomTranslator(translationManager, settingsManager);
    await domTranslator.initialize();

    captionManager = new ROOT.CaptionManager(translationManager, settingsManager);
    await captionManager.initialize();

    settingsManager.onChange((next) => {
      applySettings(next).catch((error) => console.warn("BTE applySettings failed:", error));
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
