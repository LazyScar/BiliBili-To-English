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

  class StatusIndicator {
    constructor() {
      this.el = null;
      this.labelEl = null;
      this.iconEl = null;
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
        "display:flex", "align-items:center", "gap:7px",
        "padding:7px 11px", "border-radius:8px",
        "background:#23262e", "color:#c9ced9",
        "font:500 12px/1.2 'Segoe UI',system-ui,sans-serif",
        "border:1px solid rgba(255,255,255,0.09)",
        "box-shadow:0 4px 14px rgba(0,0,0,0.3)",
        "pointer-events:none", "opacity:0", "transform:translateY(6px)",
        "transition:opacity .2s ease, transform .2s ease",
      ].join(";");
      const icon = document.createElement("span");
      icon.style.cssText = "display:inline-flex;flex:0 0 auto;color:#8a90a0;";
      const label = document.createElement("span");
      el.appendChild(icon);
      el.appendChild(label);
      (document.body || document.documentElement).appendChild(el);
      this.el = el;
      this.labelEl = label;
      this.iconEl = icon;
      return el;
    }

    setVariant() {
      if (!this.iconEl) return;
      this.iconEl.style.color = "#e0708f";
      this.iconEl.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1l22 22"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><path d="M1.42 9a15.9 15.9 0 0 1 4.7-2.88"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>';
      if (this.el) this.el.style.borderColor = "rgba(224,112,143,0.4)";
    }

    show(text) {
      const el = this.ensureEl();
      this.setVariant();
      if (this.labelEl && text) this.labelEl.textContent = text;
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

    render() {
      if (this.state === "offline") {
        this.show("You are offline");
      } else if (this.state === "error") {
        this.show("Translation unavailable");
      } else {
        this.hide();
      }
    }

    setOffline(off) {
      if (off) {
        this.state = "offline";
        if (this.hideTimer) { clearTimeout(this.hideTimer); this.hideTimer = null; }
        this.render();
      } else if (this.state === "offline") {
        this.state = "ok";
        this.render();
      }
    }

    update(status) {
      if (this.state === "offline") return;
      if (status === "busy") return;
      if (this.hideTimer) { clearTimeout(this.hideTimer); this.hideTimer = null; }
      if (status === "error") {
        this.state = "error";
        this.render();
        this.hideTimer = setTimeout(() => { this.state = "ok"; this.render(); }, 8000);
      } else if (this.state === "error") {
        this.state = "ok";
        this.hideTimer = setTimeout(() => this.render(), 600);
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
    if (domTranslator && !domTranslator.running) {
      domTranslator.updateSettings(settings);
    }
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
    routePoll = setInterval(handleRouteChange, 5000);
  }

  function registerRuntimeHandlers() {
    if (!chrome?.runtime?.onMessage) return;
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      const respond = (payload) => {
        try {
          sendResponse(payload);
        } catch (_error) {
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

      if (msg?.type === "bte:getEngineStatus") {
        respond({ success: true, status: translationManager?.getEngineStatus?.() || null });
      }

      return false;
    });
  }

  async function ensureCore() {
    if (!settingsManager) {
      ensureLanguageManagerFallback();
      settingsManager = new ROOT.SettingsManager();
      currentSettings = await settingsManager.initialize();
      applyLanguage(currentSettings);
    }
    if (!translationManager) {
      translationManager = new ROOT.TranslationManager(settingsManager);
      await translationManager.initialize();
    }
    if (!captionManager) {
      captionManager = new ROOT.CaptionManager(translationManager, settingsManager);
      await captionManager.initialize();
    }
  }

  async function primeCaptions() {
    if (!shouldActivateHere()) return;
    try {
      await ensureCore();
      if (!currentSettings?.enabled || !currentSettings?.areas?.captions) return;
      captionManager.updateSettings(currentSettings);
    } catch (_error) {
    }
  }

  async function initialize() {
    if (initialized) return;
    initialized = true;
    if (!shouldActivateHere()) {
      return;
    }
    await ensureCore();

    if (window.top === window.self) {
      const statusIndicator = new StatusIndicator();
      translationManager.setStatusListener((status) => statusIndicator.update(status));
      statusIndicator.setOffline(typeof navigator !== "undefined" && navigator.onLine === false);
      window.addEventListener("offline", () => statusIndicator.setOffline(true));
      window.addEventListener("online", () => statusIndicator.setOffline(false));
    }

    domTranslator = new ROOT.DomTranslator(translationManager, settingsManager);
    await domTranslator.initialize();

    settingsManager.onChange((next) => {
      applySettings(next).catch((error) => console.warn("BTE applySettings failed:", error));
    });

    await applySettings(currentSettings);
    registerRuntimeHandlers();
    startRoutePolling();
    startContextWatch();
    window.addEventListener("pagehide", () => {
      try { translationManager?.flushPersist?.(); } catch (_error) {}
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        try { translationManager?.flushPersist?.(); } catch (_error) {}
      }
    });
  }

  function startContextWatch() {
    const contextWatch = setInterval(() => {
      let alive = true;
      try {
        alive = !!(typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id);
      } catch (_error) {
        alive = false;
      }
      if (alive) return;
      clearInterval(contextWatch);
      if (routePoll) clearInterval(routePoll);
      try { domTranslator?.stop({ restore: false }); } catch (_error) {}
      try { captionManager?.stop({ restore: false }); } catch (_error) {}
    }, 4000);
  }

  if (document.readyState === "loading") {
    void primeCaptions();
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
