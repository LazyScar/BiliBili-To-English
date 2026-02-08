(function () {
  const ROOT = (window.BTE = window.BTE || {});

  const EDGE_AUTH_URL = "https://edge.microsoft.com/translate/auth";
  const API_URL = "https://api.cognitive.microsofttranslator.com/translate";
  const API_VERSION = "3.0";

  function parseJsonSafe(text) {
    try {
      return text ? JSON.parse(text) : null;
    } catch (_error) {
      return null;
    }
  }

  function runtimeMessage(payload) {
    if (!chrome?.runtime?.sendMessage) {
      return Promise.reject(new Error("runtime messaging unavailable"));
    }
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(payload, (response) => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message || "runtime message failed"));
          return;
        }
        resolve(response);
      });
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
      this.minIntervalMs = 120;
      this.lastRequestAt = 0;
      this.authToken = "";
      this.authExpiresAt = 0;
      this.authPromise = null;
    }

    async waitForThrottle() {
      const delta = Date.now() - this.lastRequestAt;
      if (delta >= this.minIntervalMs) return;
      await new Promise((resolve) => setTimeout(resolve, this.minIntervalMs - delta));
    }

    async fetchEdgeAuthToken() {
      if (this.authPromise) return this.authPromise;
      this.authPromise = this.request(EDGE_AUTH_URL, {
        method: "GET",
        credentials: "omit",
      })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`Edge auth failed (${response.status})`);
          }
          const token = String(response.text || "").trim();
          if (!token) {
            throw new Error("Edge auth returned empty token");
          }
          this.authToken = token;
          this.authExpiresAt = decodeJwtExpiry(token);
          return token;
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
      await this.waitForThrottle();
      this.lastRequestAt = Date.now();
      const response = await this.request(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const payload = parseJsonSafe(response.text);
      if (!response.ok) {
        const code = response.status;
        const reason = payload?.error?.message || response.statusText || "request failed";
        throw Object.assign(new Error(`Microsoft translation failed (${code}): ${reason}`), {
          status: code,
          payload,
        });
      }
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

    async translate(texts, options) {
      if (!isArrayLikeTextList(texts)) return [];
      const safeTexts = texts.map((text) => String(text || ""));
      if (!safeTexts.some((text) => text.trim())) {
        return new Array(safeTexts.length).fill(null);
      }

      try {
        if (options?.microsoftUseAzure && String(options?.microsoftApiKey || "").trim()) {
          try {
            return await this.translateWithAzure(safeTexts, options);
          } catch (azureError) {
            const azureCode = azureError?.status;
            if (azureCode === 401 || azureCode === 403 || azureCode === 429) {
              console.warn("BTE Microsoft Azure auth/rate issue, switching to Edge token:", azureError);
            } else {
              console.warn("BTE Microsoft Azure failed, switching to Edge token:", azureError);
            }
          }
        }
        return await this.translateWithEdgeToken(safeTexts, options);
      } catch (error) {
        const code = error?.status;
        if (code === 401 || code === 403 || code === 429) {
          console.warn("BTE Microsoft engine auth/rate issue:", error);
        } else {
          console.warn("BTE Microsoft engine failed:", error);
        }
        return new Array(safeTexts.length).fill(null);
      }
    }
  }

  ROOT.MicrosoftEngine = MicrosoftEngine;
})();
