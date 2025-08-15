const MAX_TRANSLATION_LENGTH = 800;
const CACHE_DURATION        = 60000;

const OBSERVER_CONFIG = {
  childList: true,
  subtree: true,
  attributes: true,
  characterData: true,
  attributeFilter: ['alt','placeholder','title','aria-label','value']
};

const translationCache    = new Map();
const pendingTranslations = new Map();

const observedRoots = new WeakSet();
const activeObservers = new Set();

let commentBatchTimer = null;
let currentCommentContainer = null;
let BTE_ENABLED = true;

function initializeLanguageManager() {
  if (!window.languageManager) {
    window.languageManager = {
      currentLanguage: 'en',
      getCurrentLanguage() { return this.currentLanguage; },
      switchLanguage(lang) { this.currentLanguage = lang; return true; },
      getTranslation(text) {
        const dict = window[`${this.currentLanguage}Dictionary`] || {};
        return dict[text] ?? dict[text.toLowerCase()] ?? null;
      }
    };
  }
}

function splitTextIntoChunks(text, maxLen) {
  const words = text.split(' ');
  const chunks = [];
  let chunk = '';
  for (const w of words) {
    if ((chunk + ' ' + w).length > maxLen) {
      chunks.push(chunk.trim());
      chunk = w;
    } else {
      chunk = chunk ? chunk + ' ' + w : w;
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

async function fetchGoogleTranslation(text, lang) {
  const parts = await Promise.all(
    splitTextIntoChunks(text, MAX_TRANSLATION_LENGTH).map(chunk =>
      fetch(
        `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto`
        + `&tl=${encodeURIComponent(lang)}&dt=t&q=${encodeURIComponent(chunk)}`
      )
      .then(r => r.json())
      .then(d => d?.[0]?.[0]?.[0] || '')
      .catch(() => '')
    )
  );
  const joined = parts.filter(Boolean).join(' ');
  return (joined && joined !== text) ? joined : null;
}

function getTranslation(text) {
  if (!BTE_ENABLED) return Promise.resolve({ trans: null, source: 'disabled' });
  const lang = window.languageManager.getCurrentLanguage();
  const dictTrans = window.languageManager.getTranslation(text);
  if (dictTrans) return Promise.resolve({ trans: dictTrans, source: 'dict' });
  const key = `${lang}::${text}`;
  if (translationCache.has(key)) {
    return Promise.resolve({ trans: translationCache.get(key), source: 'google' });
  }
  if (pendingTranslations.has(key)) {
    return pendingTranslations.get(key);
  }
  const p = fetchGoogleTranslation(text, lang)
    .then(gt => {
      translationCache.set(key, gt);
      setTimeout(() => translationCache.delete(key), CACHE_DURATION);
      if (!BTE_ENABLED) return { trans: null, source: 'disabled' };
      return gt ? { trans: gt, source: 'google' } : { trans: null, source: 'google' };
    })
    .finally(() => pendingTranslations.delete(key));
  pendingTranslations.set(key, p);
  return p;
}

function processTextNode(node) {
  if (!BTE_ENABLED) return;
  const original = node._origValue !== undefined
    ? node._origValue
    : node.nodeValue;
  if (node._origValue === undefined) {
    node._origValue = node.nodeValue;
  }
  const full = original;
  if (!full || !full.trim()) return;

  const lang = window.languageManager.getCurrentLanguage();

  if (node._lastValue === full && node._lastLang === lang) return;
  node._lastValue = full;
  node._lastLang  = lang;

  const leading  = (full.match(/^\s*/)  || [''])[0];
  const trailing = (full.match(/\s*$/)  || [''])[0];
  const core     = full.slice(leading.length, full.length - trailing.length);
  if (!core) return;

  const dictTrans = window.languageManager.getTranslation(core);
  if (dictTrans) {
    node.nodeValue  = leading + dictTrans + trailing;
    node._lastLang  = lang;
    return;
  }

  getTranslation(core).then(({ trans, source }) => {
    if (!BTE_ENABLED) return;
    if (
      trans &&
      node._origValue === original &&
      node._lastLang === lang &&
      node.nodeValue === full
    ) {
      node.nodeValue    = leading + trans + trailing;
      node._lastValue   = full;
      node._lastLang    = lang;
      node._transSource = source;
    }
  });
}

const ATTRS = ['alt','placeholder','title','aria-label','value'];
function processAttributes(el) {
  if (!BTE_ENABLED) return;
  for (const attr of ATTRS) {
    if (!el.hasAttribute(attr)) continue;
    const currentVal = el.getAttribute(attr);
    if (!currentVal.trim()) continue;

    el._attrOrig   = el._attrOrig   || {};
    el._attrSource = el._attrSource || {};

    if (el._attrOrig[attr] === undefined) {
      el._attrOrig[attr] = currentVal;
    }
    const raw  = el._attrOrig[attr];
    const lang = window.languageManager.getCurrentLanguage();

    if (
      (el._attrSource[attr] === 'dict') ||
      (el._attrTransLang === lang && el.getAttribute(attr) !== raw)
    ) continue;

    const dictTrans = window.languageManager.getTranslation(raw);
    if (dictTrans) {
      el.setAttribute(attr, dictTrans);
      el._attrSource[attr]    = 'dict';
      el._attrTransLang       = lang;
      continue;
    }

    getTranslation(raw).then(({ trans }) => {
      if (!BTE_ENABLED) return;
      if (trans && el._attrOrig[attr] === raw) {
        el.setAttribute(attr, trans);
        el._attrSource[attr]    = 'google';
        el._attrTransLang       = lang;
      }
    });
  }
}

function walkDOM(root) {
  if (!BTE_ENABLED || !root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL, null, false);
  let node;
  while (node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE)      processTextNode(node);
    else if (node.nodeType === Node.ELEMENT_NODE) processAttributes(node);
  }
}

function onMutations(muts) {
  if (!BTE_ENABLED) return;
  const app   = document.getElementById('commentapp');
  const bili  = app?.querySelector('bili-comments');
  const cont  = bili ? (bili.shadowRoot || bili) : null;

  for (const m of muts) {
    if (cont && (m.target === cont || cont.contains(m.target))) {
      scheduleCommentBatch(cont);
      continue;
    }
    if (m.type === 'childList') {
      for (const n of m.addedNodes) {
        if (n.nodeType === Node.TEXT_NODE)      processTextNode(n);
        else if (n.nodeType === Node.ELEMENT_NODE) {
          walkDOM(n);
          if (n.shadowRoot) observeRoot(n.shadowRoot);
        }
      }
    } else if (m.type === 'attributes') {
      processAttributes(m.target);
    } else if (m.type === 'characterData') {
      processTextNode(m.target);
    }
  }
}

function observeRoot(root) {
  if (observedRoots.has(root)) return;
  observedRoots.add(root);
  walkDOM(root);
  const obs = new MutationObserver(onMutations);
  obs.observe(root, OBSERVER_CONFIG);
  activeObservers.add(obs);
}

function stopObservers() {
  activeObservers.forEach(o => o.disconnect());
  activeObservers.clear();
  observedRoots.clear();
  clearTimeout(commentBatchTimer);
}

function scheduleCommentBatch(container) {
  if (!BTE_ENABLED) return;
  if (currentCommentContainer !== container) {
    currentCommentContainer = container;
  }
  clearTimeout(commentBatchTimer);
  commentBatchTimer = setTimeout(() => {
    if (!BTE_ENABLED) return;
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => walkDOM(currentCommentContainer), { timeout: 500 });
    } else {
      walkDOM(currentCommentContainer);
    }
  }, 200);
}

