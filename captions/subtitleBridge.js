(function () {
  "use strict";

  if (window.__bteSubtitleBridgeInstalled) return;
  window.__bteSubtitleBridgeInstalled = true;

  const SUB_URL_RE = /(aisubtitle\.hdslb\.com|\/bfs\/subtitle\/|subtitle[^?]*\.json)/i;
  const CDN_HOST_RE = /(\.hdslb\.com|\.bilivideo\.com)$/i;

  const postedUrls = new Set();
  let lastHref = location.href;

  function normalizeUrl(url) {
    let u = String(url || "").trim();
    if (!u) return "";
    if (u.startsWith("//")) u = "https:" + u;
    u = u.replace(/^http:\/\//i, "https://");
    return u;
  }

  function isSubtitleUrl(url) {
    const u = String(url || "");
    if (!SUB_URL_RE.test(u)) return false;
    try {
      const host = new URL(u.startsWith("//") ? "https:" + u : u).hostname;
      return CDN_HOST_RE.test(host);
    } catch (_error) {
      return false;
    }
  }

  function post(kind, data) {
    try {
      window.postMessage({ __bteBridge: true, kind, data, href: location.href }, location.origin || "*");
    } catch (_error) {
    }
  }

  function emitUrl(rawUrl) {
    const url = normalizeUrl(rawUrl);
    if (!url || !isSubtitleUrl(url)) return;
    if (postedUrls.has(url)) return;
    postedUrls.add(url);
    post("subtitleUrl", { url });
  }

  try {
    const originalFetch = window.fetch;
    if (typeof originalFetch === "function" && !originalFetch.__bteHooked) {
      const hooked = function (input, init) {
        try {
          const url = typeof input === "string" ? input : input && input.url;
          emitUrl(url);
        } catch (_error) {
        }
        return originalFetch.apply(this, arguments);
      };
      hooked.__bteHooked = true;
      window.fetch = hooked;
    }
  } catch (_error) {
  }

  try {
    const originalOpen = XMLHttpRequest.prototype.open;
    if (typeof originalOpen === "function" && !originalOpen.__bteHooked) {
      const hookedOpen = function (method, url) {
        try {
          emitUrl(url);
        } catch (_error) {
        }
        return originalOpen.apply(this, arguments);
      };
      hookedOpen.__bteHooked = true;
      XMLHttpRequest.prototype.open = hookedOpen;
    }
  } catch (_error) {
  }

  function collectTracks() {
    const tracks = [];
    const seen = new Set();
    const add = (item) => {
      if (!item) return;
      const raw = item.subtitle_url || item.url || item.subtitleUrl;
      const url = normalizeUrl(raw);
      if (!url || seen.has(url)) return;
      seen.add(url);
      tracks.push({
        url,
        lan: item.lan || item.lang || "",
        lanDoc: item.lan_doc || item.lanDoc || "",
      });
    };
    const addList = (list) => {
      if (Array.isArray(list)) list.forEach(add);
    };
    try {
      const pi = window.__playinfo__;
      if (pi && pi.data && pi.data.subtitle) {
        addList(pi.data.subtitle.subtitles);
        addList(pi.data.subtitle.list);
      }
    } catch (_error) {}
    try {
      const st = window.__INITIAL_STATE__;
      if (st) {
        const vd = st.videoData;
        const ep = st.epInfo;
        if (vd && vd.subtitle) { addList(vd.subtitle.list); addList(vd.subtitle.subtitles); }
        if (ep && ep.subtitle) { addList(ep.subtitle.list); addList(ep.subtitle.subtitles); }
      }
    } catch (_error) {}
    try {
      const p = window.player;
      if (p && typeof p === "object") {
        ["getSubtitleList", "getSubtitles", "getSubtitle", "getCurrentSubtitleList"].forEach((method) => {
          try {
            if (typeof p[method] !== "function") return;
            const result = p[method]();
            if (!result) return;
            addList(Array.isArray(result) ? result : result.list || result.subtitles);
          } catch (_error) {}
        });
      }
    } catch (_error) {}
    return tracks;
  }

  function collectContext() {
    const ctx = { bvid: null, aid: null, cid: null };
    try {
      const st = window.__INITIAL_STATE__ || {};
      ctx.bvid = window.bvid || st.bvid || (st.videoData && st.videoData.bvid) || null;
      ctx.aid = window.aid || st.aid || (st.videoData && st.videoData.aid) || null;
      ctx.cid = window.cid || (st.videoData && st.videoData.cid) || (st.epInfo && st.epInfo.cid) || null;
    } catch (_error) {}
    try {
      const p = window.player;
      if ((!ctx.cid || !ctx.bvid) && p && typeof p.getVideoInfo === "function") {
        const vi = p.getVideoInfo() || {};
        ctx.cid = ctx.cid || vi.cid || null;
        ctx.aid = ctx.aid || vi.aid || null;
        ctx.bvid = ctx.bvid || vi.bvid || null;
      }
    } catch (_error) {}
    return ctx;
  }

  function activeSubtitleLan() {
    try {
      const p = window.player;
      if (!p) return "";
      if (typeof p.__core === "function") {
        const core = p.__core();
        const lan = core && core.subtitleStore && core.subtitleStore.state && core.subtitleStore.state.lan;
        if (lan) return String(lan);
      }
      for (const method of ["getSubtitle", "getCurrentSubtitle"]) {
        if (typeof p[method] !== "function") continue;
        const cur = p[method]();
        const lan = cur && (cur.lan || cur.lang || (cur.subtitle && cur.subtitle.lan));
        if (lan) return String(lan);
      }
    } catch (_error) {
    }
    return "";
  }

  function scanGlobals() {
    const tracks = collectTracks();
    tracks.forEach((track) => emitUrl(track.url));
    if (tracks.length) {
      post("tracks", { tracks, ctx: collectContext(), activeLan: activeSubtitleLan() });
    }
  }

  let ticks = 0;
  const timer = setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      postedUrls.clear();
      ticks = 0;
    }
    if (ticks < 30 || ticks % 8 === 0) {
      scanGlobals();
    }
    ticks += 1;
  }, 500);
  if (timer && typeof timer.unref === "function") timer.unref();

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.__bteBridge !== true || data.kind !== "requestSubtitles") return;
    postedUrls.clear();
    scanGlobals();
  });
})();
