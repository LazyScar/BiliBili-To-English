class LanguageManager {
    constructor() {
        this.currentLanguage = 'en';
        this.availableLanguages = {
            'en': { name: 'English', flag: '🇬🇧' },
            'fr': { name: 'Français', flag: '🇫🇷' },
            'ja': { name: '日本語', flag: '🇯🇵' },
            'ru': { name: 'Русский', flag: '🇷🇺' }
        };
        this.dictionary = enDictionary;
    }

    getCurrentLanguage() {
        return this.currentLanguage;
    }

    getCurrentLanguageName() {
        return this.availableLanguages[this.currentLanguage]?.name || 'English';
    }

    getAvailableLanguages() {
        return this.availableLanguages;
    }

    switchLanguage(langCode) {
        if (!this.availableLanguages[langCode]) {
            console.error(`Language ${langCode} not supported`);
            return false;
        }

        this.currentLanguage = langCode;
        
        switch(langCode) {
            case 'en':
                this.dictionary = enDictionary;
                break;
            case 'fr':
                this.dictionary = frDictionary;
                break;
            case 'ja':
                this.dictionary = jaDictionary;
                break;
            case 'ru':
                this.dictionary = ruDictionary;
                break;
            default:
                this.dictionary = enDictionary;
        }

        if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.sync.set({ 'selectedLanguage': langCode });
        }
        
        return true;
    }

    getTranslation(text) {
        if (!text) return null;
        return this.dictionary[text.toLowerCase()] || null;
    }

    async initialize() {
        try {
            if (typeof chrome !== 'undefined' && chrome.storage) {
                const result = await chrome.storage.sync.get(['selectedLanguage']);
                if (result.selectedLanguage) {
                    this.switchLanguage(result.selectedLanguage);
                }
            }
        } catch (error) {
            console.error('Error loading language preference:', error);
            this.switchLanguage('en');
        }
    }
}

const languageManager = new LanguageManager();
window.languageManager = languageManager; 
