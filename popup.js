document.addEventListener('DOMContentLoaded', async () => {
  const translationToggle = document.getElementById('toggleBtn');
  const darkToggle = document.getElementById('darkModeToggle');
  const langSelect = document.getElementById('languageSelect');
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsMenu = document.getElementById('settingsMenu');
  const mainControls = document.getElementById('main-controls');
  const statusText = document.getElementById('statusText');
  const statusIndicator = document.getElementById('statusIndicator');

  const hasChrome = typeof chrome !== 'undefined';
  const storage = {
    get(keys) {
      return new Promise((resolve) => {
        if (!hasChrome || !chrome.storage || !chrome.storage.sync) return resolve({});
        chrome.storage.sync.get(keys, resolve);
      });
    },
    set(obj) {
      return new Promise((resolve) => {
        if (!hasChrome || !chrome.storage || !chrome.storage.sync) return resolve();
        chrome.storage.sync.set(obj, resolve);
      });
    }
  };

  const sendToBiliTabs = (payloads) => {
    if (!hasChrome || !chrome.tabs) return;
    chrome.tabs.query({ url: ['*://*.bilibili.com/*','*://bilibili.com/*'] }, (tabs) => {
      (tabs || []).forEach(tab => {
        (Array.isArray(payloads) ? payloads : [payloads]).forEach(p => chrome.tabs.sendMessage(tab.id, p, () => {}));
      });
    });
  };

  const setToggleUI = (enabled) => {
    translationToggle.classList.toggle('active', enabled);
    translationToggle.classList.toggle('bg-blue-500', enabled);
    statusText.innerText = enabled ? 'ACTIVE' : 'INACTIVE';
    statusIndicator.classList.toggle('bg-blue-500', enabled);
  };

  const setDarkUI = (dark) => {
    darkToggle.classList.toggle('active', dark);
    document.body.classList.toggle('light-mode', !dark);
  };

  await languageManager.initialize();
  const availableLanguages = languageManager.getAvailableLanguages();

  const data = await storage.get(['enabled', 'language', 'darkMode']);
  const initialEnabled = data.enabled !== false;
  const initialDark = data.darkMode !== false;
  if (typeof data.darkMode === 'undefined') await storage.set({ darkMode: true });

  let currentLang = data.language || languageManager.getCurrentLanguage() || 'en';
  if (currentLang !== languageManager.getCurrentLanguage()) languageManager.switchLanguage(currentLang);

  const buildLanguageSelect = (current) => {
    if (!langSelect) return;
    langSelect.innerHTML = '';
    Object.entries(availableLanguages).forEach(([code, lang]) => {
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = `${lang.flag ? lang.flag + ' ' : ''}${lang.name}`;
      langSelect.appendChild(opt);
    });
    langSelect.value = current;
  };

  buildLanguageSelect(currentLang);
  setToggleUI(initialEnabled);
  setDarkUI(initialDark);
  sendToBiliTabs({ type: 'toggleTranslation', enabled: initialEnabled });

  settingsBtn.addEventListener('click', () => {
    settingsMenu.classList.toggle('hidden');
    mainControls.classList.toggle('hidden');
  });

  translationToggle.addEventListener('click', async () => {
    const newEnabled = !translationToggle.classList.contains('active');
    setToggleUI(newEnabled);
    await storage.set({ enabled: newEnabled });
    sendToBiliTabs({ type: 'toggleTranslation', enabled: newEnabled });
  });

  if (langSelect) {
    langSelect.addEventListener('change', async () => {
      const code = langSelect.value;
      const success = languageManager.switchLanguage(code);
      if (!success) return;
      currentLang = code;
      await storage.set({ language: code });
      sendToBiliTabs({ action: 'switchLanguage', language: code });
    });
  }

  darkToggle.addEventListener('click', async () => {
    const makeDark = !darkToggle.classList.contains('active');
    setDarkUI(makeDark);
    await storage.set({ darkMode: makeDark });
  });
});
