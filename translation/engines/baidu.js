(function () {
  const ROOT = (window.BTE = window.BTE || {});

  const API_URL = "https://fanyi-api.baidu.com/api/trans/vip/translate";

  function md5(input) {
    function rl(n, c) { return (n << c) | (n >>> (32 - c)); }
    function au(x, y) {
      const l = (x & 0xffff) + (y & 0xffff);
      const m = (x >> 16) + (y >> 16) + (l >> 16);
      return (m << 16) | (l & 0xffff);
    }
    function cmn(q, a, b, x, s, t) { return au(rl(au(au(a, q), au(x, t)), s), b); }
    function ff(a, b, c, d, x, s, t) { return cmn((b & c) | (~b & d), a, b, x, s, t); }
    function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & ~d), a, b, x, s, t); }
    function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
    function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | ~d), a, b, x, s, t); }
    function toBytes(str) {
      const utf8 = unescape(encodeURIComponent(str));
      const out = [];
      for (let i = 0; i < utf8.length; i += 1) out.push(utf8.charCodeAt(i) & 0xff);
      return out;
    }
    function toBlocks(bytes) {
      const nblk = ((bytes.length + 8) >> 6) + 1;
      const blks = new Array(nblk * 16).fill(0);
      for (let i = 0; i < bytes.length; i += 1) {
        blks[i >> 2] |= bytes[i] << ((i % 4) * 8);
      }
      blks[bytes.length >> 2] |= 0x80 << ((bytes.length % 4) * 8);
      blks[nblk * 16 - 2] = bytes.length * 8;
      return blks;
    }
    const x = toBlocks(toBytes(input));
    let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
    for (let i = 0; i < x.length; i += 16) {
      const oa = a, ob = b, oc = c, od = d;
      a = ff(a, b, c, d, x[i + 0], 7, -680876936); d = ff(d, a, b, c, x[i + 1], 12, -389564586);
      c = ff(c, d, a, b, x[i + 2], 17, 606105819); b = ff(b, c, d, a, x[i + 3], 22, -1044525330);
      a = ff(a, b, c, d, x[i + 4], 7, -176418897); d = ff(d, a, b, c, x[i + 5], 12, 1200080426);
      c = ff(c, d, a, b, x[i + 6], 17, -1473231341); b = ff(b, c, d, a, x[i + 7], 22, -45705983);
      a = ff(a, b, c, d, x[i + 8], 7, 1770035416); d = ff(d, a, b, c, x[i + 9], 12, -1958414417);
      c = ff(c, d, a, b, x[i + 10], 17, -42063); b = ff(b, c, d, a, x[i + 11], 22, -1990404162);
      a = ff(a, b, c, d, x[i + 12], 7, 1804603682); d = ff(d, a, b, c, x[i + 13], 12, -40341101);
      c = ff(c, d, a, b, x[i + 14], 17, -1502002290); b = ff(b, c, d, a, x[i + 15], 22, 1236535329);
      a = gg(a, b, c, d, x[i + 1], 5, -165796510); d = gg(d, a, b, c, x[i + 6], 9, -1069501632);
      c = gg(c, d, a, b, x[i + 11], 14, 643717713); b = gg(b, c, d, a, x[i + 0], 20, -373897302);
      a = gg(a, b, c, d, x[i + 5], 5, -701558691); d = gg(d, a, b, c, x[i + 10], 9, 38016083);
      c = gg(c, d, a, b, x[i + 15], 14, -660478335); b = gg(b, c, d, a, x[i + 4], 20, -405537848);
      a = gg(a, b, c, d, x[i + 9], 5, 568446438); d = gg(d, a, b, c, x[i + 14], 9, -1019803690);
      c = gg(c, d, a, b, x[i + 3], 14, -187363961); b = gg(b, c, d, a, x[i + 8], 20, 1163531501);
      a = gg(a, b, c, d, x[i + 13], 5, -1444681467); d = gg(d, a, b, c, x[i + 2], 9, -51403784);
      c = gg(c, d, a, b, x[i + 7], 14, 1735328473); b = gg(b, c, d, a, x[i + 12], 20, -1926607734);
      a = hh(a, b, c, d, x[i + 5], 4, -378558); d = hh(d, a, b, c, x[i + 8], 11, -2022574463);
      c = hh(c, d, a, b, x[i + 11], 16, 1839030562); b = hh(b, c, d, a, x[i + 14], 23, -35309556);
      a = hh(a, b, c, d, x[i + 1], 4, -1530992060); d = hh(d, a, b, c, x[i + 4], 11, 1272893353);
      c = hh(c, d, a, b, x[i + 7], 16, -155497632); b = hh(b, c, d, a, x[i + 10], 23, -1094730640);
      a = hh(a, b, c, d, x[i + 13], 4, 681279174); d = hh(d, a, b, c, x[i + 0], 11, -358537222);
      c = hh(c, d, a, b, x[i + 3], 16, -722521979); b = hh(b, c, d, a, x[i + 6], 23, 76029189);
      a = hh(a, b, c, d, x[i + 9], 4, -640364487); d = hh(d, a, b, c, x[i + 12], 11, -421815835);
      c = hh(c, d, a, b, x[i + 15], 16, 530742520); b = hh(b, c, d, a, x[i + 2], 23, -995338651);
      a = ii(a, b, c, d, x[i + 0], 6, -198630844); d = ii(d, a, b, c, x[i + 7], 10, 1126891415);
      c = ii(c, d, a, b, x[i + 14], 15, -1416354905); b = ii(b, c, d, a, x[i + 5], 21, -57434055);
      a = ii(a, b, c, d, x[i + 12], 6, 1700485571); d = ii(d, a, b, c, x[i + 3], 10, -1894986606);
      c = ii(c, d, a, b, x[i + 10], 15, -1051523); b = ii(b, c, d, a, x[i + 1], 21, -2054922799);
      a = ii(a, b, c, d, x[i + 8], 6, 1873313359); d = ii(d, a, b, c, x[i + 15], 10, -30611744);
      c = ii(c, d, a, b, x[i + 6], 15, -1560198380); b = ii(b, c, d, a, x[i + 13], 21, 1309151649);
      a = ii(a, b, c, d, x[i + 4], 6, -145523070); d = ii(d, a, b, c, x[i + 11], 10, -1120210379);
      c = ii(c, d, a, b, x[i + 2], 15, 718787259); b = ii(b, c, d, a, x[i + 9], 21, -343485551);
      a = au(a, oa); b = au(b, ob); c = au(c, oc); d = au(d, od);
    }
    const hex = (n) => {
      let s = "";
      for (let i = 0; i < 4; i += 1) {
        s += ((n >> (i * 8)) & 0xff).toString(16).padStart(2, "0");
      }
      return s;
    };
    return hex(a) + hex(b) + hex(c) + hex(d);
  }

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

  class BaiduEngine {
    constructor() {
      this.name = "baidu";
      this.maxItemsPerRequest = 20;
      this.maxCharsPerRequest = 1800;
      this.baseIntervalMs = 300;
      this.minIntervalMs = 300;
      this.maxIntervalMs = 2200;
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

    toBaiduLang(lang) {
      const lower = String(lang || "").toLowerCase().trim();
      if (!lower || lower === "auto" || lower === "auto-detect") return "auto";
      const map = {
        zh: "zh", "zh-cn": "zh", "zh-hans": "zh", "zh-hant": "cht", "zh-tw": "cht",
        en: "en", ja: "jp", fr: "fra", ru: "ru", vi: "vie", id: "id", ko: "kor",
        es: "spa", de: "de", pt: "pt", it: "it",
      };
      return map[lower] || lower.split("-")[0];
    }

    buildGroups(texts) {
      const groups = [];
      let current = [];
      let charCount = 0;
      texts.forEach((text) => {
        const addition = text.length + 1;
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
      if (!Array.isArray(texts) || texts.length === 0) return [];
      const appid = String(options?.baiduAppid || "").trim();
      const secret = String(options?.baiduSecret || "").trim();
      if (!appid || !secret) {
        this.lastError = "missing-credentials";
        return new Array(texts.length).fill(null);
      }
      this.lastError = null;
      const from = this.toBaiduLang(options?.sourceLanguage);
      const to = this.toBaiduLang(options?.targetLanguage) || "en";
      const priority = options?.priority;
      const groups = this.buildGroups(texts);
      const output = [];
      for (const group of groups) {
        const translated = await this.schedule(() => this.translateGroup(group, { appid, secret, from, to }), priority);
        output.push(...translated);
      }
      return output;
    }

    async translateGroup(texts, ctx) {
      const items = texts.map((t) => String(t).replace(/[\r\n]+/g, " ").trim());
      const q = items.join("\n");
      const salt = String(Date.now());
      const sign = md5(ctx.appid + q + salt + ctx.secret);
      const body = new URLSearchParams({
        q,
        from: ctx.from,
        to: ctx.to,
        appid: ctx.appid,
        salt,
        sign,
      });
      const res = await this.request(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        credentials: "omit",
      });
      const data = parseJsonSafe(res.text);
      if (data && data.error_code) {
        const code = String(data.error_code);
        this.lastError = `${code}:${data.error_msg || ""}`;
        if (code === "54003" || code === "54005" || code === "54004") {
          this.noteRateLimited();
        }
        throw new Error(`Baidu error ${code} ${data.error_msg || ""}`);
      }
      const results = Array.isArray(data?.trans_result) ? data.trans_result : [];
      if (!results.length) {
        throw new Error("Baidu returned no trans_result");
      }
      this.noteSuccess();
      if (results.length === items.length) {
        return items.map((input, i) => {
          const dst = typeof results[i]?.dst === "string" ? results[i].dst.trim() : "";
          return dst && dst !== input ? dst : null;
        });
      }
      const bySrc = new Map();
      results.forEach((r) => {
        if (r && typeof r.src === "string" && typeof r.dst === "string") {
          bySrc.set(r.src.trim(), r.dst.trim());
        }
      });
      return items.map((input) => {
        const dst = bySrc.get(input);
        return dst && dst !== input ? dst : null;
      });
    }
  }

  ROOT.BaiduEngine = BaiduEngine;
  ROOT._md5 = md5;
})();
