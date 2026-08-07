(function () {
  const ROOT = (window.BTE = window.BTE || {});

  // Naver Papago has no keyless public path, so this engine uses the official Naver Cloud
  // Platform NMT API. It needs a Client ID + Client secret from console.ncloud.com (AI NAVER
  // API > Papago Translation), configured in the popup like DeepL. Credentials go in the
  // X-NCP-APIGW-API-KEY-ID / X-NCP-APIGW-API-KEY headers.
  const API_URL = "https://naveropenapi.apigw.ntruss.com/nmt/v1/translation";

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

  class PapagoEngine {
    constructor() {
      this.name = "papago";
      this.maxItemsPerRequest = 10;
      this.maxCharsPerRequest = 1000;
      this.baseIntervalMs = 120;
      this.minIntervalMs = 120;
      this.maxIntervalMs = 2000;
      this.consecutiveFailures = 0;
      this.lastRequestAt = 0;
      this.lastError = null;
    }

    // 429 (Too Many Requests) / rate errors. AIMD pacing (see RateGovernor) keeps requests just
    // under the limit instead of oscillating into repeated throttles.
    noteRateLimited() {
      (ROOT.RateGovernor || {}).rateLimited?.(this);
    }

    noteSuccess() {
      (ROOT.RateGovernor || {}).success?.(this);
    }

    // Shared paced, priority-aware scheduler (see RateGovernor.schedule).
    schedule(task, priority) {
      return ROOT.RateGovernor.schedule(this, task, priority);
    }

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
        return { ok: !!bg.ok, status: Number(bg.status || 0), text: String(bg.text || "") };
      } catch (_error) {
        const response = await fetch(url, init);
        const text = await response.text();
        return { ok: response.ok, status: response.status, text };
      }
    }

    toPapagoLang(lang) {
      const lower = String(lang || "").toLowerCase().trim();
      const map = {
        zh: "zh-CN", "zh-cn": "zh-CN", "zh-hans": "zh-CN",
        "zh-hant": "zh-TW", "zh-tw": "zh-TW",
        en: "en", ja: "ja", ko: "ko", fr: "fr", ru: "ru", vi: "vi", id: "id",
        es: "es", de: "de", it: "it", pt: "pt", th: "th",
      };
      return map[lower] || lower.split("-")[0];
    }

    async translate(texts, options) {
      if (!Array.isArray(texts) || texts.length === 0) return [];
      const clientId = String(options?.papagoClientId || "").trim();
      const clientSecret = String(options?.papagoClientSecret || "").trim();
      if (!clientId || !clientSecret) {
        this.lastError = "missing-credentials";
        return new Array(texts.length).fill(null);
      }
      this.lastError = null;
      // Papago's translate endpoint requires an explicit source. Auto-detect isn't offered
      // here, and BiliBili content is Chinese, so default an unspecified source to zh-CN.
      const rawSource = String(options?.sourceLanguage || "").toLowerCase().trim();
      const source = !rawSource || rawSource === "auto" || rawSource === "auto-detect"
        ? "zh-CN"
        : this.toPapagoLang(rawSource);
      const target = this.toPapagoLang(options?.targetLanguage) || "en";
      if (source === target) {
        // Papago rejects identical source/target; nothing to do.
        return new Array(texts.length).fill(null);
      }
      const ctx = { clientId, clientSecret, source, target };
      const priority = options?.priority;
      const settled = await Promise.allSettled(
        texts.map((text) => this.schedule(() => this.translateSingle(String(text), ctx), priority))
      );
      return settled.map((result) => (result.status === "fulfilled" ? result.value : null));
    }

    async translateSingle(text, ctx) {
      if (!text.trim()) return null;
      const body = new URLSearchParams({ source: ctx.source, target: ctx.target, text });
      const res = await this.request(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-NCP-APIGW-API-KEY-ID": ctx.clientId,
          "X-NCP-APIGW-API-KEY": ctx.clientSecret,
        },
        body: body.toString(),
        credentials: "omit",
      });
      const data = parseJsonSafe(res.text);
      if (!res.ok || !data || data.error || !data.message) {
        const code = data?.error?.errorCode || res.status;
        this.lastError = String(code || "unknown");
        if (res.status === 429) this.noteRateLimited();
        // Throw so the manager falls back and doesn't negative-cache an auth/rate failure.
        throw new Error(`Papago error ${code}`);
      }
      const translated = String(data.message?.result?.translatedText || "").trim();
      this.noteSuccess();
      return translated && translated !== text.trim() ? translated : null;
    }
  }

  ROOT.PapagoEngine = PapagoEngine;
})();
