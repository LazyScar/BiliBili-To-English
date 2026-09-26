(function () {
  const ROOT = (window.BTE = window.BTE || {});

  const CAPTION_SELECTORS = [
    "[role='caption']",
    ".bpx-player-subtitle-item-text",
    ".bpx-player-subtitle-item-text > span",
    ".bpx-player-subtitle-item-text span",
    ".bpx-player-subtitle-wrap .bpx-player-subtitle-item",
    ".bpx-player-subtitle-main",
    ".bpx-player-subtitle-main > span",
    ".bpx-player-subtitle-line",
    ".bpx-player-subtitle-content",
    ".bpx-player-subtitle-content > span",
    ".bili-subtitle-x-subtitle-panel-text",
    ".bili-subtitle-x-subtitle-panel-text[role='caption']",
    ".bili-subtitle-x-subtitle-panel-major-group [role='caption']",
    "[class*='subtitle'][class*='panel'][class*='text']",
    "[class*='subtitle-item-text']",
    "[class*='subtitle-text']",
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
  const CAPTION_PRIORITY_AHEAD_SECONDS = 30;
  const CAPTION_PRIORITY_BEHIND_SECONDS = 2;
  const CAPTION_IMMEDIATE_MAX_LINES = 12;
  const CAPTION_BOOTSTRAP_LINES = 8;
  // Subtitle buffer: refilled below the low watermark up to the high one, in watching seconds.
  const CAPTION_AHEAD_WATCH_SECONDS = 50;
  const CAPTION_BUFFER_LOW_MIN_WATCH_SECONDS = 12;
  const CAPTION_BUFFER_LOW_MAX_WATCH_SECONDS = 25;
  const CAPTION_REFILL_MAX_LINES = 40;
  const CAPTION_URGENT_WATCH_SECONDS = 3;
  const CAPTION_FAILED_SKIP_MS = 5000;
  const CAPTION_TRACK_BODY_CACHE = 12;
  const CAPTION_HEDGE_MIN_MS = 500;
  const CAPTION_HEDGE_MAX_MS = 3000;
  const CAPTION_HOVER_DWELL_MS = 150;
  const CAPTION_HOVER_MIN_GAP_MS = 700;
  const CAPTION_HOVER_LINES = 6;
  const CAPTION_PROGRESS_SELECTOR = [
    ".bpx-player-progress-wrap",
    ".bpx-player-progress",
    ".bpx-player-progress-area",
    ".squirtle-progress-wrap",
    ".bilibili-player-video-progress",
  ].join(",");
  const CAPTION_AHEAD_MIN_SECONDS = 30;
  const CAPTION_AHEAD_MAX_SECONDS = 120;
  const CAPTION_AHEAD_PAUSED_SECONDS = 15;
  const CAPTION_ACTIVE_MATCH_TOLERANCE_SECONDS = 0.9;
  const CAPTION_PREFETCH_RETRY_MS = 150;
  const CAPTION_EMPTY_RETRY_MS = 5000;
  const CAPTION_EMPTY_RETRY_MAX_MS = 60000;
  const CAPTION_PREFETCH_GRACE_MS = 120;
  const CAPTION_FETCH_TIMEOUT_MS = 8000;
  const CAPTION_EXTRA_TRACK_LIMIT = 4;
  const CAPTION_SENTENCE_MAX_LINES = 4;
  const CAPTION_SENTENCE_MAX_CHARS = 60;
  const CAPTION_SENTENCE_MAX_GAP_SECONDS = 0.6;
  const CAPTION_SENTENCE_END = /[。．.!！?？…‥~～;；:：、,，]["'”’」』）)\]】]*$/;
  const CAPTION_SENTENCE_START_BREAK = /^[（(\[【「『<《\-—–*#@]|^[A-Za-z一-鿿]{1,8}[:：]/;
  const CAPTION_CJK_LAN_PATTERN = /(zh|cmn|yue|cn|chs|cht|sc|tc)/i;
  const CAPTION_CJK_DOC_PATTERN = /(\u4e2d\u6587|\u6c49\u8bed|\u56fd\u8bed|\u7b80\u4f53|\u7e41\u4f53)/i;
  const CAPTION_AUTO_TRACK_PATTERN = /(ai|auto|machine|translated|translation)/i;

  const CAPTION_SELECTOR = CAPTION_SELECTORS.join(",");
  const CAPTION_ROOT_SELECTOR =
    ".bpx-player-subtitle-wrap, .bpx-player-subtitle-panel, " +
    ".bilibili-player-video-subtitle, [class*='subtitle-wrap'], [class*='subtitle-panel']";
  const CAPTION_SCOPE_SELECTOR = `${CAPTION_SELECTOR},${CAPTION_ROOT_SELECTOR}`;
  const CAPTION_FULL_SCAN_MS = 1000;
  const CAPTION_INTERACTIVE_ANCESTOR_SELECTOR = CAPTION_INTERACTIVE_ANCESTOR_SELECTORS.join(",");
  const CAPTION_INTERACTIVE_DESCENDANT_SELECTOR = CAPTION_INTERACTIVE_DESCENDANT_SELECTORS.join(",");

  // "seeking" fires before the video has buffered at the new position.
  const VIDEO_EVENTS = ["loadedmetadata", "play", "seeking", "seeked", "ratechange", "durationchange"];

  function normalizeLine(text) {
    const s = String(text || "");
    if (!s) return "";
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

  // Tracking params (spm_id_from, vd_source) don't make it a different video.
  const VIDEO_PARAMS = ["p", "bvid", "aid", "oid", "cid", "ep_id"];
  function videoIdentity(href) {
    if (!href) return "";
    try {
      const u = new URL(String(href || ""), location.href);
      const params = VIDEO_PARAMS.map((name) => `${name}=${u.searchParams.get(name) || ""}`).join("&");
      return `${u.origin}${u.pathname.replace(/\/+$/, "")}?${params}`;
    } catch (_error) {
      return String(href || "");
    }
  }

  // Subtitle URLs carry signed query params that differ between requests.
  function trackPath(url) {
    return String(url || "").replace(/^https?:/i, "").split("?")[0];
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

  function isCdnUrl(url) {
    try {
      const host = new URL(url).hostname;
      return host.endsWith(".hdslb.com") || host.endsWith(".bilivideo.com");
    } catch (_error) {
      return false;
    }
  }

  const CAPTION_TRACK_STORE_KEY = "bteSubtitleTracksV1";
  const CAPTION_TRACK_STORE_LIMIT = 30;
  const CAPTION_TRACK_TTL_MS = 14 * 24 * 60 * 60 * 1000;

  function storageGet(key) {
    const area = globalThis.chrome && chrome.storage && chrome.storage.local;
    if (!area) return Promise.resolve(null);
    return new Promise((resolve) => {
      try {
        const out = area.get(key, (result) => resolve((result && result[key]) || null));
        if (out && typeof out.then === "function") {
          out.then((result) => resolve((result && result[key]) || null), () => resolve(null));
        }
      } catch (_error) {
        resolve(null);
      }
    });
  }

  function storageSet(key, value) {
    const area = globalThis.chrome && chrome.storage && chrome.storage.local;
    if (!area) return Promise.resolve();
    return new Promise((resolve) => {
      try {
        const out = area.set({ [key]: value }, () => resolve());
        if (out && typeof out.then === "function") out.then(() => resolve(), () => resolve());
      } catch (_error) {
        resolve();
      }
    });
  }

  async function fetchJsonOrText(url) {
    const credentials = isCdnUrl(url) ? "omit" : "include";
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), CAPTION_FETCH_TIMEOUT_MS) : null;
    try {
      const response = await fetch(url, { credentials, signal: controller ? controller.signal : undefined });
      if (response.ok) {
        const type = response.headers.get("content-type") || "";
        const text = await response.text();
        return parseJsonOrRaw(text, type);
      }
    } catch (_error) {
    } finally {
      if (timer) clearTimeout(timer);
    }
    try {
      const bg = await runtimeMessage({
        type: "bte:bgFetch",
        payload: { url, method: "GET", credentials, timeoutMs: CAPTION_FETCH_TIMEOUT_MS },
      });
      if (bg && bg.ok) {
        return parseJsonOrRaw(bg.text || "", "application/json");
      }
    } catch (_error) {
      return null;
    }
    return null;
  }

  class CaptionManager {
    constructor(translationManager, settingsManager) {
      this.translationManager = translationManager;
      this.settingsManager = settingsManager;
      this.settings = null;
      this.running = false;
      this.subtitleObserver = null;
      this.knownCaptionNodes = [];
      this.lastCaptionScanAt = 0;
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
      this.pollPrefetch = null;
      this.cidByVideo = new Map();
      this.cidPending = new Map();
      this.probeMiss = { video: "", at: 0, delay: 0 };
      this.bodyMisses = new Map();
      this.partialRefreshTimer = null;
      this.videoWatchTimer = null;
      this.videoElement = null;
      this.warnedIssues = new Set();
      this.windowPrefetchInFlight = new Map();
      this.bridgeTracks = new Map();
      this.activeLan = "";
      this.preferredTrack = null;
      this.trackBodies = new Map();
      this.captionMisses = [];
      this.lastTrackProbeAt = 0;
      this.lastCaptionSeenAt = 0;
      this.captionDueUnseenMs = 0;
      this.visibilityTickAt = 0;
      this.lastSeekAt = 0;
      this.captionLatencyMs = 0;
      this.bridgeListenerAttached = false;
      this.handleVideoSignal = this.handleVideoSignal.bind(this);
      this.handleProgressHover = this.handleProgressHover.bind(this);
      this.hoverTimer = null;
      this.lastHoverPrefetchAt = 0;
      this.hoverBound = false;
      this.handleBridgeMessage = this.handleBridgeMessage.bind(this);
      ROOT.captionOriginalFor = (element) => this.originalFor(element);
    }

    // The Chinese line behind a translated subtitle element (for hover-to-compare).
    originalFor(element) {
      for (let el = element, depth = 0; el && depth < 3; el = el.parentElement, depth += 1) {
        const state = this.elementState.get(el);
        if (state && state.original && state.injected && normalizeLine(el.textContent) !== normalizeLine(state.original)) {
          return state.original;
        }
      }
      return null;
    }

    handleBridgeMessage(event) {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.__bteBridge !== true) return;
      const href = data.href || location.href;
      let added = false;
      const consider = (track) => {
        if (!track) return;
        const url = typeof track === "string" ? track : track.url;
        if (!url || typeof url !== "string") return;
        if (!/(\.hdslb\.com|\.bilivideo\.com)/i.test(url)) return;
        const known = this.bridgeTracks.get(url);
        if (known) {
          if (!known.lan && track && track.lan) {
            known.lan = track.lan;
            known.lanDoc = track.lanDoc || known.lanDoc;
          }
          return;
        }
        this.bridgeTracks.set(url, {
          subtitleUrl: url,
          lan: (track && track.lan) || "",
          lanDoc: (track && track.lanDoc) || "",
          href,
        });
        added = true;
      };
      if (data.kind === "subtitleBody") {
        const url = data.data && data.data.url;
        if (!url || !/(\.hdslb\.com|\.bilivideo\.com)/i.test(url)) return;
        let parsed = null;
        try {
          parsed = JSON.parse(String((data.data && data.data.text) || ""));
        } catch (_error) {
          return;
        }
        const body = this.parseSubtitlePayload(parsed);
        if (body.length) this.rememberTrackBody(url, body);
        return;
      } else if (data.kind === "subtitleUrl") {
        consider(data.data && data.data.url);
      } else if (data.kind === "subtitleFetched") {
        const url = data.data && data.data.url;
        consider(url);
        const lan = data.data && data.data.activeLan ? String(data.data.activeLan) : "";
        if (lan) this.activeLan = lan;
        const video = videoIdentity(href);
        const prev = this.preferredTrack;
        if (url && (!prev || prev.video !== video || trackPath(prev.url) !== trackPath(url))) {
          this.preferredTrack = { url, lan, video, at: Date.now() };
          added = true;
        }
      } else if (data.kind === "tracks") {
        const tracks = (data.data && data.data.tracks) || [];
        if (Array.isArray(tracks)) tracks.forEach(consider);
        const activeLan = data.data && data.data.activeLan;
        if (activeLan && activeLan !== this.activeLan) {
          this.activeLan = String(activeLan);
          const video = videoIdentity(href);
          const prev = this.preferredTrack;
          if (!prev || prev.video !== video || (prev.lan && prev.lan !== this.activeLan) || !prev.lan) {
            this.preferredTrack = { url: "", lan: this.activeLan, video, at: Date.now() };
          }
          added = true;
        }
      } else {
        return;
      }
      if (added && this.canRun() && this.isVideoRoute()) {
        this.prefetchCurrentVideo(false).catch(() => {});
      }
    }

    getBridgeTracks() {
      const here = videoIdentity(location.href);
      const out = [];
      this.bridgeTracks.forEach((track) => {
        if (track.href && videoIdentity(track.href) !== here) return;
        out.push({ lan: track.lan, lanDoc: track.lanDoc, subtitleUrl: track.subtitleUrl });
      });
      return out;
    }

    currentPreferredTrack() {
      const pref = this.preferredTrack;
      return pref && pref.video === videoIdentity(location.href) ? pref : null;
    }

    pickTrack(ranked) {
      if (!ranked.length) return null;
      const pref = this.currentPreferredTrack();
      if (pref && pref.url) {
        const match = ranked.find((t) => trackPath(t.subtitleUrl) === trackPath(pref.url));
        if (match) return match;
      }
      const lan = (pref && pref.lan) || this.activeLan;
      if (lan) {
        const match = ranked.find((t) => t.lan === lan);
        if (match) return match;
      }
      return ranked[0];
    }

    currentTrackKey() {
      const tracks = this.getBridgeTracks();
      if (tracks.length) {
        const picked = this.pickTrack(this.rankSubtitleTracks(tracks));
        if (picked) return trackPath(picked.subtitleUrl);
      }
      const pref = this.currentPreferredTrack();
      if (pref) return pref.url ? trackPath(pref.url) : `lan:${pref.lan}`;
      return "auto";
    }

    noteCaptionMiss(line) {
      const payload = this.currentSubtitleData;
      if (!payload || !(payload.sourceSet instanceof Set) || !Array.isArray(payload.timed) || !payload.timed.length) return;
      const comparable = this.extractComparableCaptionText(line);
      if (!comparable || !this.containsCjkText(comparable)) return;
      if (payload.sourceSet.has(line) || payload.sourceSet.has(comparable)) return;
      const nowMs = Date.now();
      const last = this.captionMisses[this.captionMisses.length - 1];
      if (last && last.line === comparable) return;
      this.captionMisses = this.captionMisses.filter((miss) => nowMs - miss.at < 10000);
      this.captionMisses.push({ line: comparable, at: nowMs });
      if (this.captionMisses.length < 2 || nowMs - this.lastTrackProbeAt < 5000) return;
      this.lastTrackProbeAt = nowMs;
      this.requestBridgeSubtitles();
      void this.findTrackForLine(comparable).catch(() => {});
    }

    async findTrackForLine(line) {
      const current = this.currentSubtitleData;
      const video = videoIdentity(location.href);
      for (const track of this.getBridgeTracks()) {
        if (current && current.trackKey === trackPath(track.subtitleUrl)) continue;
        const body = await this.fetchSubtitleBody(track.subtitleUrl);
        if (videoIdentity(location.href) !== video) return;
        if (body.some((entry) => normalizeLine(entry.content) === line)) {
          this.preferredTrack = { url: track.subtitleUrl, lan: track.lan || "", video, at: Date.now() };
          this.captionMisses = [];
          this.prefetchCurrentVideo(false).catch(() => {});
          return;
        }
      }
    }

    requestBridgeSubtitles() {
      try {
        window.postMessage({ __bteBridge: true, kind: "requestSubtitles" }, location.origin || "*");
      } catch (_error) {
      }
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
      if (!this.bridgeListenerAttached) {
        window.addEventListener("message", this.handleBridgeMessage);
        this.bridgeListenerAttached = true;
      }
      this.requestBridgeSubtitles();
    }

    updateSettings(nextSettings) {
      const prev = this.settings;
      this.settings = nextSettings;
      if (!this.settings.enabled || !this.settings.areas.captions || !this.isVideoRoute()) {
        this.stop({ restore: true });
        return;
      }
      const langChanged = prev && prev.targetLanguage !== nextSettings.targetLanguage;
      const engineChanged = prev && prev.engine !== nextSettings.engine;
      const sameVideo = videoIdentity(this.lastUrl) === videoIdentity(location.href);
      if (!sameVideo || langChanged || engineChanged) {
        const previous = sameVideo ? this.currentSubtitleData : null;
        this.lastUrl = location.href;
        this.clearVideoCaches();
        this.restoreOriginalCaptions();
        if (previous) this.reuseSubtitles(previous);
      }
      this.start();
      this.bindVideoSignals();
      this.prefetchCurrentVideo(false);
      this.applyToActiveSubtitleNodes();
    }

    reuseSubtitles(previous) {
      if (!previous || !previous.context || !Array.isArray(previous.timed) || !previous.timed.length) return;
      const cacheKey = this.buildVideoCacheKey(previous.context);
      const payload = {
        context: previous.context,
        map: new Map(),
        timed: previous.timed.map((line) => ({ ...line, translated: null })),
        groups: previous.groups,
        groupOf: previous.groupOf,
        sourceSet: previous.sourceSet,
        trackKey: previous.trackKey,
        prefetchPhase: "background",
        createdAt: Date.now(),
      };
      this.seedFromCache(payload);
      this.videoCache.set(cacheKey, payload);
      this.currentVideoCacheKey = cacheKey;
      this.currentSubtitleData = payload;
    }

    canRun() {
      return !!(this.running && this.settings && this.settings.enabled && this.settings.areas.captions);
    }

    isUsageOptimized() {
      const engine = this.settings?.engine;
      const engineConfig = engine ? this.settings?.[engine] : null;
      return !!(engineConfig && engineConfig.optimizeUsage === true);
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
      if (!this.hoverBound) {
        document.addEventListener("pointermove", this.handleProgressHover, { passive: true, capture: true });
        this.hoverBound = true;
      }
    }

    stop(options) {
      const restore = !!options?.restore;
      this.running = false;
      if (this.hoverBound) {
        document.removeEventListener("pointermove", this.handleProgressHover, { capture: true });
        this.hoverBound = false;
      }
      if (this.hoverTimer) {
        clearTimeout(this.hoverTimer);
        this.hoverTimer = null;
      }
      if (this.subtitleObserver) {
        this.subtitleObserver.disconnect();
        this.subtitleObserver = null;
      }
      this.knownCaptionNodes = [];
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
        if (this.partialRefreshIsFrame && typeof cancelAnimationFrame === "function") {
          cancelAnimationFrame(this.partialRefreshTimer);
        } else {
          clearTimeout(this.partialRefreshTimer);
        }
        this.partialRefreshTimer = null;
      }
      this.clearVideoCaches();
      if (restore) {
        this.restoreOriginalCaptions();
      }
    }

    clearVideoCaches() {
      this.prefetchInFlight.clear();
      this.probeMiss = { video: "", at: 0, delay: 0 };
      this.fallbackPending.clear();
      this.videoCache.clear();
      this.currentSubtitleData = null;
      this.currentVideoCacheKey = "";
      this.warnedIssues.clear();
      this.windowPrefetchInFlight.clear();
      this.captionMisses = [];
      this.captionDueUnseenMs = 0;
      if (this.bridgeTracks && this.bridgeTracks.size) {
        const here = videoIdentity(location.href);
        this.bridgeTracks.forEach((track, url) => {
          if (track.href && videoIdentity(track.href) !== here) this.bridgeTracks.delete(url);
        });
      }
    }

    warnOnce(code, message, details) {
      if (ROOT.isExtensionAlive && !ROOT.isExtensionAlive()) return;
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
        // Only undo our own text; the player may already show another line.
        const showsOurs = state.injected && normalizeLine(element.textContent) === normalizeLine(state.injected);
        if (showsOurs && typeof state.original === "string" && state.original.trim()) {
          element.textContent = state.original;
        }
        element.classList.remove("bte-caption-blur");
        element.style.whiteSpace = state.whiteSpace || "";
        element.style.visibility = state.visibility || "";
        state.hiddenPending = false;
      });
      this.elementState.clear();
    }

    handleProgressHover(event) {
      if (!this.running || !this.currentSubtitleData) return;
      const target = event.target;
      const bar = target && target.closest ? target.closest(CAPTION_PROGRESS_SELECTOR) : null;
      if (this.hoverTimer) {
        clearTimeout(this.hoverTimer);
        this.hoverTimer = null;
      }
      if (!bar) return;
      const x = event.clientX;
      this.hoverTimer = setTimeout(() => {
        this.hoverTimer = null;
        this.prefetchAtProgressPoint(bar, x);
      }, CAPTION_HOVER_DWELL_MS);
    }

    prefetchAtProgressPoint(bar, clientX) {
      const payload = this.currentSubtitleData;
      const cacheKey = this.currentVideoCacheKey;
      if (!payload || !cacheKey || !this.canRun() || !Array.isArray(payload.timed)) return;
      if (Date.now() - this.lastHoverPrefetchAt < CAPTION_HOVER_MIN_GAP_MS) return;
      const video = document.querySelector("video");
      const rect = bar.getBoundingClientRect();
      if (!video || !(Number(video.duration) > 0) || !(rect.width > 100)) return;
      if (this.captionsLookHidden(payload)) return;
      const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const at = fraction * Number(video.duration);
      const now = this.playbackState().time;
      if (at >= now - 2 && at <= now + this.aheadHorizonSeconds(this.playbackState())) return;
      const lines = [];
      const timed = payload.timed;
      for (let i = this.findTimedIndexAt(timed, Math.max(0, at - 1)); i < timed.length && lines.length < CAPTION_HOVER_LINES; i += 1) {
        if (Number(timed[i].from) > at + 12) break;
        const line = timed[i].original;
        if (!lines.includes(line) && !this.isCaptionLineCovered(payload, line)) lines.push(line);
      }
      if (!lines.length) return;
      this.lastHoverPrefetchAt = Date.now();
      this.translateCaptionLineSet(cacheKey, payload, lines).catch(() => {});
    }

    handleVideoSignal(event) {
      if (!this.canRun()) return;
      if (event && (event.type === "seeking" || event.type === "seeked")) {
        this.lastSeekAt = Date.now();
        this.captionDueUnseenMs = 0;
      }
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
          if (Date.now() - this.lastCaptionScanAt >= CAPTION_FULL_SCAN_MS) {
            this.applyToActiveSubtitleNodes();
          } else {
            this.applyToKnownCaptionNodes();
          }
          this.trackCaptionVisibility();
          if (this.currentSubtitleData && this.currentVideoCacheKey) {
            this.ensureBackgroundFullPrefetch(this.currentVideoCacheKey, this.currentSubtitleData);
            this.enqueueWindowPrefetch(this.currentVideoCacheKey, this.currentSubtitleData);
          }
          if (
            !this.currentSubtitleData &&
            !this.pollPrefetch &&
            !this.probeBackingOff() &&
            Date.now() - this.lastPrefetchAttempt > CAPTION_PREFETCH_RETRY_MS
          ) {
            this.pollPrefetch = this.prefetchCurrentVideo(false)
              .catch(() => {})
              .finally(() => {
                this.pollPrefetch = null;
              });
          }
        }, 80);
      }
      if (!this.urlPoll) {
        this.urlPoll = setInterval(() => {
          if (!this.settings?.enabled) return;
          if (this.lastUrl !== location.href && videoIdentity(this.lastUrl) === videoIdentity(location.href)) {
            this.lastUrl = location.href;
          } else if (this.lastUrl !== location.href) {
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
      // Applied right in the observer callback, so the translated line is painted in the same frame.
      this.subtitleObserver = new MutationObserver((records) => {
        if (!this.canRun() || !records.some((record) => this.recordTouchesCaptions(record))) return;
        this.applyToActiveSubtitleNodes();
      });
      this.subtitleObserver.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }

    recordTouchesCaptions(record) {
      const target = record.target;
      const element = target && target.nodeType === Node.ELEMENT_NODE ? target : target && target.parentElement;
      if (element && element.closest(CAPTION_SCOPE_SELECTOR)) return true;
      if (record.type !== "childList") return false;
      for (const node of record.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.matches(CAPTION_SCOPE_SELECTOR) || node.querySelector(CAPTION_SCOPE_SELECTOR)) return true;
      }
      return false;
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

      const stateBvid =
        state.bvid ||
        state.videoData?.bvid ||
        state.epInfo?.bvid ||
        playInfo?.data?.bvid ||
        null;
      const stateIsStale = !!(bvidFromUrl && stateBvid && stateBvid !== bvidFromUrl);

      const bvid = bvidFromUrl || (!stateIsStale ? stateBvid : null) || playerInfo?.bvid || null;

      const epList = Array.isArray(state.epList) ? state.epList : [];
      const matchedEp = epIdFromUrl
        ? epList.find((ep) => Number(ep?.id || ep?.ep_id || ep?.epid || 0) === epIdFromUrl) || null
        : null;

      const pages = !stateIsStale && Array.isArray(state.videoData?.pages) ? state.videoData.pages : [];
      const pageMeta = pages[pageNumber - 1] || pages[0] || null;

      const aid = stateIsStale
        ? (playerInfo?.aid || null)
        : (state.aid ||
           state.videoData?.aid ||
           state.videoData?.stat?.aid ||
           state.epInfo?.aid ||
           pageMeta?.aid ||
           matchedEp?.aid ||
           playInfo?.data?.aid ||
           playerInfo?.aid ||
           null);

      const cid = stateIsStale
        ? (playerInfo?.cid || cidFromQuery || null)
        : (state.cid ||
           state.videoData?.cid ||
           pageMeta?.cid ||
           state.epInfo?.cid ||
           matchedEp?.cid ||
           playInfo?.data?.cid ||
           playerInfo?.cid ||
           cidFromQuery ||
           null);

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
      if (context?.bvid) return `${context.bvid}::p${context?.pageNumber || 1}`;
      const ep = context?.epId ? `ep${context.epId}::` : "";
      return `${ep}${context?.aid || "unknown"}::${context?.cid || "unknown"}::p${context?.pageNumber || 1}`;
    }

    async firstResolved(inputs, attempt) {
      const settled = await Promise.all(
        inputs.map(async (input) => {
          try {
            return await attempt(input);
          } catch (_error) {
            return null;
          }
        })
      );
      return settled.find((value) => value) || null;
    }

    async ensureContextCid(context) {
      if (!context || context.cid) return context;
      const videoKey = `${context.bvid || context.aid}:${context.pageNumber || 1}`;
      let cid = this.cidByVideo.get(videoKey);
      if (!cid && !this.probeBackingOff()) {
        if (!this.cidPending.has(videoKey)) {
          const lookup = this.lookupCid(context).then((found) => {
            if (found) this.cidByVideo.set(videoKey, found);
            return found;
          });
          this.cidPending.set(videoKey, lookup);
          lookup.finally(() => this.cidPending.delete(videoKey));
        }
        cid = await this.cidPending.get(videoKey);
      }
      if (cid) {
        context.cid = cid;
        context.key = this.buildContextKey(context);
      }
      return context;
    }

    async lookupCid(context) {
      const candidates = [];
      if (context.bvid) {
        candidates.push(`https://api.bilibili.com/x/player/pagelist?bvid=${encodeURIComponent(context.bvid)}`);
        candidates.push(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(context.bvid)}`);
      }
      if (context.aid) {
        candidates.push(`https://api.bilibili.com/x/player/pagelist?aid=${encodeURIComponent(context.aid)}`);
        candidates.push(`https://api.bilibili.com/x/web-interface/view?aid=${encodeURIComponent(context.aid)}`);
      }
      if (!candidates.length) return null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const cid = await this.firstResolved(candidates, async (url) => {
          const payload = await fetchJsonOrText(url);
          return this.extractCidFromVideoMeta(payload, context.pageNumber) || null;
        });
        if (cid) return cid;
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }
      return null;
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
      if (context.bvid) {
        urls.push(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(context.bvid)}`);
      }
      if (!context.bvid && context.aid) {
        urls.push(`https://api.bilibili.com/x/web-interface/view?aid=${encodeURIComponent(context.aid)}`);
      }
      if (context.cid && context.bvid) {
        urls.push(`https://api.bilibili.com/x/player/v2?cid=${context.cid}&bvid=${context.bvid}`);
      }
      if (context.cid && context.aid) {
        urls.push(`https://api.bilibili.com/x/player/v2?cid=${context.cid}&aid=${context.aid}`);
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

      const bvidFromUrl = (location.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/) || [])[1] || null;
      const stateBvid = state.bvid || state.videoData?.bvid || playInfo?.data?.bvid || null;
      const stateIsStale = !!(bvidFromUrl && stateBvid && stateBvid !== bvidFromUrl);
      if (stateIsStale) return [];

      const candidates = [
        playInfo?.data?.subtitle?.subtitles,
        playInfo?.data?.subtitle?.list,
        state?.videoData?.subtitle?.list,
        state?.videoData?.subtitle?.subtitles,
        state?.epInfo?.subtitle?.list,
        state?.epInfo?.subtitle?.subtitles,
      ];
      candidates.forEach((list) => {
        if (Array.isArray(list)) {
          list.forEach((item) => this.collectTrack(item, tracks));
        }
      });
      return tracks;
    }

    getPlayerSubtitleTracks() {
      const tracks = [];
      try {
        const player = window.player;
        if (!player || typeof player !== "object") return tracks;
        for (const method of ["getSubtitleList", "getSubtitles", "getSubtitle", "getCurrentSubtitleList"]) {
          if (typeof player[method] !== "function") continue;
          const result = player[method]();
          if (!result) continue;
          const list = Array.isArray(result)
            ? result
            : Array.isArray(result?.list) ? result.list
            : Array.isArray(result?.subtitles) ? result.subtitles
            : [];
          list.forEach((item) => this.collectTrack(item, tracks));
          if (tracks.length) return tracks;
        }
      } catch (_error) {
      }
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
      if (this.activeLan && lan && lan === this.activeLan) score += 100;
      if (CAPTION_CJK_LAN_PATTERN.test(lan)) score += 8;
      if (CAPTION_CJK_DOC_PATTERN.test(doc)) score += 8;
      if (CAPTION_AUTO_TRACK_PATTERN.test(lan) || CAPTION_AUTO_TRACK_PATTERN.test(doc)) score -= 5;
      return score;
    }

    rankSubtitleTracks(tracks) {
      return [...tracks].sort((a, b) => this.scoreSubtitleTrack(b) - this.scoreSubtitleTrack(a));
    }

    async fetchSubtitleTracks(context) {
      const bridgeTracks = this.getBridgeTracks();
      if (bridgeTracks.length) {
        const ranked = this.rankSubtitleTracks(bridgeTracks);
        const picked = this.pickTrack(ranked);
        return picked ? [picked] : ranked;
      }
      const playerTracks = this.getPlayerSubtitleTracks();
      if (playerTracks.length) {
        return this.rankSubtitleTracks(playerTracks);
      }
      const embedded = this.getEmbeddedTracks();
      if (embedded.length) {
        const parsed = this.parseSubtitleTracks({ data: { subtitle: { subtitles: embedded } } });
        return this.rankSubtitleTracks(parsed);
      }
      if (this.probeBackingOff()) return [];
      const probePlan = this.buildProbeUrls(context);
      const probeUrls = probePlan.urls;
      if (!probePlan.hasCid) {
        this.warnOnce("missing-cid", "CID is not available yet; subtitle API probing is deferred.");
      }
      if (!probeUrls.length) {
        return [];
      }
      const tracks = await this.firstResolved(probeUrls, async (url) => {
        let payload = null;
        try {
          payload = await fetchJsonOrText(url);
        } catch (error) {
          this.warnOnce(`probe-failed-${url}`, `Subtitle probe request failed: ${url}`, error);
          return null;
        }
        if (!payload) return null;
        if (payload.code && Number(payload.code) !== 0) {
          const code = Number(payload.code);
          if (code !== -400 && code !== -404) {
            this.warnOnce(`probe-code-${code}`, `Subtitle probe returned code ${code}.`);
          }
          return null;
        }
        const found = this.parseSubtitleTracks(payload);
        return found.length ? found : null;
      });
      const video = videoIdentity(location.href);
      if (tracks) {
        this.probeMiss = { video: "", at: 0, delay: 0 };
        return this.rankSubtitleTracks(tracks);
      }
      // Most videos have no subtitles: ask again later, not on every poll.
      const prior = this.probeMiss.video === video ? this.probeMiss.delay : 0;
      this.probeMiss = {
        video,
        at: Date.now(),
        delay: prior ? Math.min(CAPTION_EMPTY_RETRY_MAX_MS, prior * 2) : CAPTION_EMPTY_RETRY_MS,
      };
      this.warnOnce("no-subtitle-tracks", "No subtitle tracks for this video.");
      return [];
    }

    probeBackingOff() {
      const miss = this.probeMiss;
      return miss.video === videoIdentity(location.href) && Date.now() - miss.at < miss.delay;
    }

    parseSubtitlePayload(data) {
      if (!data || typeof data !== "object") return [];
      const body = Array.isArray(data.body) ? data.body : Array.isArray(data?.data?.body) ? data.data.body : [];
      return body
        .map((item) => ({
          from: Number(item.from || 0),
          to: Number(item.to || 0),
          content: String(item.content || "").trim(),
        }))
        .filter((item) => item.content);
    }

    rememberTrackBody(url, body) {
      const key = trackPath(url);
      this.trackBodies.delete(key);
      this.trackBodies.set(key, body);
      while (this.trackBodies.size > CAPTION_TRACK_BODY_CACHE) {
        this.trackBodies.delete(this.trackBodies.keys().next().value);
      }
    }

    async fetchSubtitleBody(subtitleUrl) {
      const key = trackPath(subtitleUrl);
      const cached = this.trackBodies.get(key);
      if (cached && cached.length) return cached;
      const miss = this.bodyMisses.get(key);
      if (miss && Date.now() - miss.at < miss.delay) return [];
      let body = [];
      try {
        body = this.parseSubtitlePayload(await fetchJsonOrText(subtitleUrl));
      } catch (error) {
        console.warn("BTE subtitle body fetch failed:", subtitleUrl, error);
      }
      if (body.length) {
        this.bodyMisses.delete(key);
        this.rememberTrackBody(subtitleUrl, body);
      } else {
        this.bodyMisses.set(key, {
          at: Date.now(),
          delay: miss ? Math.min(CAPTION_EMPTY_RETRY_MAX_MS, miss.delay * 2) : CAPTION_EMPTY_RETRY_MS,
        });
      }
      return body;
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

    subtitleStoreKey(context) {
      if (!context) return null;
      const page = Number(context.pageNumber) || 1;
      const track = this.currentTrackKey();
      if (track === "auto") return null;
      if (context.bvid) return `bv:${context.bvid}:p${page}:${track}`;
      if (context.aid) return `av:${context.aid}:p${page}:${track}`;
      return context.cid ? `cid:${context.cid}:${track}` : null;
    }

    async loadStoredSubtitleBody(context) {
      const key = this.subtitleStoreKey(context);
      if (!key) return null;
      try {
        const store = await storageGet(CAPTION_TRACK_STORE_KEY);
        const entry = store && store[key];
        if (!entry || !Array.isArray(entry.body) || !entry.body.length) return null;
        if (Date.now() - (entry.at || 0) > CAPTION_TRACK_TTL_MS) return null;
        if (this.activeLan && entry.lan && entry.lan !== this.activeLan) return null;
        entry.at = Date.now();
        void storageSet(CAPTION_TRACK_STORE_KEY, store);
        return entry.body;
      } catch (_error) {
        return null;
      }
    }

    async storeSubtitleBody(context, body, lan) {
      const key = this.subtitleStoreKey(context);
      if (!key || !Array.isArray(body) || !body.length) return;
      const trimmed = body
        .map((line) => ({ from: line.from, to: line.to, content: line.content }))
        .filter((line) => line.content);
      if (!trimmed.length) return;
      try {
        const store = (await storageGet(CAPTION_TRACK_STORE_KEY)) || {};
        store[key] = { body: trimmed, at: Date.now(), lan: lan || null };
        const keys = Object.keys(store);
        if (keys.length > CAPTION_TRACK_STORE_LIMIT) {
          keys
            .sort((a, b) => (store[a].at || 0) - (store[b].at || 0))
            .slice(0, keys.length - CAPTION_TRACK_STORE_LIMIT)
            .forEach((stale) => delete store[stale]);
        }
        await storageSet(CAPTION_TRACK_STORE_KEY, store);
      } catch (_error) {
      }
    }

    buildVideoCacheKey(context) {
      const engine = this.settings?.engine || "google";
      const lang = this.settings?.targetLanguage || "en";
      return `${context.key}::${engine}::${lang}::${this.currentTrackKey()}`;
    }

    urgentPriority() {
      return (ROOT.SchedulePriority && ROOT.SchedulePriority.CAPTION_URGENT) || 110;
    }

    playbackState() {
      const video = document.querySelector("video");
      const rate = video && Number(video.playbackRate) > 0 ? Math.min(4, Number(video.playbackRate)) : 1;
      return {
        time: video ? Number(video.currentTime || 0) : 0,
        rate,
        paused: !video || !!video.paused,
        hidden: typeof document !== "undefined" && !!document.hidden,
      };
    }

    aheadHorizonSeconds(play) {
      if (play.hidden) return 0;
      if (play.paused) return CAPTION_AHEAD_PAUSED_SECONDS;
      const horizon = Math.min(
        CAPTION_AHEAD_MAX_SECONDS,
        Math.max(CAPTION_AHEAD_MIN_SECONDS, CAPTION_AHEAD_WATCH_SECONDS * play.rate)
      );
      return this.isUsageOptimized() ? Math.min(horizon, 20) : horizon;
    }

    captionsLookHidden(payload) {
      if (!payload || !Array.isArray(payload.timed) || !payload.timed.length) return false;
      if (this.lastCaptionSeenAt < (payload.createdAt || 0) - 15000) return true;
      return this.captionDueUnseenMs > 2500;
    }

    trackCaptionVisibility() {
      const nowMs = Date.now();
      const elapsed = Math.min(500, nowMs - (this.visibilityTickAt || nowMs));
      this.visibilityTickAt = nowMs;
      const payload = this.currentSubtitleData;
      if (!payload || !Array.isArray(payload.timed) || !payload.timed.length) return;
      if (nowMs - this.lastCaptionSeenAt < 300) {
        this.captionDueUnseenMs = 0;
        return;
      }
      const play = this.playbackState();
      if (play.paused || play.hidden) return;
      const index = this.findTimedIndexAt(payload.timed, play.time);
      const line = payload.timed[index];
      if (line && Number(line.from) <= play.time && play.time <= Number(line.to)) {
        this.captionDueUnseenMs = (this.captionDueUnseenMs || 0) + elapsed;
      }
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

    buildSentenceGroups(timed) {
      const groups = [];
      const groupOf = new Map();
      let current = null;

      const close = () => {
        if (!current) return;
        current.text = current.lines.join("");
        current.lines.forEach((line) => {
          if (!groupOf.has(line)) groupOf.set(line, current);
        });
        groups.push(current);
        current = null;
      };

      timed.forEach((entry, index) => {
        const line = entry.original;
        if (!line) {
          close();
          return;
        }
        const previous = index > 0 ? timed[index - 1] : null;
        const joinable =
          current &&
          previous &&
          current.lines.length < CAPTION_SENTENCE_MAX_LINES &&
          current.lines.join("").length + line.length <= CAPTION_SENTENCE_MAX_CHARS &&
          !CAPTION_SENTENCE_END.test(previous.original) &&
          !CAPTION_SENTENCE_START_BREAK.test(line) &&
          Number(entry.from) - Number(previous.to) <= CAPTION_SENTENCE_MAX_GAP_SECONDS &&
          this.containsCjkText(previous.original) &&
          this.containsCjkText(line);

        if (joinable) {
          current.lines.push(line);
          current.to = entry.to;
          return;
        }
        close();
        current = { lines: [line], from: entry.from, to: entry.to, text: line };
      });
      close();

      return { groups, groupOf };
    }

    splitTranslationAcross(translation, sourceLines) {
      const text = String(translation || "").trim();
      if (!text || sourceLines.length < 2) return null;
      const words = text.split(/(\s+)/).filter((part) => part !== "");
      const wordCount = words.filter((part) => !/^\s+$/.test(part)).length;
      if (wordCount < sourceLines.length) return null;

      const totalSource = sourceLines.reduce((sum, line) => sum + line.length, 0);
      if (!totalSource) return null;

      const pieces = [];
      let cursor = 0;
      let consumed = 0;
      for (let i = 0; i < sourceLines.length; i += 1) {
        if (i === sourceLines.length - 1) {
          pieces.push(words.slice(cursor).join("").trim());
          break;
        }
        consumed += sourceLines[i].length;
        const target = (consumed / totalSource) * text.length;
        let taken = words.slice(0, cursor).join("").length;
        let end = cursor;
        while (end < words.length && taken < target) {
          taken += words[end].length;
          end += 1;
        }
        const remainingCues = sourceLines.length - i - 1;
        end = Math.max(cursor + 1, Math.min(end, words.length - remainingCues));
        pieces.push(words.slice(cursor, end).join("").trim());
        cursor = end;
      }
      if (pieces.some((piece) => !piece)) return null;
      return pieces;
    }

    resolveSentenceUnits(payload, lines) {
      const units = [];
      const seen = new Set();
      lines.forEach((raw) => {
        const line = normalizeLine(raw);
        if (!line) return;
        const group = payload?.groupOf?.get(line);
        if (!group || group.lines.length < 2) {
          if (seen.has(line)) return;
          seen.add(line);
          units.push({ text: line, lines: [line] });
          return;
        }
        if (seen.has(group.text)) return;
        seen.add(group.text);
        units.push({ text: group.text, lines: group.lines.slice() });
      });
      return units;
    }

    distributeUnitTranslation(payload, unit, translation) {
      if (!translation) return 0;
      // A line keeps its first translation so it never changes while on screen.
      const setOnce = (line, value) => {
        if (!payload.map.has(line)) payload.map.set(line, value);
      };
      if (unit.lines.length < 2) {
        setOnce(unit.lines[0], translation);
        return 1;
      }
      const pieces = this.splitTranslationAcross(translation, unit.lines);
      if (pieces) {
        unit.lines.forEach((line, index) => setOnce(line, pieces[index]));
      } else {
        unit.lines.forEach((line) => setOnce(line, translation));
      }
      payload.map.set(unit.text, translation);
      return unit.lines.length;
    }

    seedFromCache(payload) {
      const lang = this.settings?.targetLanguage || "en";
      const seen = new Set();
      (payload.groups || []).forEach((group) => {
        if (!group || seen.has(group.text)) return;
        seen.add(group.text);
        const hit = this.translationManager.peekCached(group.text, { area: "captions", targetLanguage: lang });
        if (hit && hit.translation) this.distributeUnitTranslation(payload, { text: group.text, lines: group.lines }, hit.translation);
      });
      payload.timed.forEach((entry) => {
        const line = entry.original;
        if (!line || payload.map.has(line)) return;
        const hit = this.translationManager.peekCached(line, { area: "captions", targetLanguage: lang });
        if (hit && hit.translation) payload.map.set(line, hit.translation);
      });
    }

    selectPriorityLines(timed, uniqueLines) {
      const now = this.getVideoCurrentTime();
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

      let lo = 0;
      let hi = timed.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        if (timed[mid].to < time) {
          lo = mid + 1;
        } else if (timed[mid].from > time) {
          hi = mid - 1;
        } else {
          return timed[mid];
        }
      }

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

    shouldWaitForPrefetchForLine(line) {
      if (!this.currentSubtitleData || this.currentSubtitleData.prefetchPhase === "complete") return false;
      if (Date.now() - (this.currentSubtitleData.createdAt || 0) > CAPTION_PREFETCH_GRACE_MS) {
        return false;
      }
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
      const visible = typeof document !== "undefined" && !document.hidden && typeof requestAnimationFrame === "function";
      const defer = visible ? (fn) => requestAnimationFrame(fn) : (fn) => setTimeout(fn, 40);
      this.partialRefreshIsFrame = visible;
      this.partialRefreshTimer = defer(() => {
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

    findTimedIndexAt(timed, time) {
      let lo = 0;
      let hi = timed.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        if (timed[mid].to < time) lo = mid + 1;
        else if (timed[mid].from > time) hi = mid - 1;
        else return mid;
      }
      return Math.min(lo, timed.length - 1);
    }

    isCaptionLineCovered(payload, line) {
      if (!line) return true;
      if (payload.map.has(line)) return true;
      if (payload.inflight && payload.inflight.has(line)) return true;
      const skip = payload.skipUntil && payload.skipUntil.get(line);
      if (skip && skip > Date.now()) return true;
      return !this.containsCjkText(line);
    }

    bufferFrontier(payload, now) {
      const timed = payload.timed;
      for (let i = this.findTimedIndexAt(timed, now); i < timed.length; i += 1) {
        const entry = timed[i];
        if (Number(entry.to) < now) continue;
        if (this.isCaptionLineCovered(payload, entry.original)) continue;
        return { index: i, lead: Number(entry.from) - now };
      }
      return { index: timed.length, lead: Infinity };
    }

    bufferLowWaterSeconds(play) {
      const latencyS = (this.captionLatencyMs || 400) / 1000;
      const watch = Math.min(
        CAPTION_BUFFER_LOW_MAX_WATCH_SECONDS,
        Math.max(CAPTION_BUFFER_LOW_MIN_WATCH_SECONDS, latencyS * 4 + 6)
      );
      return watch * play.rate;
    }

    refillCaptionBuffer(cacheKey, payload, options) {
      if (!payload || !Array.isArray(payload.timed) || !payload.timed.length) return;
      if (this.currentVideoCacheKey !== cacheKey || !this.canRun()) return;
      const focusLine = options && options.focusLine ? normalizeLine(options.focusLine) : "";
      if (focusLine && this.isCaptionLineCovered(payload, focusLine)) return;
      const force = !!focusLine;
      const play = this.playbackState();
      if (!force && (play.hidden || this.captionsLookHidden(payload))) return;
      const frontier = this.bufferFrontier(payload, play.time);
      if (frontier.lead === Infinity) return;
      const high = Math.max(this.aheadHorizonSeconds(play), force ? CAPTION_URGENT_WATCH_SECONDS * play.rate : 0);
      const low = Math.min(high, this.bufferLowWaterSeconds(play));
      if (!force && frontier.lead > low) return;

      const timed = payload.timed;
      const limitTime = play.time + high;
      const lines = [];
      const seen = new Set();
      for (let i = frontier.index; i < timed.length && lines.length < CAPTION_REFILL_MAX_LINES; i += 1) {
        const entry = timed[i];
        if (Number(entry.from) > limitTime) break;
        const line = entry.original;
        if (seen.has(line) || this.isCaptionLineCovered(payload, line)) continue;
        seen.add(line);
        lines.push(line);
      }
      if (!lines.length) return;

      const uncached = [];
      let hadCacheHit = false;
      this.resolveSentenceUnits(payload, lines).forEach((unit) => {
        const hit = this.translationManager.peekCached(unit.text, {
          area: "captions",
          targetLanguage: this.settings?.targetLanguage || "en",
        });
        if (hit.translation) {
          this.distributeUnitTranslation(payload, unit, hit.translation);
          hadCacheHit = true;
          return;
        }
        unit.lines.forEach((line) => uncached.push(line));
      });
      if (hadCacheHit) this.schedulePartialRefresh(cacheKey, payload);
      if (!uncached.length) return;

      const urgentUntil = play.time + CAPTION_URGENT_WATCH_SECONDS * play.rate;
      const urgent = [];
      const rest = [];
      uncached.forEach((line) => {
        const from = this.captionLineStart(payload, line);
        (from <= urgentUntil ? urgent : rest).push(line);
      });
      const onFailure = (error) => {
        this.warnOnce(`caption-batch-${cacheKey}`, "Caption translation batch failed.", error);
      };
      if (urgent.length) {
        this.translateCaptionLineSet(cacheKey, payload, urgent, this.urgentPriority()).catch(onFailure);
      }
      if (rest.length) {
        this.translateCaptionLineSet(cacheKey, payload, rest).catch(onFailure);
      }
    }

    captionLineStart(payload, line) {
      const group = payload?.groupOf?.get(line);
      if (group && Number.isFinite(Number(group.from))) return Number(group.from);
      const entry = payload.timed.find((item) => item.original === line);
      return entry ? Number(entry.from) : Infinity;
    }

    enqueueWindowPrefetch(cacheKey, payload, focusLine) {
      this.refillCaptionBuffer(cacheKey, payload, { focusLine });
    }

    ensureBackgroundFullPrefetch() {}

    async translateCaptionLineSet(cacheKey, payload, lines, priority) {
      if (!payload || !lines || !lines.length) return;
      if (!payload.inflight) payload.inflight = new Set();
      if (!payload.skipUntil) payload.skipUntil = new Map();
      const units = this.resolveSentenceUnits(payload, lines).filter(
        (unit) =>
          !unit.lines.every((line) => payload.map.has(line)) &&
          !unit.lines.some((line) => payload.inflight.has(line))
      );
      if (!units.length) return;
      const unitLines = [];
      units.forEach((unit) => unit.lines.forEach((line) => unitLines.push(line)));
      unitLines.forEach((line) => payload.inflight.add(line));
      const startedAt = Date.now();
      try {
        await this.withHedge(cacheKey, payload, unitLines, priority);
      } finally {
        unitLines.forEach((line) => payload.inflight.delete(line));
        const elapsed = Date.now() - startedAt;
        if (elapsed > 40) {
          this.captionLatencySamples = (this.captionLatencySamples || []).concat(elapsed).slice(-9);
          const sorted = this.captionLatencySamples.slice().sort((a, b) => a - b);
          this.captionLatencyMs = sorted[Math.floor(sorted.length / 2)];
        }
        const retryAt = Date.now() + CAPTION_FAILED_SKIP_MS;
        unitLines.forEach((line) => {
          if (!payload.map.has(line)) payload.skipUntil.set(line, retryAt);
        });
      }
    }

    hedgeEngineName() {
      const tm = this.translationManager;
      if (!tm || typeof tm.resolveEngineChain !== "function" || !tm.settings) return null;
      try {
        const chain = tm.resolveEngineChain(tm.settings, {});
        return chain.length > 1 ? chain[1] : null;
      } catch (_error) {
        return null;
      }
    }

    hedgeDelayMs() {
      return Math.min(CAPTION_HEDGE_MAX_MS, Math.max(CAPTION_HEDGE_MIN_MS, Math.round((this.captionLatencyMs || 400) * 2)));
    }

    // If an on-screen line is slow, also ask the next engine; the first answer wins.
    withHedge(cacheKey, payload, lines, priority) {
      const main = this.translateCaptionUnits(cacheKey, payload, lines, priority);
      const hedgeEngine = (priority || 0) >= this.urgentPriority() ? this.hedgeEngineName() : null;
      if (!hedgeEngine) return main;
      let timer = null;
      const hedge = new Promise((resolve) => {
        timer = setTimeout(resolve, this.hedgeDelayMs());
      }).then(() => {
        const missing = lines.filter((line) => !payload.map.has(line));
        if (!missing.length || this.currentVideoCacheKey !== cacheKey) return;
        this.hedgesSent = (this.hedgesSent || 0) + 1;
        return this.translateCaptionUnits(cacheKey, payload, missing, priority, hedgeEngine);
      });
      main.then(() => clearTimeout(timer), () => {});
      hedge.catch(() => {});
      return Promise.race([
        main,
        hedge.then(() => (lines.every((line) => payload.map.has(line)) ? undefined : main), () => main),
      ]);
    }

    async translateCaptionUnits(cacheKey, payload, lines, priority, engine) {
      const engineOptions = engine ? { engine, engineOnly: true } : {};
      const requestPriority = priority || ((ROOT.SchedulePriority && ROOT.SchedulePriority.CAPTION) || 100);
      if (!lines.length) return;
      const units = this.resolveSentenceUnits(payload, lines).filter(
        (unit) => !unit.lines.every((line) => payload?.map && payload.map.has(line))
      );
      if (!units.length) return;
      const deduped = units.map((unit) => unit.text);
      const unitByText = new Map(units.map((unit) => [unit.text, unit]));
      const preprocessedToOriginal = new Map();
      if (typeof this.translationManager.preprocessInputText === "function" &&
          typeof this.translationManager.normalizeText === "function") {
        deduped.forEach((line) => {
          const normalized = this.translationManager.normalizeText(line);
          const prep = normalized ? this.translationManager.preprocessInputText(normalized) : null;
          if (prep && normalizeLine(prep) !== line) preprocessedToOriginal.set(normalizeLine(prep), line);
        });
      }
      let translatedCount = 0;
      if (this.currentVideoCacheKey !== cacheKey) return;
      const translated = await this.translationManager.translateMany(deduped, {
        area: "captions",
        targetLanguage: this.settings.targetLanguage,
        sourceLanguage: "zh-CN",
        skipKnownTranslated: false,
        priority: requestPriority,
        ...engineOptions,
        onPartial: ({ source, translation }) => {
          if (!translation || this.currentVideoCacheKey !== cacheKey) return;
          const normalizedSource = normalizeLine(source);
          if (!normalizedSource) return;
          const originalKey = preprocessedToOriginal.get(normalizedSource) || normalizedSource;
          const unit = unitByText.get(originalKey) || unitByText.get(normalizedSource);
          if (unit) {
            translatedCount += this.distributeUnitTranslation(payload, unit, translation);
          } else {
            payload.map.set(originalKey, translation);
            if (originalKey !== normalizedSource) payload.map.set(normalizedSource, translation);
            translatedCount += 1;
          }
          this.schedulePartialRefresh(cacheKey, payload);
        },
      });
      const unresolved = [];
      units.forEach((unit, index) => {
        const translation = translated[index]?.translation || null;
        if (!translation) {
          if (unit.lines.length > 1) unresolved.push(unit);
          return;
        }
        translatedCount += this.distributeUnitTranslation(payload, unit, translation);
      });
      this.schedulePartialRefresh(cacheKey, payload);

      if (unresolved.length && this.currentVideoCacheKey === cacheKey) {
        const singles = [];
        unresolved.forEach((unit) => {
          unit.lines.forEach((line) => {
            if (!payload.map.has(line)) singles.push(line);
          });
        });
        if (singles.length) {
          const retry = await this.translationManager.translateMany(singles, {
            area: "captions",
            targetLanguage: this.settings.targetLanguage,
            sourceLanguage: "zh-CN",
            skipKnownTranslated: false,
            priority: requestPriority,
            ...engineOptions,
          });
          singles.forEach((line, index) => {
            const translation = retry[index]?.translation || null;
            if (!translation) return;
            payload.map.set(line, translation);
            translatedCount += 1;
          });
          this.schedulePartialRefresh(cacheKey, payload);
        }
      }
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
      this.lastPrefetchAttempt = Date.now();
      let context = this.extractVideoContext();
      if (!context.cid && !context.bvid && !context.aid) {
        this.warnOnce("missing-video-context", "Video context is missing; subtitle prefetch will retry.");
        this.lastPrefetchAttempt = Date.now();
        return;
      }
      const storedBody = await this.loadStoredSubtitleBody(context);
      if (!storedBody && !(context.bvid && this.getBridgeTracks().length)) {
        context = await this.ensureContextCid(context);
      }
      const cacheKey = this.buildVideoCacheKey(context);
      this.lastPrefetchAttempt = Date.now();

      if (this.currentVideoCacheKey === cacheKey && this.currentSubtitleData) {
        this.applyToActiveSubtitleNodes();
        this.ensureBackgroundFullPrefetch(cacheKey, this.currentSubtitleData);
        this.enqueueWindowPrefetch(cacheKey, this.currentSubtitleData);
        return;
      }
      if (this.videoCache.has(cacheKey)) {
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

      const taskStartVideo = videoIdentity(location.href);
      const task = (async () => {
        let primaryBody = storedBody;
        if (!primaryBody) {
          const tracks = await this.fetchSubtitleTracks(context);
          if (!tracks.length) {
            this.warnOnce("no-tracks", "BTE: Subtitle tracks were not found for the current video.");
            return;
          }

          const primary = await this.fetchPrimaryBody(tracks);
          if (!primary || !primary.body.length) {
            this.warnOnce("no-track-body", "BTE: Subtitle tracks were found but subtitle body download failed.");
            return;
          }
          primaryBody = primary.body;
          void this.storeSubtitleBody(context, primaryBody, tracks[primary.index] && tracks[primary.index].lan);
        }

        const seen = new Set();
        const uniqueLines = this.collectUniqueLinesFromBody(primaryBody, seen);
        if (!uniqueLines.length) {
          this.warnOnce("empty-subtitle-body", "BTE: Subtitle body exists but contains no translatable lines.");
          return;
        }

        const map = new Map();
        const timed = this.buildTimedEntries(primaryBody, map);
        const { groups, groupOf } = this.buildSentenceGroups(timed);

        const payload = {
          context,
          map,
          timed,
          groups,
          groupOf,
          sourceSet: seen,
          trackKey: this.currentTrackKey(),
          prefetchPhase: "initial",
          createdAt: Date.now(),
        };
        if (!this.running || !this.settings?.enabled || !this.settings?.areas?.captions || !this.isVideoRoute()) {
          return;
        }
        if (videoIdentity(location.href) !== taskStartVideo) {
          return;
        }
        this.seedFromCache(payload);
        this.videoCache.set(cacheKey, payload);
        this.currentVideoCacheKey = cacheKey;
        this.currentSubtitleData = payload;
        this.applyToActiveSubtitleNodes();

        const { preferred: priorityLines } = this.selectPriorityLines(timed, uniqueLines);

        const criticalLines = priorityLines;

        const criticalTask = this.translateCaptionLineSet(cacheKey, payload, criticalLines, this.urgentPriority());
        await criticalTask;
        if (this.currentVideoCacheKey === cacheKey) {
          payload.prefetchPhase = "background";
          this.videoCache.set(cacheKey, payload);
          this.applyToActiveSubtitleNodes();
        }

        void (async () => {
          payload.prefetchSequenceRunning = true;
          try {
            if (this.currentVideoCacheKey === cacheKey) this.enqueueWindowPrefetch(cacheKey, payload);
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
      if (!comparable || !activeComparable) return null;
      if (
        comparable === activeComparable ||
        comparable.includes(activeComparable) ||
        activeComparable.includes(comparable)
      ) {
        return active.translated;
      }
      return null;
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

    queueFallbackCaptionTranslation(line, options) {
      const normalized = normalizeLine(line);
      if (!normalized) return;
      const force = !!options?.force;
      if (
        !force &&
        this.currentSubtitleData &&
        this.currentSubtitleData.prefetchPhase === "initial" &&
        this.currentSubtitleData.sourceSet instanceof Set &&
        this.currentSubtitleData.sourceSet.has(normalized) &&
        Date.now() - (this.currentSubtitleData.createdAt || 0) <= CAPTION_PREFETCH_GRACE_MS
      ) {
        return;
      }
      const payload = this.currentSubtitleData;
      if (payload && this.currentVideoCacheKey && payload.sourceSet instanceof Set && payload.sourceSet.has(normalized)) {
        this.refillCaptionBuffer(this.currentVideoCacheKey, payload, { focusLine: normalized });
        return;
      }
      if (payload && this.currentVideoCacheKey) {
        this.enqueueWindowPrefetch(this.currentVideoCacheKey, payload, normalized);
        if (this.resolveTranslationForLine(normalized)) return;
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
          sourceLanguage: "zh-CN",
          skipKnownTranslated: false,
          priority: this.urgentPriority(),
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

    setCaptionWaitingVisibility(element, state, hidden) {
      if (!element || !state) return;
      if (!state.visibilityCaptured) {
        state.visibility = element.style.visibility || "";
        state.visibilityCaptured = true;
      }
      element.style.visibility = hidden ? "hidden" : state.visibility || "";
      state.hiddenPending = !!hidden;
    }

    ensureElementState(element) {
      if (!this.elementState.has(element)) {
        this.elementState.set(element, {
          original: "",
          injected: "",
          whiteSpace: "",
          visibility: "",
          visibilityCaptured: false,
          hiddenPending: false,
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
      this.lastCaptionSeenAt = Date.now();

      if (state.injected && live === state.injected && state.original) {
      } else {
        state.original = normalizedSource;
        state.hadLineBreak = this.hasVisualLineBreaks(element, sourceText);
      }

      let translated = this.resolveTranslationForLine(state.original);
      if (!translated) this.noteCaptionMiss(state.original);
      if (!translated) {
        const quick = this.translationManager.peekCached(state.original, {
          area: "captions",
          sourceLanguage: "zh-CN",
          targetLanguage: this.settings?.targetLanguage || "en",
        }) || this.translationManager.peekCached(state.original, {
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
        if (this.containsCjkText(state.original)) {
          this.queueFallbackCaptionTranslation(state.original, { force: true });
        } else if (!this.shouldWaitForPrefetchForLine(state.original)) {
          this.queueFallbackCaptionTranslation(state.original);
        }
        if (state.injected && live === state.injected && state.original && live !== state.original) {
          element.textContent = state.original;
          state.injected = state.original;
        }
        this.setCaptionWaitingVisibility(element, state, false);
        element.classList.remove("bte-caption-blur");
        return;
      }
      const shaped = this.keepLineBreakShape(state.original, translated);
      const output = this.formatCaption(state.original, shaped);
      this.setCaptionWaitingVisibility(element, state, false);
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
      const blurLearn = !!(this.settings && this.settings.learn && this.settings.learn.blurCaption) &&
        (this.settings?.bilingual?.captions || "off") === "off";
      element.classList.toggle("bte-caption-blur", blurLearn);
    }

    applyToActiveSubtitleNodes() {
      if (!this.canRun()) return;
      const nodes = this.getCandidateCaptionNodes();
      this.knownCaptionNodes = nodes;
      this.lastCaptionScanAt = Date.now();
      nodes.forEach((node) => this.applyToCaptionElement(node));
      this.applyPasses = (this.applyPasses || 0) + 1;
      if (this.applyPasses % 200 === 0 && this.elementState.size > 50) {
        this.elementState.forEach((_state, element) => {
          if (!element || !element.isConnected) this.elementState.delete(element);
        });
      }
    }

    applyToKnownCaptionNodes() {
      if (!this.canRun()) return;
      this.knownCaptionNodes.forEach((node) => {
        if (this.isCaptionCandidate(node)) this.applyToCaptionElement(node);
      });
    }

    isCaptionCandidate(node) {
      if (!this.isSafeCaptionTextElement(node)) return false;
      const text = normalizeLine(this.extractCaptionSourceText(node));
      return !!text && text.length <= 220;
    }

    getCandidateCaptionNodes() {
      const nodes = new Set();
      const addIfSafe = (node) => {
        if (this.isCaptionCandidate(node)) nodes.add(node);
      };
      document.querySelectorAll(CAPTION_SELECTOR).forEach(addIfSafe);
      if (nodes.size === 0) {
        const subtitleRoot = document.querySelector(CAPTION_ROOT_SELECTOR);
        if (subtitleRoot) {
          const walker = document.createTreeWalker(subtitleRoot, NodeFilter.SHOW_TEXT);
          let textNode;
          while ((textNode = walker.nextNode())) {
            const val = String(textNode.nodeValue || "").trim();
            if (!val || val.length > 220) continue;
            if (!/[\u4e00-\u9fff]/.test(val)) continue;
            const parent = textNode.parentElement;
            if (!parent || parent.childElementCount > 0) continue;
            if (parent.closest(CAPTION_INTERACTIVE_ANCESTOR_SELECTOR)) continue;
            addIfSafe(parent);
          }
        }
      }
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
        .bte-caption-blur {
          filter: blur(6px);
          transition: filter .12s ease;
          cursor: help;
          pointer-events: auto;
        }
        .bte-caption-blur:hover { filter: none; }
      `;
      (document.head || document.documentElement).appendChild(style);
    }
  }

  ROOT.CaptionManager = CaptionManager;
})();
