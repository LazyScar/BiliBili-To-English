// Language Manager for BiliBili Translation Extension
class LanguageManager {
    constructor() {
        this.currentLanguage = 'en';
        this.availableLanguages = {
            'en': { name: 'English', flag: '🇺🇸' },
            'fr': { name: 'Français', flag: '🇫🇷' }
        };
        this.dictionary = enDictionary; // Default to English
    }

    // Get current language code
    getCurrentLanguage() {
        return this.currentLanguage;
    }

    // Get current language name
    getCurrentLanguageName() {
        return this.availableLanguages[this.currentLanguage]?.name || 'English';
    }

    // Get available languages
    getAvailableLanguages() {
        return this.availableLanguages;
    }

    // Switch to a different language
    switchLanguage(langCode) {
        if (!this.availableLanguages[langCode]) {
            console.error(`Language ${langCode} not supported`);
            return false;
        }

        this.currentLanguage = langCode;
        
        // Load the appropriate dictionary
        switch(langCode) {
            case 'en':
                this.dictionary = enDictionary;
                break;
            case 'fr':
                this.dictionary = frDictionary;
                break;
            default:
                this.dictionary = enDictionary;
        }

        // Save preference to storage
        if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.sync.set({ 'selectedLanguage': langCode });
        }
        
        return true;
    }

    // Get translation from current dictionary
    getTranslation(text) {
        if (!text) return null;
        return this.dictionary[text.toLowerCase()] || null;
    }

    // Initialize language from storage
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
            // Default to English if there's an error
            this.switchLanguage('en');
        }
    }
}

// Create global instance and make it available
const languageManager = new LanguageManager();
window.languageManager = languageManager; 