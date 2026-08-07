(function () {
  const ROOT = (window.BTE = window.BTE || {});

  const EDGE_AUTH_URL = "https://edge.microsoft.com/translate/auth";
  const API_URL = "https://api.cognitive.microsofttranslator.com/translate";
  const API_VERSION = "3.0";
  // The free Edge token endpoint answers 404 for non-Edge clients, so the keyless path is Bing's
  // own web translator: scrape IG / IID / token+key, then POST to ttranslatev3.
  // NOTE: this requires a browser User-Agent — without one the response is 200 with an empty body.
  const BING_HOME = "https://www.bing.com/translator";
  const BING_TOKEN_TTL_MS = 8 * 60 * 1000;

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

  function decodeJwtExpiry(token) {
    try {
      const parts = String(token || "").split(".");
      if (parts.length < 2) return Date.now() + 8 * 60 * 1000;
      const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const normalized = payload + "=".repeat((4 - (payload.length % 4)) % 4);
      const decoded = atob(normalized);
      const json = JSON.parse(decoded);
      if (json && Number.isFinite(json.exp)) {
        return json.exp * 1000;
      }
    } catch (_error) {
      // fall through
    }
    return Date.now() + 8 * 60 * 1000;
  }

  function isArrayLikeTextList(texts) {
    return Array.isArray(texts) && texts.length > 0;
  }

  class MicrosoftEngine {
    constructor() {
      this.name = "microsoft";
      this.maxItemsPerRequest = 40;
      this.maxCharsPerRequest = 4500;
      this.baseIntervalMs = 120;
      this.minIntervalMs = 120;
      this.maxIntervalMs = 2000;
      this.consecutiveFailures = 0;
      this.lastRequestAt = 0;
      this.authToken = "";
      this.authExpiresAt = 0;
      this.authPromise = null;
      // Escalating cooldown (2 min doubling to 30) so a persistently-broken endpoint is retried
      // rarely; resets on success.
      this.authFailedUntil = 0;
      this.authBaseCooldownMs = 2 * 60 * 1000;
      this.authMaxCooldownMs = 30 * 60 * 1000;
      this.authCooldownMs = this.authBaseCooldownMs;
      this.authFailStreak = 0;
      // Bing web-translator credentials (scraped, no API key needed).
      this.bing = { ig: "", iid: "", token: "", key: "", host: "https://www.bing.com/", at: 0, count: 0 };
      this.bingPromise = null;
      this.lastError = null;
    }

    // Scrape the Bing translator page for the request credentials its front-end uses.
    async ensureBingTokens(force) {
      if (!force && this.bing.ig && this.bing.token && Date.now() - this.bing.at < BING_TOKEN_TTL_MS) {
        return this.bing;
      }
      if (this.bingPromise) return this.bingPromise;
      this.bingPromise = (async () => {
        const res = await this.request(BING_HOME, { method: "GET", credentials: "omit" });
        const html = String(res.text || "");
        const ig = (html.match(/IG:"([A-Za-z0-9]+)"/) || [])[1] || "";
        const abuse = html.match(/params_AbusePreventionHelper\s*=\s*\[([0-9]+),\s*"([^"]+)"/);
        const iid = (html.match(/data-iid="([^"]+)"/) || [])[1] || "translator.5023";
        if (!ig || !abuse) {
          throw Object.assign(new Error("Bing translator tokens unavailable"), { status: res.status || 0 });
        }
        this.bing = { ig, iid, key: abuse[1], token: abuse[2], host: "https://www.bing.com/", at: Date.now(), count: 0 };
        return this.bing;
      })().finally(() => {
        this.bingPromise = null;
      });
      return this.bingPromise;
    }

    // Translate through Bing's web endpoint. It handles one text per request, so a batch is issued
    // as parallel requests through the shared paced scheduler by the caller.
    async translateWithBingWeb(texts, options) {
      const target = this.normalizeTarget(options?.targetLanguage);
      const rawSource = String(options?.sourceLanguage || "").trim();
      const from = !rawSource || rawSource === "auto" || rawSource === "auto-detect"
        ? "auto-detect"
        : (rawSource.toLowerCase().startsWith("zh") ? "zh-Hans" : rawSource);
      const tokens = await this.ensureBingTokens(false);
      const runOne = async (text, retried) => {
        const value = String(text || "");
        if (!value.trim()) return null;
        this.bing.count += 1;
        const url = `${tokens.host}ttranslatev3?isVertical=1&IG=${tokens.ig}&IID=${tokens.iid}.${this.bing.count}`;
        const body =
          `&fromLang=${encodeURIComponent(from)}&to=${encodeURIComponent(target)}` +
          `&text=${encodeURIComponent(value)}` +
          `&token=${encodeURIComponent(tokens.token)}&key=${encodeURIComponent(tokens.key)}`;
        const res = await this.request(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
          credentials: "omit",
        });
        if (res.status === 429 || res.status === 401) {
          this.noteRateLimited();
          throw Object.assign(new Error(`Bing rate limited (${res.status})`), { status: res.status });
        }
        const payload = parseJsonSafe(res.text);
        // statusCode 205 means the scraped tokens went stale — refresh once and retry.
        const statusCode = payload?.StatusCode || payload?.statusCode || 200;
        if (statusCode === 205 && !retried) {
          await this.ensureBingTokens(true);
          return runOne(value, true);
        }
        const out = payload?.[0]?.translations?.[0]?.text;
        return this.sanitizeOutput(out, value);
      };
      const settled = await Promise.allSettled(texts.map((text) => runOne(text, false)));
      // If every item failed, surface the error so the manager can fall back.
      if (settled.length && settled.every((r) => r.status === "rejected")) {
        throw settled[0].reason || new Error("Bing translation failed");
      }
      this.noteSuccess();
      return settled.map((r) => (r.status === "fulfilled" ? r.value : null));
    }

    // AIMD pacing (see RateGovernor): the Edge/Azure endpoints also rate-limit; back off fast on
    // a 429/503 and recover gradually so we settle just under the limit. No effect when healthy.
    noteRateLimited() {
      (ROOT.RateGovernor || {}).rateLimited?.(this);
    }

    noteSuccess() {
      (ROOT.RateGovernor || {}).success?.(this);
    }

    // Shared paced, priority-aware scheduler (see RateGovernor.schedule): each request chunk runs
    // in one paced slot, and higher-priority (caption) chunks run ahead of page text.
    schedule(task, priority) {
      return ROOT.RateGovernor.schedule(this, task, priority);
    }

    async fetchEdgeAuthToken() {
      if (this.authPromise) return this.authPromise;
      this.authPromise = this.request(EDGE_AUTH_URL, {
        method: "GET",
        credentials: "omit",
      })
        .then(async (response) => {
          if (!response.ok) {
            // Carry the HTTP status so the manager treats this as a soft (engine-specific)
            // failure that falls back — not a hard "internet is down" network failure.
            throw Object.assign(new Error(`Edge auth failed (${response.status})`), { status: response.status });
          }
          const token = String(response.text || "").trim();
          if (!token) {
            throw new Error("Edge auth returned empty token");
          }
          this.authToken = token;
          this.authExpiresAt = decodeJwtExpiry(token);
          this.authFailedUntil = 0;
          this.authFailStreak = 0;
          this.authCooldownMs = this.authBaseCooldownMs;
          return token;
        })
        .catch((error) => {
          this.authFailStreak = Math.min(this.authFailStreak + 1, 5);
          this.authCooldownMs = Math.min(
            this.authMaxCooldownMs,
            this.authBaseCooldownMs * Math.pow(2, this.authFailStreak - 1)
          );
          this.authFailedUntil = Date.now() + this.authCooldownMs;
          throw error;
        })
        .finally(() => {
          this.authPromise = null;
        });
      return this.authPromise;
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
        const bgResult = await runtimeMessage(payload);
        if (!bgResult) {
          throw new Error("empty background response");
        }
        return {
          ok: !!bgResult.ok,
          status: Number(bgResult.status || 0),
          statusText: String(bgResult.statusText || ""),
          text: String(bgResult.text || ""),
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

    async ensureToken() {
      const skewMs = 60 * 1000;
      if (this.authToken && Date.now() + skewMs < this.authExpiresAt) {
        return this.authToken;
      }
      // Recent auth failure — fail fast so the manager falls back immediately instead of
      // waiting on (and re-triggering) the broken endpoint on every batch.
      if (Date.now() < this.authFailedUntil) {
        // Soft status (503) so this deliberate skip is a fall-back, not a hard network failure.
        throw Object.assign(new Error("Edge auth temporarily unavailable"), { status: 503 });
      }
      return this.fetchEdgeAuthToken();
    }

    normalizeTarget(targetLanguage) {
      const raw = String(targetLanguage || "en").trim();
      return raw || "en";
    }

    sanitizeOutput(value, input) {
      if (typeof value !== "string") return null;
      const out = value.trim();
      if (!out || out === String(input || "").trim()) return null;
      return out;
    }

    buildUrl(targetLanguage, sourceLanguage) {
      const query = new URLSearchParams();
      query.set("api-version", API_VERSION);
      query.append("to", this.normalizeTarget(targetLanguage));
      const from = String(sourceLanguage || "").trim();
      if (from && from !== "auto" && from !== "auto-detect") {
        query.set("from", from);
      }
      return `${API_URL}?${query.toString()}`;
    }

    async performTranslateRequest(url, body, headers) {
      // Pacing is handled by the shared scheduler (schedule()); this just issues the request.
      const response = await this.request(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const payload = parseJsonSafe(response.text);
      if (!response.ok) {
        const code = response.status;
        if (code === 429 || code === 503) this.noteRateLimited();
        const reason = payload?.error?.message || response.statusText || "request failed";
        throw Object.assign(new Error(`Microsoft translation failed (${code}): ${reason}`), {
          status: code,
          payload,
        });
      }
      this.noteSuccess();
      return Array.isArray(payload) ? payload : [];
    }

    async translateWithAzure(texts, options) {
      const key = String(options?.microsoftApiKey || "").trim();
      if (!key) {
        throw new Error("Azure key is missing");
      }
      const region = String(options?.microsoftRegion || "").trim();
      const url = this.buildUrl(options?.targetLanguage, options?.sourceLanguage);
      const headers = {
        "Content-Type": "application/json",
        "Ocp-Apim-Subscription-Key": key,
      };
      if (region) {
        headers["Ocp-Apim-Subscription-Region"] = region;
      }
      const body = texts.map((text) => ({ Text: text }));
      const payload = await this.performTranslateRequest(url, body, headers);
      return payload.map((row, index) => this.sanitizeOutput(row?.translations?.[0]?.text, texts[index]));
    }

    async translateWithEdgeToken(texts, options) {
      const token = await this.ensureToken();
      const url = this.buildUrl(options?.targetLanguage, options?.sourceLanguage);
      const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      };
      const body = texts.map((text) => ({ Text: text }));
      try {
        const payload = await this.performTranslateRequest(url, body, headers);
        return payload.map((row, index) => this.sanitizeOutput(row?.translations?.[0]?.text, texts[index]));
      } catch (error) {
        if (error?.status === 401 || error?.status === 403) {
          this.authToken = "";
          this.authExpiresAt = 0;
          const renewed = await this.ensureToken();
          headers.Authorization = `Bearer ${renewed}`;
          const retryPayload = await this.performTranslateRequest(url, body, headers);
          return retryPayload.map((row, index) => this.sanitizeOutput(row?.translations?.[0]?.text, texts[index]));
        }
        throw error;
      }
    }

    // Split into per-request chunks that respect the API's element/character limits. Needed
    // because the manager may hand Microsoft an oversized batch when it is a *fallback* for
    // another engine (e.g. a DeepL-sized batch of up to 50 items / 110k chars) — a single
    // request that large is rejected by the API. Microsoft's own primary batches are already
    // sized to these limits, so this is a no-op on the common path.
    buildGroups(texts) {
      const groups = [];
      let current = [];
      let charCount = 0;
      texts.forEach((text) => {
        const addition = text.length;
        if (current.length > 0 && (current.length >= this.maxItemsPerRequest || charCount + addition > this.maxCharsPerRequest)) {
          groups.push(current);
          current = [];
          charCount = 0;
        }
        current.push(text);
        charCount += addition;
      });
      if (current.length) groups.push(current);
      return groups;
    }

    async translate(texts, options) {
      if (!isArrayLikeTextList(texts)) return [];
      const safeTexts = texts.map((text) => String(text || ""));
      if (!safeTexts.some((text) => text.trim())) {
        return new Array(safeTexts.length).fill(null);
      }
      const priority = options?.priority;
      const groups = this.buildGroups(safeTexts);
      if (groups.length <= 1) {
        return this.schedule(() => this.translateChunk(safeTexts, options), priority);
      }
      const output = [];
      for (const group of groups) {
        const part = await this.schedule(() => this.translateChunk(group, options), priority);
        output.push(...part);
      }
      return output;
    }

    async translateChunk(safeTexts, options) {
      // Azure key present → try it first, fall through to the free paths on Azure error.
      if (options?.microsoftUseAzure && String(options?.microsoftApiKey || "").trim()) {
        try {
          return await this.translateWithAzure(safeTexts, options);
        } catch (_azureError) {
          // fall through to the keyless paths
        }
      }
      // Bing's web translator is the reliable keyless route (the Edge token endpoint answers 404
      // for non-Edge clients). Try it first, and only then the Edge token as a legacy fallback.
      try {
        const out = await this.translateWithBingWeb(safeTexts, options);
        this.lastError = null;
        return out;
      } catch (bingError) {
        try {
          return await this.translateWithEdgeToken(safeTexts, options);
        } catch (edgeError) {
          // Report the more meaningful of the two, so the popup can explain the fallback.
          this.lastError = "unavailable";
          throw edgeError?.status ? edgeError : bingError;
        }
      }
    }
  }

  ROOT.MicrosoftEngine = MicrosoftEngine;
})();