function pollForComments() {
  const iv = setInterval(() => {
    if (!BTE_ENABLED) { clearInterval(iv); return; }
    const app  = document.getElementById('commentapp');
    const bili = app?.querySelector('bili-comments');
    if (!bili) return;
    clearInterval(iv);
    scheduleCommentBatch(bili.shadowRoot || bili);
  }, 500);
}

function pollForDict(lang) {
  const name = `${lang}Dictionary`;
  const iv = setInterval(() => {
    if (!BTE_ENABLED) { clearInterval(iv); return; }
    const d = window[name];
    if (d && typeof d === 'object' && Object.keys(d).length > 0) {
      clearInterval(iv);
      walkDOM(document.body);
    }
  }, 200);
}

function start() {
  if (!BTE_ENABLED) return;
  observeRoot(document.body);
  document.querySelectorAll('*').forEach(el => {
    if (el.shadowRoot) observeRoot(el.shadowRoot);
  });
  pollForComments();
  pollForDict(window.languageManager.getCurrentLanguage());
}

function initialize() {
  initializeLanguageManager();

  const afterPrefs = () => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }
  };

  if (chrome?.storage?.sync) {
    chrome.storage.sync.get(['selectedLanguage','enabled'], (result) => {
      if (result.selectedLanguage) {
        const lang = result.selectedLanguage;
        window.languageManager.switchLanguage(lang);
        translationCache.clear();
        pendingTranslations.clear();
      }
      BTE_ENABLED = result.enabled !== false;
      afterPrefs();
    });
  } else {
    afterPrefs();
  }

  if (chrome?.runtime) {
    chrome.runtime.onMessage.addListener((msg, _, resp) => {
      if (msg.action === 'switchLanguage') {
        window.languageManager.switchLanguage(msg.language);
        translationCache.clear();
        pendingTranslations.clear();
        if (BTE_ENABLED) {
          walkDOM(document.body);
          pollForComments();
          pollForDict(msg.language);
        }
        resp && resp({ success: true });
      } else if (
        msg?.type === 'toggleTranslation' ||
        msg?.action === 'toggleTranslation' ||
        msg?.action === 'setEnabled'
      ) {
        BTE_ENABLED = !!msg.enabled;
        if (BTE_ENABLED) {
          start();
        } else {
          stopObservers();
        }
        resp && resp({ success: true });
      }
      return true;
    });
  }
}

initialize();
