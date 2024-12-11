const translationCache = new Map();
const ongoingRequests = new Set();
const MAX_TRANSLATION_LENGTH = 800;
const TRANSLATION_CACHE_DURATION = 600000;
const PROCESS_INTERVAL = 500;
const MUTATION_OBSERVER_CONFIG = { 
    childList: true, 
    subtree: true 
};

async function translateText(text) {
    try {
        const chunks = splitTextIntoChunks(text, MAX_TRANSLATION_LENGTH);
        const translatedChunks = [];

        for (const chunk of chunks) {
            const response = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(chunk)}`);
            const data = await response.json();

            if (data && data[0] && data[0][0] && data[0][0][0]) {
                translatedChunks.push(data[0][0][0]);
            }
        }

        return translatedChunks.join(' ');
    } catch (error) {
        console.error("Translation error:", error);
        return null;
    }
}

function processNode(node, translateFunction) {
    const originalText = node.nodeValue ? node.nodeValue.trim() : 
                         node.textContent ? node.textContent.trim() : '';
    
    if (!originalText) return;

    if (node.processed || 
        (node.parentElement && node.parentElement.id === 'h-name')) {
        return;
    }

    const cachedTranslation = translationCache.get(originalText);
    const dictionaryTranslation = dictionary[originalText.toLowerCase()];

    if (cachedTranslation) {
        node.nodeValue ? node.nodeValue = cachedTranslation : 
        node.textContent = cachedTranslation;
        node.processed = true;
        return;
    }

    if (dictionaryTranslation) {
        node.nodeValue ? node.nodeValue = dictionaryTranslation : 
        node.textContent = dictionaryTranslation;
        translationCache.set(originalText, dictionaryTranslation);
        node.processed = true;
        return;
    }

    if (ongoingRequests.has(originalText)) return;

    ongoingRequests.add(originalText);
    translateFunction(node, originalText);
}

function setupDynamicContentObserver() {
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach((addedNode) => {
                    if (addedNode.nodeType === Node.ELEMENT_NODE) {
                        processAddedElement(addedNode);
                    }
                });
            }
        });
    });

    observer.observe(document.body, MUTATION_OBSERVER_CONFIG);
}

function processAddedElement(element) {
    if (element.nodeType !== Node.ELEMENT_NODE) return;

    const textNodes = [];
    const walker = document.createTreeWalker(
        element, 
        NodeFilter.SHOW_TEXT, 
        null, 
        false
    );

    let node;
    while (node = walker.nextNode()) {
        textNodes.push(node);
    }

    textNodes.forEach(textNode => {
        processNode(textNode, async (nodeToTranslate, text) => {
            const translatedText = await translateText(text);
            if (translatedText) {
                nodeToTranslate.nodeValue = translatedText;
                translationCache.set(text, translatedText);
                nodeToTranslate.processed = true;

                setTimeout(() => {
                    translationCache.delete(text);
                }, TRANSLATION_CACHE_DURATION);
            }
            ongoingRequests.delete(text);
        });
    });

    const placeholderElements = element.querySelectorAll('input[placeholder], textarea[placeholder]');
    placeholderElements.forEach(processPlaceholderElement);
}

function processPlaceholderElement(element) {
    if (element.dataset.processed) return;

    const originalPlaceholder = element.placeholder.trim();
    
    if (!originalPlaceholder) return;

    const cachedTranslation = translationCache.get(originalPlaceholder);
    const dictionaryTranslation = dictionary[originalPlaceholder.toLowerCase()];

    if (cachedTranslation) {
        element.placeholder = cachedTranslation;
        element.dataset.processed = true;
        return;
    }

    if (dictionaryTranslation) {
        element.placeholder = dictionaryTranslation;
        translationCache.set(originalPlaceholder, dictionaryTranslation);
        element.dataset.processed = true;
        return;
    }

    if (ongoingRequests.has(originalPlaceholder)) return;

    ongoingRequests.add(originalPlaceholder);
    
    translateText(originalPlaceholder).then(translatedText => {
        if (translatedText) {
            element.placeholder = translatedText;
            translationCache.set(originalPlaceholder, translatedText);
            element.dataset.processed = true;

            setTimeout(() => {
                translationCache.delete(originalPlaceholder);
            }, TRANSLATION_CACHE_DURATION);
        }
        ongoingRequests.delete(originalPlaceholder);
    });
}

function processTextNodes() {
    const textNodes = document.createTreeWalker(
        document.body, 
        NodeFilter.SHOW_TEXT, 
        null, 
        false
    );

    let node;
    while (node = textNodes.nextNode()) {
        processNode(node, async (nodeToTranslate, text) => {
            const translatedText = await translateText(text);
            if (translatedText) {
                nodeToTranslate.nodeValue = translatedText;
                translationCache.set(text, translatedText);
                nodeToTranslate.processed = true;

                setTimeout(() => {
                    translationCache.delete(text);
                }, TRANSLATION_CACHE_DURATION);
            }
            ongoingRequests.delete(text);
        });
    }
}

function processPlaceholders() {
    const inputElements = document.querySelectorAll('input[placeholder], textarea[placeholder]');
    inputElements.forEach(processPlaceholderElement);
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

function replaceText() {
    processTextNodes();
    processPlaceholders();
}

function initialize() {
    replaceText();
    setupDynamicContentObserver();
}

setInterval(replaceText, PROCESS_INTERVAL);

initialize();
