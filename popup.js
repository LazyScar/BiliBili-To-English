document.addEventListener("DOMContentLoaded", async () => {
  const SettingsManager = window.BTE?.SettingsManager;
  if (!SettingsManager) return;

  const settingsManager = new SettingsManager();
  await languageManager.initialize();
  let settings = await settingsManager.initialize();
  let applying = false;
  let hintTimer = null;
  let panelHintTimer = null;
  let updateDismissed = false;
  let lastReleaseTag = null;
  let updateStatusKey = "";

  const UPDATE_INFO_KEY = "bteUpdateInfoV1";
  const GITHUB_RELEASE_API = "https://api.github.com/repos/LazyScar/BiliBili-To-English/releases/latest";
  const GITHUB_RELEASE_PAGE = "https://github.com/LazyScar/BiliBili-To-English/releases/latest";
  const FIREFOX_ADDON_PAGE = "https://addons.mozilla.org/en-US/firefox/addon/bilibili-to-english/";

  const els = {
    appVersion: document.getElementById("appVersion"),
    enableBtn: document.getElementById("enableBtn"),
    enableLabel: document.getElementById("enableLabel"),
    bilingualBtn: document.getElementById("bilingualBtn"),
    languageSelect: document.getElementById("languageSelect"),
    engineSelect: document.getElementById("engineSelect"),
    engineIcon: document.getElementById("engineIcon"),
    engineStatus: document.getElementById("engineStatus"),
    deeplMenuRow: document.getElementById("deeplMenuRow"),
    deeplKey: document.getElementById("deeplKey"),
    deeplEndpoint: document.getElementById("deeplEndpoint"),
    deeplFallback: document.getElementById("deeplFallback"),
    deeplOptimize: document.getElementById("deeplOptimize"),
    baiduMenuRow: document.getElementById("baiduMenuRow"),
    baiduAppid: document.getElementById("baiduAppid"),
    baiduSecret: document.getElementById("baiduSecret"),
    baiduOptimize: document.getElementById("baiduOptimize"),
    baiduFallback: document.getElementById("baiduFallback"),
    youdaoMenuRow: document.getElementById("youdaoMenuRow"),
    youdaoAppKey: document.getElementById("youdaoAppKey"),
    youdaoAppSecret: document.getElementById("youdaoAppSecret"),
    youdaoOptimize: document.getElementById("youdaoOptimize"),
    youdaoFallback: document.getElementById("youdaoFallback"),
    papagoMenuRow: document.getElementById("papagoMenuRow"),
    papagoClientId: document.getElementById("papagoClientId"),
    papagoClientSecret: document.getElementById("papagoClientSecret"),
    papagoOptimize: document.getElementById("papagoOptimize"),
    papagoFallback: document.getElementById("papagoFallback"),
    cacheCount: document.getElementById("cacheCount"),
    cacheSize: document.getElementById("cacheSize"),
    aboutVersion: document.getElementById("aboutVersion"),
    installSource: document.getElementById("installSource"),
    checkUpdatesBtn: document.getElementById("checkUpdatesBtn"),
    updateBanner: document.getElementById("updateBanner"),
    updateBannerTitle: document.getElementById("updateBannerTitle"),
    updateBannerSub: document.getElementById("updateBannerSub"),
    updateBannerGo: document.getElementById("updateBannerGo"),
    updateBannerClose: document.getElementById("updateBannerClose"),
    bilingualPage: document.getElementById("bilingualPage"),
    bilingualComments: document.getElementById("bilingualComments"),
    bilingualDynamic: document.getElementById("bilingualDynamic"),
    bilingualDanmaku: document.getElementById("bilingualDanmaku"),
    bilingualCaptions: document.getElementById("bilingualCaptions"),
    areaPage: document.getElementById("areaPage"),
    areaComments: document.getElementById("areaComments"),
    areaDynamic: document.getElementById("areaDynamic"),
    areaDanmaku: document.getElementById("areaDanmaku"),
    areaCaptions: document.getElementById("areaCaptions"),
    areaCreatorPages: document.getElementById("areaCreatorPages"),
    cacheEnabled: document.getElementById("cacheEnabled"),
    blurCaptionToggle: document.getElementById("blurCaptionToggle"),
    hoverTranslateToggle: document.getElementById("hoverTranslateToggle"),
    clearCacheBtn: document.getElementById("clearCacheBtn"),
    darkModeToggle: document.getElementById("darkModeToggle"),
    saveHint: document.getElementById("saveHint"),
    updateStatus: document.getElementById("updateStatus"),
    githubBtn: document.getElementById("githubBtn"),
    docsBtn: document.getElementById("docsBtn"),
    updateBtn: document.getElementById("updateBtn"),
    verWrap: document.getElementById("verWrap"),
    verNew: document.getElementById("verNew"),
    fitTextToggle: document.getElementById("fitTextToggle"),
    properNounsToggle: document.getElementById("properNounsToggle"),
  };

  const localVersion = chrome?.runtime?.getManifest?.().version || "0.0.0";
  let latestVersionTag = "";
  let lastCacheBytes = 0;
  els.appVersion.textContent = `v${localVersion}`;

  const BILINGUAL_AREAS = ["page", "comments", "dynamic", "danmaku", "captions"];
  const ENGINE_ICONS = {
    auto:
      '<svg viewBox="0 0 24 24" width="16" height="16"><rect x="1.5" y="1.5" width="21" height="21" rx="5" fill="#2f3540"/><path d="M4.5 12h3.2M7.7 12c2 0 2.2-4 4.3-4M7.7 12c2 0 2.2 4 4.3 4M7.7 12h4.3" fill="none" stroke="#8fa6ff" stroke-width="1.5" stroke-linecap="round"/><circle cx="15.6" cy="8" r="2" fill="#8fa6ff"/><circle cx="15.6" cy="12" r="2" fill="#8fa6ff" opacity=".6"/><circle cx="15.6" cy="16" r="2" fill="#8fa6ff" opacity=".35"/></svg>',
    google:
      '<svg viewBox="0 0 48 48" width="16" height="16"><path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"/><path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"/><path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"/><path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"/></svg>',
    microsoft:
      '<svg viewBox="0 0 24 24" width="16" height="16"><rect x="2" y="2" width="9" height="9" fill="#F25022"/><rect x="13" y="2" width="9" height="9" fill="#7FBA00"/><rect x="2" y="13" width="9" height="9" fill="#00A4EF"/><rect x="13" y="13" width="9" height="9" fill="#FFB900"/></svg>',
    deepl:
      '<svg viewBox="0 0 24 24" width="16" height="16"><rect x="1.5" y="1.5" width="21" height="21" rx="5" fill="#0f2b46"/><text x="12" y="17" font-size="13" fill="#fff" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="700">D</text></svg>',
    yandex:
      '<svg viewBox="0 0 24 24" width="16" height="16"><rect x="1.5" y="1.5" width="21" height="21" rx="5" fill="#fc3f1d"/><text x="12" y="17.5" font-size="14" fill="#fff" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="700">Я</text></svg>',
    baidu:
      '<svg viewBox="0 0 24 24" width="16" height="16"><rect x="1.5" y="1.5" width="21" height="21" rx="5" fill="#4e6ef2"/><g fill="#fff"><ellipse cx="12" cy="15.2" rx="3.5" ry="2.7"/><circle cx="7.5" cy="11.4" r="1.5"/><circle cx="10.4" cy="8.9" r="1.5"/><circle cx="13.6" cy="8.9" r="1.5"/><circle cx="16.5" cy="11.4" r="1.5"/></g></svg>',
    youdao:
      '<svg viewBox="0 0 24 24" width="16" height="16"><rect x="1.5" y="1.5" width="21" height="21" rx="5" fill="#00a870"/><path d="M12 7.2c-1.7-1-4-1.2-5.9-1.05a.9.9 0 0 0-.85.9v8.1c0 .53.44.94.97.9 1.7-.13 3.9.08 5.28.98M12 7.2c1.7-1 4-1.2 5.9-1.05a.9.9 0 0 1 .85.9v8.1c0 .53-.44.94-.97.9-1.7-.13-3.9.08-5.28.98M12 7.2V17.9" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    papago:
      '<svg viewBox="0 0 24 24" width="16" height="16"><rect x="1.5" y="1.5" width="21" height="21" rx="5" fill="#08cf5d"/><path d="M6 6.8h12a1.6 1.6 0 0 1 1.6 1.6v5.4a1.6 1.6 0 0 1-1.6 1.6h-5.2l-3.6 2.7v-2.7H6a1.6 1.6 0 0 1-1.6-1.6V8.4A1.6 1.6 0 0 1 6 6.8Z" fill="#fff"/><circle cx="9.3" cy="11.1" r="1.05" fill="#08cf5d"/><circle cx="12" cy="11.1" r="1.05" fill="#08cf5d"/><circle cx="14.7" cy="11.1" r="1.05" fill="#08cf5d"/></svg>',
  };
  function setEngineIcon(engine) {
    if (!els.engineIcon) return;
    els.engineIcon.innerHTML = ENGINE_ICONS[engine] || ENGINE_ICONS.google;
  }

  const ENGINE_I18N_KEY = {
    auto: "svcAuto", google: "svcGoogle", microsoft: "svcMicrosoft", yandex: "svcYandex",
    baidu: "svcBaidu", youdao: "svcYoudao", papago: "svcPapago", deepl: "svcDeepL",
  };
  const ENGINE_FALLBACK_NAME = {
    auto: "Auto", google: "Google Translate", microsoft: "Microsoft Translator",
    yandex: "Yandex Translate", baidu: "Baidu Translate", youdao: "Youdao Translate",
    papago: "Naver Papago", deepl: "DeepL",
  };
  const engineName = (id) => (I18N && I18N[ENGINE_I18N_KEY[id]]) || ENGINE_FALLBACK_NAME[id] || id;

  const openDropdowns = [];
  const dropdownSelectRefs = {};
  document.addEventListener("click", () => openDropdowns.forEach((d) => d.close()));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") openDropdowns.forEach((d) => d.close()); });

  function createIconDropdown(ids, items, onSelect) {
    const dd = document.getElementById(ids.dd);
    const btn = document.getElementById(ids.btn);
    const list = document.getElementById(ids.list);
    const nameEl = ids.name ? document.getElementById(ids.name) : null;
    const iconEl = ids.icon ? document.getElementById(ids.icon) : null;
    if (!dd || !btn || !list) return null;
    const onSelectRef = dropdownSelectRefs[ids.dd] || (dropdownSelectRefs[ids.dd] = { fn: onSelect });
    const close = () => {
      if (!dd.classList.contains("open")) return;
      dd.classList.remove("open");
      btn.setAttribute("aria-expanded", "false");
    };
    if (!openDropdowns.some((d) => d.id === ids.dd)) openDropdowns.push({ id: ids.dd, close });
    list.innerHTML = "";
    items.forEach((item) => {
      const li = document.createElement("li");
      li.className = "icon-dd-item";
      li.setAttribute("role", "option");
      li.dataset.value = item.value;
      const ic = document.createElement("span");
      ic.className = "icon-dd-ic";
      ic.innerHTML = item.iconHtml || "";
      const lbl = document.createElement("span");
      lbl.className = "icon-dd-lbl";
      lbl.textContent = item.label;
      li.appendChild(ic);
      li.appendChild(lbl);
      list.appendChild(li);
    });
    if (!list.dataset.bteBound) {
      list.dataset.bteBound = "1";
      list.addEventListener("click", (event) => {
        const li = event.target.closest(".icon-dd-item");
        if (!li || !list.contains(li)) return;
        event.stopPropagation();
        close();
        onSelectRef.fn(li.dataset.value);
      });
    }
    onSelectRef.fn = onSelect;
    if (!btn.dataset.bteBound) {
      btn.dataset.bteBound = "1";
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        const wasOpen = dd.classList.contains("open");
        openDropdowns.forEach((d) => d.close());
        if (!wasOpen) { dd.classList.add("open"); btn.setAttribute("aria-expanded", "true"); }
      });
    }
    return {
      close,
      setValue(value) {
        const item = items.find((x) => x.value === value) || items[0];
        if (!item) return;
        if (iconEl) iconEl.innerHTML = item.iconHtml || "";
        if (nameEl) nameEl.textContent = item.label;
        list.querySelectorAll(".icon-dd-item").forEach((li) => {
          const on = li.dataset.value === value;
          li.classList.toggle("active", on);
          li.setAttribute("aria-selected", String(on));
        });
      },
    };
  }

  let engineDropdown = null;
  let languageDropdown = null;

  function buildEngineDropdown() {
    if (!els.engineSelect) return;
    Array.from(els.engineSelect.options).forEach((opt) => {
      opt.textContent = engineName(opt.value);
    });
    const items = Array.from(els.engineSelect.options).map((opt) => ({
      value: opt.value, label: engineName(opt.value), iconHtml: ENGINE_ICONS[opt.value] || "",
    }));
    engineDropdown = createIconDropdown(
      { dd: "engineDropdown", btn: "engineDropdownBtn", list: "engineDropdownList", name: "engineDropdownName", icon: "engineIcon" },
      items,
      (value) => {
        if (els.engineSelect.value !== value) {
          els.engineSelect.value = value;
          els.engineSelect.dispatchEvent(new Event("change"));
        }
      }
    );
  }

  function buildLanguageDropdown() {
    if (!els.languageSelect || !window.languageManager) return;
    const available = languageManager.getAvailableLanguages();
    const items = Object.entries(available).map(([code, info]) => ({
      value: code, label: (info && info.name) || code, iconHtml: (info && info.flag) || "",
    }));
    languageDropdown = createIconDropdown(
      { dd: "languageDropdown", btn: "languageDropdownBtn", list: "languageDropdownList", name: "languageDropdownName", icon: "languageFlag" },
      items,
      (value) => {
        if (els.languageSelect.value !== value) {
          els.languageSelect.value = value;
          els.languageSelect.dispatchEvent(new Event("change"));
        }
      }
    );
  }

  function setEngineDropdown(engine) {
    setEngineIcon(engine);
    if (engineDropdown) engineDropdown.setValue(engine);
  }

  function setLanguageDropdown(code) {
    if (languageDropdown) languageDropdown.setValue(code);
  }

  function engineReasonText(reason) {
    if (reason === "captcha") return I18N.svcCaptcha || "is blocked by a captcha";
    if (reason === "cooldown") return I18N.svcCooldown || "is paused";
    if (reason === "rate-limited") return I18N.svcRateLimited || "hit its rate limit";
    if (reason === "timeout") return I18N.svcTimeout || "timed out";
    if (reason === "offline" || reason === "network") return I18N.svcNoConnect || "cannot connect";
    if (reason === "missing-key" || reason === "missing-credentials") return I18N.svcNotConfigured || "is not configured";
    return I18N.svcUnavailable || "is unavailable";
  }

  function engineNeedsSetup(engine) {
    const s = settings || {};
    const has = (v) => !!(v && String(v).trim());
    if (engine === "deepl") return !has(s.deepl && s.deepl.apiKey);
    if (engine === "baidu") return !(has(s.baidu && s.baidu.appid) && has(s.baidu && s.baidu.secret));
    if (engine === "youdao") return !(has(s.youdao && s.youdao.appKey) && has(s.youdao && s.youdao.appSecret));
    if (engine === "papago") return !(has(s.papago && s.papago.clientId) && has(s.papago && s.papago.clientSecret));
    return false;
  }

  let lastRuntimeStatus = null;

  function updateEngineStatusLine() {
    const el = els.engineStatus;
    if (!el) return;
    const engine = (settings && settings.engine) || "google";
    ["deepl", "baidu", "youdao", "papago"].forEach((name) => {
      const badge = document.getElementById(`${name}Needs`);
      if (badge) badge.classList.toggle("show", engineNeedsSetup(name));
    });
    if (engineNeedsSetup(engine)) {
      const name = engineName(engine);
      el.textContent = (I18N.svcNeedsKeyShort
        ? I18N.svcNeedsKeyShort.replace("{name}", name)
        : `${name} needs an API key.`);
      el.className = "engine-status setup";
      el.style.display = "block";
      return;
    }
    const status = lastRuntimeStatus;
    if (!status || !status.fellBack || !status.active) {
      el.style.display = "none";
      el.textContent = "";
      el.className = "engine-status";
      return;
    }
    const selName = engineName(status.selected);
    const actName = engineName(status.active);
    el.textContent = `${selName} ${engineReasonText(status.reason)}. ${I18N.svcUsing || "Using"} ${actName}.`;
    el.className = "engine-status warn";
    el.style.display = "block";
  }

  let shownErrorSignature = "";
  function showErrorModal(title, message, code) {
    const back = document.getElementById("errModal");
    if (!back) return;
    const msgEl = document.getElementById("errModalMsg");
    const codeEl = document.getElementById("errModalCode");
    if (msgEl) msgEl.textContent = message || "";
    if (codeEl) {
      codeEl.textContent = code || "";
      codeEl.style.display = code ? "block" : "none";
    }
    const titleEl = document.getElementById("errModalTitle");
    if (titleEl && title) titleEl.textContent = title;
    back.classList.add("open");
  }
  function closeErrorModal() {
    document.getElementById("errModal")?.classList.remove("open");
  }
  function maybeReportError(status) {
    if (!status || status.ok !== false) return;
    const signature = `${status.selected}:${status.reason}`;
    if (signature === shownErrorSignature) return;
    shownErrorSignature = signature;
    const name = engineName(status.selected) || "Translation";
    showErrorModal(
      I18N.errTitle || "Translation problem",
      `${name} ${engineReasonText(status.reason)}.`,
      `engine: ${status.selected}\nreason: ${status.reason || "unknown"}\ntime: ${new Date(status.at || Date.now()).toISOString()}`
    );
  }

  function refreshEngineStatus() {
    if (!els.engineStatus || !chrome?.tabs?.query) { updateEngineStatusLine(); return; }
    chrome.tabs.query({ url: ["*://*.bilibili.com/*", "*://bilibili.com/*"] }, (tabs) => {
      const tab = (tabs || [])[0];
      if (!tab) { lastRuntimeStatus = null; updateEngineStatusLine(); return; }
      try {
        chrome.tabs.sendMessage(tab.id, { type: "bte:getEngineStatus" }, (resp) => {
          void chrome.runtime?.lastError;
          lastRuntimeStatus = resp && resp.status;
          updateEngineStatusLine();
          maybeReportError(lastRuntimeStatus);
        });
      } catch (_error) {
        lastRuntimeStatus = null;
        updateEngineStatusLine();
      }
    });
  }

  function browserFamily() {
    let scheme = "";
    try {
      scheme = String(chrome?.runtime?.getURL?.("") || location.protocol || "");
    } catch (_error) {
    }
    if (scheme.startsWith("moz-extension")) return "firefox";
    if (scheme.startsWith("chrome-extension")) {
      return /\bEdg[A-Z]?\//.test(navigator.userAgent) ? "edge" : "chrome";
    }
    if (scheme.startsWith("safari-web-extension")) return "safari";
    return /Firefox/i.test(navigator.userAgent) ? "firefox" : "chrome";
  }

  function isFirefox() {
    return browserFamily() === "firefox";
  }

  function compareVersions(a, b) {
    const parse = (v) =>
      String(v || "")
        .replace(/^v/i, "")
        .split(".")
        .map((part) => parseInt(part, 10) || 0);
    const aa = parse(a);
    const bb = parse(b);
    const len = Math.max(aa.length, bb.length);
    for (let i = 0; i < len; i += 1) {
      const av = aa[i] || 0;
      const bv = bb[i] || 0;
      if (av > bv) return 1;
      if (av < bv) return -1;
    }
    return 0;
  }

  function showHint(text, timeoutMs = 1500) {
    els.saveHint.textContent = text;
    els.saveHint.classList.add("show");
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(() => {
      els.saveHint.classList.remove("show");
      els.saveHint.textContent = "";
    }, timeoutMs);
    const openPanel = document.querySelector(".view-panel.open");
    const panelHint = openPanel ? openPanel.querySelector("[data-panel-hint]") : null;
    if (panelHint) {
      panelHint.textContent = text;
      panelHint.classList.add("show");
      if (panelHintTimer) clearTimeout(panelHintTimer);
      panelHintTimer = setTimeout(() => {
        panelHint.classList.remove("show");
        panelHint.textContent = "";
      }, timeoutMs);
    }
  }

  let installTypeCache = null;
  function installSourceLabel() {
    const family = browserFamily();
    const storeName =
      family === "firefox"
        ? I18N.srcAmo || "Firefox Add-ons"
        : family === "edge"
        ? I18N.srcEdge || "Edge Add-ons"
        : I18N.srcWebStore || "Chrome Web Store";
    const source = I18N.srcSource || "Source";
    if (installTypeCache === "normal") return storeName;
    if (installTypeCache === "development") return source;
    if (installTypeCache === "sideload") return I18N.srcSideload || "Sideloaded";
    if (installTypeCache === "admin") return I18N.srcAdmin || "Installed by admin";
    try {
      const mf = chrome?.runtime?.getManifest?.() || {};
      const hasUpdateUrl = !!(mf.update_url || mf.browser_specific_settings?.gecko?.update_url);
      if (hasUpdateUrl) return storeName;
    } catch (_error) {
    }
    return source;
  }

  function detectInstallSource() {
    if (installTypeCache !== null) return installSourceLabel();
    installTypeCache = "";
    const applyInfo = (info) => {
      installTypeCache = (info && info.installType) || "";
      if (els.installSource) els.installSource.textContent = installSourceLabel();
    };
    const api =
      (typeof browser !== "undefined" && browser?.management) ||
      (typeof chrome !== "undefined" && chrome?.management) ||
      null;
    if (api && typeof api.getSelf === "function") {
      try {
        const maybePromise = api.getSelf((info) => {
          void (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.lastError);
          if (info) applyInfo(info);
        });
        if (maybePromise && typeof maybePromise.then === "function") {
          maybePromise.then(applyInfo).catch(() => {});
        }
      } catch (_error) {
      }
    }
    return installSourceLabel();
  }

  function formatBytes(n) {
    const B = I18N.unitB || "B";
    const KB = I18N.unitKB || "KB";
    const MB = I18N.unitMB || "MB";
    if (!Number.isFinite(n) || n <= 0) return `0 ${KB}`;
    if (n < 1024) return `${n} ${B}`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} ${KB}`;
    return `${(n / (1024 * 1024)).toFixed(1)} ${MB}`;
  }

  function versionLabel(v) {
    return `${I18N.verPrefix || "v"}${String(v || "").replace(/^v/i, "")}`;
  }

  function sendToBiliTabs(payload) {
    if (!chrome?.tabs?.query) return;
    chrome.tabs.query({ url: ["*://*.bilibili.com/*", "*://bilibili.com/*"] }, (tabs) => {
      (tabs || []).forEach((tab) => {
        chrome.tabs.sendMessage(tab.id, payload, () => {
          void chrome.runtime?.lastError;
        });
      });
    });
  }

  function buildLanguageSelect() {
    const options = languageManager.getAvailableLanguages();
    els.languageSelect.innerHTML = "";
    Object.entries(options).forEach(([code, info]) => {
      const option = document.createElement("option");
      option.value = code;
      option.textContent = `${info.flag ? `${info.flag} ` : ""}${info.name}`;
      els.languageSelect.appendChild(option);
    });
  }

  let I18N = (window.popupI18n && window.popupI18n.en) || {};

  function setI18nText(el, text) {
    const suffix = el.children.length ? " " : "";
    let done = false;
    el.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE && node.nodeValue.trim()) {
        if (!done) { node.nodeValue = text + suffix; done = true; }
        else { node.nodeValue = ""; }
      }
    });
    if (!done) el.insertBefore(document.createTextNode(text + suffix), el.firstChild);
  }

  function applyI18n(lang) {
    const all = window.popupI18n || {};
    I18N = { ...(all.en || {}), ...(all[lang] || {}) };
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const v = I18N[el.getAttribute("data-i18n")];
      if (v) setI18nText(el, v);
    });
    document.querySelectorAll("[data-i18n-ph]").forEach((el) => {
      const v = I18N[el.getAttribute("data-i18n-ph")];
      if (v) el.setAttribute("placeholder", v);
    });
    document.querySelectorAll("[data-i18n-title]").forEach((el) => {
      const v = I18N[el.getAttribute("data-i18n-title")];
      if (v) el.setAttribute("title", v);
    });
    document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
      const v = I18N[el.getAttribute("data-i18n-aria")];
      if (v) el.setAttribute("aria-label", v);
    });
    buildBilingualSelects();
    buildEngineDropdown();
    els.appVersion.textContent = versionLabel(localVersion);
    if (els.verNew && latestVersionTag) els.verNew.textContent = versionLabel(latestVersionTag);
    if (els.cacheSize) els.cacheSize.textContent = formatBytes(lastCacheBytes);
    if (els.installSource) els.installSource.textContent = installSourceLabel();
    if (settings) setEngineDropdown(settings.engine || "auto");
    if (lastReleaseTag) applyUpdateUI(lastReleaseTag);
    else if (updateStatusKey) setUpdateStatus(updateStatusKey);
    if (document.documentElement) document.documentElement.lang = lang || "en";
  }

  const MODE_ICONS = {
    off: '<svg width="22" height="15" viewBox="0 0 22 15" fill="none"><rect x="1" y="5" width="20" height="4.5" rx="1.6" fill="currentColor" opacity="0.95"/></svg>',
    stacked: '<svg width="22" height="15" viewBox="0 0 22 15" fill="none"><rect x="1" y="1.5" width="20" height="4" rx="1.4" fill="currentColor" opacity="0.32"/><rect x="1" y="9" width="20" height="4" rx="1.4" fill="currentColor" opacity="0.95"/></svg>',
    sideBySide: '<svg width="22" height="15" viewBox="0 0 22 15" fill="none"><rect x="1" y="5" width="9" height="4.5" rx="1.5" fill="currentColor" opacity="0.32"/><rect x="12" y="5" width="9" height="4.5" rx="1.5" fill="currentColor" opacity="0.95"/></svg>',
  };

  const BILINGUAL_IDS = [
    "bilingualPage", "bilingualComments", "bilingualDynamic", "bilingualDanmaku", "bilingualCaptions",
  ];
  const bilingualDropdowns = {};

  function modeOptions() {
    return [
      { value: "off", label: I18N.modeOff || "Translation only", iconHtml: MODE_ICONS.off },
      { value: "stacked", label: I18N.modeStacked || "Both, stacked", iconHtml: MODE_ICONS.stacked },
      { value: "sideBySide", label: I18N.modeSide || "Both, side by side", iconHtml: MODE_ICONS.sideBySide },
    ];
  }

  function buildBilingualSelects() {
    const options = modeOptions();
    BILINGUAL_IDS.forEach((id) => {
      const select = els[id];
      if (!select) return;
      const current = select.value;
      select.innerHTML = "";
      options.forEach((mode) => {
        const option = document.createElement("option");
        option.value = mode.value;
        option.textContent = mode.label;
        select.appendChild(option);
      });
      if (current) select.value = current;
      bilingualDropdowns[id] = createIconDropdown(
        { dd: `${id}Dd`, btn: `${id}DdBtn`, list: `${id}DdList`, name: `${id}DdName`, icon: `${id}DdIcon` },
        options,
        (value) => {
          if (select.value !== value) {
            select.value = value;
            select.dispatchEvent(new Event("change"));
          }
        }
      );
      if (bilingualDropdowns[id]) bilingualDropdowns[id].setValue(select.value || "off");
    });
  }

  function setBilingualDropdown(id, value) {
    if (bilingualDropdowns[id]) bilingualDropdowns[id].setValue(value || "off");
  }

  function render(nextSettings) {
    applying = true;
    try {
      renderInner(nextSettings);
    } catch (error) {
      console.warn("BTE popup render failed:", error);
    } finally {
      applying = false;
    }
  }

  function renderInner(nextSettings) {
    settings = nextSettings;
    applyI18n(settings.targetLanguage || "en");
    const enabled = !!settings.enabled;
    els.enableBtn.classList.toggle("on", enabled);
    els.enableLabel.textContent = enabled ? (I18N.on || "Translation on") : (I18N.enable || "Enable translation");

    els.languageSelect.value = settings.targetLanguage || "en";
    setLanguageDropdown(settings.targetLanguage || "en");
    els.engineSelect.value = settings.engine || "google";
    setEngineDropdown(settings.engine || "google");
    els.deeplKey.value = settings.deepl?.apiKey || "";
    els.deeplEndpoint.value = settings.deepl?.endpointMode || "auto";
    els.deeplFallback.checked = settings.deepl?.fallbackToGoogle !== false;
    els.deeplOptimize.checked = settings.deepl?.optimizeUsage === true;
    els.deeplMenuRow.style.display = settings.engine === "deepl" ? "flex" : "none";
    els.baiduAppid.value = settings.baidu?.appid || "";
    els.baiduSecret.value = settings.baidu?.secret || "";
    els.baiduOptimize.checked = settings.baidu?.optimizeUsage === true;
    els.baiduFallback.checked = settings.baidu?.fallback !== false;
    els.baiduMenuRow.style.display = settings.engine === "baidu" ? "flex" : "none";
    els.youdaoAppKey.value = settings.youdao?.appKey || "";
    els.youdaoAppSecret.value = settings.youdao?.appSecret || "";
    els.youdaoOptimize.checked = settings.youdao?.optimizeUsage === true;
    els.youdaoFallback.checked = settings.youdao?.fallback !== false;
    els.youdaoMenuRow.style.display = settings.engine === "youdao" ? "flex" : "none";
    els.papagoClientId.value = settings.papago?.clientId || "";
    els.papagoClientSecret.value = settings.papago?.clientSecret || "";
    els.papagoOptimize.checked = settings.papago?.optimizeUsage === true;
    els.papagoFallback.checked = settings.papago?.fallback !== false;
    els.papagoMenuRow.style.display = settings.engine === "papago" ? "flex" : "none";

    els.bilingualPage.value = settings.bilingual?.page || "off";
    els.bilingualComments.value = settings.bilingual?.comments || "off";
    els.bilingualDynamic.value = settings.bilingual?.dynamic || "off";
    els.bilingualDanmaku.value = settings.bilingual?.danmaku || "off";
    els.bilingualCaptions.value = settings.bilingual?.captions || "off";
    setBilingualDropdown("bilingualPage", els.bilingualPage.value);
    setBilingualDropdown("bilingualComments", els.bilingualComments.value);
    setBilingualDropdown("bilingualDynamic", els.bilingualDynamic.value);
    setBilingualDropdown("bilingualDanmaku", els.bilingualDanmaku.value);
    setBilingualDropdown("bilingualCaptions", els.bilingualCaptions.value);
    const anyBilingual = BILINGUAL_AREAS.some(
      (area) => (settings.bilingual?.[area] || "off") !== "off"
    );
    els.bilingualBtn.classList.toggle("on", anyBilingual);
    els.bilingualBtn.setAttribute("aria-pressed", String(anyBilingual));

    els.areaPage.checked = settings.areas?.page !== false;
    els.areaComments.checked = settings.areas?.comments !== false;
    els.areaDynamic.checked = settings.areas?.dynamic !== false;
    els.areaDanmaku.checked = !!settings.areas?.danmaku;
    els.areaCaptions.checked = settings.areas?.captions !== false;
    els.areaCreatorPages.checked = settings.areas?.creatorPages !== false;
    els.cacheEnabled.checked = settings.cache?.enabled !== false;
    if (els.blurCaptionToggle) els.blurCaptionToggle.checked = settings.learn?.blurCaption === true;
    if (els.hoverTranslateToggle) els.hoverTranslateToggle.checked = settings.learn?.hoverTranslate === true;
    if (els.fitTextToggle) els.fitTextToggle.checked = settings.learn?.fitText === true;
    if (els.properNounsToggle) els.properNounsToggle.checked = settings.learn?.properNouns === true;
    els.darkModeToggle.checked = settings.darkMode !== false;
    document.body.classList.toggle("light", settings.darkMode === false);
    updateEngineStatusLine();
    if (els.installSource) els.installSource.textContent = detectInstallSource();
    if (els.aboutVersion) els.aboutVersion.textContent = localVersion;
    refreshUpdateCopy();
  }

  function refreshUpdateCopy() {
    if (lastReleaseTag) applyUpdateUI(lastReleaseTag);
  }

  async function persist(partial, hint) {
    if (applying) return;
    const next = await settingsManager.update(partial);
    render(next);
    sendToBiliTabs({
      type: "bte:updateSettings",
      payload: partial,
    });
    showHint(hint || I18N.hintSaved || "Saved");
  }

  async function getCachedUpdateInfo() {
    if (!chrome?.storage?.local) return null;
    const data = await new Promise((resolve) => chrome.storage.local.get([UPDATE_INFO_KEY], resolve));
    return data?.[UPDATE_INFO_KEY] || null;
  }

  async function setCachedUpdateInfo(info) {
    if (!chrome?.storage?.local) return;
    await new Promise((resolve) => chrome.storage.local.set({ [UPDATE_INFO_KEY]: info }, resolve));
  }

  function setUpdateStatus(key) {
    updateStatusKey = key;
    if (!els.updateStatus) return;
    els.updateStatus.classList.remove("upd");
    els.updateStatus.textContent = I18N[key] || "";
  }

  function applyUpdateUI(releaseTag) {
    if (!releaseTag) return;
    lastReleaseTag = releaseTag;
    const isNew = compareVersions(releaseTag, localVersion) > 0;
    if (isNew) {
      const avail = (I18N.updAvailable || "Version {v} is available").replace("{v}", versionLabel(releaseTag));
      els.updateStatus.textContent = avail;
      els.updateStatus.classList.add("upd");
      els.updateBtn.style.display = "block";
      els.updateBtn.textContent = (I18N.updTo || "Update to {v}").replace("{v}", versionLabel(releaseTag));
      if (els.verWrap && els.verNew) {
        els.verNew.textContent = versionLabel(releaseTag);
        latestVersionTag = releaseTag;
        els.verWrap.classList.add("has-update");
        els.verWrap.title = (I18N.updTitle || "Update available");
      }
      if (els.updateBanner && !updateDismissed) {
        els.updateBannerTitle.textContent = (I18N.updTitle || "Update available");
        els.updateBannerSub.textContent = `${versionLabel(localVersion)} → ${versionLabel(releaseTag)}`;
        els.updateBanner.classList.add("show");
      }
    } else {
      els.updateStatus.textContent = (I18N.updLatest || "You're on the latest version ({v})").replace("{v}", versionLabel(localVersion));
      els.updateStatus.classList.remove("upd");
      els.updateBtn.style.display = "none";
      if (els.verWrap) { els.verWrap.classList.remove("has-update"); els.verWrap.title = ""; }
      if (els.updateBanner) els.updateBanner.classList.remove("show");
    }
  }

  async function checkForUpdates(force) {
    const now = Date.now();
    const cached = await getCachedUpdateInfo();
    if (!force && cached && cached.checkedAt && now - cached.checkedAt < 1000 * 60 * 60) {
      applyUpdateUI(cached.tag);
      return;
    }
    setUpdateStatus("updChecking");
    try {
      const response = await fetch(GITHUB_RELEASE_API, {
        headers: {
          Accept: "application/vnd.github+json",
        },
      });
      if (!response.ok) throw new Error(`GitHub release check failed (${response.status})`);
      const data = await response.json();
      const tag = String(data?.tag_name || "").trim();
      if (!tag) return;
      await setCachedUpdateInfo({
        tag,
        checkedAt: now,
      });
      applyUpdateUI(tag);
    } catch (_error) {
      if (cached?.tag) {
        applyUpdateUI(cached.tag);
      } else {
        setUpdateStatus("updFailed");
      }
    }
  }

  function openLink(url) {
    if (!url) return;
    if (chrome?.tabs?.create) {
      chrome.tabs.create({ url });
    } else {
      window.open(url, "_blank", "noopener");
    }
  }

  const NEGATIVE_CACHE_SENTINEL = "__BTE_NO_TRANSLATION__";
  async function refreshCacheCount() {
    if (!els.cacheCount) return;
    const cacheKey = window.BTE?.BTE_KEYS?.PERSISTENT_CACHE_KEY || "btePersistentCacheV2";
    if (!chrome?.storage?.local) {
      els.cacheCount.textContent = "0";
      return;
    }
    const data = await new Promise((resolve) => chrome.storage.local.get([cacheKey], resolve));
    const blob = data?.[cacheKey];
    const entries = blob && typeof blob === "object" ? blob.entries : null;
    let count = 0;
    let bytes = 0;
    if (entries && typeof entries === "object") {
      Object.keys(entries).forEach((key) => {
        const value = entries[key]?.value;
        if (value && value !== NEGATIVE_CACHE_SENTINEL) {
          count += 1;
          bytes += (key.length + String(value).length) * 2;
        }
      });
    }
    els.cacheCount.textContent = count.toLocaleString();
    lastCacheBytes = bytes;
    if (els.cacheSize) els.cacheSize.textContent = formatBytes(bytes);
  }

  buildLanguageSelect();
  buildLanguageDropdown();
  buildEngineDropdown();
  render(settings);
  if (els.aboutVersion) els.aboutVersion.textContent = localVersion;
  if (els.installSource) els.installSource.textContent = detectInstallSource();
  checkForUpdates();
  refreshCacheCount();
  refreshEngineStatus();
  setInterval(refreshEngineStatus, 3000);
  setInterval(refreshCacheCount, 2000);
  if (chrome?.storage?.onChanged) {
    const cacheKey = window.BTE?.BTE_KEYS?.PERSISTENT_CACHE_KEY || "btePersistentCacheV2";
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[cacheKey]) refreshCacheCount();
    });
  }

  settingsManager.onChange((next) => {
    render(next);
  });

  els.enableBtn.addEventListener("click", () => persist({ enabled: !settings.enabled }));
  els.languageSelect.addEventListener("change", () => {
    const targetLanguage = els.languageSelect.value;
    languageManager.switchLanguage(targetLanguage);
    persist({ targetLanguage });
  });
  els.engineSelect.addEventListener("change", () => {
    persist({ engine: els.engineSelect.value });
  });
  els.deeplEndpoint.addEventListener("change", () => {
    persist({ deepl: { endpointMode: els.deeplEndpoint.value } });
  });
  els.deeplFallback.addEventListener("change", () => {
    persist({ deepl: { fallbackToGoogle: els.deeplFallback.checked } });
  });
  els.deeplKey.addEventListener("change", () => {
    persist({ deepl: { apiKey: els.deeplKey.value.trim() } }, "DeepL key updated");
  });
  els.deeplOptimize.addEventListener("change", () => {
    persist({ deepl: { optimizeUsage: els.deeplOptimize.checked } });
  });

  els.baiduAppid.addEventListener("change", () => {
    persist({ baidu: { appid: els.baiduAppid.value.trim() } });
  });
  els.baiduSecret.addEventListener("change", () => {
    persist({ baidu: { secret: els.baiduSecret.value.trim() } });
  });
  els.baiduOptimize.addEventListener("change", () => {
    persist({ baidu: { optimizeUsage: els.baiduOptimize.checked } });
  });
  els.baiduFallback.addEventListener("change", () => {
    persist({ baidu: { fallback: els.baiduFallback.checked } });
  });
  els.youdaoAppKey.addEventListener("change", () => {
    persist({ youdao: { appKey: els.youdaoAppKey.value.trim() } });
  });
  els.youdaoAppSecret.addEventListener("change", () => {
    persist({ youdao: { appSecret: els.youdaoAppSecret.value.trim() } });
  });
  els.youdaoOptimize.addEventListener("change", () => {
    persist({ youdao: { optimizeUsage: els.youdaoOptimize.checked } });
  });
  els.youdaoFallback.addEventListener("change", () => {
    persist({ youdao: { fallback: els.youdaoFallback.checked } });
  });
  els.papagoClientId.addEventListener("change", () => {
    persist({ papago: { clientId: els.papagoClientId.value.trim() } });
  });
  els.papagoClientSecret.addEventListener("change", () => {
    persist({ papago: { clientSecret: els.papagoClientSecret.value.trim() } });
  });
  els.papagoOptimize.addEventListener("change", () => {
    persist({ papago: { optimizeUsage: els.papagoOptimize.checked } });
  });
  els.papagoFallback.addEventListener("change", () => {
    persist({ papago: { fallback: els.papagoFallback.checked } });
  });

  els.bilingualPage.addEventListener("change", () => persist({ bilingual: { page: els.bilingualPage.value } }));
  els.bilingualComments.addEventListener("change", () =>
    persist({ bilingual: { comments: els.bilingualComments.value } })
  );
  els.bilingualDynamic.addEventListener("change", () =>
    persist({ bilingual: { dynamic: els.bilingualDynamic.value } })
  );
  els.bilingualDanmaku.addEventListener("change", () =>
    persist({ bilingual: { danmaku: els.bilingualDanmaku.value } })
  );
  els.bilingualCaptions.addEventListener("change", () =>
    persist({ bilingual: { captions: els.bilingualCaptions.value } })
  );

  els.bilingualBtn.addEventListener("click", () => {
    const anyBilingual = BILINGUAL_AREAS.some(
      (area) => (settings.bilingual?.[area] || "off") !== "off"
    );
    const mode = anyBilingual ? "off" : "stacked";
    persist({
      bilingual: { page: mode, comments: mode, dynamic: mode, danmaku: mode, captions: mode },
    });
  });

  document.querySelectorAll("[data-open]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const panel = document.getElementById(btn.dataset.open);
      if (panel) panel.classList.add("open");
      if (btn.dataset.open === "panelSettings") refreshCacheCount();
    })
  );
  document.querySelectorAll("[data-close]").forEach((btn) =>
    btn.addEventListener("click", () => {
      document.querySelectorAll(".view-panel.open").forEach((p) => p.classList.remove("open"));
    })
  );

  els.areaPage.addEventListener("change", () => persist({ areas: { page: els.areaPage.checked } }));
  els.areaComments.addEventListener("change", () => persist({ areas: { comments: els.areaComments.checked } }));
  els.areaDynamic.addEventListener("change", () => persist({ areas: { dynamic: els.areaDynamic.checked } }));
  els.areaDanmaku.addEventListener("change", () => persist({ areas: { danmaku: els.areaDanmaku.checked } }));
  els.areaCaptions.addEventListener("change", () => persist({ areas: { captions: els.areaCaptions.checked } }));
  els.areaCreatorPages.addEventListener("change", () =>
    persist({ areas: { creatorPages: els.areaCreatorPages.checked } })
  );

  els.cacheEnabled.addEventListener("change", () => persist({ cache: { enabled: els.cacheEnabled.checked } }));
  els.blurCaptionToggle?.addEventListener("change", () =>
    persist({ learn: { blurCaption: els.blurCaptionToggle.checked } })
  );
  els.properNounsToggle?.addEventListener("change", () =>
    persist({ learn: { properNouns: els.properNounsToggle.checked } })
  );
  els.fitTextToggle?.addEventListener("change", () =>
    persist({ learn: { fitText: els.fitTextToggle.checked } })
  );
  els.hoverTranslateToggle?.addEventListener("change", () =>
    persist({ learn: { hoverTranslate: els.hoverTranslateToggle.checked } })
  );
  els.darkModeToggle.addEventListener("change", () => persist({ darkMode: els.darkModeToggle.checked }));

  els.clearCacheBtn.addEventListener("click", async () => {
    const cacheKey = window.BTE?.BTE_KEYS?.PERSISTENT_CACHE_KEY || "btePersistentCacheV2";
    if (chrome?.storage?.local) {
      await new Promise((resolve) => chrome.storage.local.remove([cacheKey], resolve));
    }
    sendToBiliTabs({ type: "bte:clearCache" });
    if (els.cacheCount) els.cacheCount.textContent = "0";
    showHint(I18N.hintCacheCleared || "Cache cleared");
  });

  els.githubBtn.addEventListener("click", () => openLink("https://github.com/LazyScar/BiliBili-To-English"));
  els.docsBtn.addEventListener("click", () => openLink("https://github.com/LazyScar/BiliBili-To-English#readme"));
  els.updateBtn.addEventListener("click", () => {
    openLink(isFirefox() ? FIREFOX_ADDON_PAGE : GITHUB_RELEASE_PAGE);
  });
  els.verNew?.addEventListener("click", () => {
    openLink(isFirefox() ? FIREFOX_ADDON_PAGE : GITHUB_RELEASE_PAGE);
  });
  els.updateBannerGo?.addEventListener("click", () => {
    openLink(isFirefox() ? FIREFOX_ADDON_PAGE : GITHUB_RELEASE_PAGE);
  });
  els.updateBannerClose?.addEventListener("click", () => {
    updateDismissed = true;
    els.updateBanner.classList.remove("show");
  });
  document.getElementById("errModalClose")?.addEventListener("click", closeErrorModal);
  document.getElementById("errModal")?.addEventListener("click", (event) => {
    if (event.target && event.target.id === "errModal") closeErrorModal();
  });
  document.getElementById("errModalCopy")?.addEventListener("click", async () => {
    const text = [
      document.getElementById("errModalMsg")?.textContent,
      document.getElementById("errModalCode")?.textContent,
    ].filter(Boolean).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      showHint(I18N.errCopied || "Copied");
    } catch (_error) {
    }
  });

  els.checkUpdatesBtn?.addEventListener("click", async () => {
    showHint(I18N.updChecking || "Checking for updates");
    await checkForUpdates(true);
    const cached = await getCachedUpdateInfo();
    if (cached?.tag && compareVersions(cached.tag, localVersion) <= 0) {
      showHint(I18N.updUpToDate || "Up to date");
    }
  });
});
