(function () {
  const ROOT = (window.BTE = window.BTE || {});

  const OBSERVER_CONFIG = {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["alt", "placeholder", "title", "aria-label", "value"],
  };

  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "CODE", "PRE", "TEXTAREA"]);
  const ATTRS = ["alt", "placeholder", "title", "aria-label", "value"];
  const AREA_PRIORITY = ["comments", "danmaku", "dynamic", "page"];
  const AREA_SELECTORS = {
    comments: [
      "#commentapp",
      "bili-comments",
      ".reply-list",
      ".comment-container",
      ".comment-list",
      ".bb-comment",
      ".reply-content",
      ".comment-wrap",
    ],
    dynamic: [
      ".bili-dyn",
      ".bili-dyn-list",
      ".feed-card",
      ".recommended-container_floor-aside",
      ".bili-feed4",
      ".feed-list",
    ],
    danmaku: [
      ".bpx-player-dm-wrap",
      ".bpx-player-row-dm-wrap",
      ".bpx-player-dm-root",
      ".bpx-player-dm-text",
      ".bili-player-danmaku",
      ".danmaku-item",
      "[class*='danmaku']",
    ],
    captions: [
      ".bpx-player-subtitle-wrap",
      ".bpx-player-subtitle-panel",
      ".bpx-player-subtitle-item",
      ".bilibili-player-video-subtitle",
    ],
  };
  const CREATOR_PRIORITY_SELECTORS = [
    ".data-card-name",
    ".data-card-name .name",
    ".ct-info-card .name",
    ".section.video .name",
    ".bcc-row .name",
  ];
  const FORCED_SPACING_SELECTORS = [
    ".bpx-player-video-info-dm",
    ".bpx-player-video-info-watch",
    ".bpx-player-video-info",
    ".video-data",
    ".video-toolbar-left",
  ];
  const TIME_CONTAINER_SELECTORS = [
    "time",
    ".video-time",
    ".duration",
    ".reply-time",
    ".root-reply-time",
    ".sub-time",
    ".bpx-player-ctrl-time",
    ".bpx-player-ctrl-time-current",
    ".bpx-player-ctrl-time-duration",
    "[data-time]",
    "[class*='timestamp']",
    "[class*='reply-time']",
  ];
  const TIME_PATTERNS = [
    /^\s*\d{1,2}:\d{2}(\s*\/\s*\d{1,2}:\d{2})?\s*$/,
    /^\s*\d{1,2}:\d{2}:\d{2}\s*$/,
    /^\s*\d+\s*(\u79d2|\u5206\u949f|\u5c0f\u65f6|min|mins|minute|minutes|hour|hours)\s*$/i,
    /^\s*\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(\s+\d{1,2}:\d{2}(:\d{2})?)?\s*$/,
    /^\s*\d{1,2}[-/.]\d{1,2}([-.\/]\d{2,4})?(\s+\d{1,2}:\d{2}(:\d{2})?)?\s*$/,
  ];

  const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const TIME_CONTAINER_SELECTOR = TIME_CONTAINER_SELECTORS.join(",");
  const AREA_COMBINED_SELECTORS = {
    comments: AREA_SELECTORS.comments.join(","),
    dynamic: AREA_SELECTORS.dynamic.join(","),
    danmaku: AREA_SELECTORS.danmaku.join(","),
    captions: AREA_SELECTORS.captions.join(","),
  };
  const AREA_ORDER = ["comments", "dynamic", "danmaku", "captions"];
  const AREA_RANK = { page: 0, captions: 1, danmaku: 2, dynamic: 3, comments: 4 };
  const ANY_AREA_SELECTOR = AREA_ORDER.map((area) => AREA_COMBINED_SELECTORS[area]).join(",");
  const OWNED_SELECTOR = "[data-bte-owned='1']";
  const DANMAKU_MIN_GAP_MS = 1000;
  const DANMAKU_MAX_WAIT_MS = 5000;
  const DANMAKU_MAX_BATCH = 60;
  const STRICT_ALLOWED_TAGS = new Set(["SPAN", "P", "A", "BUTTON", "LABEL", "H1", "H2", "H3", "LI", "DT", "DD"]);
  const INLINE_WRAP_TAGS = new Set(["SPAN", "A", "B", "I", "EM", "STRONG", "MARK", "FONT", "SMALL", "SUB", "SUP", "U", "BDI", "LABEL"]);

  function editableState(value) {
    if (value === null) return null;
    const v = String(value).toLowerCase();
    if (v === "" || v === "true" || v === "plaintext-only") return true;
    return v === "false" ? false : null;
  }

  function ownArea(element) {
    if (!element.matches(ANY_AREA_SELECTOR)) return "page";
    return AREA_ORDER.find((area) => element.matches(AREA_COMBINED_SELECTORS[area])) || "page";
  }

  // Bilibili's comments are nested web components; closest() stops at each shadow root.
  function areaAcrossShadowRoots(element) {
    let best = "page";
    let el = element;
    while (el) {
      for (const area of AREA_ORDER) {
        if (AREA_RANK[area] <= AREA_RANK[best]) break;
        if (el.closest(AREA_COMBINED_SELECTORS[area])) {
          best = area;
          break;
        }
      }
      if (best === "comments") return best;
      const root = el.getRootNode ? el.getRootNode() : null;
      el = root && root.host ? root.host : null;
    }
    return best;
  }

  function isFormControl(el) {
    if (!el || !el.tagName) return false;
    const tag = el.tagName.toUpperCase();
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  }

  function modeFromSettings(settings, area) {
    const bilingual = settings && settings.bilingual ? settings.bilingual : {};
    switch (area) {
      case "comments":
        return bilingual.comments || "off";
      case "dynamic":
        return bilingual.dynamic || "off";
      case "danmaku":
        return bilingual.danmaku || "off";
      case "captions":
        return bilingual.captions || "off";
      case "page":
      default:
        return bilingual.page || "off";
    }
  }

  class DomTranslator {
    constructor(translationManager, settingsManager) {
      this.translationManager = translationManager;
      this.settingsManager = settingsManager;
      this.settings = null;
      this.running = false;
      this.observers = new Map();
      this.observedRoots = new WeakSet();
      this.lazyObserver = null;
      this.lazyObserved = new WeakSet();
      this.lazyElements = new Set();
      this.pendingNodes = new Set();
      this.flushScheduled = false;
      this.flushInProgress = false;
      this._activeDispatches = 0;
      this._maxConcurrentDispatches = 4;
      this.dispatchPending = false;
      this.textJobs = [];
      this.attrJobs = [];
      this.textState = new Map();
      this.attrState = new Map();
      this.commentPoll = null;
      this.rescanPoll = null;
      this.stylesInjected = false;
      const cores = (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4;
      this.maxNodesPerFlush = cores <= 2 ? 70 : cores <= 4 ? 140 : cores <= 8 ? 200 : 260;
      this._aheadViewports = cores <= 2 ? 1 : cores <= 4 ? 2 : cores <= 8 ? 3 : 4;
      this._flushDurationSamples = [];
      this.cleanupCounter = 0;
      this.spacingNodes = new Set();
      this.spacingParents = new Set();
      this.iframeOverlays = new Map();
      this.timestampState = new Map();
      this.lastTimestampDiscovery = 0;
      this.creatorLayoutReady = true;
      this.creatorGateTimer = null;
      this.creatorMutationCounter = 0;
      this.creatorGateLastCounter = 0;
      this.creatorStableTicks = 0;
      this.creatorGateStartedAt = 0;
      this.creatorGateUrl = "";
      this.handleMutations = this.handleMutations.bind(this);
      this.handleHover = this.handleHover.bind(this);
      this.hideHoverTip = this.hideHoverTip.bind(this);
      this.hoverTip = null;
      this.hoverBound = false;
      this.hoverPending = new WeakSet();
      this.titleObserver = null;
      this.titleOriginal = "";
      this.titleInjected = "";
      this.walkTraits = null;
      this.creatorRoute = undefined;
      this.fitWrapped = new Set();
      this.pageWork = 0;
      this.rescanWorkSeen = 0;
      this.rescanIdle = 0;
      this.danmakuJobs = [];
      this.danmakuBusy = false;
      this.danmakuTimer = null;
      this.danmakuSentAt = 0;
    }

    async initialize() {
      this.settings = await this.settingsManager.initialize();
      if (!this.nameUnsubscribe && typeof this.translationManager.onNameResolved === "function") {
        this.nameUnsubscribe = this.translationManager.onNameResolved((phrase) => this.refreshSource(phrase));
      }
      this.injectStyles();
    }

    updateSettings(nextSettings) {
      const prevLanguage = this.settings && this.settings.targetLanguage;
      this.settings = nextSettings;
      if (!this.settings.enabled || this.isRouteExcluded()) {
        this.stop({ restore: true });
        return;
      }
      if (!this.running) {
        this.start();
        return;
      }
      this.syncHoverBinding();
      if (!this.settings?.learn?.fitText) this.clearOverflowFit();
      this.beginCreatorLayoutGate();
      if (prevLanguage && prevLanguage !== this.settings.targetLanguage) {
        this.retranslateFromSavedOriginals();
      }
      this.queueFullRescan();
    }

    // A better translation became available for this text (an official name): show it.
    refreshSource(source) {
      if (!this.canRun()) return;
      this.textState.forEach((state, node) => {
        if (!node.isConnected || (state.original || "").trim() !== source) return;
        state.lastSource = "";
        this.processTextNode(node);
      });
    }

    retranslateFromSavedOriginals() {
      if (!this.canRun()) return;
      const language = this.settings.targetLanguage;
      this.textState.forEach((state, node) => {
        if (!node || !node.isConnected || !node.parentElement) return;
        const source = (state.original || "").trim();
        if (!source) return;
        if (this.shouldSkipElement(node.parentElement)) return;
        const area = this.detectArea(node.parentElement);
        if (!this.isAreaEnabled(area) || area === "captions") return;
        if (this.shouldSkipText(source, node.parentElement)) return;
        const mode = modeFromSettings(this.settings, area);
        const titleCase = this.isLikelyTagElement(node.parentElement);
        if (
          state.lastSource === source &&
          state.lastLanguage === language &&
          state.lastMode === mode &&
          this.isStateApplied(node, state, mode)
        ) {
          return;
        }
        state.inflightSig = "";
        {
          const relative = this.localizeRelativeTime(source);
          if (relative) {
            this.applyTextMode(node, state, source, relative, mode);
            state.lastSource = source; state.lastLanguage = language; state.lastMode = mode;
            this.recordSpacingParent(node);
            return;
          }
        }
        const quick = this.translationManager.peekCached(source, { targetLanguage: language, area, titleCase });
        if (quick.translation) {
          this.applyTextMode(node, state, source, quick.translation, mode);
          state.lastSource = source; state.lastLanguage = language; state.lastMode = mode;
          this.recordSpacingParent(node);
          return;
        }
        if (quick.fromCache && !quick.translation) {
          this.removeBilingualNode(state);
          if (state.applied && node.nodeValue !== state.original) node.nodeValue = state.original;
          state.applied = false; state.injectedValue = "";
          state.lastSource = source; state.lastLanguage = language; state.lastMode = mode;
          return;
        }
        state.requestId = (state.requestId || 0) + 1;
        state.inflightSig = `${language}::${mode}::${source}`;
        this.textJobs.push({
          node, area, mode, source, language, titleCase,
          priority: this.getPriorityBucket(node.parentElement), requestId: state.requestId,
        });
      });
      this.attrState.forEach((bucket, element) => {
        if (!element || !element.isConnected || this.shouldSkipElement(element)) return;
        const area = this.detectArea(element);
        if (!this.isAreaEnabled(area)) return;
        const titleCase = this.isLikelyTagElement(element);
        ATTRS.forEach((attr) => {
          const source = bucket.original[attr];
          if (!source || this.shouldSkipText(source, element)) return;
          if (bucket.lastSource[attr] === source && bucket.lastLanguage[attr] === language && bucket.applied[attr]) return;
          const quick = this.translationManager.peekCached(source, { targetLanguage: language, area, titleCase });
          if (quick.translation) {
            if (element.getAttribute(attr) !== quick.translation) element.setAttribute(attr, quick.translation);
            bucket.applied[attr] = quick.translation; bucket.lastSource[attr] = source; bucket.lastLanguage[attr] = language;
            return;
          }
          bucket.requestIds[attr] = (bucket.requestIds[attr] || 0) + 1;
          bucket.inflight[attr] = `${language}::${source}`;
          this.attrJobs.push({
            element, attr, area, source, language, titleCase,
            priority: this.getPriorityBucket(element), requestId: bucket.requestIds[attr],
          });
        });
      });
      this.dispatchTranslations();
    }

    queueFullRescan() {
      this.queueNode(document.body);
      const visit = (root, depth) => {
        root.querySelectorAll("*").forEach((el) => {
          if (el.shadowRoot && depth < 8) {
            this.observeRoot(el.shadowRoot);
            this.queueNode(el.shadowRoot);
            visit(el.shadowRoot, depth + 1);
          }
          if (el.tagName === "IFRAME") this.observeIFrame(el);
          if (el.tagName === "MICRO-APP") this.observeMicroApp(el);
        });
      };
      try {
        visit(document, 0);
      } catch (_error) {
      }
      this.observeMicroApps();
      try {
        const app = document.getElementById("commentapp");
        const biliComments =
          (app ? app.querySelector("bili-comments") : null) || document.querySelector("bili-comments");
        if (biliComments) this.queueNode(biliComments.shadowRoot || biliComments);
      } catch (_error) {
      }
    }

    isCreatorRoute() {
      if (this.creatorRoute === undefined) {
        this.creatorRoute = (location.hostname || "") === "member.bilibili.com";
      }
      return this.creatorRoute;
    }

    isRouteExcluded() {
      if (!this.isCreatorRoute()) return false;
      return !(this.settings && this.settings.areas && this.settings.areas.creatorPages);
    }

    isStrictCreatorMode() {
      return this.isCreatorRoute() && this.settings?.areas?.creatorPages && this.settings?.strictCreatorMode;
    }

    resetCreatorGateState() {
      this.creatorMutationCounter = 0;
      this.creatorGateLastCounter = 0;
      this.creatorStableTicks = 0;
      this.creatorGateStartedAt = Date.now();
    }

    clearCreatorGateTimer() {
      if (this.creatorGateTimer) {
        clearTimeout(this.creatorGateTimer);
        this.creatorGateTimer = null;
      }
    }

    beginCreatorLayoutGate() {
      if (!this.isCreatorRoute()) {
        this.creatorLayoutReady = true;
        this.creatorGateUrl = "";
        this.clearCreatorGateTimer();
        return;
      }
      const currentUrl = location.href;
      if (!this.running) return;
      this.creatorLayoutReady = false;
      this.creatorGateUrl = currentUrl;
      this.clearCreatorGateTimer();
      this.resetCreatorGateState();

      const settleCheck = () => {
        if (!this.running || !this.isCreatorRoute()) {
          this.creatorLayoutReady = true;
          this.clearCreatorGateTimer();
          return;
        }
        const hasLayoutRoots = !!document.querySelector("micro-app, micro-app-body, .microapp-container");
        if (!hasLayoutRoots) {
          this.creatorLayoutReady = true;
          this.clearCreatorGateTimer();
          return;
        }
        const delta = this.creatorMutationCounter - this.creatorGateLastCounter;
        this.creatorGateLastCounter = this.creatorMutationCounter;
        if (delta <= 2) {
          this.creatorStableTicks += 1;
        } else {
          this.creatorStableTicks = 0;
        }
        const elapsed = Date.now() - this.creatorGateStartedAt;
        if (this.creatorStableTicks >= 2 || elapsed > 4500) {
          this.creatorLayoutReady = true;
          this.clearCreatorGateTimer();
          this.observeMicroApps();
          this.queueCreatorMicroRoots();
          return;
        }
        this.creatorGateTimer = setTimeout(settleCheck, 350);
      };

      this.creatorGateTimer = setTimeout(settleCheck, 700);
    }

    canRun() {
      if (!this.settings || !this.settings.enabled || this.isRouteExcluded() || !this.running) {
        return false;
      }
      return true;
    }

    start() {
      if (!this.settings || !this.settings.enabled || this.isRouteExcluded()) {
        return;
      }
      if (this.running) return;
      this.running = true;
      this.setupLazyObserver();
      this.syncHoverBinding();
      this.observeRoot(document.body);
      document.querySelectorAll("*").forEach((el) => {
        if (el.shadowRoot) {
          this.observeRoot(el.shadowRoot);
        }
        if (el.tagName === "IFRAME") {
          this.observeIFrame(el);
        }
        if (el.tagName === "MICRO-APP") {
          this.observeMicroApp(el);
        }
      });
      this.observeMicroApps();
      this.beginCreatorLayoutGate();
      this.queueNode(document.body);
      this.startCommentsPoll();
      this.startRescanPoll();
      this.observePageTitle();
      this.translatePageTitle();
    }

    setupLazyObserver() {
      if (this.lazyObserver || typeof IntersectionObserver === "undefined") return;
      const vh = window.innerHeight || 800;
      const aheadPx = Math.round(vh * this._aheadViewports);
      const triggerPx = Math.max(Math.round(vh * 0.5), Math.round(aheadPx * 0.5));
      const rootMargin = `${Math.round(vh * 0.5)}px 0px ${triggerPx}px 0px`;
      this.lazyObserver = new IntersectionObserver(
        (entries) => {
          if (!this.canRun()) return;
          if (entries.some((entry) => entry.isIntersecting)) this.releaseLazyNearViewport();
        },
        { rootMargin }
      );
    }

    // Releases everything in the look-ahead zone at once: one request per stretch of scrolling.
    releaseLazyNearViewport() {
      const vh = window.innerHeight || 800;
      const aheadPx = vh * (this._aheadViewports || 1);
      this.lazyElements.forEach((element) => {
        if (!element.isConnected) {
          this.unobserveLazy(element);
          return;
        }
        const rect = element.getBoundingClientRect();
        if (rect.bottom >= -vh && rect.top <= vh + aheadPx) {
          this.unobserveLazy(element);
          this.queueNode(element);
        }
      });
    }

    unobserveLazy(element) {
      try {
        this.lazyObserver.unobserve(element);
      } catch (_error) {
      }
      this.lazyObserved.delete(element);
      this.lazyElements.delete(element);
    }

    queueOverflowFit(element) {
      if (!element || element.nodeType !== Node.ELEMENT_NODE) return;
      if (!this.settings?.learn?.fitText) return;
      if (!this._fitQueue) this._fitQueue = new Set();
      this._fitQueue.add(element);
      if (this._fitScheduled) return;
      this._fitScheduled = true;
      const run = () => {
        this._fitScheduled = false;
        const queue = this._fitQueue;
        this._fitQueue = new Set();
        if (!this.canRun()) return;
        queue.forEach((el) => this.applyOverflowFit(el));
      };
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
      else setTimeout(run, 16);
    }

    applyOverflowFit(el) {
      if (!el || !el.isConnected) return;
      if (this.fitWrapped.has(el)) {
        el.classList.remove("bte-fit-wrap");
        this.fitWrapped.delete(el);
      }
      if (!this.settings?.learn?.fitText) return;
      if (!el.clientWidth) return;
      if (el.scrollWidth <= el.clientWidth + 1) return;
      let style = null;
      try {
        style = window.getComputedStyle(el);
      } catch (_error) {
        return;
      }
      const clipped =
        style.textOverflow === "ellipsis" ||
        style.overflowX === "hidden" ||
        style.whiteSpace === "nowrap";
      if (!clipped) return;
      el.classList.add("bte-fit-wrap");
      this.fitWrapped.add(el);
    }

    clearOverflowFit() {
      this.fitWrapped.forEach((el) => el.classList.remove("bte-fit-wrap"));
      this.fitWrapped.clear();
    }

    syncHoverBinding() {
      const want = !!(this.settings && this.settings.learn && this.settings.learn.hoverTranslate);
      if (want && !this.hoverBound) {
        document.addEventListener("mouseover", this.handleHover, { passive: true, capture: true });
        document.addEventListener("scroll", this.hideHoverTip, { passive: true, capture: true });
        document.addEventListener("mouseout", this.hideHoverTip, { passive: true, capture: true });
        this.hoverBound = true;
      } else if (!want && this.hoverBound) {
        document.removeEventListener("mouseover", this.handleHover, { capture: true });
        document.removeEventListener("scroll", this.hideHoverTip, { capture: true });
        document.removeEventListener("mouseout", this.hideHoverTip, { capture: true });
        this.hoverBound = false;
      }
      if (!want && this.hoverTip) {
        this.hoverTip.remove();
        this.hoverTip = null;
        this.hoverTipFor = null;
      }
    }

    // Translated text shows its Chinese original; Chinese text gets translated.
    handleHover(event) {
      if (!this.canRun()) return;
      if (!this.settings?.learn?.hoverTranslate) return;
      const path = typeof event.composedPath === "function" ? event.composedPath() : [];
      const el = path[0] && path[0].nodeType === Node.ELEMENT_NODE ? path[0] : event.target;
      if (!el || el.nodeType !== Node.ELEMENT_NODE) return;
      if (this.hoverTip && (el === this.hoverTip || this.hoverTip.contains(el))) return;
      const original = this.originalShownFor(el);
      if (original) {
        this.showHoverTip(el, original);
        return;
      }
      this.hideHoverTip();
      if (this.hoverPending.has(el)) return;
      if (this.shouldSkipElement(el)) return;
      if (el.childElementCount > 0) return;
      const textNode = Array.from(el.childNodes).find((n) => n.nodeType === Node.TEXT_NODE && /[一-鿿]/.test(n.nodeValue || ""));
      if (!textNode) return;
      this.hoverPending.add(el);
      this.processTextNode(textNode, { force: true });
      this.dispatchTranslations();
    }

    originalShownFor(el) {
      const parts = [];
      el.childNodes.forEach((n) => {
        if (n.nodeType !== Node.TEXT_NODE) return;
        const st = this.textState.get(n);
        if (st && st.applied && st.original && (n.nodeValue || "").trim() !== st.original.trim()) parts.push(st.original.trim());
      });
      if (parts.length) return parts.join(" ");
      return typeof ROOT.captionOriginalFor === "function" ? ROOT.captionOriginalFor(el) : null;
    }

    showHoverTip(el, text) {
      if (!this.hoverTip) {
        const tip = document.createElement("div");
        tip.setAttribute("data-bte-owned", "1");
        tip.className = "bte-hover-tip";
        this.hoverTip = tip;
      }
      const tip = this.hoverTip;
      // In fullscreen only the fullscreen element is drawn.
      const host = document.fullscreenElement || document.body || document.documentElement;
      if (tip.parentNode !== host) host.appendChild(tip);
      if (this.hoverTipFor === el && tip.style.display === "block" && tip.textContent === text) return;
      this.hoverTipFor = el;
      tip.textContent = text;
      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth || 1024;
      tip.style.left = `${Math.max(6, Math.min(rect.left, vw - 330))}px`;
      tip.style.top = rect.bottom + 44 > (window.innerHeight || 800) ? `${Math.max(6, rect.top - 38)}px` : `${rect.bottom + 6}px`;
      tip.style.display = "block";
    }

    hideHoverTip(event) {
      if (event && event.type === "mouseout" && event.relatedTarget) return;
      this.hoverTipFor = null;
      if (this.hoverTip) this.hoverTip.style.display = "none";
    }

    observeLazy(element) {
      if (!this.lazyObserver || !element || element.nodeType !== Node.ELEMENT_NODE) return;
      if (this.lazyObserved.has(element)) return;
      this.lazyObserved.add(element);
      this.lazyElements.add(element);
      try {
        this.lazyObserver.observe(element);
      } catch (_error) {
        this.lazyObserved.delete(element);
        this.lazyElements.delete(element);
      }
    }

    stop(options) {
      const restore = !!options?.restore;
      this.running = false;
      this.observers.forEach((observer) => observer.disconnect());
      this.observers.clear();
      this.observedRoots = new WeakSet();
      if (this.lazyObserver) {
        this.lazyObserver.disconnect();
        this.lazyObserver = null;
      }
      this.lazyObserved = new WeakSet();
      this.lazyElements.clear();
      if (this.hoverBound) {
        document.removeEventListener("mouseover", this.handleHover, { capture: true });
        document.removeEventListener("scroll", this.hideHoverTip, { capture: true });
        document.removeEventListener("mouseout", this.hideHoverTip, { capture: true });
        this.hoverBound = false;
      }
      if (this.hoverTip) {
        this.hoverTip.remove();
        this.hoverTip = null;
      }
      this.hoverPending = new WeakSet();
      this.pendingNodes.clear();
      this.flushScheduled = false;
      this.dispatchPending = false;
      this.textJobs = [];
      this.attrJobs = [];
      this.danmakuJobs = [];
      if (this.danmakuTimer) {
        clearTimeout(this.danmakuTimer);
        this.danmakuTimer = null;
      }
      if (this.commentPoll) {
        clearInterval(this.commentPoll);
        this.commentPoll = null;
      }
      if (this.rescanPoll) {
        clearTimeout(this.rescanPoll);
        this.rescanPoll = null;
      }
      this.clearCreatorGateTimer();
      this.creatorLayoutReady = true;
      this.creatorGateUrl = "";
      if (this.titleObserver) {
        this.titleObserver.disconnect();
        this.titleObserver = null;
      }
      if (restore) {
        this.clearOverflowFit();
        this.restoreOriginals();
      } else {
        this.timestampState.clear();
      }
    }

    restoreOriginals() {
      if (this.titleOriginal && document.title === this.titleInjected) {
        document.title = this.titleOriginal;
      }
      this.titleOriginal = "";
      this.titleInjected = "";
      this.spacingNodes.forEach((node) => {
        if (node && node.isConnected) {
          node.remove();
        }
      });
      this.spacingNodes.clear();
      this.spacingParents.clear();
      this.iframeOverlays.forEach((overlay) => {
        if (overlay && overlay.isConnected) {
          overlay.remove();
        }
      });
      this.iframeOverlays.clear();
      this.timestampState.forEach((state, element) => {
        if (!element || !element.isConnected) return;
        if (state.original && element.textContent === state.applied) {
          element.textContent = state.original;
        }
      });
      this.timestampState.clear();
      this.textState.forEach((state, node) => {
        if (!node || !node.isConnected) return;
        if (state.extraNode && state.extraNode.isConnected) {
          state.extraNode.remove();
        }
        if (typeof state.original === "string") {
          node.nodeValue = state.original;
        }
        state.applied = false;
        state.injectedValue = "";
        state.translation = null;
        state.inflightSig = "";
        state.lastSource = "";
        state.lastLanguage = "";
        state.lastMode = "";
      });
      this.attrState.forEach((bucket, element) => {
        if (!element || !element.isConnected) return;
        const originals = bucket.original || {};
        Object.keys(originals).forEach((attr) => {
          if (originals[attr] !== undefined) {
            element.setAttribute(attr, originals[attr]);
          }
        });
        bucket.applied = {};
        bucket.inflight = {};
        bucket.lastSource = {};
        bucket.lastLanguage = {};
      });
    }

    startCommentsPoll() {
      if (this.commentPoll) {
        clearInterval(this.commentPoll);
      }
      this.commentPoll = setInterval(() => {
        if (!this.canRun() || document.hidden) return;
        const app = document.getElementById("commentapp");
        const biliComments = app ? app.querySelector("bili-comments") : null;
        if (!biliComments) return;
        const root = biliComments.shadowRoot || biliComments;
        this.observeRoot(root);
        this.queueNode(root);
        this.scanTimestamps();
      }, 250);
    }

    startRescanPoll() {
      if (this.rescanPoll) {
        clearTimeout(this.rescanPoll);
      }
      const baseMs = this.isCreatorRoute() ? 1200 : 2800;
      this.rescanIdle = 0;
      this.rescanWorkSeen = this.pageWork;
      const schedule = () => {
        this.rescanPoll = setTimeout(() => {
          rescan();
          schedule();
        }, baseMs * Math.min(8, 2 ** this.rescanIdle));
      };
      const rescan = () => {
        if (!this.canRun() || document.hidden) return;
        this.rescanIdle = this.pageWork === this.rescanWorkSeen ? this.rescanIdle + 1 : 0;
        this.rescanWorkSeen = this.pageWork;
        this.queueNode(document.body);
        this.observeMicroApps();
        const app = document.getElementById("commentapp");
        const biliComments = app ? app.querySelector("bili-comments") : null;
        if (biliComments) {
          this.queueNode(biliComments.shadowRoot || biliComments);
        }
        this.scanTimestamps();
      };
      schedule();
    }

    notePageWork(area) {
      if (area !== "danmaku") this.pageWork += 1;
    }

    observePageTitle() {
      if (this.titleObserver) {
        this.titleObserver.disconnect();
        this.titleObserver = null;
      }
      const titleEl = document.querySelector("title");
      if (!titleEl) return;
      this.titleObserver = new MutationObserver(() => {
        if (!this.canRun()) return;
        const current = document.title;
        if (current === this.titleInjected) return;
        this.titleOriginal = current;
        this.titleInjected = "";
        this.translatePageTitle();
      });
      this.titleObserver.observe(titleEl, { childList: true, characterData: true, subtree: true });
    }

    translatePageTitle() {
      if (!this.canRun()) return;
      if (!this.settings?.areas?.page) return;
      if (!this.titleOriginal) {
        const current = document.title;
        if (!current || !current.trim()) return;
        this.titleOriginal = current;
      }
      const source = this.titleOriginal;
      if (!source || !source.trim()) return;
      if (document.title === this.titleInjected && this.titleInjected) return;
      this.translationManager
        .translate(source, {
          targetLanguage: this.settings?.targetLanguage || "en",
          area: "page",
        })
        .then((result) => {
          if (!this.running) return;
          const translated = result?.translation || null;
          if (!translated || translated === source) return;
          this.titleInjected = translated;
          document.title = translated;
        })
        .catch(() => {});
    }

    observeRoot(root) {
      if (!root || this.observedRoots.has(root)) return;
      this.observedRoots.add(root);
      this.pageWork += 1;
      const observer = new MutationObserver(this.handleMutations);
      observer.observe(root, OBSERVER_CONFIG);
      this.observers.set(root, observer);
      this.queueNode(root);
    }

    handleMutations(mutations) {
      if (this.running && this.isCreatorRoute() && !this.creatorLayoutReady) {
        mutations.forEach((mutation) => {
          if (this.mutationTouchesMicroArea(mutation)) {
            this.creatorMutationCounter += 1;
          }
        });
      }
      if (!this.canRun()) return;
      mutations.forEach((mutation) => {
        if (mutation.type === "childList") {
          mutation.addedNodes.forEach((node) => {
            if (this.isCreatorRoute() && this.creatorLayoutReady && this.isMicroRootCandidate(node)) {
              this.beginCreatorLayoutGate();
            }
            this.queueNode(node);
            if (node.nodeType === Node.ELEMENT_NODE && node.shadowRoot) {
              this.observeRoot(node.shadowRoot);
            }
            if (node.nodeType === Node.ELEMENT_NODE && node.tagName === "IFRAME") {
              this.observeIFrame(node);
            }
            if (node.nodeType === Node.ELEMENT_NODE && node.tagName === "MICRO-APP") {
              this.observeMicroApp(node);
            }
            if (node.nodeType === Node.ELEMENT_NODE && node.tagName === "MICRO-APP-BODY") {
              this.observeRoot(node);
              this.queueNode(node);
            }
          });
        } else if (mutation.type === "characterData" || mutation.type === "attributes") {
          this.queueNode(mutation.target);
        }
      });
    }

    mutationTouchesMicroArea(mutation) {
      if (!mutation) return false;
      const target = mutation.target;
      const targetElement =
        target?.nodeType === Node.ELEMENT_NODE
          ? target
          : target?.nodeType === Node.TEXT_NODE
            ? target.parentElement
            : null;
      if (this.isMicroAreaElement(targetElement)) return true;
      if (mutation.type === "childList") {
        for (const node of mutation.addedNodes || []) {
          if (node.nodeType === Node.ELEMENT_NODE && this.isMicroAreaElement(node)) return true;
          if (node.nodeType === Node.TEXT_NODE && this.isMicroAreaElement(node.parentElement)) return true;
        }
      }
      return false;
    }

    isMicroRootCandidate(node) {
      if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
      if (node.tagName === "MICRO-APP" || node.tagName === "MICRO-APP-BODY") return true;
      if (node.matches?.(".microapp-container")) return true;
      return false;
    }

    observeMicroApps() {
      document.querySelectorAll("micro-app").forEach((app) => this.observeMicroApp(app));
      document.querySelectorAll("micro-app-body").forEach((body) => {
        this.observeRoot(body);
        this.queueNode(body);
      });
    }

    queueCreatorMicroRoots() {
      document.querySelectorAll("micro-app, micro-app-body, .microapp-container").forEach((root) => {
        this.queueNode(root);
      });
    }

    observeMicroApp(app) {
      if (!app || app.nodeType !== Node.ELEMENT_NODE) return;
      this.observeRoot(app);
      this.queueNode(app);
      if (app.shadowRoot) {
        this.observeRoot(app.shadowRoot);
        this.queueNode(app.shadowRoot);
      }
      const body = app.querySelector("micro-app-body");
      if (body) {
        this.observeRoot(body);
        this.queueNode(body);
      }
      app.querySelectorAll("iframe").forEach((frame) => this.observeIFrame(frame));
    }

    observeIFrame(iframe) {
      if (!iframe) return;
      this.ensureIFrameAllowTranslator(iframe);
      try {
        const doc = iframe.contentDocument;
        const body = doc?.body;
        if (body) {
          this.observeRoot(body);
          this.queueNode(body);
          this.removeIframeOverlay(iframe);
        }
      } catch (_error) {
        this.applyIframeOverlayFallback(iframe);
      }
    }

    ensureIFrameAllowTranslator(_iframe) {
    }

    removeIframeOverlay(iframe) {
      const overlay = this.iframeOverlays.get(iframe);
      if (overlay && overlay.isConnected) {
        overlay.remove();
      }
      this.iframeOverlays.delete(iframe);
    }

    applyIframeOverlayFallback(iframe) {
      if (!iframe || !iframe.isConnected) return;
      if (this.iframeOverlays.has(iframe)) return;
      const parent = iframe.parentElement;
      if (!parent) return;
      const host = (() => {
        try {
          return new URL(iframe.src || "").hostname || "";
        } catch (_error) {
          return "";
        }
      })();
      const labelRaw = iframe.getAttribute("title") || iframe.getAttribute("aria-label") || host || "Embedded content";
      const label = String(labelRaw || "").trim();
      if (!label) return;
      const overlay = document.createElement("div");
      overlay.setAttribute("data-bte-owned", "1");
      overlay.style.position = "absolute";
      overlay.style.left = "8px";
      overlay.style.top = "8px";
      overlay.style.padding = "4px 6px";
      overlay.style.background = "rgba(0,0,0,0.42)";
      overlay.style.color = "#fff";
      overlay.style.fontSize = "12px";
      overlay.style.borderRadius = "6px";
      overlay.style.pointerEvents = "none";
      overlay.style.zIndex = "2147483646";
      overlay.textContent = label;
      const computedParentPos = window.getComputedStyle(parent).position;
      if (!computedParentPos || computedParentPos === "static") {
        parent.style.position = "relative";
      }
      parent.appendChild(overlay);
      this.iframeOverlays.set(iframe, overlay);
      this.translationManager
        .translate(label, {
          targetLanguage: this.settings?.targetLanguage || "en",
          area: "page",
          titleCase: true,
        })
        .then((result) => {
          if (!overlay.isConnected) return;
          const translated = result?.translation || null;
          if (translated) {
            overlay.textContent = translated;
          }
        })
        .catch(() => {});
    }

    queueNode(node) {
      if (!node) return;
      this.pendingNodes.add(node);
      this.scheduleFlush();
    }

    scheduleFlush() {
      if (this.flushScheduled) return;
      this.flushScheduled = true;
      setTimeout(() => {
        this.flushScheduled = false;
        this.flush().catch((error) => {
          console.warn("BTE DOM flush failed:", error);
        });
      }, 0);
    }

    _adaptFlushSize(ms) {
      this._flushDurationSamples.push(ms);
      if (this._flushDurationSamples.length > 8) {
        this._flushDurationSamples.shift();
      }
      const avg = this._flushDurationSamples.reduce((a, b) => a + b, 0) / this._flushDurationSamples.length;
      if (avg < 30 && this.maxNodesPerFlush < 400) {
        this.maxNodesPerFlush = Math.min(400, this.maxNodesPerFlush + 30);
      } else if (avg > 100 && this.maxNodesPerFlush > 40) {
        this.maxNodesPerFlush = Math.max(40, this.maxNodesPerFlush - 20);
      }
    }

    async flush() {
      if (!this.canRun()) return;
      if (this.flushInProgress) {
        this.scheduleFlush();
        return;
      }
      this.flushInProgress = true;
      const t0 = Date.now();
      try {
        const nodes = Array.from(this.pendingNodes);
        this.pendingNodes.clear();
        const limit = Math.min(this.maxNodesPerFlush, nodes.length);
        this.walkTraits = new Map();
        for (let i = 0; i < limit; i += 1) {
          this.processNode(nodes[i]);
        }
        for (let i = limit; i < nodes.length; i += 1) {
          this.pendingNodes.add(nodes[i]);
        }
        if (this.spacingParents.size) this.flushSiblingSpacing(false);
        this.cleanupCounter += 1;
        if (this.cleanupCounter % 20 === 0) {
          this.pruneStateMaps();
        }
      } finally {
        this.walkTraits = null;
        this.flushInProgress = false;
        this._adaptFlushSize(Date.now() - t0);
      }
      this.dispatchTranslations();
      if (this.pendingNodes.size) {
        this.scheduleFlush();
      }
    }

    dispatchTranslations() {
      if (!this.textJobs.length && !this.attrJobs.length) return;
      if (this._activeDispatches >= this._maxConcurrentDispatches) {
        this.dispatchPending = true;
        return;
      }
      this._activeDispatches += 1;
      Promise.resolve()
        .then(() => this.processQueuedTranslations())
        .catch((error) => console.warn("BTE translation dispatch failed:", error))
        .finally(() => {
          this._activeDispatches -= 1;
          if ((this.dispatchPending || this.textJobs.length || this.attrJobs.length) && this.canRun()) {
            this.dispatchPending = false;
            this.dispatchTranslations();
          }
        });
    }

    pruneStateMaps() {
      this.textState.forEach((_state, node) => {
        if (!node || !node.isConnected) {
          this.textState.delete(node);
        }
      });
      this.attrState.forEach((_bucket, element) => {
        if (!element || !element.isConnected) {
          this.attrState.delete(element);
        }
      });
      this.iframeOverlays.forEach((overlay, iframe) => {
        if (!iframe || !iframe.isConnected) {
          if (overlay && overlay.isConnected) {
            overlay.remove();
          }
          this.iframeOverlays.delete(iframe);
        }
      });
      this.timestampState.forEach((_state, element) => {
        if (!element || !element.isConnected) this.timestampState.delete(element);
      });
      // An observer keeps its root alive: let go of comment threads the page has removed.
      this.observers.forEach((observer, root) => {
        if (root.isConnected) return;
        observer.disconnect();
        this.observers.delete(root);
        this.observedRoots.delete(root);
      });
      this.fitWrapped.forEach((element) => {
        if (!element.isConnected) this.fitWrapped.delete(element);
      });
    }

    processNode(node) {
      if (!node) return;
      if (node.nodeType === Node.TEXT_NODE) {
        this.processTextNode(node);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
        return;
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (this.shouldSkipElement(node)) return;
        if (node.tagName === "IFRAME") {
          this.observeIFrame(node);
          return;
        }
        this.processAttributes(node);
      }
      const rootDoc = node.ownerDocument || document;
      const walker = rootDoc.createTreeWalker(
        node,
        NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
        {
          acceptNode: (candidate) => {
            if (candidate.nodeType === Node.ELEMENT_NODE) {
              if (this.shouldSkipElement(candidate)) return NodeFilter.FILTER_REJECT;
              return NodeFilter.FILTER_ACCEPT;
            }
            if (candidate.nodeType === Node.TEXT_NODE) {
              if (!candidate.parentElement || this.shouldSkipElement(candidate.parentElement)) {
                return NodeFilter.FILTER_REJECT;
              }
              return NodeFilter.FILTER_ACCEPT;
            }
            return NodeFilter.FILTER_SKIP;
          },
        },
        false
      );
      let current;
      while ((current = walker.nextNode())) {
        if (current.nodeType === Node.TEXT_NODE) {
          this.processTextNode(current);
        } else if (current.nodeType === Node.ELEMENT_NODE) {
          if (current.tagName === "IFRAME") {
            this.observeIFrame(current);
            continue;
          }
          this.processAttributes(current);
          if (current.shadowRoot) {
            this.observeRoot(current.shadowRoot);
          }
        }
      }
    }

    elementTraits(element) {
      const memo = this.walkTraits;
      if (!memo) return this.computeTraits(element);
      let traits = memo.get(element);
      if (traits) return traits;
      const parent = element.parentElement;
      if (parent) {
        const base = this.elementTraits(parent);
        const own = ownArea(element);
        const editable = editableState(element.getAttribute("contenteditable"));
        traits = {
          owned: base.owned || element.matches(OWNED_SELECTOR),
          time: base.time || element.matches(TIME_CONTAINER_SELECTOR),
          area: AREA_RANK[own] > AREA_RANK[base.area] ? own : base.area,
          editable: editable === null ? base.editable : editable,
        };
      } else {
        traits = this.computeTraits(element);
      }
      memo.set(element, traits);
      return traits;
    }

    computeTraits(element) {
      let editable = false;
      for (let el = element; el; el = el.parentElement) {
        const state = editableState(el.getAttribute("contenteditable"));
        if (state !== null) {
          editable = state;
          break;
        }
      }
      return {
        owned: !!element.closest(OWNED_SELECTOR),
        time: !!element.closest(TIME_CONTAINER_SELECTOR),
        area: areaAcrossShadowRoots(element),
        editable,
      };
    }

    shouldSkipElement(element) {
      if (!element || element.nodeType !== Node.ELEMENT_NODE) return true;
      if (SKIP_TAGS.has(element.tagName)) return true;
      const traits = this.elementTraits(element);
      if (traits.owned || traits.time || traits.editable || traits.area === "captions") return true;
      if (document.designMode === "on") return true;
      if (this.shouldDelayMicroAreaElement(element)) return true;
      if (this.isStrictCreatorMode() && this.isStrictExcluded(element)) return true;
      return false;
    }

    isMicroAreaElement(element) {
      if (!element || element.nodeType !== Node.ELEMENT_NODE || !element.closest) return false;
      return !!element.closest("micro-app, micro-app-body, .microapp-container");
    }

    shouldDelayMicroAreaElement(element) {
      if (!this.isCreatorRoute() || this.creatorLayoutReady) return false;
      return this.isMicroAreaElement(element);
    }

    isStrictExcluded(element) {
      if (!element || !element.matches) return false;
      return !!element.closest(
        "form, [class*='form'], [class*='editor'], [class*='input'], [class*='upload-input'], .ql-container"
      );
    }

    detectArea(element) {
      if (!element || !element.closest) return "page";
      return this.elementTraits(element).area;
    }

    isAreaEnabled(area) {
      const areas = this.settings?.areas || {};
      switch (area) {
        case "comments":
          return areas.comments !== false;
        case "dynamic":
          return areas.dynamic !== false;
        case "danmaku":
          return !!areas.danmaku;
        case "captions":
          return areas.captions !== false;
        case "page":
        default:
          return areas.page !== false;
      }
    }

    isTimeContainer(element) {
      if (!element || !element.closest) return false;
      return this.elementTraits(element).time;
    }

    isTimeLikeText(text) {
      if (!text) return true;
      if (/^\s*[\d.,%]+\s*$/.test(text)) return true;
      return TIME_PATTERNS.some((pattern) => pattern.test(text));
    }

    shouldSkipText(text, parent) {
      const normalized = String(text || "").trim();
      if (!normalized) return true;
      if (ROOT.Slang && parent && ROOT.Slang.line(normalized, this.targetLocale(), this.detectArea(parent))) return false;
      if (this.isTimeLikeText(normalized)) return true;
      if (/^https?:\/\/\S+$/.test(normalized)) return true;
      if (/^[\p{P}\p{S}\s]+$/u.test(normalized)) return true;
      if (!/[㐀-鿿぀-ヿ가-힯]/.test(normalized)) return true;
      if (/^(BV[1-9A-Za-z]{10}|av\d+)$/i.test(normalized)) return true;
      if (parent && this.isTimeContainer(parent)) return true;
      if (this.isStrictCreatorMode()) {
        const tag = parent?.tagName ? parent.tagName.toUpperCase() : "";
        if (!STRICT_ALLOWED_TAGS.has(tag)) return true;
      }
      return false;
    }

    removeBilingualNode(state) {
      if (state.extraNode && state.extraNode.isConnected) {
        state.extraNode.remove();
      }
      state.extraNode = null;
    }

    isStateApplied(node, state, mode) {
      if (!state.applied) return false;
      if (mode === "off") {
        return !!state.injectedValue && node.nodeValue === state.injectedValue;
      }
      return !!state.extraNode && state.extraNode.isConnected && node.nodeValue === state.original;
    }

    isTextModeCurrent(node, state, original, translated, mode) {
      if (!this.isStateApplied(node, state, mode)) return false;
      if (state.original !== original || state.translation !== translated) return false;
      if (mode === "off") {
        return node.nodeValue === translated;
      }
      const expectedExtra = mode === "stacked" ? translated : ` | ${translated}`;
      return state.extraNode?.textContent === expectedExtra;
    }

    applyTextMode(node, state, original, translated, mode) {
      if (this.isTextModeCurrent(node, state, original, translated, mode)) {
        state.inflightSig = "";
        this.textState.set(node, state);
        return;
      }
      if (mode === "off") {
        this.removeBilingualNode(state);
        const origVal = state.original || "";
        let leadWs = origVal.match(/^(\s+)/)?.[1] ?? "";
        let trailWs = origVal.match(/(\s+)$/)?.[1] ?? "";
        if (!leadWs && node.previousSibling?.nodeType === Node.ELEMENT_NODE) leadWs = " ";
        if (!trailWs && node.nextSibling?.nodeType === Node.ELEMENT_NODE) trailWs = " ";
        const withWs = leadWs + translated + trailWs;
        if (node.nodeValue !== withWs) {
          node.nodeValue = withWs;
        }
        state.injectedValue = withWs;
      } else {
        if (node.nodeValue !== original) {
          node.nodeValue = original;
        }
        let extraNode = state.extraNode;
        if (!extraNode || !extraNode.isConnected) {
          extraNode = document.createElement("span");
          extraNode.setAttribute("data-bte-owned", "1");
          extraNode.className = `bte-bilingual bte-${mode}`;
          if (node.parentNode) {
            node.parentNode.insertBefore(extraNode, node.nextSibling);
          }
        }
        if (mode === "stacked") {
          if (extraNode.textContent !== translated) {
            extraNode.textContent = translated;
          }
        } else {
          const inlineTranslated = ` | ${translated}`;
          if (extraNode.textContent !== inlineTranslated) {
            extraNode.textContent = inlineTranslated;
          }
        }
        state.extraNode = extraNode;
        state.injectedValue = mode === "stacked" ? `${original}\n${translated}` : `${original} | ${translated}`;
      }
      state.translation = translated;
      state.original = original;
      state.applied = true;
      state.inflightSig = "";
      this.textState.set(node, state);
      this.queueOverflowFit(node.parentElement);
    }

    ensureTextState(node) {
      if (!this.textState.has(node)) {
        this.textState.set(node, {
          original: "",
          translation: null,
          extraNode: null,
          injectedValue: "",
          lastSource: "",
          lastLanguage: "",
          lastMode: "",
          requestId: 0,
          inflightSig: "",
          applied: false,
        });
      }
      return this.textState.get(node);
    }

    processTextNode(node, options) {
      if (!this.canRun()) return;
      if (!node || node.nodeType !== Node.TEXT_NODE || !node.parentElement) return;
      if (!node.isConnected) return;
      if (this.shouldSkipElement(node.parentElement)) return;
      const area = this.detectArea(node.parentElement);
      const force = !!(options && options.force);
      if ((!force && !this.isAreaEnabled(area)) || area === "captions") return;
      const mode = modeFromSettings(this.settings, area);
      const titleCase = this.isLikelyTagElement(node.parentElement);
      const state = this.ensureTextState(node);
      const liveValue = node.nodeValue || "";
      if (!liveValue.trim()) {
        this.removeBilingualNode(state);
        state.applied = false;
        state.injectedValue = "";
        return;
      }

      if (state.injectedValue && liveValue !== state.injectedValue) {
        state.applied = false;
      }
      if (state.injectedValue && liveValue === state.injectedValue && state.original) {
      } else {
        state.original = liveValue;
      }
      const source = (state.original || "").trim();
      if (!source || this.shouldSkipText(source, node.parentElement)) return;
      const language = this.settings.targetLanguage;

      if (
        state.lastSource === source &&
        state.lastLanguage === language &&
        state.lastMode === mode &&
        this.isStateApplied(node, state, mode)
      ) {
        return;
      }

      {
        const relative = this.localizeRelativeTime(source);
        if (relative) {
          this.notePageWork(area);
          this.applyTextMode(node, state, source, relative, mode);
          state.lastSource = source;
          state.lastLanguage = language;
          state.lastMode = mode;
          this.recordSpacingParent(node);
          return;
        }
      }

      const quick = this.translationManager.peekCached(source, {
        targetLanguage: language,
        area,
        titleCase,
      });
      if (quick.translation) {
        this.notePageWork(area);
        this.applyTextMode(node, state, source, quick.translation, mode);
        state.lastSource = source;
        state.lastLanguage = language;
        state.lastMode = mode;
        this.recordSpacingParent(node);
        return;
      }
      if (quick.fromCache && !quick.translation) {
        this.removeBilingualNode(state);
        if (state.applied && node.isConnected && node.nodeValue !== state.original) {
          node.nodeValue = state.original;
        }
        state.applied = false;
        state.injectedValue = "";
        state.lastSource = source;
        state.lastLanguage = language;
        state.lastMode = mode;
        state.inflightSig = "";
        return;
      }

      // Danmaku only exist while on screen; measuring each one would force a layout per line.
      const priority = area === "danmaku" ? 2 : this.getPriorityBucket(node.parentElement);
      if (priority <= 0 && this.lazyObserver) {
        this.observeLazy(node.parentElement);
        state.inflightSig = "";
        return;
      }

      const signature = `${language}::${mode}::${source}`;
      if (state.inflightSig === signature) {
        return;
      }
      state.requestId = (state.requestId || 0) + 1;
      state.inflightSig = signature;
      this.notePageWork(area);
      this.textJobs.push({
        node,
        area,
        mode,
        source,
        language,
        titleCase,
        priority,
        requestId: state.requestId,
      });
    }

    ensureAttrState(element) {
      if (!this.attrState.has(element)) {
        this.attrState.set(element, {
          original: {},
          requestIds: {},
          inflight: {},
          applied: {},
          lastSource: {},
          lastLanguage: {},
        });
      }
      return this.attrState.get(element);
    }

    processAttributes(element) {
      if (!element || element.nodeType !== Node.ELEMENT_NODE) return;
      if (!ATTRS.some((attr) => element.hasAttribute(attr))) return;
      if (!this.canRun()) return;
      if (!element.isConnected) return;
      if (this.shouldSkipElement(element)) return;
      const area = this.detectArea(element);
      if (!this.isAreaEnabled(area)) return;
      const bucket = this.ensureAttrState(element);
      const titleCase = this.isLikelyTagElement(element);
      ATTRS.forEach((attr) => {
        if (!element.hasAttribute(attr)) return;
        if (attr === "value" && (isFormControl(element) || this.isStrictCreatorMode())) return;
        const currentValue = element.getAttribute(attr);
        if (!currentValue || !currentValue.trim()) return;
        if (bucket.original[attr] === undefined) {
          bucket.original[attr] = currentValue;
        }
        if (bucket.applied[attr] && currentValue !== bucket.applied[attr] && currentValue !== bucket.original[attr]) {
          bucket.original[attr] = currentValue;
          bucket.applied[attr] = "";
        }
        const source = bucket.original[attr];
        if (!source || this.shouldSkipText(source, element)) return;
        const language = this.settings.targetLanguage;

        if (
          bucket.applied[attr] &&
          currentValue === bucket.applied[attr] &&
          bucket.lastSource[attr] === source &&
          bucket.lastLanguage[attr] === language
        ) {
          bucket.inflight[attr] = "";
          return;
        }

        const quick = this.translationManager.peekCached(source, {
          targetLanguage: language,
          area,
          titleCase,
        });
        if (quick.translation) {
          if (currentValue !== quick.translation) {
            this.notePageWork(area);
            element.setAttribute(attr, quick.translation);
          }
          bucket.applied[attr] = quick.translation;
          bucket.lastSource[attr] = source;
          bucket.lastLanguage[attr] = language;
          bucket.inflight[attr] = "";
          return;
        }
        if (quick.fromCache && !quick.translation) {
          bucket.inflight[attr] = "";
          if (bucket.applied[attr]) {
            if (currentValue !== source) {
              element.setAttribute(attr, source);
            }
            bucket.applied[attr] = "";
          }
          bucket.lastSource[attr] = source;
          bucket.lastLanguage[attr] = language;
          return;
        }

        if (this.lazyObserver && this.getPriorityBucket(element) <= 0) {
          this.observeLazy(element);
          return;
        }
        const signature = `${language}::${source}`;
        if (bucket.inflight[attr] === signature) return;
        bucket.requestIds[attr] = (bucket.requestIds[attr] || 0) + 1;
        bucket.inflight[attr] = signature;
        this.notePageWork(area);
        this.attrJobs.push({
          element,
          attr,
          area,
          source,
          language,
          titleCase,
          priority: this.getPriorityBucket(element),
          requestId: bucket.requestIds[attr],
        });
      });
    }

    isLikelyTagElement(element) {
      if (!element) return false;
      const attr = `${element.className || ""} ${element.getAttribute?.("data-type") || ""} ${element.getAttribute?.("role") || ""}`;
      return /(tag|tags|topic|category|chip|label|keyword|badge)/i.test(attr);
    }

    targetLocale() {
      return String((this.settings && this.settings.targetLanguage) || "en");
    }

    relativeLabel(value, unit) {
      const lang = this.targetLocale();
      const n = Number(value);
      if (lang === "en" || typeof Intl === "undefined" || !Intl.RelativeTimeFormat) {
        if (unit === "now") return "just now";
        if (unit === "day" && n === 1) return "yesterday";
        return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
      }
      try {
        if (!this._rtf || this._rtfLang !== lang) {
          this._rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
          this._rtfLang = lang;
        }
        if (unit === "now") return this._rtf.format(0, "second");
        return this._rtf.format(-n, unit);
      } catch (_error) {
        return null;
      }
    }

    dayWithTime(offsetDays, time) {
      const lang = this.targetLocale();
      if (lang === "en" || typeof Intl === "undefined" || !Intl.RelativeTimeFormat) {
        return `${offsetDays === 0 ? "today" : "yesterday"} ${time}`;
      }
      const day = this.relativeLabel(offsetDays === 0 ? 0 : 1, "day");
      return day ? `${day} ${time}` : null;
    }

    monthDayLabel(date, withYear) {
      const lang = this.targetLocale();
      if (lang !== "en" && typeof Intl !== "undefined" && Intl.DateTimeFormat) {
        try {
          return new Intl.DateTimeFormat(lang, {
            month: "short",
            day: "numeric",
            ...(withYear ? { year: "numeric" } : {}),
          }).format(date);
        } catch (_error) {
        }
      }
      const label = `${MONTH_ABBR[date.getMonth()]} ${date.getDate()}`;
      return withYear ? `${label}, ${date.getFullYear()}` : label;
    }

    localizeRelativeTime(text) {
      const s = String(text || "").trim();
      if (!s || s.length > 12) return null;
      let m;
      if (/^(刚刚|刚才|现在|此刻)$/.test(s)) return this.relativeLabel(0, "now");
      if (/^昨天$/.test(s)) return this.relativeLabel(1, "day");
      if (/^前天$/.test(s)) return this.relativeLabel(2, "day");
      if ((m = s.match(/^(\d+)\s*秒(钟)?前$/))) return this.relativeLabel(m[1], "second");
      if ((m = s.match(/^(\d+)\s*分钟前$/))) return this.relativeLabel(m[1], "minute");
      if ((m = s.match(/^(\d+)\s*(个?小时)前$/))) return this.relativeLabel(m[1], "hour");
      if ((m = s.match(/^(\d+)\s*天前$/))) return this.relativeLabel(m[1], "day");
      if ((m = s.match(/^(\d+)\s*(周|星期|个星期)前$/))) return this.relativeLabel(m[1], "week");
      if ((m = s.match(/^(\d+)\s*个月前$/))) return this.relativeLabel(m[1], "month");
      if ((m = s.match(/^(\d+)\s*年前$/))) return this.relativeLabel(m[1], "year");
      if ((m = s.match(/^今天\s*(\d{1,2}:\d{2})$/))) return this.dayWithTime(0, m[1]);
      if ((m = s.match(/^昨天\s*(\d{1,2}:\d{2})$/))) return this.dayWithTime(1, m[1]);
      return null;
    }

    // loose: text found by scanning the page, not inside a time element, so "10.5" is not a date.
    formatRelativeTime(text, loose) {
      const s = String(text || "").trim();
      let date;
      let hasYear = false;
      const full = s.match(/^(\d{4})([-/.])(\d{1,2})\2(\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
      if (full) {
        if (loose && full[2] === ".") return null;
        hasYear = true;
        date = new Date(
          Number(full[1]), Number(full[3]) - 1, Number(full[4]),
          Number(full[5] || 0), Number(full[6] || 0), Number(full[7] || 0)
        );
        if (date.getMonth() !== Number(full[3]) - 1 || date.getDate() !== Number(full[4])) return null;
      } else {
        const short = s.match(/^(\d{1,2})([-/.])(\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
        if (!short) return null;
        if (loose && (short[2] === "." || short[1].length !== 2 || short[3].length !== 2)) return null;
        date = new Date(
          new Date().getFullYear(),
          Number(short[1]) - 1, Number(short[3]),
          Number(short[4] || 0), Number(short[5] || 0), Number(short[6] || 0)
        );
        if (date.getMonth() !== Number(short[1]) - 1 || date.getDate() !== Number(short[3])) return null;
      }
      if (isNaN(date.getTime())) return null;
      const diffMs = Date.now() - date.getTime();
      if (diffMs < 0) return null;
      const diffMinutes = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);
      if (diffDays >= 30) return this.monthDayLabel(date, hasYear);
      if (diffMinutes < 1) return this.relativeLabel(0, "now");
      if (diffMinutes < 60) return this.relativeLabel(diffMinutes, "minute");
      if (diffHours < 24) return this.relativeLabel(diffHours, "hour");
      if (diffDays < 7) return this.relativeLabel(diffDays, "day");
      return this.relativeLabel(Math.floor(diffDays / 7), "week");
    }

    processTimestampElement(element, loose) {
      if (!element || !element.isConnected) return;
      const text = String(element.textContent || "").trim();
      if (!text) return;
      if (!this.timestampState.has(element)) {
        this.timestampState.set(element, { original: text, applied: "", strict: !loose });
      }
      const state = this.timestampState.get(element);
      const lang = this.targetLocale();
      if (state.applied && text === state.applied && state.lang === lang) return;
      const sourceText = (state.applied && text === state.applied) ? state.original : text;
      if (sourceText !== state.applied) {
        state.original = sourceText;
      }
      const relative = this.formatRelativeTime(sourceText, loose && !state.strict);
      if (relative === null) return;
      state.lang = lang;
      if (state.applied === relative && text === state.applied) return;
      element.textContent = relative;
      state.applied = relative;
    }

    scanShadowRootTimestamps(root, depth) {
      if (!root || (depth || 0) > 5) return;
      try {
        root.querySelectorAll(TIME_CONTAINER_SELECTOR).forEach((el) => {
          this.processTimestampElement(el);
        });
      } catch (_error) {}
      try {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let textNode;
        while ((textNode = walker.nextNode())) {
          const text = String(textNode.nodeValue || "").trim();
          if (text.length < 5 || text.length > 30) continue;
          if (this.formatRelativeTime(text, true) === null) continue;
          const parent = textNode.parentElement;
          if (parent && parent.childElementCount === 0) {
            this.processTimestampElement(parent, true);
          }
        }
      } catch (_error) {}
      try {
        root.querySelectorAll("*").forEach((el) => {
          if (el.shadowRoot) this.scanShadowRootTimestamps(el.shadowRoot, (depth || 0) + 1);
        });
      } catch (_error) {}
    }

    scanTimestamps() {
      if (!this.canRun()) return;
      try {
        this.timestampState.forEach((state, el) => {
          if (el && el.isConnected) this.processTimestampElement(el, !state.strict);
        });
      } catch (_error) {}
      const now = Date.now();
      if (typeof document !== "undefined" && document.hidden) return;
      if (now - this.lastTimestampDiscovery < 1000) return;
      this.lastTimestampDiscovery = now;
      try {
        document.querySelectorAll(TIME_CONTAINER_SELECTOR).forEach((el) => {
          this.processTimestampElement(el);
        });
      } catch (_error) {}
      try {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let textNode;
        while ((textNode = walker.nextNode())) {
          const text = String(textNode.nodeValue || "").trim();
          if (text.length < 4 || text.length > 30) continue;
          if (this.formatRelativeTime(text, true) === null) continue;
          const parent = textNode.parentElement;
          if (!parent || parent.childElementCount > 0) continue;
          this.processTimestampElement(parent, true);
        }
      } catch (_error) {}
      try {
        const biliComments =
          document.getElementById("commentapp")?.querySelector("bili-comments") ||
          document.querySelector("bili-comments");
        if (biliComments?.shadowRoot) {
          this.scanShadowRootTimestamps(biliComments.shadowRoot);
        }
      } catch (_error) {}
    }

    getPriorityBucket(element) {
      const el = element?.nodeType === Node.ELEMENT_NODE ? element : element?.parentElement;
      if (!el || !el.getBoundingClientRect) return 0;
      if (this.isCreatorRoute() && this.matchesCreatorPriority(el)) return 3;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight || 0;
      const vw = window.innerWidth || document.documentElement.clientWidth || 0;
      if (vh <= 0 || vw <= 0) return 0;
      const isVisible = rect.bottom >= 0 && rect.top <= vh && rect.right >= 0 && rect.left <= vw;
      if (isVisible) return 2;
      const aheadPx = vh * (this._aheadViewports || 1);
      const near = rect.bottom >= -vh && rect.top <= vh + aheadPx;
      return near ? 1 : 0;
    }

    matchesCreatorPriority(element) {
      if (!element || !element.matches) return false;
      return CREATOR_PRIORITY_SELECTORS.some((selector) => {
        try {
          return !!(element.matches(selector) || element.closest(selector));
        } catch (_error) {
          return false;
        }
      });
    }

    groupJobsByAreaLanguage(jobs) {
      const grouped = new Map();
      jobs.forEach((job) => {
        const key = `${job.area}::${job.language}::${job.priority}::${job.titleCase ? 1 : 0}`;
        if (!grouped.has(key)) {
          grouped.set(key, {
            area: job.area,
            language: job.language,
            priority: job.priority || 0,
            titleCase: !!job.titleCase,
            jobs: [],
          });
        }
        grouped.get(key).jobs.push(job);
      });
      return Array.from(grouped.values()).sort((a, b) => {
        const priorityCmp = (b.priority || 0) - (a.priority || 0);
        if (priorityCmp !== 0) return priorityCmp;
        const ia = AREA_PRIORITY.indexOf(a.area);
        const ib = AREA_PRIORITY.indexOf(b.area);
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      });
    }

    async translateGroupedJobs(group, options, onPartial) {
      const uniqueTexts = [];
      const seen = new Set();
      group.jobs.forEach((job) => {
        if (seen.has(job.source)) return;
        seen.add(job.source);
        uniqueTexts.push(job.source);
      });
      if (!uniqueTexts.length) return new Map();
      const translated = await this.translationManager.translateMany(uniqueTexts, {
        ...options,
        priority: group.priority || 0,
        onPartial,
      });
      const bySource = new Map();
      uniqueTexts.forEach((source, index) => {
        const translation = translated[index]?.translation || null;
        bySource.set(source, translation);
      });
      return bySource;
    }

    applyTextResult(job, translated, final) {
      if (!this.running) return;
      const state = this.textState.get(job.node);
      if (!state || state.requestId !== job.requestId) return;
      state.inflightSig = "";
      // Players reuse elements (danmaku especially); never put an old line's translation on new text.
      const live = job.node.nodeValue || "";
      const showsSource = live.trim() === job.source ||
        (!!state.injectedValue && live === state.injectedValue && (state.original || "").trim() === job.source);
      if (!showsSource) return;
      if (translated) {
        this.applyTextMode(job.node, state, job.source, translated, job.mode);
        state.lastSource = job.source;
        state.lastLanguage = job.language;
        state.lastMode = job.mode;
        this.recordSpacingParent(job.node);
      } else if (final) {
        this.removeBilingualNode(state);
        if (state.applied && job.node.isConnected && job.node.nodeValue !== state.original) {
          job.node.nodeValue = state.original;
        }
        state.applied = false;
        state.injectedValue = "";
      }
    }

    applyAttrResult(job, translated, final) {
      if (!this.running) return;
      const bucket = this.attrState.get(job.element);
      if (!bucket || bucket.requestIds[job.attr] !== job.requestId) return;
      bucket.inflight[job.attr] = "";
      if (!job.element.isConnected) return;
      if (!translated) {
        if (final) {
          bucket.lastSource[job.attr] = job.source;
          bucket.lastLanguage[job.attr] = job.language;
        }
        return;
      }
      if (job.element.getAttribute(job.attr) !== translated) {
        job.element.setAttribute(job.attr, translated);
      }
      bucket.applied[job.attr] = translated;
      bucket.lastSource[job.attr] = job.source;
      bucket.lastLanguage[job.attr] = job.language;
    }

    // Attribute text rides along with visible text only while it fits in the same request; the
    // rest goes after all visible and nearby text.
    splitAttributeOverflow(groups) {
      const limit = typeof this.translationManager.batchItemLimit === "function" ? this.translationManager.batchItemLimit() : 25;
      const out = [];
      groups.forEach((group) => {
        const textSources = new Set(group.jobs.filter((job) => job.node).map((job) => job.source));
        const attrOnly = group.jobs.filter((job) => !job.node && !textSources.has(job.source));
        const attrSources = new Set(attrOnly.map((job) => job.source));
        if (!attrOnly.length || !textSources.size || textSources.size + attrSources.size <= limit) {
          out.push(group);
          return;
        }
        const moved = new Set(attrOnly);
        out.push({ ...group, jobs: group.jobs.filter((job) => !moved.has(job)) });
        out.push({ ...group, priority: (group.priority || 0) - 1.5, jobs: attrOnly, deferred: true });
      });
      return out;
    }

    async processQueuedTranslations() {
      if (!this.textJobs.length && !this.attrJobs.length) {
        return;
      }
      const jobs = this.textJobs.splice(0, this.textJobs.length).concat(this.attrJobs.splice(0, this.attrJobs.length));
      const danmaku = jobs.filter((job) => job.area === "danmaku");
      if (danmaku.length) this.queueDanmakuJobs(danmaku);
      await this.runJobs(danmaku.length ? jobs.filter((job) => job.area !== "danmaku") : jobs);
    }

    async runJobs(jobs) {
      if (!jobs.length) return;
      const apply = (job, translated, final) =>
        job.node ? this.applyTextResult(job, translated, final) : this.applyAttrResult(job, translated, final);

      const groups = this.splitAttributeOverflow(this.groupJobsByAreaLanguage(jobs));
      const runGroup = async (group) => {
        if (!this.canRun()) return;
        const jobsBySource = new Map();
        group.jobs.forEach((job) => {
          if (!jobsBySource.has(job.source)) jobsBySource.set(job.source, []);
          jobsBySource.get(job.source).push(job);
        });
        const map = await this.translateGroupedJobs(group, {
          targetLanguage: group.language,
          area: group.area,
          titleCase: group.titleCase,
        }, ({ source, translation }) => {
          if (translation) (jobsBySource.get(source) || []).forEach((job) => apply(job, translation, false));
        });
        if (!this.canRun()) return;
        group.jobs.forEach((job) => apply(job, map.get(job.source) || null, true));
      };
      try {
        await Promise.all(groups.filter((group) => !group.deferred).map(runGroup));
        await Promise.all(groups.filter((group) => group.deferred).map(runGroup));
        if (!this.canRun()) return;
        this.flushSiblingSpacing();
      } finally {
        jobs.forEach((job) => this.releaseJob(job));
      }
    }

    releaseJob(job) {
      if (job.node) {
        const state = this.textState.get(job.node);
        if (state && state.requestId === job.requestId && state.inflightSig) {
          state.inflightSig = "";
        }
        return;
      }
      const bucket = this.attrState.get(job.element);
      if (bucket && bucket.requestIds[job.attr] === job.requestId && bucket.inflight[job.attr]) {
        bucket.inflight[job.attr] = "";
      }
    }

    queueDanmakuJobs(jobs) {
      const now = Date.now();
      jobs.forEach((job) => {
        job.queuedAt = now;
        this.danmakuJobs.push(job);
      });
      this.pumpDanmaku();
    }

    pumpDanmaku() {
      if (this.danmakuBusy || this.danmakuTimer || !this.danmakuJobs.length) return;
      const wait = this.danmakuSentAt + DANMAKU_MIN_GAP_MS - Date.now();
      if (wait > 0) {
        this.danmakuTimer = setTimeout(() => {
          this.danmakuTimer = null;
          this.pumpDanmaku();
        }, wait);
        return;
      }
      const now = Date.now();
      const queued = this.danmakuJobs.splice(0, this.danmakuJobs.length);
      const live = queued.filter((job) =>
        now - job.queuedAt <= DANMAKU_MAX_WAIT_MS && (job.node || job.element).isConnected
      );
      const batch = live.slice(-DANMAKU_MAX_BATCH);
      const sent = new Set(batch);
      queued.forEach((job) => {
        if (!sent.has(job)) this.releaseJob(job);
      });
      if (!batch.length || !this.canRun()) {
        batch.forEach((job) => this.releaseJob(job));
        return;
      }
      this.danmakuSentAt = now;
      this.danmakuBusy = true;
      this.runJobs(batch)
        .catch((error) => console.warn("BTE danmaku translation failed:", error))
        .finally(() => {
          this.danmakuBusy = false;
          this.pumpDanmaku();
        });
    }

    isInlineJoinChar(char) {
      return /[A-Za-z0-9+#]/.test(char || "");
    }

    isMentionNode(node) {
      if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
      const text = (node.textContent || "").trim();
      if (!text) return false;
      if (text.startsWith("@") || text.startsWith("#")) return true;
      const cls = `${node.className || ""}`;
      return /jump-link|user-name|at-user|reply-at|topic|account/i.test(cls);
    }

    getHeadChar(node) {
      if (!node) return "";
      if (node.nodeType === Node.TEXT_NODE) {
        const value = (node.nodeValue || "").trimStart();
        return value.charAt(0);
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        const value = (node.textContent || "").trimStart();
        return value.charAt(0);
      }
      return "";
    }

    getTailChar(node) {
      if (!node) return "";
      if (node.nodeType === Node.TEXT_NODE) {
        const value = (node.nodeValue || "").trimEnd();
        return value.charAt(value.length - 1);
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        const value = (node.textContent || "").trimEnd();
        return value.charAt(value.length - 1);
      }
      return "";
    }

    // Text at the edge of a node that we replaced with a translation.
    translatedEdge(node, fromEnd) {
      let text = node;
      if (node && node.nodeType === Node.ELEMENT_NODE) {
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
          acceptNode: (n) => ((n.nodeValue || "").trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
        });
        text = fromEnd ? walker.lastChild() : walker.firstChild();
      }
      if (!text || text.nodeType !== Node.TEXT_NODE) return false;
      const state = this.textState.get(text);
      return !!(state && state.applied && (text.nodeValue || "").trim() !== (state.original || "").trim());
    }

    needsSiblingSpace(leftNode, rightNode) {
      // Only around our own text: never add spaces inside words the page split into pieces.
      if (!this.translatedEdge(leftNode, true) && !this.translatedEdge(rightNode, false)) return false;
      const tail = this.getTailChar(leftNode);
      const head = this.getHeadChar(rightNode);
      if (!tail || !head) return false;
      if (/\s/.test(tail) || /\s/.test(head)) return false;
      if (this.isMentionNode(leftNode) || this.isMentionNode(rightNode)) {
        if (/[)\]}>,.!?;:\u3001\uff0c\u3002\uff01\uff1f\uff1b\uff1a]/.test(head)) return false;
        if (/[([{<\uff08]/.test(tail)) return false;
        return true;
      }
      if (!this.isInlineJoinChar(tail) && !this.isInlineJoinChar(head)) return false;
      if (/[\u4e00-\u9fff]/.test(tail) && /[\u4e00-\u9fff]/.test(head)) return false;
      return true;
    }

    recordSpacingParent(node) {
      let el = node && node.parentElement;
      let depth = 0;
      while (el && depth < 4) {
        this.spacingParents.add(el);
        if (!INLINE_WRAP_TAGS.has(el.tagName)) break;
        el = el.parentElement;
        depth += 1;
      }
    }

    injectSpaceBetween(leftNode, rightNode) {
      if (!leftNode || !rightNode || !rightNode.parentNode) return;
      const spacer = document.createTextNode(" ");
      rightNode.parentNode.insertBefore(spacer, rightNode);
      this.spacingNodes.add(spacer);
    }

    enforceSiblingSpacing(parent) {
      if (!parent || !parent.isConnected || !parent.childNodes || parent.childNodes.length < 2) return;
      const nodes = Array.from(parent.childNodes);
      for (let i = 0; i < nodes.length - 1; i += 1) {
        const leftNode = nodes[i];
        const rightNode = nodes[i + 1];
        if (!leftNode || !rightNode) continue;
        if (this.spacingNodes.has(leftNode) || this.spacingNodes.has(rightNode)) continue;
        if (this.needsSiblingSpace(leftNode, rightNode)) {
          this.injectSpaceBetween(leftNode, rightNode);
        }
      }
    }

    flushSiblingSpacing(withForced = true) {
      this.spacingNodes.forEach((node) => {
        if (!node || !node.isConnected) {
          this.spacingNodes.delete(node);
        }
      });
      if (this.isCreatorRoute()) {
        this.spacingParents.clear();
        return;
      }
      this.spacingParents.forEach((parent) => {
        this.enforceSiblingSpacing(parent);
      });
      if (withForced) {
        try {
          document.querySelectorAll(FORCED_SPACING_SELECTORS.join(",")).forEach((parent) => {
            this.enforceSiblingSpacing(parent);
          });
        } catch (_error) {
        }
      }
      this.spacingParents.clear();
    }

    injectStyles() {
      if (this.stylesInjected) return;
      this.stylesInjected = true;
      const style = document.createElement("style");
      style.setAttribute("data-bte-owned", "1");
      style.textContent = `
        .bte-bilingual[data-bte-owned="1"], .bte-bilingual {
          opacity: 0.88;
          color: inherit;
        }
        .bte-stacked {
          display: block;
          font-size: 0.92em;
          line-height: 1.25;
          margin-top: 0.1em;
        }
        .bte-sideBySide {
          display: inline;
          font-size: 0.95em;
        }
        .bte-hover-tip {
          position: fixed; z-index: 2147483646; max-width: 320px; padding: 5px 9px;
          background: #23262e; color: #e6e9ef; border-radius: 6px; font: 13px/1.45 system-ui, sans-serif;
          box-shadow: 0 3px 10px rgba(0,0,0,.3); pointer-events: none; white-space: pre-wrap;
        }
        .bte-fit-wrap {
          white-space: normal !important;
          overflow-wrap: anywhere !important;
          text-overflow: clip !important;
        }
      `;
      (document.head || document.documentElement).appendChild(style);
    }
  }

  ROOT.DomTranslator = DomTranslator;
})();
