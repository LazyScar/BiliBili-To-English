(function () {
  const ROOT = (window.BTE = window.BTE || {});

  class DeepLEngine {
    constructor() {
      this.name = "deepl";
      this.baseIntervalMs = 350;
      this.minIntervalMs = 350;
      this.maxItemsPerRequest = 50;
      this.maxCharsPerRequest = 110_000;
      this.lastRequestAt = 0;
      this.lastError = null;
    }

    schedule(task, priority) {
      return ROOT.RateGovernor.schedule(this, task, priority);
    }

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
      // DeepL source languages never carry a region ("ZH", not "ZH-CN"), unlike some targets.
      const sourceLang = options?.sourceLanguage && options.sourceLanguage !== "auto"
        ? String(options.sourceLanguage).split(/[-_]/)[0].toUpperCase()
        : null;
      const priority = options?.priority;
      const groups = this.buildGroups(texts);
      return ROOT.runEngineGroups(groups, (group) =>
        this.schedule(
          () =>
            this.translateGroup(group, {
              endpoint,
              key,
              targetLang,
              sourceLang,
            }),
          priority
        )
      );
    }

    async translateGroup(texts, context) {
      const body = new URLSearchParams();
      texts.forEach((text) => body.append("text", text));
      body.append("target_lang", context.targetLang);
      if (context.sourceLang) {
        body.append("source_lang", context.sourceLang);
      }
      try {
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
          if (!ROOT.isExtensionAlive || ROOT.isExtensionAlive()) {
            console.warn("BTE DeepL error:", message);
          }
          throw Object.assign(new Error(message), { status: response.status || undefined });
        }
        if (!Array.isArray(data?.translations)) {
          throw Object.assign(new Error("DeepL returned no translations"), { status: 502 });
        }
        const translations = data.translations;
        return texts.map((input, index) => {
          const output = translations[index]?.text;
          const trimmed = typeof output === "string" ? output.trim() : "";
          return trimmed && trimmed !== input ? trimmed : null;
        });
      } catch (error) {
        this.lastError = String(error && error.message ? error.message : error);
        if (!ROOT.isExtensionAlive || ROOT.isExtensionAlive()) {
          console.warn("BTE DeepL translate failed:", error);
        }
        throw error;
      }
    }
  }

  ROOT.DeepLEngine = DeepLEngine;
})();
