console.log("[BiliBili-Translator] main.js script started.");

const translationCache = new Map();
const ongoingRequests = new Set();
const MAX_TRANSLATION_LENGTH = 800;
const TRANSLATION_CACHE_DURATION = 60000;
const PROCESS_INTERVAL = 500;
const MUTATION_OBSERVER_CONFIG = {
    childList: true,
    subtree: true
};

function initializeLanguageManager() {
    if (typeof window.languageManager === 'undefined') {
        console.error('BiliBili-Translator: languageManager.js did not load correctly. Using fallback.');
        window.languageManager = {
            getCurrentLanguage: () => 'en',
            getTranslation: (text) => enDictionary[text.toLowerCase()] || null,
            switchLanguage: () => true,
            initialize: async () => {}
        };
    }
    window.languageManager.initialize().catch(error => {
        console.error('BiliBili-Translator: Error initializing language manager:', error);
    });
}

async function translateText(text) {
    if (!text || !text.trim()) {
        return null;
    }
    try {
        const chunks = splitTextIntoChunks(text, MAX_TRANSLATION_LENGTH);
        const translatedChunks = [];
        const targetLang = window.languageManager.getCurrentLanguage();

        for (const chunk of chunks) {
            const response = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(chunk)}`);
            const data = await response.json();
            if (data && data[0] && data[0][0] && data[0][0][0]) {
                translatedChunks.push(data[0][0][0]);
            }
        }
        return translatedChunks.join(' ');
    } catch (error) {
        console.error("BiliBili-Translator: Translation API error:", error);
        return null;
    }
}

function processNode(node) {
    if (!window.languageManager || node.isTranslated) return;
    
    const originalText = (node.nodeValue || "").trim();
    if (!originalText) return;

    const dictionaryTranslation = window.languageManager.getTranslation(originalText);

    if (dictionaryTranslation) {
        node.textContent = dictionaryTranslation;
        node.isTranslated = true;
    } else {
        if (originalText.length > 1 && !ongoingRequests.has(originalText)) {
             ongoingRequests.add(originalText);
             translateText(originalText).then(translatedText => {
                if (translatedText && translatedText !== originalText) {
                    node.textContent = translatedText;
                    node.isTranslated = true;
                    translationCache.set(originalText, translatedText);
                    setTimeout(() => translationCache.delete(originalText), TRANSLATION_CACHE_DURATION);
                }
                ongoingRequests.delete(originalText);
            });
        }
    }
}

function walkTheDOM(node) {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null, false);
    let currentNode;
    while (currentNode = walker.nextNode()) {
        processNode(currentNode);
    }
}

function initialize() {
    initializeLanguageManager();

    setTimeout(() => {
        walkTheDOM(document.body);

        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((addedNode) => {
                    if (addedNode.nodeType === Node.ELEMENT_NODE) {
                        walkTheDOM(addedNode);
                    }
                });
            });
        });

        observer.observe(document.body, MUTATION_OBSERVER_CONFIG);
    }, 250);
}

if (typeof chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'switchLanguage' && window.languageManager) {
            window.languageManager.switchLanguage(message.language);
            
            const allNodes = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
            let node;
            while(node = allNodes.nextNode()) {
                delete node.isTranslated;
            }
            
            walkTheDOM(document.body);
            sendResponse({success: true});
        }
        return true;
    });
}

function splitTextIntoChunks(text, maxLength) {
    const chunks = [];
    let currentChunk = '';
    text.split(' ').forEach(word => {
        if ((currentChunk + ' ' + word).length > maxLength) {
            chunks.push(currentChunk.trim());
            currentChunk = word;
        } else {
            currentChunk += ' ' + word;
        }
    });
    if (currentChunk) {
        chunks.push(currentChunk.trim());
    }
    return chunks;
}

initialize(); 