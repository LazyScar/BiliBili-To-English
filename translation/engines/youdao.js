(function () {
  const ROOT = (window.BTE = window.BTE || {});

  const API_URL = "https://openapi.youdao.com/api";

  function parseJsonSafe(text) {
    try {
      return text ? JSON.parse(text) : null;
    } catch (_error) {
      return null;
    }
  }

  function runtimeMessage(payload) {
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

  async function sha256Hex(str) {
    if (!globalThis.crypto || !globalThis.crypto.subtle) {
      throw new Error("SubtleCrypto unavailable (insecure context)");
    }
    const data = new TextEncoder().encode(str);
    const buf = await globalThis.crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function truncateInput(q) {
    const chars = Array.from(q);
    const len = chars.length;
    if (len <= 20) return q;
    return chars.slice(0, 10).join("") + len + chars.slice(len - 10).join("");
  }

  class YoudaoEngine {
    constructor() {
      this.name = "youdao";
      this.maxItemsPerRequest = 12;
      this.maxCharsPerRequest = 1500;
      this.baseIntervalMs = 120;
      this.minIntervalMs = 120;
      this.maxIntervalMs = 2000;
      this.consecutiveFailures = 0;
      this.lastRequestAt = 0;
      this.lastError = null;
    }

    noteRateLimited() {
      (ROOT.RateGovernor || {}).rateLimited?.(this);
    }

    noteSuccess() {
      (ROOT.RateGovernor || {}).success?.(this);
    }

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

    toYoudaoLang(lang) {
      const lower = String(lang || "").toLowerCase().trim();
      if (!lower || lower === "auto" || lower === "auto-detect") return "auto";
      const map = {
        zh: "zh-CHS", "zh-cn": "zh-CHS", "zh-hans": "zh-CHS", "zh-hant": "zh-CHT", "zh-tw": "zh-CHT",
        en: "en", ja: "ja", fr: "fr", ru: "ru", vi: "vi", id: "id", ko: "ko",
        es: "es", de: "de", pt: "pt", it: "it",
      };
      return map[lower] || lower.split("-")[0];
    }

    async translate(texts, options) {
      if (!Array.isArray(texts) || texts.length === 0) return [];
      const appKey = String(options?.youdaoAppKey || "").trim();
      const appSecret = String(options?.youdaoAppSecret || "").trim();
      if (!appKey || !appSecret) {
        this.lastError = "missing-credentials";
        return new Array(texts.length).fill(null);
      }
      this.lastError = null;
      const from = this.toYoudaoLang(options?.sourceLanguage);
      const to = this.toYoudaoLang(options?.targetLanguage) || "en";
      const ctx = { appKey, appSecret, from, to };
      const priority = options?.priority;
      const settled = await Promise.allSettled(
        texts.map((text) => this.schedule(() => this.translateSingle(String(text), ctx), priority))
      );
      return ROOT.fromSettledResults(settled);
    }

    async translateSingle(text, ctx) {
      const q = text;
      if (!q.trim()) return null;
      const salt = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
      const curtime = String(Math.round(Date.now() / 1000));
      const sign = await sha256Hex(ctx.appKey + truncateInput(q) + salt + curtime + ctx.appSecret);
      const body = new URLSearchParams({
        q,
        from: ctx.from,
        to: ctx.to,
        appKey: ctx.appKey,
        salt,
        sign,
        signType: "v3",
        curtime,
      });
      const res = await this.request(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        credentials: "omit",
      });
      const data = parseJsonSafe(res.text);
      const code = data ? String(data.errorCode) : "";
      if (!data || code !== "0") {
        this.lastError = code || `http-${res.status}`;
        if (code === "411" || code === "412" || code === "304") {
          this.noteRateLimited();
        }
        throw new Error(`Youdao error ${code || res.status}`);
      }
      const translation = Array.isArray(data.translation) ? data.translation.join("\n").trim() : "";
      this.noteSuccess();
      return translation && translation !== q.trim() ? translation : null;
    }
  }

  ROOT.YoudaoEngine = YoudaoEngine;
})();
