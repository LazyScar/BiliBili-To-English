(function () {
  const ROOT = (window.BTE = window.BTE || {});

  const EDGE_AUTH_URL = "https://edge.microsoft.com/translate/auth";
  const API_URL = "https://api.cognitive.microsofttranslator.com/translate";
  const API_VERSION = "3.0";
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
    }
    return Date.now() + 8 * 60 * 1000;
  }

  function isArrayLikeTextList(texts) {
    return Array.isArray(texts) && texts.length > 0;
  }

  class MicrosoftEngine {
    constructor() {
      this.name = "microsoft";
      this.maxItemsPerRequest = 20;
      this.maxCharsPerRequest = 4500;
      this.baseIntervalMs = 120;
      this.minIntervalMs = 120;
      this.maxIntervalMs = 2000;
      this.consecutiveFailures = 0;
      this.lastRequestAt = 0;
      this.authToken = "";
      this.authExpiresAt = 0;
      this.authPromise = null;
      this.authFailedUntil = 0;
      this.authBaseCooldownMs = 2 * 60 * 1000;
      this.authMaxCooldownMs = 30 * 60 * 1000;
      this.authCooldownMs = this.authBaseCooldownMs;
      this.authFailStreak = 0;
      this.bing = { ig: "", iid: "", token: "", key: "", host: "https://www.bing.com/", at: 0, count: 0 };
      this.bingPromise = null;
      this.lastError = null;
    }

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

    async translateWithBingWeb(texts, options) {
      const target = this.normalizeTarget(options?.targetLanguage);
      const rawSource = String(options?.sourceLanguage || "").trim();
      const from = !rawSource || rawSource === "auto" || rawSource === "auto-detect"
        ? "zh-Hans"
        : (rawSource.toLowerCase().startsWith("zh") ? "zh-Hans" : rawSource);
      const tokens = await this.ensureBingTokens(false);

      const post = async (body, retried) => {
        this.bing.count += 1;
        const url = `${tokens.host}ttranslatev3?isVertical=1&IG=${tokens.ig}&IID=${tokens.iid}.${this.bing.count}`;
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
        const statusCode = payload?.StatusCode || payload?.statusCode || 200;
        if (statusCode === 205 && !retried) {
          await this.ensureBingTokens(true);
          return post(body, true);
        }
        return payload?.[0]?.translations?.[0]?.text;
      };

      const buildBody = (value) =>
        `&fromLang=${encodeURIComponent(from)}&to=${encodeURIComponent(target)}` +
        `&text=${encodeURIComponent(value)}` +
        `&token=${encodeURIComponent(tokens.token)}&key=${encodeURIComponent(tokens.key)}`;

      const flat = texts.map((t) => String(t || "").replace(/\s*\n+\s*/g, " "));
      if (!flat.some((t) => t.trim())) return texts.map(() => null);

      const SEP = "\n@@@\n";
      const SPLIT_RE = /\s*@@@\s*/;

      const translateChunkOfTexts = async (items, depth) => {
        const usable = items.filter((t) => t.trim());
        if (!usable.length) return items.map(() => null);
        if (items.length === 1) {
          const out = await post(buildBody(items[0]), false);
          return [this.sanitizeOutput(out, items[0])];
        }
        const joined = await post(buildBody(items.join(SEP)), false);
        const parts = typeof joined === "string" ? joined.split(SPLIT_RE) : [];
        if (parts.length === items.length) {
          return items.map((input, i) => this.sanitizeOutput(parts[i], input));
        }
        if (depth >= 4) return items.map(() => null);
        const mid = Math.ceil(items.length / 2);
        const [left, right] = await Promise.all([
          translateChunkOfTexts(items.slice(0, mid), depth + 1),
          translateChunkOfTexts(items.slice(mid), depth + 1),
        ]);
        return left.concat(right);
      };

      const out = await translateChunkOfTexts(flat, 0);
      this.noteSuccess();
      return out;
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

    async fetchEdgeAuthToken() {
      if (this.authPromise) return this.authPromise;
      this.authPromise = this.request(EDGE_AUTH_URL, {
        method: "GET",
        credentials: "omit",
      })
        .then(async (response) => {
          if (!response.ok) {
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
      if (Date.now() < this.authFailedUntil) {
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
      if (options?.microsoftUseAzure && String(options?.microsoftApiKey || "").trim()) {
        try {
          return await this.translateWithAzure(safeTexts, options);
        } catch (_azureError) {
        }
      }
      try {
        const out = await this.translateWithBingWeb(safeTexts, options);
        this.lastError = null;
        return out;
      } catch (bingError) {
        try {
          return await this.translateWithEdgeToken(safeTexts, options);
        } catch (edgeError) {
          this.lastError = "unavailable";
          throw edgeError?.status ? edgeError : bingError;
        }
      }
    }
  }

  ROOT.MicrosoftEngine = MicrosoftEngine;
})();
