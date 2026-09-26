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
  const instanceId = `${Date.now()}-${Math.random()}`;

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

  const TOAST_TEXT = {
    en: { offline: "You are offline", error: "Translation unavailable", on: "Translation on", off: "Translation off" },
    fr: { offline: "Vous êtes hors ligne", error: "Traduction indisponible", on: "Traduction activée", off: "Traduction désactivée" },
    ja: { offline: "オフラインです", error: "翻訳を利用できません", on: "翻訳オン", off: "翻訳オフ" },
    ru: { offline: "Нет подключения к сети", error: "Перевод недоступен", on: "Перевод включён", off: "Перевод выключен" },
    vi: { offline: "Bạn đang ngoại tuyến", error: "Không thể dịch", on: "Đã bật dịch", off: "Đã tắt dịch" },
    id: { offline: "Anda sedang offline", error: "Terjemahan tidak tersedia", on: "Terjemahan aktif", off: "Terjemahan nonaktif" },
    ko: { offline: "오프라인 상태입니다", error: "번역을 사용할 수 없음", on: "번역 켜짐", off: "번역 꺼짐" },
    th: { offline: "คุณออฟไลน์อยู่", error: "ไม่สามารถแปลได้", on: "เปิดการแปลแล้ว", off: "ปิดการแปลแล้ว" },
    pt: { offline: "Você está offline", error: "Tradução indisponível", on: "Tradução ativada", off: "Tradução desativada" },
    es: { offline: "Sin conexión", error: "Traducción no disponible", on: "Traducción activada", off: "Traducción desactivada" },
  };
  function toastText(key) {
    const lang = (currentSettings && currentSettings.targetLanguage) || "en";
    return (TOAST_TEXT[lang] || TOAST_TEXT.en)[key] || TOAST_TEXT.en[key];
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

    setVariant(kind) {
      if (!this.iconEl) return;
      if (kind === "info") {
        this.iconEl.style.color = "#8fa6ff";
        this.iconEl.innerHTML =
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h9M8.5 3v2M11 5c-1 4-3.5 7-7 9M6 9c1.5 2.2 3.5 4 6 5"/><path d="M13 21l4-9 4 9M14.5 18h5"/></svg>';
        if (this.el) this.el.style.borderColor = "rgba(143,166,255,0.35)";
        return;
      }
      this.iconEl.style.color = "#e0708f";
      this.iconEl.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1l22 22"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><path d="M1.42 9a15.9 15.9 0 0 1 4.7-2.88"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>';
      if (this.el) this.el.style.borderColor = "rgba(224,112,143,0.4)";
    }

    show(text, kind) {
      const el = this.ensureEl();
      this.setVariant(kind);
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
        this.show(toastText("offline"));
      } else if (this.state === "error") {
        this.show(toastText("error"));
      } else {
        this.hide();
      }
    }

    // Brief notice only: the browser's "offline" flag often flickers (sleep, Wi-Fi switch) and
    // lines that could not be translated are retried as soon as it is back.
    setOffline(off) {
      if (this.hideTimer) { clearTimeout(this.hideTimer); this.hideTimer = null; }
      if (off) {
        this.state = "offline";
        this.render();
        this.hideTimer = setTimeout(() => { this.state = "ok"; this.render(); }, 4000);
      } else if (this.state === "offline") {
        this.state = "ok";
        this.render();
      }
    }

    flash(text) {
      if (this.state === "offline" || this.state === "error") return;
      if (this.hideTimer) { clearTimeout(this.hideTimer); this.hideTimer = null; }
      this.show(text, "info");
      this.hideTimer = setTimeout(() => this.hide(), 1600);
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

  let statusIndicator = null;
  let lastEnabled = null;

  async function applySettings(settings) {
    const wasEnabled = lastEnabled;
    lastEnabled = !!settings.enabled;
    currentSettings = settings;
    if (statusIndicator && wasEnabled !== null && wasEnabled !== lastEnabled) {
      statusIndicator.flash(toastText(lastEnabled ? "on" : "off"));
    }
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

  // Back from the background, offline or the back/forward cache: retry what failed and look again.
  function catchUp() {
    if (!currentSettings?.enabled) return;
    try { translationManager?.failureBackoff?.clear(); } catch (_error) {}
    try { domTranslator?.running && domTranslator.queueFullRescan(); } catch (_error) {}
    try { captionManager?.running && captionManager.prefetchCurrentVideo(false).catch(() => {}); } catch (_error) {}
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
    try {
      if (window.navigation && typeof window.navigation.addEventListener === "function") {
        window.navigation.addEventListener("navigatesuccess", scheduleRouteChange);
      }
    } catch (_error) {
    }
    if (routePoll) clearInterval(routePoll);
    routePoll = setInterval(handleRouteChange, 1000);
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
        const status = translationManager?.getEngineStatus?.() || null;
        // Content scripts run in every frame. Let only frames that actually translated something
        // answer, so an idle iframe cannot reply first with an empty status.
        if ((status && status.at > 0) || window.top === window.self) {
          if (status && status.at > 0) {
            respond({ success: true, status });
          } else {
            // Top frame with nothing to report: answer late so a busier frame can win.
            setTimeout(() => respond({ success: true, status }), 150);
            return true;
          }
        }
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
    try { window.dispatchEvent(new CustomEvent("bte:takeover", { detail: instanceId })); } catch (_error) {}
    await ensureCore();

    if (window.top === window.self) {
      statusIndicator = new StatusIndicator();
      translationManager.setStatusListener((status) => statusIndicator.update(status));
      statusIndicator.setOffline(typeof navigator !== "undefined" && navigator.onLine === false);
      window.addEventListener("offline", () => statusIndicator.setOffline(true));
      window.addEventListener("online", () => {
        statusIndicator.setOffline(false);
        catchUp();
      });
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
      ROOT.pageUnloading = true;
      try { translationManager?.flushPersist?.(); } catch (_error) {}
    });
    window.addEventListener("pageshow", (event) => {
      ROOT.pageUnloading = false;
      if (event.persisted) catchUp();
    });
    let hiddenAt = 0;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        try { translationManager?.flushPersist?.(); } catch (_error) {}
      } else if (hiddenAt && Date.now() - hiddenAt > 30000) {
        catchUp();
      }
    });
    // A newer copy of the extension (after an update) takes over this page.
    window.addEventListener("bte:takeover", (event) => {
      if (event.detail === instanceId) return;
      try { domTranslator?.stop({ restore: true }); } catch (_error) {}
      try { captionManager?.stop({ restore: true }); } catch (_error) {}
      if (routePoll) clearInterval(routePoll);
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
