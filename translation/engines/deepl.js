(function () {
  const ROOT = (window.BTE = window.BTE || {});

  class DeepLEngine {
    constructor() {
      this.name = "deepl";
      // DeepL is paced at a fixed interval (no AIMD). baseIntervalMs === minIntervalMs keeps the
      // shared scheduler's jitter at zero, so its steady 350 ms spacing is never perturbed.
      this.baseIntervalMs = 350;
      this.minIntervalMs = 350;
      this.maxItemsPerRequest = 50;
      this.maxCharsPerRequest = 110_000;
      this.lastRequestAt = 0;
      this.lastError = null;
    }

    // Shared paced, priority-aware scheduler (see RateGovernor.schedule).
    schedule(task, priority) {
      return ROOT.RateGovernor.schedule(this, task, priority);
    }

    // Background worker first (the only context with cross-origin privileges in MV3).
    async request(url, init) {
      const alive = ROOT.isExtensionAlive ? ROOT.isExtensionAlive() : true;
      if (alive && typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
        try {
          const bg = await new Promise((resolve, reject) => {
            try {
              chrome.runtime.sendMessage(
                {
                  type: "bte:bgFetch",
                  payload: {
                    url,
                    method: init?.method || "GET",
                    headers: init?.headers || {},
                    body: init?.body,
                    credentials: "omit",
                  },
                },
                (response) => {
                  const err = chrome.runtime.lastError;
                  if (err) { reject(new Error(err.message || "runtime error")); return; }
                  resolve(response);
                }
              );
            } catch (error) {
              reject(error);
            }
          });
          if (bg) {
            return {
              ok: !!bg.ok,
              status: Number(bg.status || 0),
              statusText: String(bg.statusText || ""),
              text: String(bg.text || ""),
            };
          }
        } catch (_error) {
          /* fall through to a direct fetch */
        }
      }
      const response = await fetch(url, init);
      const text = await response.text();
      return { ok: response.ok, status: response.status, statusText: response.statusText, text };
    }

    resolveEndpoint(mode, key) {
      if (mode === "free") {
        return "https://api-free.deepl.com/v2/translate";
      }
      if (mode === "pro") {
        return "https://api.deepl.com/v2/translate";
      }
      return /:fx$/i.test(key) ? "https://api-free.deepl.com/v2/translate" : "https://api.deepl.com/v2/translate";
    }

    toDeepLLang(lang) {
      if (!lang) return "EN";
      const lower = lang.toLowerCase();
      const map = {
        en: "EN",
        fr: "FR",
        ja: "JA",
        ru: "RU",
        de: "DE",
        es: "ES",
        it: "IT",
        pt: "PT-PT",
        "pt-br": "PT-BR",
        nl: "NL",
        pl: "PL",
        tr: "TR",
        uk: "UK",
        zh: "ZH",
      };
      return map[lower] || lower.replace(/_/g, "-").toUpperCase();
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
      const key = options?.deeplApiKey ? String(options.deeplApiKey).trim() : "";
      if (!key) {
        this.lastError = "missing-key";
        return new Array(texts.length).fill(null);
      }
      this.lastError = null;
      const endpointMode = options?.endpointMode || "auto";
      const endpoint = this.resolveEndpoint(endpointMode, key);
      const targetLang = this.toDeepLLang(options?.targetLanguage || "en");
      const sourceLang = options?.sourceLanguage && options.sourceLanguage !== "auto"
        ? this.toDeepLLang(options.sourceLanguage)
        : null;
      const priority = options?.priority;
      const groups = this.buildGroups(texts);
      const output = [];
      for (const group of groups) {
        const translated = await this.schedule(
          () =>
            this.translateGroup(group, {
              endpoint,
              key,
              targetLang,
              sourceLang,
            }),
          priority
        );
        output.push(...translated);
      }
      return output;
    }

    async translateGroup(texts, context) {
      const body = new URLSearchParams();
      texts.forEach((text) => body.append("text", text));
      body.append("target_lang", context.targetLang);
      if (context.sourceLang) {
        body.append("source_lang", context.sourceLang);
      }
      try {
        // MV3 content scripts do NOT inherit cross-origin privileges, so a direct fetch here is
        // CORS-blocked. Every engine must go through the background worker.
        const response = await this.request(context.endpoint, {
          method: "POST",
          headers: {
            Authorization: `DeepL-Auth-Key ${context.key}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: body.toString(),
        });
        let data = {};
        try {
          data = response.text ? JSON.parse(response.text) : {};
        } catch (_error) {
          data = {};
        }
        if (!response.ok) {
          const message = data?.message || `DeepL request failed (${response.status})`;
          this.lastError = message;
          // Silent once the extension context is gone — otherwise every batch logs after a reload.
          if (!ROOT.isExtensionAlive || ROOT.isExtensionAlive()) {
            console.warn("BTE DeepL error:", message);
          }
          // Throw so the manager falls back (to Microsoft) and doesn't negative-cache a fetch
          // failure. Carrying the HTTP status marks it a SOFT error (handled by fallback/backoff)
          // rather than a hard "internet is down" signal.
          throw Object.assign(new Error(message), { status: response.status || undefined });
        }
        const translations = Array.isArray(data?.translations) ? data.translations : [];
        return texts.map((input, index) => {
          const output = translations[index]?.text;
          const trimmed = typeof output === "string" ? output.trim() : "";
          return trimmed && trimmed !== input ? trimmed : null;
        });
      } catch (error) {
        this.lastError = String(error && error.message ? error.message : error);
        // Silent once the extension context is gone, and left to the manager's throttled logging
        // otherwise, so a persistent failure can't flood the console once per batch.
        if (!ROOT.isExtensionAlive || ROOT.isExtensionAlive()) {
          console.warn("BTE DeepL translate failed:", error);
        }
        throw error;
      }
    }
  }

  ROOT.DeepLEngine = DeepLEngine;
})();
