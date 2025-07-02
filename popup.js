document.addEventListener('DOMContentLoaded', async function() {
    const languageOptions = document.getElementById('languageOptions');
    const currentLanguageSpan = document.getElementById('currentLanguage');
    
    // Initialize language manager
    await languageManager.initialize();
    
    // Get current language
    const currentLang = languageManager.getCurrentLanguage();
    const availableLanguages = languageManager.getAvailableLanguages();
    
    // Update current language display
    currentLanguageSpan.textContent = availableLanguages[currentLang]?.name || 'English';
    
    // Populate language options
    Object.entries(availableLanguages).forEach(([code, lang]) => {
        const option = document.createElement('div');
        option.className = `language-option ${code === currentLang ? 'selected' : ''}`;
        option.dataset.language = code;
        option.innerHTML = `
            <div class="language-flag">${lang.flag}</div>
            <div class="language-name">${lang.name}</div>
        `;
        option.addEventListener('click', async () => {
            document.querySelectorAll('.language-option').forEach(opt => {
                opt.classList.remove('selected');
            });
            option.classList.add('selected');
            const success = languageManager.switchLanguage(code);
            if (success) {
                currentLanguageSpan.textContent = lang.name;
                try {
                    if (typeof chrome !== 'undefined' && chrome.tabs) {
                        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                        if (tab && tab.url && tab.url.includes('bilibili.com')) {
                            try {
                                await chrome.tabs.sendMessage(tab.id, {
                                    action: 'switchLanguage',
                                    language: code
                                });
                            } catch (messageError) {
                                // Content script not ready or not on BiliBili page
                            }
                        }
                    }
                } catch (error) {
                    // Tab not available or not a BiliBili page
                }
            }
        });
        languageOptions.appendChild(option);
    });
}); 
