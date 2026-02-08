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
    enabledToggle: document.getElementById("enabledToggle"),
    statusDot: document.getElementById("statusDot"),
    statusText: document.getElementById("statusText"),
    languageSelect: document.getElementById("languageSelect"),
    engineSelect: document.getElementById("engineSelect"),
    deeplSection: document.getElementById("deeplSection"),
    deeplKey: document.getElementById("deeplKey"),
    deeplEndpoint: document.getElementById("deeplEndpoint"),
    deeplFallback: document.getElementById("deeplFallback"),
    microsoftSection: document.getElementById("microsoftSection"),
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
  };

  const localVersion = chrome?.runtime?.getManifest?.().version || "0.0.0";
  els.appVersion.textContent = `v${localVersion}`;

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
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(() => {
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
    els.enabledToggle.checked = !!settings.enabled;
    els.statusText.textContent = settings.enabled ? "ACTIVE" : "INACTIVE";
    els.statusDot.classList.toggle("on", !!settings.enabled);

    els.languageSelect.value = settings.targetLanguage || "en";
    els.engineSelect.value = settings.engine || "google";
    els.deeplKey.value = settings.deepl?.apiKey || "";
    els.deeplEndpoint.value = settings.deepl?.endpointMode || "auto";
    els.deeplFallback.checked = settings.deepl?.fallbackToGoogle !== false;
    els.deeplSection.style.display = settings.engine === "deepl" ? "grid" : "none";
    els.microsoftSection.style.display = settings.engine === "microsoft" ? "grid" : "none";

    els.bilingualPage.value = settings.bilingual?.page || "off";
    els.bilingualComments.value = settings.bilingual?.comments || "off";
    els.bilingualDynamic.value = settings.bilingual?.dynamic || "off";
    els.bilingualDanmaku.value = settings.bilingual?.danmaku || "off";
    els.bilingualCaptions.value = settings.bilingual?.captions || "off";

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

  async function persist(partial, message = "Saved") {
    if (applying) return;
    showHint("Saving...", 700);
    const next = await settingsManager.update(partial);
    render(next);
    sendToBiliTabs({
      type: "bte:updateSettings",
      payload: partial,
    });
    showHint(message);
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
      els.updateBtn.style.display = "inline-block";
      els.updateBtn.textContent = "Update";
    } else {
      els.updateStatus.textContent = "Up to date";
      els.updateBtn.style.display = "none";
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

  els.enabledToggle.addEventListener("change", () => persist({ enabled: els.enabledToggle.checked }));
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
});
