(function () {
  const ROOT = (window.BTE = window.BTE || {});

  // Resolves named entities to their canonical label so names are not translated literally
  // ("鬼灭之刃" -> "Demon Slayer", not "Ghost Destroying Blade"). Three gates, in order: a free
  // local name check + seen-twice requirement, a 1 req/sec queue, then exact-match-only acceptance.
  const SEARCH_API = "https://www.wikidata.org/w/api.php";
  const MIN_REQUEST_GAP_MS = 1000;   // never exceed ~1 req/sec
  const MIN_SEEN_COUNT = 2;          // must appear at least twice before it is worth asking
  const MIN_LEN = 2;
  const MAX_LEN = 12;                // names are short; longer strings are phrases
  const MAX_CACHE = 500;
  const MAX_QUEUE = 40;

  // Particles/verbs that never appear inside a bare proper noun — their presence means a sentence.
  const SENTENCE_MARKERS = /[的了是在有和与也就都很吗呢吧啊把被从对为把着过还没不我你他她它们这那什么怎么可以因为但是所以如果虽然而且或者已经正在应该需要能够觉得知道看到听到觉]/;
  const DISQUALIFYING = /[0-9A-Za-z\s，。！？、；：""''（）《》…—·~!@#$%^&*()_+=\[\]{}|\\/<>?,.;:'"`-]/;
  const CJK = /^[一-鿿㐀-䶿]+$/;

  class ProperNounResolver {
    constructor() {
      this.enabled = false;
      this.targetLanguage = "en";
      this.seen = new Map();        // phrase -> times observed on this page
      this.resolved = new Map();    // phrase -> canonical label (or null = confirmed not a name)
      this.queue = [];
      this.inFlight = false;
      this.lastRequestAt = 0;
      this.onResolved = null;       // callback(phrase, label)
    }

    setEnabled(on) {
      this.enabled = !!on;
      if (!on) this.queue.length = 0;
    }

    setTargetLanguage(lang) {
      const next = String(lang || "en");
      if (next === this.targetLanguage) return;
      this.targetLanguage = next;
      this.resolved.clear();
      this.queue.length = 0;
    }

    // Gate 1 (free, no network): reject anything sentence-like before it can cost a request.
    looksLikeName(text) {
      const s = String(text || "").trim();
      if (s.length < MIN_LEN || s.length > MAX_LEN) return false;
      if (DISQUALIFYING.test(s)) return false;
      if (!CJK.test(s)) return false;
      if (SENTENCE_MARKERS.test(s)) return false;
      return true;
    }

    observe(text) {
      if (!this.enabled) return;
      const s = String(text || "").trim();
      if (!this.looksLikeName(s)) return;
      if (this.resolved.has(s)) return;              // already answered (hit or confirmed miss)
      const count = (this.seen.get(s) || 0) + 1;
      this.seen.set(s, count);
      if (count < MIN_SEEN_COUNT) return;            // one-off text is not worth a request
      if (this.queue.includes(s)) return;
      this.queue.push(s);
      if (this.queue.length > MAX_QUEUE) this.queue.shift();
      // Drain on the next tick so a burst of observe() calls batches into one drain.
      if (!this._startTimer) {
        this._startTimer = setTimeout(() => {
          this._startTimer = null;
          this.pump();
        }, 0);
      }
    }

    lookup(text) {
      const hit = this.resolved.get(String(text || "").trim());
      return hit || undefined;
    }

    // Returns the in-flight drain when one is running, so callers can await completion.
    pump() {
      if (this.inFlightPromise) return this.inFlightPromise;
      if (!this.enabled || !this.queue.length) return Promise.resolve();
      this.inFlightPromise = this._drain().finally(() => {
        this.inFlightPromise = null;
      });
      return this.inFlightPromise;
    }

    async _drain() {
      this.inFlight = true;
      try {
        while (this.queue.length && this.enabled) {
          const phrase = this.queue.pop();
          if (this.resolved.has(phrase)) continue;
          const wait = MIN_REQUEST_GAP_MS - (Date.now() - this.lastRequestAt);
          if (wait > 0) await new Promise((r) => setTimeout(r, wait));
          this.lastRequestAt = Date.now();
          let label = null;
          try {
            label = await this.resolveOne(phrase);
          } catch (_error) {
            label = null; // retryable on the next page load
          }
          this.remember(phrase, label);
          if (label && typeof this.onResolved === "function") {
            try { this.onResolved(phrase, label); } catch (_error) { /* never break the loop */ }
          }
        }
      } finally {
        this.inFlight = false;
      }
    }

    remember(phrase, label) {
      this.resolved.set(phrase, label || null);
      if (this.resolved.size > MAX_CACHE) {
        const oldest = this.resolved.keys().next().value;
        this.resolved.delete(oldest);
      }
    }

    // Gate 3: accept ONLY an exact match on a described entity.
    async resolveOne(phrase) {
      const searchUrl = `${SEARCH_API}?action=wbsearchentities&format=json&origin=*&type=item&limit=3` +
        `&language=zh&uselang=zh&search=${encodeURIComponent(phrase)}`;
      const data = await this.fetchJson(searchUrl);
      const hits = (data && data.search) || [];
      if (!hits.length) return null;
      const best = hits[0];
      // Undescribed items are usually junk or disambiguation pages.
      const matched = best.match && typeof best.match.text === "string" ? best.match.text.trim() : "";
      if (matched !== phrase) return null;
      if (!best.description) return null;
      if (!best.id) return null;
      const lang = this.targetLanguage;
      const labelUrl = `${SEARCH_API}?action=wbgetentities&format=json&origin=*&props=labels` +
        `&languages=${encodeURIComponent(lang)}&ids=${encodeURIComponent(best.id)}`;
      const entity = await this.fetchJson(labelUrl);
      const labels = entity && entity.entities && entity.entities[best.id] && entity.entities[best.id].labels;
      const value = labels && labels[lang] && labels[lang].value;
      if (!value) return null;
      if (String(value).trim() === phrase) return null;
      return String(value).trim();
    }

    async fetchJson(url) {
      const alive = ROOT.isExtensionAlive ? ROOT.isExtensionAlive() : true;
      if (alive && typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
        try {
          const bg = await new Promise((resolve, reject) => {
            try {
              chrome.runtime.sendMessage(
                { type: "bte:bgFetch", payload: { url, method: "GET", credentials: "omit" } },
                (response) => {
                  const err = chrome.runtime.lastError;
                  if (err) { reject(new Error(err.message || "runtime error")); return; }
                  resolve(response);
                }
              );
            } catch (error) { reject(error); }
          });
          if (bg && bg.ok && bg.text) return JSON.parse(bg.text);
        } catch (_error) {
          /* fall through to a direct fetch */
        }
      }
      const response = await fetch(url, { credentials: "omit" });
      if (!response.ok) throw new Error(`Wikidata HTTP ${response.status}`);
      return response.json();
    }
  }

  ROOT.ProperNounResolver = ProperNounResolver;
})();
