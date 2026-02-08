(function () {
  const ROOT = (window.BTE = window.BTE || {});

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  class DeepLEngine {
    constructor() {
      this.name = "deepl";
      this.minIntervalMs = 350;
      this.maxItemsPerRequest = 50;
      this.maxCharsPerRequest = 110_000;
      this.lastRequestAt = 0;
      this.chain = Promise.resolve();
      this.lastError = null;
    }

    schedule(task) {
      const run = this.chain.then(async () => {
        const elapsed = Date.now() - this.lastRequestAt;
        const waitMs = Math.max(0, this.minIntervalMs - elapsed);
        if (waitMs > 0) {
          await sleep(waitMs);
        }
        this.lastRequestAt = Date.now();
        return task();
      });
      this.chain = run.catch(() => {});
      return run;
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
      const groups = this.buildGroups(texts);
      const output = [];
      for (const group of groups) {
        const translated = await this.schedule(() =>
          this.translateGroup(group, {
            endpoint,
            key,
            targetLang,
            sourceLang,
          })
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
        const response = await fetch(context.endpoint, {
          method: "POST",
          headers: {
            Authorization: `DeepL-Auth-Key ${context.key}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          const message = data?.message || `DeepL request failed (${response.status})`;
          this.lastError = message;
          console.warn("BTE DeepL error:", message);
          return new Array(texts.length).fill(null);
        }
        const translations = Array.isArray(data?.translations) ? data.translations : [];
        return texts.map((input, index) => {
          const output = translations[index]?.text;
          const trimmed = typeof output === "string" ? output.trim() : "";
          return trimmed && trimmed !== input ? trimmed : null;
        });
      } catch (error) {
        this.lastError = String(error && error.message ? error.message : error);
        console.warn("BTE DeepL translate failed:", error);
        return new Array(texts.length).fill(null);
      }
    }
  }

  ROOT.DeepLEngine = DeepLEngine;
})();
