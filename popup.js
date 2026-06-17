document.addEventListener("DOMContentLoaded", async () => {
  const SettingsManager = window.BTE?.SettingsManager;
  if (!SettingsManager) return;

  const settingsManager = new SettingsManager();
  await languageManager.initialize();
  let settings = await settingsManager.initialize();
  let applying = false;
  let hintTimer = null;

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
    deeplMenuRow: document.getElementById("deeplMenuRow"),
    deeplKey: document.getElementById("deeplKey"),
    deeplEndpoint: document.getElementById("deeplEndpoint"),
    deeplFallback: document.getElementById("deeplFallback"),
    deeplOptimize: document.getElementById("deeplOptimize"),
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
    clearCacheBtn: document.getElementById("clearCacheBtn"),
    darkModeToggle: document.getElementById("darkModeToggle"),
    saveHint: document.getElementById("saveHint"),
    updateStatus: document.getElementById("updateStatus"),
    githubBtn: document.getElementById("githubBtn"),
    docsBtn: document.getElementById("docsBtn"),
    updateBtn: document.getElementById("updateBtn"),
    updateBadge: document.getElementById("updateBadge"),
  };

  const localVersion = chrome?.runtime?.getManifest?.().version || "0.0.0";
  els.appVersion.textContent = `v${localVersion}`;

  const BILINGUAL_AREAS = ["page", "comments", "dynamic", "danmaku", "captions"];
  const ENGINE_ICONS = {
    // Real Google "G" mark
    google:
      '<svg viewBox="0 0 48 48" width="16" height="16"><path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"/><path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"/><path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"/><path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"/></svg>',
    // Real Microsoft four-square logo
    microsoft:
      '<svg viewBox="0 0 24 24" width="16" height="16"><rect x="2" y="2" width="9" height="9" fill="#F25022"/><rect x="13" y="2" width="9" height="9" fill="#7FBA00"/><rect x="2" y="13" width="9" height="9" fill="#00A4EF"/><rect x="13" y="13" width="9" height="9" fill="#FFB900"/></svg>',
    // DeepL navy rounded mark
    deepl:
      '<svg viewBox="0 0 24 24" width="16" height="16"><rect x="1.5" y="1.5" width="21" height="21" rx="5" fill="#0f2b46"/><text x="12" y="17" font-size="13" fill="#fff" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="700">D</text></svg>',
  };
  function setEngineIcon(engine) {
    if (!els.engineIcon) return;
    els.engineIcon.innerHTML = ENGINE_ICONS[engine] || ENGINE_ICONS.google;
  }

  function isFirefox() {
    return /Firefox/i.test(navigator.userAgent) || typeof browser !== "undefined";
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

  function buildBilingualSelects() {
    const modeOptions = [
      { value: "off", label: "Off (replace)" },
      { value: "stacked", label: "Stacked" },
      { value: "sideBySide", label: "Side-by-side" },
    ];
    [
      els.bilingualPage,
      els.bilingualComments,
      els.bilingualDynamic,
      els.bilingualDanmaku,
      els.bilingualCaptions,
    ].forEach((select) => {
      select.innerHTML = "";
      modeOptions.forEach((mode) => {
        const option = document.createElement("option");
        option.value = mode.value;
        option.textContent = mode.label;
        select.appendChild(option);
      });
    });
  }

  function render(nextSettings) {
    applying = true;
    settings = nextSettings;
    const enabled = !!settings.enabled;
    els.enableBtn.classList.toggle("on", enabled);
    els.enableLabel.textContent = enabled ? "Translation on" : "Enable translation";

    els.languageSelect.value = settings.targetLanguage || "en";
    els.engineSelect.value = settings.engine || "microsoft";
    setEngineIcon(settings.engine || "microsoft");
    els.deeplKey.value = settings.deepl?.apiKey || "";
    els.deeplEndpoint.value = settings.deepl?.endpointMode || "auto";
    els.deeplFallback.checked = settings.deepl?.fallbackToGoogle !== false;
    els.deeplOptimize.checked = settings.deepl?.optimizeUsage === true;
    els.deeplMenuRow.style.display = settings.engine === "deepl" ? "flex" : "none";

    els.bilingualPage.value = settings.bilingual?.page || "off";
    els.bilingualComments.value = settings.bilingual?.comments || "off";
    els.bilingualDynamic.value = settings.bilingual?.dynamic || "off";
    els.bilingualDanmaku.value = settings.bilingual?.danmaku || "off";
    els.bilingualCaptions.value = settings.bilingual?.captions || "off";
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
    els.darkModeToggle.checked = settings.darkMode !== false;
    document.body.classList.toggle("light", settings.darkMode === false);
    applying = false;
  }

  async function persist(partial) {
    if (applying) return;
    const next = await settingsManager.update(partial);
    render(next);
    sendToBiliTabs({
      type: "bte:updateSettings",
      payload: partial,
    });
    showHint("Saved");
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

  function applyUpdateUI(releaseTag) {
    if (!releaseTag) return;
    const isNew = compareVersions(releaseTag, localVersion) > 0;
    if (isNew) {
      els.updateStatus.textContent = `Update ${releaseTag} available`;
      els.updateBtn.style.display = "block";
      els.updateBtn.textContent = `Update to ${releaseTag}`;
      if (els.updateBadge) els.updateBadge.style.display = "inline-block";
    } else {
      els.updateStatus.textContent = "Up to date";
      els.updateBtn.style.display = "none";
      if (els.updateBadge) els.updateBadge.style.display = "none";
    }
  }

  async function checkForUpdates() {
    const now = Date.now();
    const cached = await getCachedUpdateInfo();
    if (cached && cached.checkedAt && now - cached.checkedAt < 1000 * 60 * 60) {
      applyUpdateUI(cached.tag);
      return;
    }
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

  buildLanguageSelect();
  buildBilingualSelects();
  render(settings);
  checkForUpdates();

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
    const engine = els.engineSelect.value;
    persist({ engine }, `${engine} selected`);
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

  // "Show bilingual" button — flips every area between bilingual (stacked) and replace (off).
  // The per-area selects in the Bilingual panel still allow fine-grained control.
  els.bilingualBtn.addEventListener("click", () => {
    const anyBilingual = BILINGUAL_AREAS.some(
      (area) => (settings.bilingual?.[area] || "off") !== "off"
    );
    const mode = anyBilingual ? "off" : "stacked";
    persist({
      bilingual: { page: mode, comments: mode, dynamic: mode, danmaku: mode, captions: mode },
    });
  });

  // Slide-in panels (Exclude areas / Bilingual per area / Settings).
  document.querySelectorAll("[data-open]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const panel = document.getElementById(btn.dataset.open);
      if (panel) panel.classList.add("open");
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
  els.darkModeToggle.addEventListener("change", () => persist({ darkMode: els.darkModeToggle.checked }));

  els.clearCacheBtn.addEventListener("click", async () => {
    const cacheKey = window.BTE?.BTE_KEYS?.PERSISTENT_CACHE_KEY || "btePersistentCacheV2";
    if (chrome?.storage?.local) {
      await new Promise((resolve) => chrome.storage.local.remove([cacheKey], resolve));
    }
    sendToBiliTabs({ type: "bte:clearCache" });
    showHint("Cache cleared");
  });

  els.githubBtn.addEventListener("click", () => openLink("https://github.com/LazyScar/BiliBili-To-English"));
  els.docsBtn.addEventListener("click", () => openLink("https://github.com/LazyScar/BiliBili-To-English#readme"));
  els.updateBtn.addEventListener("click", () => {
    openLink(isFirefox() ? FIREFOX_ADDON_PAGE : GITHUB_RELEASE_PAGE);
  });
  els.updateBadge.addEventListener("click", () => {
    openLink(isFirefox() ? FIREFOX_ADDON_PAGE : GITHUB_RELEASE_PAGE);
  });
});
