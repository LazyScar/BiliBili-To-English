document.addEventListener('DOMContentLoaded', async function() {
    const languageOptions = document.getElementById('languageOptions');
    const currentLanguageSpan = document.getElementById('currentLanguage');
    await languageManager.initialize();
    const currentLang = languageManager.getCurrentLanguage();
    const availableLanguages = languageManager.getAvailableLanguages();
    currentLanguageSpan.textContent = availableLanguages[currentLang]?.name || 'English';
    Object.entries(availableLanguages).forEach(([code, lang]) => {
        const option = document.createElement('div');
        option.className = `language-option ${code === currentLang ? 'selected' : ''}`;
        option.dataset.language = code;
        const flagDiv = document.createElement('div');
        flagDiv.className = 'language-flag';
        flagDiv.textContent = lang.flag;
        const nameDiv = document.createElement('div');
        nameDiv.className = 'language-name';
        nameDiv.textContent = lang.name;
        option.appendChild(flagDiv);
        option.appendChild(nameDiv);
        option.addEventListener('click', async () => {
            document.querySelectorAll('.language-option').forEach(opt => opt.classList.remove('selected'));
            option.classList.add('selected');
            const success = languageManager.switchLanguage(code);
            if (!success) return;
            currentLanguageSpan.textContent = lang.name;
            try {
                if (typeof chrome !== 'undefined' && chrome.tabs) {
                    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                    if (tab && tab.url && tab.url.includes('bilibili.com')) {
                        await chrome.tabs.sendMessage(tab.id, {
                            action: 'switchLanguage',
                            language: code
                        });
                    }
                }
            } catch (err) {}
        });
        languageOptions.appendChild(option);
    });
});
