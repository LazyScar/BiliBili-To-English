(function () {
  const ROOT = (window.BTE = window.BTE || {});

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  class GoogleEngine {
    constructor() {
      this.name = "google";
      this.minIntervalMs = 130;
      this.maxCharsPerRequest = 3500;
      this.maxItemsPerRequest = 40;
      this.separator = "\n<<<BTE_SPLIT_TOKEN>>>\n";
      this.fallbackConcurrency = 6;
      this.lastRequestAt = 0;
      this.chain = Promise.resolve();
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

    buildGroups(texts) {
      const groups = [];
      let current = [];
      let charCount = 0;
      texts.forEach((text) => {
        const addition = text.length + this.separator.length;
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
      const targetLanguage = options?.targetLanguage || "en";
      const sourceLanguage = options?.sourceLanguage || "auto";
      const groups = this.buildGroups(texts);
      const output = [];
      for (const group of groups) {
        const translatedGroup = await this.schedule(() =>
          this.translateGroup(group, sourceLanguage, targetLanguage)
        );
        output.push(...translatedGroup);
      }
      return output;
    }

    async translateGroup(texts, sourceLanguage, targetLanguage) {
      if (texts.length === 1) {
        const single = await this.translateSingle(texts[0], sourceLanguage, targetLanguage);
        return [single];
      }
      const joined = texts.join(this.separator);
      const translatedJoined = await this.translateSingle(joined, sourceLanguage, targetLanguage);
      if (!translatedJoined) {
        return this.translateFallback(texts, sourceLanguage, targetLanguage);
      }
      const parts = translatedJoined.split(this.separator);
      if (parts.length !== texts.length) {
        return this.translateFallback(texts, sourceLanguage, targetLanguage);
      }
      return parts.map((part, index) => {
        const trimmed = part.trim();
        return trimmed && trimmed !== texts[index] ? trimmed : null;
      });
    }

    async translateFallback(texts, sourceLanguage, targetLanguage) {
      const results = new Array(texts.length).fill(null);
      let cursor = 0;
      const worker = async () => {
        while (true) {
          const index = cursor;
          cursor += 1;
          if (index >= texts.length) return;
          results[index] = await this.translateSingle(texts[index], sourceLanguage, targetLanguage);
        }
      };
      const workers = Array.from(
        { length: Math.max(1, Math.min(this.fallbackConcurrency, texts.length)) },
        () => worker()
      );
      await Promise.allSettled(workers);
      return results;
    }

    async translateSingle(text, sourceLanguage, targetLanguage) {
      try {
        const url =
          "https://translate.googleapis.com/translate_a/single?client=gtx" +
          `&sl=${encodeURIComponent(sourceLanguage || "auto")}` +
          `&tl=${encodeURIComponent(targetLanguage)}` +
          "&dt=t" +
          `&q=${encodeURIComponent(text)}`;
        const response = await fetch(url);
        if (!response.ok) {
          return null;
        }
        const data = await response.json();
        const chunks = Array.isArray(data?.[0]) ? data[0] : [];
        let merged = "";
        chunks.forEach((chunk) => {
          if (Array.isArray(chunk) && typeof chunk[0] === "string") {
            merged += chunk[0];
          }
        });
        const normalized = merged.trim();
        if (!normalized || normalized === text.trim()) {
          return null;
        }
        return normalized;
      } catch (error) {
        console.warn("BTE Google translate failed:", error);
        return null;
      }
    }
  }

  ROOT.GoogleEngine = GoogleEngine;
})();
