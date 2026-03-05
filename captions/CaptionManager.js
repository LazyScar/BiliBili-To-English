(function () {
  const ROOT = (window.BTE = window.BTE || {});

  const CAPTION_SELECTORS = [
    ".bpx-player-subtitle-item-text",
    ".bpx-player-subtitle-item-text > span",
    ".bpx-player-subtitle-wrap .bpx-player-subtitle-item",
    ".bpx-player-subtitle-main",
    ".bpx-player-subtitle-main > span",
    ".bpx-player-subtitle-line",
    ".bpx-player-subtitle-content",
    ".bpx-player-subtitle-content > span",
    ".bili-subtitle-x-subtitle-panel-text",
    ".bili-subtitle-x-subtitle-panel-text[role='caption']",
    ".bili-subtitle-x-subtitle-panel-major-group [role='caption']",
    ".bilibili-player-video-subtitle .subtitle-item-text",
    ".bilibili-player-video-subtitle .bilibili-player-video-subtitle-item-text",
    ".bilibili-player-video-subtitle-item-text",
    ".subtitle-wrap .subtitle-item-text",
  ];
  const CAPTION_INTERACTIVE_ANCESTOR_SELECTORS = [
    ".bpx-player-control-wrap",
    ".bpx-player-ctrl-wrap",
    ".bpx-player-setting-wrap",
    ".bpx-player-setting-panel",
    ".bpx-player-menu",
    ".bilibili-player-video-control-wrap",
    ".bilibili-player-video-btn",
    "[class*='setting']",
    "[class*='menu']",
    "[class*='control']",
    "[class*='ctrl']",
    "[role='menu']",
    "[role='listbox']",
    "button",
    "a",
  ];
  const CAPTION_INTERACTIVE_DESCENDANT_SELECTORS = [
    "button",
    "a",
    "input",
    "select",
    "textarea",
    "[role='button']",
    "[role='menuitem']",
    "[role='option']",
  ];
  const CAPTION_PRIORITY_AHEAD_SECONDS = 35;
  const CAPTION_PRIORITY_BEHIND_SECONDS = 8;
  const CAPTION_IMMEDIATE_MAX_LINES = 18;
  const CAPTION_BOOTSTRAP_LINES = 12;
  const CAPTION_CRITICAL_LINES = 8;
  const CAPTION_WINDOW_PREFETCH_LINES = 180;
  const CAPTION_WINDOW_AHEAD_SECONDS = 420;
  const CAPTION_WINDOW_BEHIND_SECONDS = 20;
  const CAPTION_FUTURE_PREFETCH_AHEAD_SECONDS = 600;
  const CAPTION_FUTURE_PREFETCH_MAX_LINES = 260;
  const CAPTION_ACTIVE_MATCH_TOLERANCE_SECONDS = 0.9;
  const CAPTION_PREFETCH_RETRY_MS = 320;
  const CAPTION_EXTRA_TRACK_LIMIT = 4;
  const CAPTION_CJK_LAN_PATTERN = /(zh|cmn|yue|cn|chs|cht|sc|tc)/i;
  const CAPTION_CJK_DOC_PATTERN = /(\u4e2d\u6587|\u6c49\u8bed|\u56fd\u8bed|\u7b80\u4f53|\u7e41\u4f53)/i;
  const CAPTION_AUTO_TRACK_PATTERN = /(ai|auto|machine|translated|translation)/i;

  // Pre-joined selector strings — avoids looping per selector on every node check
  const CAPTION_INTERACTIVE_ANCESTOR_SELECTOR = CAPTION_INTERACTIVE_ANCESTOR_SELECTORS.join(",");
  const CAPTION_INTERACTIVE_DESCENDANT_SELECTOR = CAPTION_INTERACTIVE_DESCENDANT_SELECTORS.join(",");

  // Constant event-name array — avoids allocating a new array on every bind/unbind call
  const VIDEO_EVENTS = ["loadedmetadata", "play", "seeked", "durationchange"];

  function normalizeLine(text) {
    const s = String(text || "");
    if (!s) return "";
    // Fast path: single-line subtitle (no \r, no \n) — the overwhelming common case.
    // Avoids creating split/map/filter/join intermediate arrays on every subtitle node.
    if (!s.includes("\r") && !s.includes("\n")) {
      return s.replace(/\s+/g, " ").trim();
    }
    return s
      .replace(/\r/g, "")
      .split("\n")
      .map((part) => part.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n");
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

  function parseJsonOrRaw(text, contentType) {
    const type = String(contentType || "");
    if (type.includes("application/json")) {
      try {
        return JSON.parse(text || "");
      } catch (_error) {
        return null;
      }
    }
    try {
      return JSON.parse(text || "");
    } catch (_error) {
      return text;
    }
  }

  async function fetchJsonOrText(url) {
    try {
      const bg = await runtimeMessage({
        type: "bte:bgFetch",
        payload: {
          url,
          method: "GET",
          credentials: "include",
        },
      });
      if (bg && bg.ok) {
        return parseJsonOrRaw(bg.text || "", "application/json");
      }
    } catch (_error) {
      // Fallback to direct fetch below.
    }
    try {
      const response = await fetch(url, {
        credentials: "include",
      });
      if (!response.ok) return null;
      const type = response.headers.get("content-type") || "";
      const text = await response.text();
      return parseJsonOrRaw(text, type);
    } catch (_error) {
      return null;
    }
  }

  class CaptionManager {
    constructor(translationManager, settingsManager) {
      this.translationManager = translationManager;
      this.settingsManager = settingsManager;
      this.settings = null;
      this.running = false;
      this.subtitleObserver = null;
      this.subtitlePoll = null;
      this.urlPoll = null;
      this.lastUrl = "";
      this.currentVideoCacheKey = "";
      this.currentSubtitleData = null;
      this.videoCache = new Map();
      this.prefetchInFlight = new Map();
      this.fallbackPending = new Map();
      this.elementState = new Map();
      this.stylesInjected = false;
      this.lastPrefetchAttempt = 0;
      this.partialRefreshTimer = null;
      this.videoWatchTimer = null;
      this.videoElement = null;
      this.warnedIssues = new Set();
      this.windowPrefetchInFlight = new Map();
      this.handleVideoSignal = this.handleVideoSignal.bind(this);
    }

    getPlayerVideoInfo() {
      try {
        const player = window.player;
        if (!player || typeof player.getVideoInfo !== "function") return null;
        const info = player.getVideoInfo();
        if (!info || typeof info !== "object") return null;
        return info;
      } catch (_error) {
        return null;
      }
    }

    async initialize() {
      this.settings = await this.settingsManager.initialize();
      this.injectStyles();
    }

    updateSettings(nextSettings) {
      this.settings = nextSettings;
      if (!this.settings.enabled || !this.settings.areas.captions || !this.isVideoRoute()) {
        this.stop({ restore: true });
        return;
      }
      // If the URL changed, clear stale video state immediately so the urlPoll
      // (900 ms) doesn't redo the same cleanup redundantly on the same navigation.
      if (this.lastUrl !== location.href) {
        this.lastUrl = location.href;
        this.clearVideoCaches();
        this.restoreOriginalCaptions();
      }
      this.start();
      this.bindVideoSignals();
      this.prefetchCurrentVideo(true);
      this.applyToActiveSubtitleNodes();
    }

    canRun() {
      return !!(this.running && this.settings && this.settings.enabled && this.settings.areas.captions);
    }

    isVideoRoute() {
      const host = location.hostname || "";
      const path = location.pathname || "";
      if (!/bilibili\.com$/i.test(host) && !/\.bilibili\.com$/i.test(host)) return false;
      return (
        path.includes("/video/") ||
        path.includes("/bangumi/play/") ||
        path.includes("/medialist/play/") ||
        path.includes("/list/") ||
        path.includes("/play/")
      );
    }

    start() {
      if (!this.settings || !this.settings.enabled || !this.settings.areas.captions || !this.isVideoRoute()) {
        return;
      }
      if (this.running) return;
      this.running = true;
      this.lastUrl = location.href;
      this.observeSubtitleDom();
      this.bindVideoSignals();
      this.prefetchCurrentVideo(true);
      this.startPolling();
    }

    stop(options) {
      const restore = !!options?.restore;
      this.running = false;
      if (this.subtitleObserver) {
        this.subtitleObserver.disconnect();
        this.subtitleObserver = null;
      }
      if (this.subtitlePoll) {
        clearInterval(this.subtitlePoll);
        this.subtitlePoll = null;
      }
      if (this.urlPoll) {
        clearInterval(this.urlPoll);
        this.urlPoll = null;
      }
      if (this.videoWatchTimer) {
        clearInterval(this.videoWatchTimer);
        this.videoWatchTimer = null;
      }
      this.unbindVideoSignals();
      if (this.partialRefreshTimer) {
        clearTimeout(this.partialRefreshTimer);
        this.partialRefreshTimer = null;
      }
      this.clearVideoCaches();
      if (restore) {
        this.restoreOriginalCaptions();
      }
    }

    clearVideoCaches() {
      this.prefetchInFlight.clear();
      this.fallbackPending.clear();
      this.videoCache.clear();
      this.currentSubtitleData = null;
      this.currentVideoCacheKey = "";
      this.warnedIssues.clear();
      this.windowPrefetchInFlight.clear();
    }

    warnOnce(code, message, details) {
      const key = `${code}::${this.lastUrl || location.href}`;
      if (this.warnedIssues.has(key)) return;
      this.warnedIssues.add(key);
      if (details !== undefined) {
        console.warn(`[BTE captions] ${message}`, details);
      } else {
        console.warn(`[BTE captions] ${message}`);
      }
    }

    restoreOriginalCaptions() {
      this.elementState.forEach((state, element) => {
        if (!element || !element.isConnected) return;
        if (typeof state.original === "string" && state.original.trim()) {
          element.textContent = state.original;
        }
        element.style.whiteSpace = state.whiteSpace || "";
      });
      this.elementState.clear();
    }

    handleVideoSignal() {
      if (!this.canRun()) return;
      this.prefetchCurrentVideo(false);
      if (this.currentSubtitleData && this.currentVideoCacheKey) {
        this.ensureBackgroundFullPrefetch(this.currentVideoCacheKey, this.currentSubtitleData);
        this.enqueueWindowPrefetch(this.currentVideoCacheKey, this.currentSubtitleData);
      }
    }

    bindVideoSignals() {
      this.unbindVideoSignals();
      this.videoWatchTimer = setInterval(() => {
        if (!this.running) return;
        const video = document.querySelector("video");
        if (!video || video === this.videoElement) return;
        this.unbindVideoSignals();
        this.videoElement = video;
        VIDEO_EVENTS.forEach((eventName) => {
          this.videoElement.addEventListener(eventName, this.handleVideoSignal, { passive: true });
        });
        this.prefetchCurrentVideo(true);
      }, 250);
    }

    unbindVideoSignals() {
      if (this.videoElement) {
        VIDEO_EVENTS.forEach((eventName) => {
          this.videoElement.removeEventListener(eventName, this.handleVideoSignal);
        });
      }
      this.videoElement = null;
    }

    startPolling() {
      if (!this.subtitlePoll) {
        this.subtitlePoll = setInterval(() => {
          if (!this.canRun()) return;
          this.applyToActiveSubtitleNodes();
          if (this.currentSubtitleData && this.currentVideoCacheKey) {
            this.ensureBackgroundFullPrefetch(this.currentVideoCacheKey, this.currentSubtitleData);
            this.enqueueWindowPrefetch(this.currentVideoCacheKey, this.currentSubtitleData);
          }
          if (!this.currentSubtitleData && Date.now() - this.lastPrefetchAttempt > CAPTION_PREFETCH_RETRY_MS) {
            this.prefetchCurrentVideo(false);
          }
        }, 80);
      }
      if (!this.urlPoll) {
        this.urlPoll = setInterval(() => {
          if (!this.settings?.enabled) return;
          if (this.lastUrl !== location.href) {
            this.lastUrl = location.href;
            this.clearVideoCaches();
            this.restoreOriginalCaptions();
            if (this.isVideoRoute() && this.settings.areas.captions) {
              this.bindVideoSignals();
              this.prefetchCurrentVideo(true);
            } else {
              this.clearVideoCaches();
              this.unbindVideoSignals();
            }
          }
        }, 900);
      }
    }

    observeSubtitleDom() {
      if (this.subtitleObserver) {
        this.subtitleObserver.disconnect();
      }
      this.subtitleObserver = new MutationObserver(() => {
        if (!this.canRun()) return;
        this.applyToActiveSubtitleNodes();
      });
      this.subtitleObserver.observe(document.body, {
        childList: true,
        subtree: true,
        // characterData omitted intentionally: every text change in the entire page
        // would fire this observer. The 80 ms subtitle poll covers text updates at
        // negligible latency cost without the page-wide overhead.
      });
    }

    extractVideoContext() {
      const state = window.__INITIAL_STATE__ || {};
      const playInfo = window.__playinfo__ || {};
      const playerInfo = this.getPlayerVideoInfo() || {};
      const pathname = location.pathname || "";
      const search = new URLSearchParams(location.search || "");
      const pageNumber = Math.max(1, Number.parseInt(search.get("p") || "1", 10) || 1);
      const cidFromQuery = Number.parseInt(search.get("cid") || "", 10) || null;
      const bvidFromUrl = (pathname.match(/\/video\/(BV[0-9A-Za-z]+)/) || [])[1] || null;
      const epIdFromUrl = Number.parseInt((pathname.match(/\/bangumi\/play\/ep(\d+)/) || [])[1] || "", 10) || null;
      const pages = Array.isArray(state.videoData?.pages) ? state.videoData.pages : [];
      const pageMeta = pages[pageNumber - 1] || pages[0] || null;
      const epList = Array.isArray(state.epList) ? state.epList : [];
      const matchedEp = epIdFromUrl
        ? epList.find((ep) => Number(ep?.id || ep?.ep_id || ep?.epid || 0) === epIdFromUrl) || null
        : null;
      const bvid =
        state.bvid ||
        state.videoData?.bvid ||
        state.epInfo?.bvid ||
        matchedEp?.bvid ||
        playInfo?.data?.bvid ||
        playerInfo?.bvid ||
        bvidFromUrl ||
        null;
      const aid =
        state.aid ||
        state.videoData?.aid ||
        state.videoData?.stat?.aid ||
        state.epInfo?.aid ||
        pageMeta?.aid ||
        matchedEp?.aid ||
        playInfo?.data?.aid ||
        playerInfo?.aid ||
        null;
      const cid =
        state.cid ||
        state.videoData?.cid ||
        pageMeta?.cid ||
        state.epInfo?.cid ||
        matchedEp?.cid ||
        playInfo?.data?.cid ||
        playerInfo?.cid ||
        cidFromQuery ||
        null;
      const context = {
        bvid,
        aid,
        cid,
        pageNumber,
        epId: epIdFromUrl,
      };
      context.key = this.buildContextKey(context);
      return context;
    }

    buildContextKey(context) {
      return `${context?.bvid || context?.aid || "unknown"}::${context?.cid || "unknown"}::p${context?.pageNumber || 1}`;
    }

    async ensureContextCid(context) {
      if (!context || context.cid) return context;
      const candidates = [];
      if (context.bvid) {
        candidates.push(`https://api.bilibili.com/x/player/pagelist?bvid=${encodeURIComponent(context.bvid)}`);
        candidates.push(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(context.bvid)}`);
      }
      if (context.aid) {
        candidates.push(`https://api.bilibili.com/x/player/pagelist?aid=${encodeURIComponent(context.aid)}`);
        candidates.push(`https://api.bilibili.com/x/web-interface/view?aid=${encodeURIComponent(context.aid)}`);
      }
      for (const url of candidates) {
        try {
          const payload = await fetchJsonOrText(url);
          const cid = this.extractCidFromVideoMeta(payload, context.pageNumber);
          if (!cid) continue;
          context.cid = cid;
          context.key = this.buildContextKey(context);
          return context;
        } catch (_error) {
          // keep probing
        }
      }
      return context;
    }

    extractCidFromVideoMeta(payload, pageNumber) {
      if (!payload || typeof payload !== "object") return null;
      const data = payload.data || payload.result || payload;
      const list = Array.isArray(data) ? data : Array.isArray(data?.pages) ? data.pages : [];
      if (!list.length) return null;
      const index = Math.max(0, (Number(pageNumber) || 1) - 1);
      const page = list[index] || list[0] || null;
      if (!page) return null;
      const cid = Number(page.cid || 0);
      return cid > 0 ? cid : null;
    }

    buildProbeUrls(context) {
      const urls = [];
      if (context.cid && context.bvid) {
        urls.push(`https://api.bilibili.com/x/player/v2?cid=${context.cid}&bvid=${context.bvid}`);
      }
      if (context.cid) {
        urls.push(`https://api.bilibili.com/x/player/wbi/v2?cid=${context.cid}`);
      }
      if (context.aid && context.cid) {
        urls.push(`https://api.bilibili.com/x/v2/dm/view?aid=${context.aid}&oid=${context.cid}&type=1`);
      }
      return {
        urls,
        hasCid: !!context.cid,
      };
    }

    collectTrack(item, tracks) {
      if (!item) return;
      const url = item.subtitle_url || item.url || item.subtitleUrl || null;
      if (!url) return;
      const normalized = String(url).startsWith("//") ? `https:${url}` : String(url).replace(/^http:\/\//i, "https://");
      tracks.push({
        lan: item.lan || item.lang || "",
        lanDoc: item.lan_doc || item.lanDoc || "",
        subtitleUrl: normalized,
      });
    }

    getEmbeddedTracks() {
      const tracks = [];
      const playInfo = window.__playinfo__ || {};
      const state = window.__INITIAL_STATE__ || {};
      const p1 = playInfo?.data?.subtitle?.subtitles || [];
      const p2 = state?.videoData?.subtitle?.list || [];
      const p3 = state?.videoData?.subtitle?.subtitles || [];
      [p1, p2, p3].forEach((list) => {
        if (Array.isArray(list)) {
          list.forEach((item) => this.collectTrack(item, tracks));
        }
      });
      return tracks;
    }

    parseSubtitleTracks(responseData) {
      const tracks = [];
      const addTrack = (item) => this.collectTrack(item, tracks);

      if (typeof responseData === "string") {
        const regex = /subtitle_url["']?\s*[:=]\s*["']([^"']+)["']/gi;
        let match = regex.exec(responseData);
        while (match) {
          addTrack({ subtitle_url: match[1] });
          match = regex.exec(responseData);
        }
      } else {
        const fromData =
          responseData?.data?.subtitle?.subtitles ||
          responseData?.data?.subtitle?.list ||
          responseData?.subtitle?.subtitles ||
          responseData?.result?.subtitle?.subtitles ||
          [];
        if (Array.isArray(fromData)) {
          fromData.forEach(addTrack);
        }
      }

      const deduped = [];
      const seen = new Set();
      tracks.forEach((track) => {
        if (seen.has(track.subtitleUrl)) return;
        seen.add(track.subtitleUrl);
        deduped.push(track);
      });
      return deduped;
    }

    scoreSubtitleTrack(track) {
      if (!track) return -100;
      const lan = String(track.lan || "");
      const doc = String(track.lanDoc || "");
      let score = 0;
      if (CAPTION_CJK_LAN_PATTERN.test(lan)) score += 8;
      if (CAPTION_CJK_DOC_PATTERN.test(doc)) score += 8;
      if (CAPTION_AUTO_TRACK_PATTERN.test(lan) || CAPTION_AUTO_TRACK_PATTERN.test(doc)) score -= 5;
      return score;
    }

    rankSubtitleTracks(tracks) {
      return [...tracks].sort((a, b) => this.scoreSubtitleTrack(b) - this.scoreSubtitleTrack(a));
    }

    async fetchSubtitleTracks(context) {
      const embedded = this.getEmbeddedTracks();
      if (embedded.length) {
        const parsed = this.parseSubtitleTracks({ data: { subtitle: { subtitles: embedded } } });
        return this.rankSubtitleTracks(parsed);
      }
      const probePlan = this.buildProbeUrls(context);
      const probeUrls = probePlan.urls;
      if (!probePlan.hasCid) {
        this.warnOnce("missing-cid", "CID is not available yet; subtitle API probing is deferred.");
      }
      if (!probeUrls.length) {
        return [];
      }
      for (const url of probeUrls) {
        try {
          const payload = await fetchJsonOrText(url);
          if (!payload) continue;
          if (payload?.code && Number(payload.code) !== 0) {
            this.warnOnce(`probe-code-${payload.code}`, `Subtitle probe returned code ${payload.code}.`, payload);
            continue;
          }
          const tracks = this.parseSubtitleTracks(payload);
          if (tracks.length) {
            return this.rankSubtitleTracks(tracks);
          }
        } catch (error) {
          this.warnOnce(`probe-failed-${url}`, `Subtitle probe request failed: ${url}`, error);
        }
      }
      this.warnOnce("no-subtitle-tracks", "No subtitle track URLs were discovered from subtitle APIs.");
      return [];
    }

    async fetchSubtitleBody(subtitleUrl) {
      try {
        const data = await fetchJsonOrText(subtitleUrl);
        if (!data || typeof data !== "object") return [];
        const body = Array.isArray(data.body) ? data.body : Array.isArray(data?.data?.body) ? data.data.body : [];
        return body
          .map((item) => ({
            from: Number(item.from || 0),
            to: Number(item.to || 0),
            content: String(item.content || "").trim(),
          }))
          .filter((item) => item.content);
      } catch (error) {
        console.warn("BTE subtitle body fetch failed:", subtitleUrl, error);
        return [];
      }
    }

    collectUniqueLinesFromBody(body, seen) {
      const output = [];
      body.forEach((line) => {
        const normalized = normalizeLine(line.content);
        if (!normalized || seen.has(normalized)) return;
        seen.add(normalized);
        output.push(normalized);
      });
      return output;
    }

    async fetchPrimaryBody(tracks) {
      const limit = Math.min(CAPTION_EXTRA_TRACK_LIMIT, tracks.length);
      for (let i = 0; i < limit; i += 1) {
        const track = tracks[i];
        const body = await this.fetchSubtitleBody(track.subtitleUrl);
        if (body.length) {
          return {
            body,
            index: i,
          };
        }
      }
      return null;
    }

    async prefetchAdditionalTrackBodies(cacheKey, payload, tracks) {
      if (!tracks.length) return;
      for (const track of tracks) {
        if (this.currentVideoCacheKey !== cacheKey) return;
        const body = await this.fetchSubtitleBody(track.subtitleUrl);
        if (!body.length) continue;
        const seen = payload.sourceSet || new Set();
        payload.sourceSet = seen;
        const newLines = this.collectUniqueLinesFromBody(body, seen);
        if (!newLines.length) continue;
        await this.translateCaptionLineSet(cacheKey, payload, newLines);
      }
    }

    buildVideoCacheKey(context) {
      const engine = this.settings?.engine || "google";
      const lang = this.settings?.targetLanguage || "en";
      return `${context.key}::${engine}::${lang}`;
    }

    getVideoCurrentTime() {
      const video = document.querySelector("video");
      return video ? Number(video.currentTime || 0) : 0;
    }

    buildTimedEntries(body, map) {
      return body.map((line) => {
        const original = normalizeLine(line.content);
        return {
          from: line.from,
          to: line.to,
          original,
          translated: map.get(original) || null,
        };
      });
    }

    selectPriorityLines(timed, uniqueLines) {
      const now = this.getVideoCurrentTime();
      // timed[] is already sorted by 'from' (built directly from the API response order)
      const preferred = [];
      const seen = new Set();

      timed.forEach((line) => {
        const original = line.original;
        if (!original || seen.has(original)) return;
        const inWindow =
          line.to >= now - CAPTION_PRIORITY_BEHIND_SECONDS &&
          line.from <= now + CAPTION_PRIORITY_AHEAD_SECONDS;
        if (!inWindow) return;
        preferred.push(original);
        seen.add(original);
      });

      if (preferred.length < CAPTION_BOOTSTRAP_LINES) {
        for (const line of uniqueLines) {
          if (!line || seen.has(line)) continue;
          preferred.push(line);
          seen.add(line);
          if (preferred.length >= CAPTION_BOOTSTRAP_LINES) break;
        }
      }

      const cappedPreferred = preferred.slice(0, CAPTION_IMMEDIATE_MAX_LINES);
      const preferredSet = new Set(cappedPreferred);
      const remaining = uniqueLines.filter((line) => line && !preferredSet.has(line));

      return { preferred: cappedPreferred, remaining };
    }

    extractComparableCaptionText(text) {
      const normalized = normalizeLine(text);
      if (!normalized) return "";
      const parts = normalized.split("\n").map((part) => normalizeLine(part)).filter(Boolean);
      if (!parts.length) return normalized;
      const cjkPart = parts.find((part) => this.containsCjkText(part));
      return cjkPart || parts[0];
    }

    findActiveTimedLine(time) {
      if (!this.currentSubtitleData || !Array.isArray(this.currentSubtitleData.timed)) return null;
      const timed = this.currentSubtitleData.timed;
      if (!timed.length) return null;

      // Binary search — timed[] is sorted by 'from'
      let lo = 0;
      let hi = timed.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        if (timed[mid].to < time) {
          lo = mid + 1;
        } else if (timed[mid].from > time) {
          hi = mid - 1;
        } else {
          return timed[mid]; // time is within [from, to]
        }
      }

      // No exact match — scan the narrow vicinity of the insertion point for nearest
      let nearest = null;
      let nearestDelta = Infinity;
      const start = Math.max(0, lo - 1);
      const end = Math.min(timed.length - 1, lo + 1);
      for (let i = start; i <= end; i += 1) {
        const line = timed[i];
        const delta = Math.min(Math.abs(time - line.from), Math.abs(time - line.to));
        if (delta < nearestDelta) {
          nearestDelta = delta;
          nearest = line;
        }
      }
      if (nearest && nearestDelta <= CAPTION_ACTIVE_MATCH_TOLERANCE_SECONDS) {
        return nearest;
      }
      return null;
    }

    collectFuturePrefetchLines(payload, excludedLines) {
      if (!payload || !Array.isArray(payload.timed) || !payload.timed.length) return [];
      const excluded = excludedLines || new Set();
      const now = this.getVideoCurrentTime();
      const out = [];
      const seen = new Set();
      payload.timed.forEach((entry) => {
        if (!entry || !entry.original) return;
        if (entry.from < now - 2) return;
        if (entry.from > now + CAPTION_FUTURE_PREFETCH_AHEAD_SECONDS) return;
        const original = normalizeLine(entry.original);
        if (!original || seen.has(original) || excluded.has(original)) return;
        if (payload.map && payload.map.has(original)) return;
        seen.add(original);
        out.push(original);
      });
      return out.slice(0, CAPTION_FUTURE_PREFETCH_MAX_LINES);
    }

    shouldWaitForPrefetchForLine(line) {
      if (!this.currentSubtitleData || this.currentSubtitleData.prefetchPhase === "complete") return false;
      const normalized = normalizeLine(line);
      if (!normalized) return false;
      const active = this.findActiveTimedLine(this.getVideoCurrentTime());
      if (!active) return false;
      const activeComparable = this.extractComparableCaptionText(active.original);
      const lineComparable = this.extractComparableCaptionText(normalized);
      if (!lineComparable || !activeComparable) return false;
      return (
        lineComparable === activeComparable ||
        lineComparable.includes(activeComparable) ||
        activeComparable.includes(lineComparable)
      );
    }

    schedulePartialRefresh(cacheKey, payload) {
      if (this.partialRefreshTimer) return;
      this.partialRefreshTimer = setTimeout(() => {
        this.partialRefreshTimer = null;
        if (this.currentVideoCacheKey !== cacheKey) return;
        payload.timed = payload.timed.map((line) => ({
          ...line,
          translated: payload.map.get(line.original) || line.translated || null,
        }));
        this.videoCache.set(cacheKey, payload);
        this.applyToActiveSubtitleNodes();
      }, 40);
    }

    getWindowCandidateLines(payload, focusLine) {
      if (!payload || !Array.isArray(payload.timed) || !payload.timed.length) return [];
      const out = [];
      const seen = new Set();
      const add = (line) => {
        const normalized = normalizeLine(line);
        if (!normalized || seen.has(normalized)) return;
        if (payload.map && payload.map.has(normalized)) return;
        seen.add(normalized);
        out.push(normalized);
      };

      const normalizedFocus = normalizeLine(focusLine || "");
      if (normalizedFocus) add(normalizedFocus);

      const now = this.getVideoCurrentTime();
      payload.timed.forEach((entry) => {
        const inWindow =
          entry.to >= now - CAPTION_WINDOW_BEHIND_SECONDS &&
          entry.from <= now + CAPTION_WINDOW_AHEAD_SECONDS;
        if (inWindow) add(entry.original);
      });

      if (out.length < CAPTION_WINDOW_PREFETCH_LINES) {
        // Binary search for current playback position in sorted timed[]
        let lo = 0;
        let hi = payload.timed.length - 1;
        let pivot = -1;
        while (lo <= hi) {
          const mid = (lo + hi) >>> 1;
          if (payload.timed[mid].to < now) {
            lo = mid + 1;
          } else if (payload.timed[mid].from > now) {
            hi = mid - 1;
          } else {
            pivot = mid;
            break;
          }
        }
        if (pivot < 0) pivot = lo; // insertion point = first line starting after now
        if (pivot >= payload.timed.length) pivot = payload.timed.length - 1;
        const start = Math.max(0, pivot - 3);
        for (let i = start; i < payload.timed.length && out.length < CAPTION_WINDOW_PREFETCH_LINES; i += 1) {
          add(payload.timed[i].original);
        }
      }

      return out.slice(0, CAPTION_WINDOW_PREFETCH_LINES);
    }

    enqueueWindowPrefetch(cacheKey, payload, focusLine) {
      if (!payload || this.currentVideoCacheKey !== cacheKey) return;
      // All lines already translated — getWindowCandidateLines would iterate timed[] (500+ entries)
      // every 80 ms for nothing. Skip the work entirely.
      if (payload.prefetchPhase === "complete") return;
      const candidates = this.getWindowCandidateLines(payload, focusLine);
      if (!candidates.length) return;

      const uncached = [];
      let hadCacheHit = false;
      candidates.forEach((source) => {
        const hit = this.translationManager.peekCached(source, {
          area: "captions",
          targetLanguage: this.settings?.targetLanguage || "en",
        });
        if (hit.translation) {
          payload.map.set(source, hit.translation);
          hadCacheHit = true;
          return;
        }
        uncached.push(source);
      });
      if (hadCacheHit) {
        this.schedulePartialRefresh(cacheKey, payload);
      }
      if (!uncached.length) return;

      if (!payload.windowQueue) {
        payload.windowQueue = new Set();
      }
      uncached.forEach((line) => payload.windowQueue.add(line));

      if (this.windowPrefetchInFlight.has(cacheKey)) return;

      const worker = (async () => {
        while (
          payload.windowQueue &&
          payload.windowQueue.size &&
          this.currentVideoCacheKey === cacheKey &&
          this.canRun()
        ) {
          const batch = Array.from(payload.windowQueue).slice(0, CAPTION_WINDOW_PREFETCH_LINES);
          batch.forEach((line) => payload.windowQueue.delete(line));
          await this.translateCaptionLineSet(cacheKey, payload, batch);
        }
      })().finally(() => {
        this.windowPrefetchInFlight.delete(cacheKey);
      });
      this.windowPrefetchInFlight.set(cacheKey, worker);
    }

    ensureBackgroundFullPrefetch(cacheKey, payload) {
      if (!payload || this.currentVideoCacheKey !== cacheKey) return;
      if (payload.prefetchPhase === "complete") return;
      if (payload.backgroundPrefetchRunning) return;
      if (payload.prefetchSequenceRunning) return;
      if (!this.canRun()) return;

      const sourceLines =
        payload.sourceSet instanceof Set
          ? Array.from(payload.sourceSet)
          : Array.isArray(payload.timed)
            ? payload.timed.map((line) => normalizeLine(line.original)).filter(Boolean)
            : [];
      const missing = sourceLines.filter((line) => !payload.map.has(line));
      if (!missing.length) {
        payload.prefetchPhase = "complete";
        this.videoCache.set(cacheKey, payload);
        return;
      }

      payload.backgroundPrefetchRunning = true;
      if (payload.prefetchPhase === "initial") {
        payload.prefetchPhase = "background";
      }

      void this.translateCaptionLineSet(cacheKey, payload, missing)
        .catch((error) => {
          this.warnOnce("background-prefetch-failed", "Background full subtitle prefetch failed.", error);
        })
        .finally(() => {
          payload.backgroundPrefetchRunning = false;
          if (this.currentVideoCacheKey !== cacheKey) return;
          const stillMissing = sourceLines.some((line) => !payload.map.has(line));
          if (!stillMissing) {
            payload.prefetchPhase = "complete";
          }
          this.videoCache.set(cacheKey, payload);
          this.applyToActiveSubtitleNodes();
        });
    }

    async translateCaptionLineSet(cacheKey, payload, lines) {
      if (!lines.length) return;
      const deduped = Array.from(
        new Set(
          lines
            .map((line) => normalizeLine(line))
            .filter((line) => !!line && !(payload?.map && payload.map.has(line)))
        )
      );
      if (!deduped.length) return;
      let translatedCount = 0;
      if (this.currentVideoCacheKey !== cacheKey) return;
      const translated = await this.translationManager.translateMany(deduped, {
        area: "captions",
        targetLanguage: this.settings.targetLanguage,
        onPartial: ({ source, translation }) => {
          if (!translation || this.currentVideoCacheKey !== cacheKey) return;
          const normalizedSource = normalizeLine(source);
          if (!normalizedSource) return;
          payload.map.set(normalizedSource, translation);
          translatedCount += 1;
          this.schedulePartialRefresh(cacheKey, payload);
        },
      });
      deduped.forEach((line, index) => {
        const translation = translated[index]?.translation || null;
        if (!translation) return;
        payload.map.set(line, translation);
        translatedCount += 1;
      });
      this.schedulePartialRefresh(cacheKey, payload);
      if (translatedCount === 0) {
        this.warnOnce(
          `translate-empty-${cacheKey}`,
          "Prefetched subtitle lines were sent for translation but no translated output was returned."
        );
      }
    }

    async prefetchCurrentVideo(forceRefresh) {
      if (!this.settings?.enabled || !this.settings?.areas?.captions) return;
      if (!this.isVideoRoute()) return;
      let context = this.extractVideoContext();
      if (!context.cid && !context.bvid && !context.aid) {
        this.warnOnce("missing-video-context", "Video context is missing; subtitle prefetch will retry.");
        return;
      }
      context = await this.ensureContextCid(context);
      const cacheKey = this.buildVideoCacheKey(context);
      this.lastPrefetchAttempt = Date.now();

      if (!forceRefresh && this.currentVideoCacheKey === cacheKey && this.currentSubtitleData) return;
      if (!forceRefresh && this.videoCache.has(cacheKey)) {
        this.currentVideoCacheKey = cacheKey;
        this.currentSubtitleData = this.videoCache.get(cacheKey);
        if (this.currentSubtitleData && !this.currentSubtitleData.sourceSet) {
          this.currentSubtitleData.sourceSet = new Set(
            this.currentSubtitleData.timed?.map((line) => line.original).filter(Boolean) || []
          );
        }
        if (this.currentSubtitleData) {
          this.applyToActiveSubtitleNodes();
          this.ensureBackgroundFullPrefetch(cacheKey, this.currentSubtitleData);
          this.enqueueWindowPrefetch(cacheKey, this.currentSubtitleData);
        }
        return;
      }
      if (this.prefetchInFlight.has(cacheKey)) {
        await this.prefetchInFlight.get(cacheKey);
        if (this.currentSubtitleData && this.currentVideoCacheKey === cacheKey) {
          this.ensureBackgroundFullPrefetch(cacheKey, this.currentSubtitleData);
          this.enqueueWindowPrefetch(cacheKey, this.currentSubtitleData);
        }
        return;
      }

      const task = (async () => {
        const tracks = await this.fetchSubtitleTracks(context);
        if (!tracks.length) {
          this.warnOnce("no-tracks", "Subtitle tracks were not found for the current video.");
          return;
        }

        const primary = await this.fetchPrimaryBody(tracks);
        if (!primary || !primary.body.length) {
          this.warnOnce("no-track-body", "Subtitle tracks were found but subtitle body download failed.");
          return;
        }

        const primaryBody = primary.body;
        const seen = new Set();
        const uniqueLines = this.collectUniqueLinesFromBody(primaryBody, seen);
        if (!uniqueLines.length) {
          this.warnOnce("empty-subtitle-body", "Subtitle body exists but contains no translatable lines.");
          return;
        }

        const map = new Map();
        const timed = this.buildTimedEntries(primaryBody, map);

        const payload = {
          context,
          map,
          timed,
          sourceSet: seen,
          prefetchPhase: "initial",
          createdAt: Date.now(),
        };
        if (!this.running || !this.settings?.enabled || !this.settings?.areas?.captions || !this.isVideoRoute()) {
          return;
        }
        const latestContext = this.extractVideoContext();
        const latestKey = this.buildVideoCacheKey(latestContext);
        if (latestKey !== cacheKey) {
          return;
        }
        this.videoCache.set(cacheKey, payload);
        this.currentVideoCacheKey = cacheKey;
        this.currentSubtitleData = payload;
        this.applyToActiveSubtitleNodes();

        const { preferred: priorityLines, remaining: remainingLines } = this.selectPriorityLines(timed, uniqueLines);

        const criticalLines = priorityLines.slice(0, CAPTION_CRITICAL_LINES);
        const nearLines = priorityLines.slice(CAPTION_CRITICAL_LINES);

        await this.translateCaptionLineSet(cacheKey, payload, criticalLines);
        if (this.currentVideoCacheKey === cacheKey) {
          payload.prefetchPhase = "background";
          this.videoCache.set(cacheKey, payload);
          this.applyToActiveSubtitleNodes();
        }

        void (async () => {
          payload.prefetchSequenceRunning = true;
          try {
            if (nearLines.length && this.currentVideoCacheKey === cacheKey) {
              await this.translateCaptionLineSet(cacheKey, payload, nearLines);
            }
            const excluded = new Set([...priorityLines]);
            const futureChunk = this.collectFuturePrefetchLines(payload, excluded);
            if (futureChunk.length && this.currentVideoCacheKey === cacheKey) {
              await this.translateCaptionLineSet(cacheKey, payload, futureChunk);
            }
            if (remainingLines.length && this.currentVideoCacheKey === cacheKey) {
              await this.translateCaptionLineSet(cacheKey, payload, remainingLines);
            }

            const additionalTracks = tracks
              .filter((_track, index) => index !== primary.index)
              .slice(0, CAPTION_EXTRA_TRACK_LIMIT);
            if (additionalTracks.length && this.currentVideoCacheKey === cacheKey) {
              await this.prefetchAdditionalTrackBodies(cacheKey, payload, additionalTracks);
            }

            if (this.currentVideoCacheKey === cacheKey) {
              payload.prefetchPhase = "complete";
              this.videoCache.set(cacheKey, payload);
              this.applyToActiveSubtitleNodes();
            }
          } catch (error) {
            this.warnOnce(`prefetch-sequence-failed-${cacheKey}`, "Caption prefetch sequence failed.", error);
          } finally {
            payload.prefetchSequenceRunning = false;
            if (this.currentVideoCacheKey === cacheKey) {
              this.ensureBackgroundFullPrefetch(cacheKey, payload);
            }
          }
        })();
      })();

      this.prefetchInFlight.set(cacheKey, task);
      try {
        await task;
      } finally {
        this.prefetchInFlight.delete(cacheKey);
      }
    }

    getCurrentTimedTranslation(text) {
      if (!this.currentSubtitleData || !this.currentSubtitleData.timed.length) return null;
      const normalized = normalizeLine(text);
      if (!normalized) return null;
      const exact = this.currentSubtitleData.map.get(normalized);
      if (exact) return exact;
      const comparable = this.extractComparableCaptionText(normalized);
      if (comparable) {
        const comparableHit = this.currentSubtitleData.map.get(comparable);
        if (comparableHit) return comparableHit;
      }
      const active = this.findActiveTimedLine(this.getVideoCurrentTime());
      if (!active || !active.translated) return null;
      const activeComparable = this.extractComparableCaptionText(active.original);
      if (!comparable || !activeComparable) return active.translated;
      if (
        comparable === activeComparable ||
        comparable.includes(activeComparable) ||
        activeComparable.includes(comparable)
      ) {
        return active.translated;
      }
      return this.containsCjkText(normalized) ? active.translated : null;
    }

    containsCjkText(text) {
      return /[\u3400-\u9fff]/.test(String(text || ""));
    }

    resolveTranslationForLine(line) {
      if (!line || !this.currentSubtitleData) return null;
      const normalized = normalizeLine(line);
      if (!normalized) return null;
      if (this.currentSubtitleData.map.has(normalized)) {
        return this.currentSubtitleData.map.get(normalized);
      }
      const comparable = this.extractComparableCaptionText(normalized);
      if (comparable && this.currentSubtitleData.map.has(comparable)) {
        return this.currentSubtitleData.map.get(comparable);
      }
      if (normalized.includes("\n")) {
        const lines = normalized.split("\n").map((part) => normalizeLine(part));
        let changed = false;
        const translatedLines = lines.map((part) => {
          const mapped = this.currentSubtitleData.map.get(part) || null;
          if (mapped) {
            changed = true;
            return mapped;
          }
          return part;
        });
        if (changed) {
          return translatedLines.join("\n");
        }
      }
      return this.getCurrentTimedTranslation(normalized);
    }

    formatCaption(original, translated) {
      const mode = this.settings?.bilingual?.captions || "off";
      if (mode === "stacked") {
        return `${original}\n${translated}`;
      }
      if (mode === "sideBySide") {
        if (String(original).includes("\n") || String(translated).includes("\n")) {
          const originalLines = String(original).split("\n");
          const translatedLines = String(translated).split("\n");
          const lineCount = Math.max(originalLines.length, translatedLines.length);
          const pairs = [];
          for (let i = 0; i < lineCount; i += 1) {
            const left = originalLines[i] || "";
            const right = translatedLines[i] || "";
            pairs.push(`${left} | ${right}`.trim());
          }
          return pairs.join("\n");
        }
        return `${original} | ${translated}`;
      }
      return translated;
    }

    queueFallbackCaptionTranslation(line) {
      const normalized = normalizeLine(line);
      if (!normalized) return;
      if (
        this.currentSubtitleData &&
        this.currentSubtitleData.prefetchPhase === "initial" &&
        this.currentSubtitleData.sourceSet instanceof Set &&
        this.currentSubtitleData.sourceSet.has(normalized)
      ) {
        return;
      }
      if (this.currentSubtitleData && this.currentVideoCacheKey) {
        this.enqueueWindowPrefetch(this.currentVideoCacheKey, this.currentSubtitleData, normalized);
      }
      const key = `${this.settings?.targetLanguage || "en"}::${normalized}`;
      if (this.fallbackPending.has(key)) return;
      const fullLines = normalized.includes("\n")
        ? normalized
            .split("\n")
            .map((part) => normalizeLine(part))
            .filter(Boolean)
        : [normalized];
      const lines = Array.from(
        new Set(fullLines.filter((part) => this.containsCjkText(part)))
      );
      if (!lines.length) return;
      const task = this.translationManager
        .translateMany(lines, {
          area: "captions",
          targetLanguage: this.settings?.targetLanguage || "en",
          onPartial: ({ source, translation }) => {
            if (!translation || !this.currentSubtitleData) return;
            const normalizedSource = normalizeLine(source);
            if (!normalizedSource) return;
            this.currentSubtitleData.map.set(normalizedSource, translation);
            this.schedulePartialRefresh(this.currentVideoCacheKey, this.currentSubtitleData);
          },
        })
        .then((result) => {
          if (!this.currentSubtitleData) {
            this.currentSubtitleData = {
              context: null,
              map: new Map(),
              timed: [],
              createdAt: Date.now(),
            };
          }
          const translatedLines = fullLines.map((source) => {
            if (!this.containsCjkText(source)) {
              return source;
            }
            return this.currentSubtitleData.map.get(source) || null;
          });
          lines.forEach((source, index) => {
            const translated = this.currentSubtitleData.map.get(source) || result[index]?.translation || null;
            if (translated) {
              this.currentSubtitleData.map.set(source, translated);
            }
          });
          const merged = fullLines.map((source, index) => {
            return (
              translatedLines[index] ||
              this.currentSubtitleData.map.get(source) ||
              null
            );
          });
          if (merged.every(Boolean)) {
            const combined = merged.join("\n");
            this.currentSubtitleData.map.set(normalized, combined);
          }
          this.schedulePartialRefresh(this.currentVideoCacheKey, this.currentSubtitleData);
        })
        .catch((error) => {
          console.warn("BTE caption fallback translation failed:", error);
        })
        .finally(() => {
          this.fallbackPending.delete(key);
        });
      this.fallbackPending.set(key, task);
    }

    ensureElementState(element) {
      if (!this.elementState.has(element)) {
        this.elementState.set(element, {
          original: "",
          injected: "",
          whiteSpace: "",
          hadLineBreak: false,
        });
      }
      return this.elementState.get(element);
    }

    extractCaptionSourceText(element) {
      if (!element) return "";
      if (!element.childNodes || element.childNodes.length === 0) {
        return String(element.textContent || "");
      }
      const parts = [];
      const walk = (node) => {
        if (!node) return;
        if (node.nodeType === Node.TEXT_NODE) {
          parts.push(node.nodeValue || "");
          return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        if (node.tagName === "BR") {
          parts.push("\n");
          return;
        }
        Array.from(node.childNodes || []).forEach((child) => walk(child));
      };
      Array.from(element.childNodes).forEach((child) => walk(child));
      return parts.join("");
    }

    hasVisualLineBreaks(element, sourceText) {
      if (!element) return false;
      if (element.querySelector("br")) return true;
      return String(sourceText || "").includes("\n");
    }

    keepLineBreakShape(original, translated) {
      const normalizedOriginal = normalizeLine(original);
      const normalizedTranslated = normalizeLine(translated);
      if (!normalizedOriginal.includes("\n")) return normalizedTranslated;
      if (normalizedTranslated.includes("\n")) return normalizedTranslated;
      const parts = normalizedOriginal
        .split("\n")
        .map((part) => normalizeLine(part))
        .filter(Boolean);
      if (!parts.length || !this.currentSubtitleData) return normalizedTranslated;
      const translatedParts = parts.map((part) => this.currentSubtitleData.map.get(part) || null);
      if (translatedParts.every(Boolean)) {
        return translatedParts.join("\n");
      }
      return normalizedTranslated;
    }

    hasOnlyLineBreakChildren(element) {
      if (!element || element.childElementCount === 0) return true;
      return Array.from(element.children).every((child) => child.tagName === "BR");
    }

    isCaptionControlNode(element) {
      if (!element || !element.closest) return true;
      try {
        return !!element.closest(CAPTION_INTERACTIVE_ANCESTOR_SELECTOR);
      } catch (_error) {
        return false;
      }
    }

    isSafeCaptionTextElement(element) {
      if (!element || !element.isConnected) return false;
      if (this.isCaptionControlNode(element)) return false;
      if (element.closest("[data-bte-owned='1']")) return false;
      if (element.matches && element.matches("button,a,input,select,textarea")) return false;
      if (element.querySelector(CAPTION_INTERACTIVE_DESCENDANT_SELECTOR)) {
        return false;
      }
      if (element.childElementCount > 0 && !this.hasOnlyLineBreakChildren(element)) {
        // Keep subtitle tool/panel structure untouched. Allow BR-only caption lines.
        return false;
      }
      return true;
    }

    applyToCaptionElement(element) {
      if (!this.canRun() || !element || !element.isConnected) return;
      if (!this.isSafeCaptionTextElement(element)) return;
      const state = this.ensureElementState(element);
      const sourceText = this.extractCaptionSourceText(element);
      const normalizedSource = normalizeLine(sourceText);
      const live = String(element.textContent || "").trim();
      if (!live) return;

      if (state.injected && live === state.injected && state.original) {
        // keep source line
      } else {
        state.original = normalizedSource;
        state.hadLineBreak = this.hasVisualLineBreaks(element, sourceText);
      }

      let translated = this.resolveTranslationForLine(state.original);
      if (!translated) {
        const quick = this.translationManager.peekCached(state.original, {
          area: "captions",
          targetLanguage: this.settings?.targetLanguage || "en",
        });
        if (quick.translation) {
          if (!this.currentSubtitleData) {
            this.currentSubtitleData = {
              context: null,
              map: new Map(),
              timed: [],
              createdAt: Date.now(),
            };
          }
          this.currentSubtitleData.map.set(state.original, quick.translation);
          translated = quick.translation;
        }
      }
      if (!translated) {
        if (this.currentSubtitleData && this.currentVideoCacheKey) {
          this.ensureBackgroundFullPrefetch(this.currentVideoCacheKey, this.currentSubtitleData);
          this.enqueueWindowPrefetch(this.currentVideoCacheKey, this.currentSubtitleData, state.original);
        }
        if (this.shouldWaitForPrefetchForLine(state.original)) {
          return;
        }
        this.queueFallbackCaptionTranslation(state.original);
        return;
      }
      const shaped = this.keepLineBreakShape(state.original, translated);
      const output = this.formatCaption(state.original, shaped);
      if (live !== output) {
        if (!state.whiteSpace) {
          state.whiteSpace = element.style.whiteSpace || "";
        }
        if (
          (this.settings?.bilingual?.captions || "off") === "stacked" ||
          state.hadLineBreak ||
          String(output).includes("\n")
        ) {
          element.style.whiteSpace = "pre-line";
        } else {
          element.style.whiteSpace = state.whiteSpace;
        }
        element.textContent = output;
      }
      state.injected = output;
    }

    applyToActiveSubtitleNodes() {
      if (!this.canRun()) return;
      const nodes = this.getCandidateCaptionNodes();
      nodes.forEach((node) => this.applyToCaptionElement(node));
    }

    getCandidateCaptionNodes() {
      const nodes = new Set();
      document.querySelectorAll(CAPTION_SELECTORS.join(",")).forEach((node) => {
        if (!this.isSafeCaptionTextElement(node)) return;
        const text = normalizeLine(this.extractCaptionSourceText(node));
        if (!text) return;
        if (text.length > 220) return;
        nodes.add(node);
      });
      return Array.from(nodes);
    }

    injectStyles() {
      if (this.stylesInjected) return;
      this.stylesInjected = true;
      const style = document.createElement("style");
      style.setAttribute("data-bte-owned", "1");
      style.textContent = `
        .bpx-player-subtitle-wrap, .bilibili-player-video-subtitle {
          text-rendering: optimizeLegibility;
        }
      `;
      (document.head || document.documentElement).appendChild(style);
    }
  }

  ROOT.CaptionManager = CaptionManager;
})();
