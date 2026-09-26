(function () {
  const ROOT = (window.BTE = window.BTE || {});

  const ENDPOINT = "https://translate.googleapis.com/translate_a/single";
  const REQUEST_TIMEOUT_MS = 15000;
  // Google's front end rejects long GET URLs (400/413/414). CJK text URL-encodes to 9 bytes per
  // character, so budgets are counted in encoded bytes, not characters.
  // Long GET URLs are rejected; CJK text URL-encodes to 9 bytes per character.
  const MAX_ENCODED_QUERY_BYTES = 6000;
  const RATE_LIMIT_COOLDOWN_BASE_MS = 20000;
  const RATE_LIMIT_COOLDOWN_MAX_MS = 5 * 60 * 1000;
  // Google sometimes adds spaces inside or around the split token, so match it loosely.
  // Google sometimes adds spaces inside the split token.
  const SPLIT_PATTERN = /\s*<{2,3}\s*BTE[\s_]*SPLIT[\s_]*TOKEN\s*>{2,3}\s*/i;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function googleError(message, status, reason, extra) {
    return Object.assign(new Error(message), { status, reason }, extra || {});
  }

  class GoogleEngine {
    constructor() {
      this.name = "google";
      this.baseIntervalMs = 130;
      this.minIntervalMs = 130;
      this.maxIntervalMs = 2500;
      this.consecutiveFailures = 0;
      this.maxCharsPerRequest = 3500;
      this.maxItemsPerRequest = 40;
      this.separator = "\n<<<BTE_SPLIT_TOKEN>>>\n";
      this.lastRequestAt = 0;
      this.lastError = null;
      this.cooldownUntil = 0;
      this.rateLimitStreak = 0;
      // Failures always throw (or flag partialFailure), so a null result means "no translation
      // needed" and the manager need not retry it on another engine.
      this.reportsErrors = true;
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

    encodedSize(text) {
      try {
        return encodeURIComponent(text).length;
      } catch (_error) {
        return String(text || "").length * 9;
      }
    }

    buildGroups(texts) {
      const groups = [];
      const separatorBytes = this.encodedSize(this.separator);
      let current = [];
      let bytes = 0;
      texts.forEach((text) => {
        const addition = this.encodedSize(text) + separatorBytes;
        if (
          current.length > 0 &&
          (current.length >= this.maxItemsPerRequest || bytes + addition > MAX_ENCODED_QUERY_BYTES)
        ) {
          groups.push(current);
          current = [];
          bytes = 0;
        }
        current.push(text);
        bytes += addition;
      });
      if (current.length) {
        groups.push(current);
      }
      return groups;
    }

    inCooldown() {
      return Date.now() < this.cooldownUntil;
    }

    async translate(texts, options) {
      if (!Array.isArray(texts) || texts.length === 0) {
        return [];
      }
      if (this.inCooldown()) {
        // Google has just blocked us (429 / "unusual traffic"). Hitting it again only extends the
        // block, so let the manager fall back to another engine until the cooldown ends.
        throw googleError("Google Translate is rate limited (cooldown)", 429, this.lastError || "rate-limited");
      }
      const targetLanguage = options?.targetLanguage || "en";
      const sourceLanguage = options?.sourceLanguage || "auto";
      const priority = options?.priority;
      const groups = this.buildGroups(texts);
      const output = [];
      let failedGroups = 0;
      let lastError = null;
      for (const group of groups) {
        if (this.inCooldown()) {
          failedGroups += 1;
          lastError = lastError || googleError("Google Translate is rate limited (cooldown)", 429, "rate-limited");
          output.push(...new Array(group.length).fill(null));
          continue;
        }
        try {
          const translatedGroup = await this.schedule(
            () => this.translateGroup(group, sourceLanguage, targetLanguage),
            priority
          );
          output.push(...translatedGroup);
        } catch (error) {
          failedGroups += 1;
          lastError = error;
          output.push(...new Array(group.length).fill(null));
        }
      }
      if (failedGroups && failedGroups === groups.length) {
        throw lastError;
      }
      if (failedGroups) {
        // Some groups translated, some failed: tell the manager those nulls are errors, not
        // "nothing to translate", so it retries them elsewhere and does not negative-cache them.
        output.partialFailure = true;
      }
      return output;
    }

    splitJoined(translatedJoined, expectedCount) {
      const parts = String(translatedJoined || "").split(SPLIT_PATTERN);
      if (parts.length === expectedCount) return parts;
      // A stray empty part at either end (separator echoed at the start/end) is harmless.
      const trimmed = parts.filter((part, index) => part.trim() || (index > 0 && index < parts.length - 1));
      return trimmed.length === expectedCount ? trimmed : null;
    }

    toResult(translated, original) {
      const trimmed = String(translated || "").trim();
      return trimmed && trimmed !== String(original || "").trim() ? trimmed : null;
    }

    async translateGroup(texts, sourceLanguage, targetLanguage) {
      if (texts.length === 1) {
        try {
          const single = await this.requestTranslation(texts[0], sourceLanguage, targetLanguage);
          return [this.toResult(single, texts[0])];
        } catch (error) {
          // One line Google refuses outright: leave it untranslated rather than failing its group.
          if (error && error.tooLong) return [null];
          throw error;
        }
      }
      let translatedJoined = null;
      try {
        translatedJoined = await this.requestTranslation(texts.join(this.separator), sourceLanguage, targetLanguage);
      } catch (error) {
        if (!error || !error.tooLong) throw error;
      }
      const parts = translatedJoined === null ? null : this.splitJoined(translatedJoined, texts.length);
      if (parts) {
        return parts.map((part, index) => this.toResult(part, texts[index]));
      }
      // The split token got mangled or the request was too long: halve the group and retry each
      // half in turn. Sequential with the engine's pacing — the old path fired six parallel
      // single-line requests outside the scheduler, which is what tripped Google's rate limit.
      const middle = Math.ceil(texts.length / 2);
      const left = await this.translateGroup(texts.slice(0, middle), sourceLanguage, targetLanguage);
      await sleep(this.minIntervalMs || 0);
      const right = await this.translateGroup(texts.slice(middle), sourceLanguage, targetLanguage);
      return left.concat(right);
    }

    parseGoogleResponse(data) {
      const chunks = Array.isArray(data?.[0]) ? data[0] : [];
      let merged = "";
      chunks.forEach((chunk) => {
        if (Array.isArray(chunk) && typeof chunk[0] === "string") {
          merged += chunk[0];
        }
      });
      return merged;
    }

    noteRequestFailure(status, reason) {
      this.lastError = reason;
      if (status === 429) {
        if (this.inCooldown()) return;
        this.rateLimitStreak = Math.min(this.rateLimitStreak + 1, 6);
        const cooldown = Math.min(
          RATE_LIMIT_COOLDOWN_MAX_MS,
          RATE_LIMIT_COOLDOWN_BASE_MS * Math.pow(2, this.rateLimitStreak - 1)
        );
        this.cooldownUntil = Date.now() + cooldown;
      }
      if (status === 429 || status >= 500) {
        this.noteRateLimited();
      }
    }

    noteRequestSuccess() {
      this.lastError = null;
      this.rateLimitStreak = 0;
      this.cooldownUntil = 0;
      this.noteSuccess();
    }

    async directFetch(url, init) {
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;
      try {
        const response = await fetch(url, { ...init, signal: controller ? controller.signal : undefined });
        const text = await response.text();
        return { ok: response.ok, status: response.status, text };
      } catch (error) {
        if (controller && controller.signal.aborted) {
          throw googleError("Google Translate request timed out", 0, "timeout", { timedOut: true });
        }
        throw error;
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    backgroundFetch(url, init) {
      return new Promise((resolve, reject) => {
        const alive = ROOT.isExtensionAlive ? ROOT.isExtensionAlive() : !!(chrome && chrome.runtime && chrome.runtime.id);
        if (!alive || !chrome.runtime.sendMessage) {
          reject(new Error("runtime unavailable"));
          return;
        }
        try {
          chrome.runtime.sendMessage(
            {
              type: "bte:bgFetch",
              payload: { url, method: init.method, headers: init.headers, body: init.body, credentials: "omit" },
            },
            (response) => {
              const err = chrome.runtime.lastError;
              if (err) {
                reject(new Error(err.message || "runtime error"));
                return;
              }
              if (!response || (!response.status && !response.ok)) {
                reject(new Error((response && response.error) || "background fetch failed"));
                return;
              }
              resolve({ ok: !!response.ok, status: Number(response.status) || 0, text: response.text || "" });
            }
          );
        } catch (error) {
          reject(error);
        }
      });
    }

    async fetchResponse(url, init) {
      try {
        return await this.directFetch(url, init);
      } catch (directError) {
        if ((directError && directError.timedOut) || ROOT.pageUnloading) throw directError;
        // The direct request never got an HTTP answer (CORS / network policy in the content
        // script). Retry once through the background worker. HTTP errors such as 429 are NOT
        // retried there — same IP, same block, and a second request only prolongs it.
        // Only network failures are retried in the background; a 429 would just repeat the block.
        try {
          return await this.backgroundFetch(url, init);
        } catch (bgError) {
          const offline = typeof navigator !== "undefined" && navigator.onLine === false;
          throw googleError(
            `Google Translate request failed: ${(bgError && bgError.message) || bgError}`,
            0,
            offline ? "offline" : "network"
          );
        }
      }
    }

    async requestTranslation(text, sourceLanguage, targetLanguage) {
      const params =
        "client=gtx" +
        `&sl=${encodeURIComponent(sourceLanguage || "auto")}` +
        `&tl=${encodeURIComponent(targetLanguage)}` +
        "&dt=t";
      const query = `q=${encodeURIComponent(text)}`;
      // A single oversized text cannot be split further; send it in a POST body instead of the URL.
      const usePost = query.length > MAX_ENCODED_QUERY_BYTES;
      const url = usePost ? `${ENDPOINT}?${params}` : `${ENDPOINT}?${params}&${query}`;
      const init = usePost
        ? {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
            body: query,
            credentials: "omit",
          }
        : { method: "GET", credentials: "omit" };

      let response;
      try {
        response = await this.fetchResponse(url, init);
      } catch (error) {
        this.noteRequestFailure(0, error.reason || "network");
        throw error;
      }

      const status = response.status;
      if (!response.ok) {
        if (status === 413 || status === 414 || (status === 400 && (usePost || url.length > 2000))) {
          // Too long for Google's front end; the caller splits the group and retries.
          this.lastError = "unavailable";
          throw googleError(`Google Translate rejected the request (${status})`, status, "unavailable", {
            tooLong: true,
          });
        }
        const reason = status === 429 ? "rate-limited" : "unavailable";
        this.noteRequestFailure(status, reason);
        throw googleError(`Google Translate request failed (${status})`, status || 503, reason);
      }

      let data = null;
      try {
        data = JSON.parse(response.text);
      } catch (_error) {
        // A 200 with an HTML body is Google's "unusual traffic" interstitial.
        const captcha = /unusual traffic|sorry\/index|recaptcha/i.test(response.text || "");
        const reason = captcha ? "captcha" : "unavailable";
        this.noteRequestFailure(captcha ? 429 : 503, reason);
        throw googleError("Google Translate returned an unexpected response", captcha ? 429 : 503, reason);
      }
      this.noteRequestSuccess();
      return this.parseGoogleResponse(data);
    }
  }

  ROOT.GoogleEngine = GoogleEngine;
})();
