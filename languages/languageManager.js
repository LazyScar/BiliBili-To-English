class LanguageManager {
    constructor() {
        this.currentLanguage = 'en';
        this.availableLanguages = {
            'en': { name: 'English', flag: '🇬🇧' },
            'fr': { name: 'Français', flag: '🇫🇷' },
            'ja': { name: '日本語', flag: '🇯🇵' },
            'ru': { name: 'Русский', flag: '🇷🇺' },
            'vi': { name: 'Tiếng Việt', flag: '🇻🇳' },
            'id': { name: 'Indonesia', flag: '🇮🇩' }
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
            case 'vi':
                this.dictionary = viDictionary;
                break;
            case 'id':
                this.dictionary = idDictionary;
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
        const exact = this.dictionary[text];
        if (exact) return exact;
        const lower = text.toLowerCase();
        if (this.dictionary[lower]) return this.dictionary[lower];
        const normalized = lower.replace(/\s+/g, ' ').trim();
        if (this.dictionary[normalized]) return this.dictionary[normalized];
        // Final fallback: ignore surrounding punctuation/whitespace so a single manual
        // dictionary entry (e.g. "返回") also matches "返回。", " 返回 ", "返回!", etc.
        // — this is the common case for short button/label overrides.
        const stripped = text.replace(/^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu, '');
        if (stripped && stripped !== text) {
            return this.dictionary[stripped] || this.dictionary[stripped.toLowerCase()] || null;
        }
        return null;
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
