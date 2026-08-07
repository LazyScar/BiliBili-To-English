(function () {
  const ROOT = (window.BTE = window.BTE || {});

  // The web page is captcha-walled for datacenter/unknown IPs, so the old sid scrape could never
  // succeed. The Android endpoint needs no scraping: a client-generated UUID as "ucid" plus
  // srv=android. Do not go back to the web path.
  const TRANSLATE_URL = "https://translate.yandex.net/api/v1/tr.json/translate";
  const UCID_TTL_MS = 6 * 60 * 1000; // rotate the client id periodically, like the app does
  const FAIL_COOLDOWN_MS = 60 * 1000; // after a hard failure, fall back instantly for a while

  function parseJsonSafe(text) {
    try {
      return text ? JSON.parse(text) : null;
    } catch (_error) {
      return null;
    }
  }

  function runtimeMessage(payload) {
    // chrome.runtime.id is undefined once the extension is reloaded ("context invalidated").
    // Bail cleanly rather than letting sendMessage throw an uncaught error onto chrome://extensions.
    const alive = ROOT.isExtensionAlive ? ROOT.isExtensionAlive() : !!(chrome && chrome.runtime && chrome.runtime.id);
    if (!alive || !chrome.runtime.sendMessage) {
      return Promise.reject(new Error("runtime unavailable"));
    }
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(payload, (response) => {
          const err = chrome.runtime.lastError;
          if (err) {
            reject(new Error(err.message || "runtime message failed"));
            return;
          }
          resolve(response);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  class YandexEngine {
    constructor() {
      this.name = "yandex";
      this.maxItemsPerRequest = 12;
      this.maxCharsPerRequest = 2500;
      this.baseIntervalMs = 200;
      this.minIntervalMs = 200;
      this.maxIntervalMs = 3000;
      this.consecutiveFailures = 0;
      this.lastRequestAt = 0;
      this.ucid = "";
      this.ucidCreatedAt = 0;
      this.cooldownUntil = 0;
      this.reqCounter = 0;
      this.lastError = null;
    }

    // Client id for the Android endpoint: a plain UUID we generate ourselves (no network, no
    // scraping, nothing to be captcha-blocked). Rotated periodically like the app does.
    getUcid() {
      if (this.ucid && Date.now() - this.ucidCreatedAt < UCID_TTL_MS) return this.ucid;
      const rand = () => Math.floor(Math.random() * 16).toString(16);
      let out = "";
      for (let i = 0; i < 32; i += 1) {
        if (i === 12) out += "4";
        else if (i === 16) out += ((Math.floor(Math.random() * 4) + 8)).toString(16);
        else out += rand();
      }
      this.ucid = out;
      this.ucidCreatedAt = Date.now();
      return this.ucid;
    }

    // The web endpoint rate-limits (HTTP 429). AIMD pacing (see RateGovernor): back off fast,
    // recover gradually so we settle just under the limit instead of re-tripping it.
    noteRateLimited() {
      (ROOT.RateGovernor || {}).rateLimited?.(this);
    }

    noteSuccess() {
      (ROOT.RateGovernor || {}).success?.(this);
    }

    // Serialize + throttle requests (shared paced, priority-aware scheduler — see
    // RateGovernor.schedule) so the shared sid isn't spent faster than Yandex allows.
    schedule(task, priority) {
      return ROOT.RateGovernor.schedule(this, task, priority);
    }

    // Background service worker first (bypasses CORS in iframes/workers), then a direct fetch.
    async request(url, init) {
      const payload = {
        type: "bte:bgFetch",
        payload: {
          url,
          method: init?.method || "GET",
          headers: init?.headers || {},
          body: init?.body,
          credentials: init?.credentials || "omit",
        },
      };
      try {
        const bg = await runtimeMessage(payload);
        if (!bg) throw new Error("empty background response");
        return {
          ok: !!bg.ok,
          status: Number(bg.status || 0),
          statusText: String(bg.statusText || ""),
          text: String(bg.text || ""),
        };
      } catch (_error) {
        const response = await fetch(url, init);
        const text = await response.text();
        return {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          text,
        };
      }
    }

    toYandexLang(lang) {
      const lower = String(lang || "").toLowerCase().trim();
      if (!lower || lower === "auto" || lower === "auto-detect") return "";
      const map = {
        "zh-cn": "zh",
        "zh-hans": "zh",
        "zh-hant": "zh",
        "zh-tw": "zh",
        "pt-br": "pt",
        "pt-pt": "pt",
      };
      return map[lower] || lower.split("-")[0];
    }

    buildGroups(texts) {
      const groups = [];
      let current = [];
      let charCount = 0;
      texts.forEach((text) => {
        const addition = text.length;
        if (
          current.length > 0 &&
          (current.length >= this.maxItemsPerRequest || charCount + addition > this.maxCharsPerRequest)
        ) {
          groups.push(current);
          current = [];
          charCount = 0;
        }
        current.push(text);
        charCount += addition;
      });
      if (current.length) {
        groups.push(current);
      }
      return groups;
    }

    async translate(texts, options) {
      if (!Array.isArray(texts) || texts.length === 0) {
        return [];
      }
      // Fast-fail during a cooldown after a hard failure: skip the throttle queue entirely so the
      // manager falls back to another engine with no added latency.
      if (Date.now() < this.cooldownUntil) {
        throw Object.assign(new Error("Yandex unavailable (cooldown)"), { reason: this.lastError || "cooldown" });
      }
      const target = this.toYandexLang(options?.targetLanguage) || "en";
      const source = this.toYandexLang(options?.sourceLanguage);
      // Yandex accepts "<from>-<to>" or just "<to>" (auto-detect the source).
      const lang = source && source !== target ? `${source}-${target}` : target;
      const priority = options?.priority;
      const groups = this.buildGroups(texts);
      const output = [];
      for (const group of groups) {
        const translated = await this.schedule(() => this.translateGroup(group, lang, false), priority);
        output.push(...translated);
      }
      return output;
    }

    async translateGroup(texts, lang, retriedUcid) {
      this.reqCounter += 1;
      const query = new URLSearchParams();
      // Android-app style request: a self-generated client id, no scraped session token.
      query.set("ucid", this.getUcid());
      query.set("srv", "android");
      query.set("lang", lang);
      query.set("format", "text");
      const url = `${TRANSLATE_URL}?${query.toString()}`;

      const body = new URLSearchParams();
      texts.forEach((text) => body.append("text", text));

      const res = await this.request(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        credentials: "omit",
      });

      const data = parseJsonSafe(res.text);
      const code = data && Number.isFinite(Number(data.code)) ? Number(data.code) : null;

      // A rejected/stale client id surfaces as HTTP 403 or a non-200 body code. Rotate the ucid
      // once and retry before giving up, so one bad id doesn't blank a whole batch.
      const ucidRejected = res.status === 403 || code === 401 || code === 403 || code === 404;
      if (ucidRejected && !retriedUcid) {
        this.ucid = "";
        this.ucidCreatedAt = 0;
        return this.translateGroup(texts, lang, true);
      }

      if (res.status === 429 || res.status >= 500) {
        this.noteRateLimited();
      }

      if (!res.ok || (code !== null && code !== 200)) {
        // Back off briefly so a broken endpoint doesn't get hammered once per batch, and record a
        // reason the popup can show instead of silently switching engines.
        this.lastError = res.status === 429 ? "rate-limited" : "unavailable";
        this.cooldownUntil = Date.now() + FAIL_COOLDOWN_MS;
        throw Object.assign(
          new Error(`Yandex request failed (${res.status}${code !== null ? `/code ${code}` : ""})`),
          { status: res.status || undefined, reason: this.lastError }
        );
      }

      const arr = Array.isArray(data?.text) ? data.text : [];
      this.lastError = null;
      this.cooldownUntil = 0;
      this.noteSuccess();
      return texts.map((input, index) => {
        const out = typeof arr[index] === "string" ? arr[index].trim() : "";
        return out && out !== String(input).trim() ? out : null;
      });
    }
  }

  ROOT.YandexEngine = YandexEngine;
})();
