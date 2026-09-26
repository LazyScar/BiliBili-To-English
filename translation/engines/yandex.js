(function () {
  const ROOT = (window.BTE = window.BTE || {});

  const TRANSLATE_URL = "https://translate.yandex.net/api/v1/tr.json/translate";
  const UCID_TTL_MS = 6 * 60 * 1000;
  const FAIL_COOLDOWN_MS = 60 * 1000;

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

  class YandexEngine {
    constructor() {
      this.name = "yandex";
      this.maxItemsPerRequest = 12;
      this.maxCharsPerRequest = 2500;
      this.baseIntervalMs = 200;
      this.minIntervalMs = 200;
      this.maxIntervalMs = 3000;
      this.consecutiveFailures = 0;
      this.lastRequestAt = 0;
      this.ucid = "";
      this.ucidCreatedAt = 0;
      this.cooldownUntil = 0;
      this.reqCounter = 0;
      this.lastError = null;
    }

    getUcid() {
      if (this.ucid && Date.now() - this.ucidCreatedAt < UCID_TTL_MS) return this.ucid;
      const rand = () => Math.floor(Math.random() * 16).toString(16);
      let out = "";
      for (let i = 0; i < 32; i += 1) {
        if (i === 12) out += "4";
        else if (i === 16) out += ((Math.floor(Math.random() * 4) + 8)).toString(16);
        else out += rand();
      }
      this.ucid = out;
      this.ucidCreatedAt = Date.now();
      return this.ucid;
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
        return {
          ok: !!bg.ok,
          status: Number(bg.status || 0),
          statusText: String(bg.statusText || ""),
          text: String(bg.text || ""),
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

    toYandexLang(lang) {
      const lower = String(lang || "").toLowerCase().trim();
      if (!lower || lower === "auto" || lower === "auto-detect") return "";
      const map = {
        "zh-cn": "zh",
        "zh-hans": "zh",
        "zh-hant": "zh",
        "zh-tw": "zh",
        "pt-br": "pt",
        "pt-pt": "pt",
      };
      return map[lower] || lower.split("-")[0];
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
      if (Date.now() < this.cooldownUntil) {
        throw Object.assign(new Error("Yandex unavailable (cooldown)"), { reason: this.lastError || "cooldown" });
      }
      const target = this.toYandexLang(options?.targetLanguage) || "en";
      const source = this.toYandexLang(options?.sourceLanguage);
      const lang = source && source !== target ? `${source}-${target}` : target;
      const priority = options?.priority;
      const groups = this.buildGroups(texts);
      return ROOT.runEngineGroups(groups, (group) => {
        if (Date.now() < this.cooldownUntil) {
          throw Object.assign(new Error("Yandex unavailable (cooldown)"), { reason: this.lastError || "cooldown" });
        }
        return this.schedule(() => this.translateGroup(group, lang, false), priority);
      });
    }

    async translateGroup(texts, lang, retriedUcid) {
      this.reqCounter += 1;
      const query = new URLSearchParams();
      query.set("ucid", this.getUcid());
      query.set("srv", "android");
      query.set("lang", lang);
      query.set("format", "text");
      const url = `${TRANSLATE_URL}?${query.toString()}`;

      const body = new URLSearchParams();
      texts.forEach((text) => body.append("text", text));

      const res = await this.request(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        credentials: "omit",
      });

      const data = parseJsonSafe(res.text);
      const code = data && Number.isFinite(Number(data.code)) ? Number(data.code) : null;

      const ucidRejected = res.status === 403 || code === 401 || code === 403 || code === 404;
      if (ucidRejected && !retriedUcid) {
        this.ucid = "";
        this.ucidCreatedAt = 0;
        return this.translateGroup(texts, lang, true);
      }

      if (res.status === 429 || res.status >= 500) {
        this.noteRateLimited();
      }

      if (!res.ok || !data || (code !== null && code !== 200)) {
        this.lastError = res.status === 429 ? "rate-limited" : "unavailable";
        this.cooldownUntil = Date.now() + FAIL_COOLDOWN_MS;
        throw Object.assign(
          new Error(`Yandex request failed (${res.status}${code !== null ? `/code ${code}` : ""})`),
          { status: res.status || undefined, reason: this.lastError }
        );
      }

      const arr = Array.isArray(data?.text) ? data.text : [];
      this.lastError = null;
      this.cooldownUntil = 0;
      this.noteSuccess();
      return texts.map((input, index) => {
        const out = typeof arr[index] === "string" ? arr[index].trim() : "";
        return out && out !== String(input).trim() ? out : null;
      });
    }
  }

  ROOT.YandexEngine = YandexEngine;
})();
