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

  // Pre-joined selector strings — avoids rebuilding on every node visit
  const TIME_CONTAINER_SELECTOR = TIME_CONTAINER_SELECTORS.join(",");
  const AREA_COMBINED_SELECTORS = {
    comments: AREA_SELECTORS.comments.join(","),
    dynamic: AREA_SELECTORS.dynamic.join(","),
    danmaku: AREA_SELECTORS.danmaku.join(","),
    captions: AREA_SELECTORS.captions.join(","),
  };
  const STRICT_ALLOWED_TAGS = new Set(["SPAN", "P", "A", "BUTTON", "LABEL", "H1", "H2", "H3", "LI", "DT", "DD"]);
  // Inline wrappers Bilibili uses to split one comment/line into many adjacent segments.
  // We climb through these to find the block container that holds the segments so spacing
  // can be enforced between them after translation.
  const INLINE_WRAP_TAGS = new Set(["SPAN", "A", "B", "I", "EM", "STRONG", "MARK", "FONT", "SMALL", "SUB", "SUP", "U", "BDI", "LABEL"]);

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
      this.observers = new Set();
      this.observedRoots = new WeakSet();
      // Far off-screen text is deferred until it nears the viewport.
      this.lazyObserver = null;
      this.lazyObserved = new WeakSet();
      this.pendingNodes = new Set();
      this.flushScheduled = false;
      this.flushInProgress = false;
      // Dispatch runs off the flush lock so new DOM isn't blocked by an in-flight round-trip.
      // Each dispatch takes a disjoint job snapshot, so overlap is safe.
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
      // Nodes per DOM pass, scaled by device tier and then tuned by _adaptFlushSize().
      const cores = (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4;
      this.maxNodesPerFlush = cores <= 2 ? 70 : cores <= 4 ? 140 : cores <= 8 ? 200 : 260;
      // Viewports of off-screen content to pre-translate. Shared by the priority buckets and the
      // lazy observer margin so they stay in sync.
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
      // Hover-to-translate (learning aid): translate just the Chinese text under the pointer.
      this.handleHover = this.handleHover.bind(this);
      this.hoverBound = false;
      this.hoverPending = new WeakSet();
      this.titleObserver = null;
      this.titleOriginal = "";
      this.titleInjected = "";
    }

    async initialize() {
      this.settings = await this.settingsManager.initialize();
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
      this.beginCreatorLayoutGate();
      // A TreeWalker never crosses shadow boundaries, so a plain body queue would leave shadow
      // content in the old language. On a language change, rescan every root explicitly.
      if (prevLanguage && prevLanguage !== this.settings.targetLanguage) {
        // Retranslate straight from each node's SAVED raw original (visible first), then do the
        // full rescan for shadow DOM / not-yet-seen content. This flips the on-screen text to the
        // new language almost immediately instead of waiting to re-walk and re-detect the page.
        this.retranslateFromSavedOriginals();
        this.queueFullRescan();
      } else {
        this.queueNode(document.body);
      }
    }

    // Re-translate from each node's saved raw original instead of re-walking the DOM and
    // re-detecting the old language. Visible text flips first.
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
          return; // already showing this source in the new language
        }
        state.inflightSig = "";
        if (language === "en") {
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

    // observeRoot won't re-queue an already-observed root, so queue each explicitly.
    queueFullRescan() {
      this.queueNode(document.body);
      try {
        document.querySelectorAll("*").forEach((el) => {
          if (el.shadowRoot) {
            this.observeRoot(el.shadowRoot);
            this.queueNode(el.shadowRoot);
          }
          if (el.tagName === "IFRAME") this.observeIFrame(el);
          if (el.tagName === "MICRO-APP") this.observeMicroApp(el);
        });
      } catch (_error) {
        /* querySelectorAll can throw on exotic documents — ignore */
      }
      this.observeMicroApps();
      try {
        const app = document.getElementById("commentapp");
        const biliComments =
          (app ? app.querySelector("bili-comments") : null) || document.querySelector("bili-comments");
        if (biliComments) this.queueNode(biliComments.shadowRoot || biliComments);
      } catch (_error) {
        /* comments component not present — ignore */
      }
    }

    isCreatorRoute() {
      const host = location.hostname || "";
      return host === "member.bilibili.com";
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
      // Kept in sync with the priority-bucket "near" threshold so a fired element is always
      // eligible and never re-deferred.
      const vh = window.innerHeight || 800;
      const aheadPx = Math.round(vh * this._aheadViewports);
      const rootMargin = `${Math.round(vh * 0.5)}px 0px ${aheadPx}px 0px`;
      this.lazyObserver = new IntersectionObserver(
        (entries) => {
          if (!this.canRun()) return;
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            this.lazyObserver.unobserve(entry.target);
            this.lazyObserved.delete(entry.target);
            this.queueNode(entry.target);
          });
        },
        { rootMargin }
      );
    }

    // Translated text runs longer than the Chinese it replaces, so a box sized for Chinese can
    // clip it. Measured per element (never a blanket restyle), batched into one rAF layout read.
    queueOverflowFit(element) {
      if (!element || element.nodeType !== Node.ELEMENT_NODE) return;
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
      el.classList.remove("bte-fit-wrap");
      // Opt-in: auto-restyling translated text made most of the page look worse.
      if (!this.settings?.learn?.fitText) return;
      // clientWidth 0 means it isn't laid out (hidden menu) — skip; it gets re-checked when shown.
      if (!el.clientWidth) return;
      if (el.scrollWidth <= el.clientWidth + 1) return;
      // Only relax elements the site itself truncates; visible overflow is left alone.
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
    }

    // Bound only while enabled, so there is no cost when the feature is off.
    syncHoverBinding() {
      const want = !!(this.settings && this.settings.learn && this.settings.learn.hoverTranslate);
      if (want && !this.hoverBound) {
        document.addEventListener("mouseover", this.handleHover, { passive: true, capture: true });
        this.hoverBound = true;
      } else if (!want && this.hoverBound) {
        document.removeEventListener("mouseover", this.handleHover, { capture: true });
        this.hoverBound = false;
      }
    }

    handleHover(event) {
      if (!this.canRun()) return;
      if (!this.settings?.learn?.hoverTranslate) return;
      const el = event.target;
      if (!el || el.nodeType !== Node.ELEMENT_NODE) return;
      if (this.hoverPending.has(el)) return;
      if (this.shouldSkipElement(el)) return;
      // Only leaf-ish elements, so we translate the phrase you're on and not a whole container.
      if (el.childElementCount > 0) return;
      const textNode = Array.from(el.childNodes).find(
        (n) => n.nodeType === Node.TEXT_NODE && /[一-鿿]/.test(n.nodeValue || "")
      );
      if (!textNode) return;
      const state = this.ensureTextState(textNode);
      // Already showing a translation for this text — nothing to do.
      if (state.applied && state.translation) return;
      this.hoverPending.add(el);
      this.processTextNode(textNode, { force: true });
      // processTextNode defers far off-screen text; a hovered element is by definition visible, so
      // dispatch immediately for an instant result.
      this.dispatchTranslations();
    }

    // Defer a far off-screen element: translate it only once it nears the viewport.
    observeLazy(element) {
      if (!this.lazyObserver || !element || element.nodeType !== Node.ELEMENT_NODE) return;
      if (this.lazyObserved.has(element)) return;
      this.lazyObserved.add(element);
      try {
        this.lazyObserver.observe(element);
      } catch (_error) {
        this.lazyObserved.delete(element);
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
      if (this.hoverBound) {
        document.removeEventListener("mouseover", this.handleHover, { capture: true });
        this.hoverBound = false;
      }
      this.hoverPending = new WeakSet();
      this.pendingNodes.clear();
      this.flushScheduled = false;
      this.dispatchPending = false;
      this.textJobs = [];
      this.attrJobs = [];
      if (this.commentPoll) {
        clearInterval(this.commentPoll);
        this.commentPoll = null;
      }
      if (this.rescanPoll) {
        clearInterval(this.rescanPoll);
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
        if (!this.canRun()) return;
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
        clearInterval(this.rescanPoll);
      }
      const intervalMs = this.isCreatorRoute() ? 1200 : 2800;
      this.rescanPoll = setInterval(() => {
        if (!this.canRun()) return;
        this.queueNode(document.body);
        this.observeMicroApps();
        const app = document.getElementById("commentapp");
        const biliComments = app ? app.querySelector("bili-comments") : null;
        if (biliComments) {
          this.queueNode(biliComments.shadowRoot || biliComments);
        }
        this.scanTimestamps();
      }, intervalMs);
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
        // Our own write — ignore to avoid infinite loop
        if (current === this.titleInjected) return;
        // Page changed the title (SPA navigation) — re-translate
        this.titleOriginal = current;
        this.titleInjected = "";
        this.translatePageTitle();
      });
      this.titleObserver.observe(titleEl, { childList: true, characterData: true, subtree: true });
    }

    translatePageTitle() {
      if (!this.canRun()) return;
      if (!this.settings?.areas?.page) return;
      // Capture original on first call
      if (!this.titleOriginal) {
        const current = document.title;
        if (!current || !current.trim()) return;
        this.titleOriginal = current;
      }
      const source = this.titleOriginal;
      if (!source || !source.trim()) return;
      // Already applied with current source
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
      const observer = new MutationObserver(this.handleMutations);
      observer.observe(root, OBSERVER_CONFIG);
      this.observers.add(observer);
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
        // Cross-origin iframe cannot be accessed directly from this frame.
        // We can expose a best-effort translated overlay label, but cannot inspect inner DOM.
        this.applyIframeOverlayFallback(iframe);
      }
    }

    ensureIFrameAllowTranslator(_iframe) {
      // 'translator' Permissions Policy is not supported in Chrome and logs
      // "Unrecognized feature" warnings. Intentional no-op.
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
      // Fast PC (flush < 30ms): increase batch for smoother, larger waves; slow PC (flush >
      // 100ms): reduce batch to protect responsiveness.
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
        for (let i = 0; i < limit; i += 1) {
          this.processNode(nodes[i]);
        }
        for (let i = limit; i < nodes.length; i += 1) {
          this.pendingNodes.add(nodes[i]);
        }
        this.cleanupCounter += 1;
        if (this.cleanupCounter % 20 === 0) {
          this.pruneStateMaps();
        }
      } finally {
        this.flushInProgress = false;
        this._adaptFlushSize(Date.now() - t0);
      }
      // Dispatch without holding the flush lock, so new DOM is scanned immediately instead of
      // waiting on the previous batch's round-trip.
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
          // Pick up anything that queued while dispatches were saturated / in flight.
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

    shouldSkipElement(element) {
      if (!element || element.nodeType !== Node.ELEMENT_NODE) return true;
      if (element.closest("[data-bte-owned='1']")) return true;
      if (SKIP_TAGS.has(element.tagName)) return true;
      if (element.isContentEditable || element.getAttribute("contenteditable") === "true") return true;
      if (this.shouldDelayMicroAreaElement(element)) return true;
      if (this.isTimeContainer(element)) return true;
      if (this.detectArea(element) === "captions") return true;
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
      if (element.closest(AREA_COMBINED_SELECTORS.comments)) return "comments";
      if (element.closest(AREA_COMBINED_SELECTORS.dynamic)) return "dynamic";
      if (element.closest(AREA_COMBINED_SELECTORS.danmaku)) return "danmaku";
      if (element.closest(AREA_COMBINED_SELECTORS.captions)) return "captions";
      return "page";
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
      try {
        return !!element.closest(TIME_CONTAINER_SELECTOR);
      } catch (_error) {
        return false;
      }
    }

    isTimeLikeText(text) {
      if (!text) return true;
      if (/^\s*[\d.,%]+\s*$/.test(text)) return true;
      return TIME_PATTERNS.some((pattern) => pattern.test(text));
    }

    shouldSkipText(text, parent) {
      const normalized = String(text || "").trim();
      if (!normalized) return true;
      if (this.isTimeLikeText(normalized)) return true;
      if (/^https?:\/\/\S+$/.test(normalized)) return true;
      if (/^[\p{P}\p{S}\s]+$/u.test(normalized)) return true;
      // No Chinese at all: the source is declared as Chinese, so sending Latin text would have it
      // "translated" from a language it isn't, producing nonsense. It is also a large share of the
      // page (usernames, counts, latin titles), so skipping it removes many pointless requests.
      if (!/[㐀-鿿぀-ヿ가-힯]/.test(normalized)) return true;
      // BV / AV ids are identifiers, never prose.
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
        // Preserve (or inject) surrounding whitespace so adjacent inline elements
        // — links, @-mentions, buttons inside comment text — stay word-separated.
        const origVal = state.original || "";
        let leadWs = origVal.match(/^(\s+)/)?.[1] ?? "";
        let trailWs = origVal.match(/(\s+)$/)?.[1] ?? "";
        // When the original CJK had no spaces (common), add one at element boundaries.
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
      // `force` (hover-to-translate) bypasses the per-area toggles — that is the point of the
      // mode. Captions stay excluded either way; CaptionManager owns those.
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
        // Keep source text.
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

      // Chinese relative timestamps are converted locally (instant, no engine request).
      if (language === "en") {
        const relative = this.localizeRelativeTime(source);
        if (relative) {
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

      // Far off-screen and uncached: defer the request until it nears the viewport.
      const priority = this.getPriorityBucket(node.parentElement);
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
      if (!this.canRun()) return;
      if (!element || element.nodeType !== Node.ELEMENT_NODE) return;
      if (!element.isConnected) return;
      // shouldSkipElement is checked first: owned/SKIP_TAG/contenteditable elements
      // exit before paying for detectArea's CSS closest() calls.
      // It also guards area === "captions" internally, so isAreaEnabled only needs
      // to check whether the surviving area is enabled.
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

        const signature = `${language}::${source}`;
        if (bucket.inflight[attr] === signature) return;
        bucket.requestIds[attr] = (bucket.requestIds[attr] || 0) + 1;
        bucket.inflight[attr] = signature;
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

    // Chinese relative timestamps are converted locally: instant, and avoids one request per
    // timestamp. English targets only.
    localizeRelativeTime(text) {
      const s = String(text || "").trim();
      if (!s || s.length > 12) return null;
      const plural = (n, unit) => `${n} ${unit}${n === "1" ? "" : "s"} ago`;
      let m;
      if (/^(刚刚|刚才|现在|此刻)$/.test(s)) return "just now";
      if (/^昨天$/.test(s)) return "yesterday";
      if (/^前天$/.test(s)) return "2 days ago";
      if ((m = s.match(/^(\d+)\s*秒(钟)?前$/))) return plural(m[1], "second");
      if ((m = s.match(/^(\d+)\s*分钟前$/))) return plural(m[1], "minute");
      if ((m = s.match(/^(\d+)\s*(个?小时)前$/))) return plural(m[1], "hour");
      if ((m = s.match(/^(\d+)\s*天前$/))) return plural(m[1], "day");
      if ((m = s.match(/^(\d+)\s*(周|星期|个星期)前$/))) return plural(m[1], "week");
      if ((m = s.match(/^(\d+)\s*个月前$/))) return plural(m[1], "month");
      if ((m = s.match(/^(\d+)\s*年前$/))) return plural(m[1], "year");
      if ((m = s.match(/^今天\s*(\d{1,2}:\d{2})$/))) return `today ${m[1]}`;
      if ((m = s.match(/^昨天\s*(\d{1,2}:\d{2})$/))) return `yesterday ${m[1]}`;
      return null;
    }

    formatRelativeTime(text) {
      const s = String(text || "").trim();
      let date;
      const full = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
      if (full) {
        date = new Date(
          Number(full[1]), Number(full[2]) - 1, Number(full[3]),
          Number(full[4] || 0), Number(full[5] || 0), Number(full[6] || 0)
        );
      } else {
        // MM-DD with no year → assume current year (e.g. "04-05")
        const short = s.match(/^(\d{1,2})[-/.](\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
        if (!short) return null;
        date = new Date(
          new Date().getFullYear(),
          Number(short[1]) - 1, Number(short[2]),
          Number(short[3] || 0), Number(short[4] || 0), Number(short[5] || 0)
        );
      }
      if (isNaN(date.getTime())) return null;
      const diffMs = Date.now() - date.getTime();
      if (diffMs < 0) return null;
      const diffMinutes = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);
      // Older than ~a month: don't leave the raw "2026-03-27 04:59" on screen — show a
      // clean English date. Keep the year only when the source actually had one.
      if (diffDays >= 30) {
        const label = `${MONTH_ABBR[date.getMonth()]} ${date.getDate()}`;
        return full ? `${label}, ${date.getFullYear()}` : label;
      }
      if (diffMinutes < 1) return "just now";
      if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes !== 1 ? "s" : ""} ago`;
      if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? "s" : ""} ago`;
      if (diffDays === 1) return "yesterday";
      if (diffDays < 7) return `${diffDays} days ago`;
      const weeks = Math.floor(diffDays / 7);
      return `${weeks} week${weeks !== 1 ? "s" : ""} ago`;
    }

    processTimestampElement(element) {
      if (!element || !element.isConnected) return;
      const text = String(element.textContent || "").trim();
      if (!text) return;
      if (!this.timestampState.has(element)) {
        this.timestampState.set(element, { original: text, applied: "" });
      }
      const state = this.timestampState.get(element);
      // If the element shows our previously applied label (e.g. "21 hours ago"),
      // compute relative time from the saved original date string, not the applied
      // text — otherwise formatRelativeTime returns null and we never update it.
      const sourceText = (state.applied && text === state.applied) ? state.original : text;
      if (sourceText !== state.applied) {
        state.original = sourceText;
      }
      const relative = this.formatRelativeTime(sourceText);
      if (relative === null) return;
      if (state.applied === relative && text === state.applied) return;
      element.textContent = relative;
      state.applied = relative;
    }

    scanShadowRootTimestamps(root, depth) {
      if (!root || (depth || 0) > 5) return;
      // Selector-based scan (catches known class names)
      try {
        root.querySelectorAll(TIME_CONTAINER_SELECTOR).forEach((el) => {
          this.processTimestampElement(el);
        });
      } catch (_error) {}
      // Text-based fallback: walk all text nodes, process leaf parents whose content
      // looks like a date/time. This handles unknown class names in shadow DOM.
      try {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let textNode;
        while ((textNode = walker.nextNode())) {
          const text = String(textNode.nodeValue || "").trim();
          if (text.length < 5 || text.length > 30) continue;
          if (this.formatRelativeTime(text) === null) continue;
          const parent = textNode.parentElement;
          if (parent && parent.childElementCount === 0) {
            this.processTimestampElement(parent);
          }
        }
      } catch (_error) {}
      // Recurse into nested shadow roots (e.g. bili-comment-renderer)
      try {
        root.querySelectorAll("*").forEach((el) => {
          if (el.shadowRoot) this.scanShadowRootTimestamps(el.shadowRoot, (depth || 0) + 1);
        });
      } catch (_error) {}
    }

    scanTimestamps() {
      if (!this.canRun()) return;
      // Re-process elements we've already applied to (handles "21h ago" → "22h ago" updates).
      // Cheap — only iterates the elements we already track — so it runs every tick.
      try {
        this.timestampState.forEach((_state, el) => {
          if (el && el.isConnected) this.processTimestampElement(el);
        });
      } catch (_error) {}
      // Discovery of NEW timestamp elements walks the whole document (+ shadow DOM) for
      // text nodes, which is expensive. The comment poll calls this every 250 ms, so
      // throttle the full scan to ~1 s; the cheap refresh above keeps applied labels live.
      const now = Date.now();
      if (now - this.lastTimestampDiscovery < 1000) return;
      this.lastTimestampDiscovery = now;
      // Regular document: selector-based scan
      try {
        document.querySelectorAll(TIME_CONTAINER_SELECTOR).forEach((el) => {
          this.processTimestampElement(el);
        });
      } catch (_error) {}
      // Text-based fallback: catch date strings (e.g. "04-10", "03-31 15:21",
      // "2026-04-21 01:30:00") that appear in elements not in our selector list.
      try {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let textNode;
        while ((textNode = walker.nextNode())) {
          const text = String(textNode.nodeValue || "").trim();
          if (text.length < 4 || text.length > 30) continue;
          if (this.formatRelativeTime(text) === null) continue;
          const parent = textNode.parentElement;
          if (!parent || parent.childElementCount > 0) continue;
          this.processTimestampElement(parent);
        }
      } catch (_error) {}
      // bili-comments shadow DOM: full scan including text-based fallback.
      // Try multiple locations since Bilibili occasionally moves the component.
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
      // "Near" = within N viewports of the fold (N scales with device speed). Content beyond
      // this is priority 0 → deferred and translated lazily as it approaches (see observeLazy).
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
        // Visibility first: whatever the viewer can actually see — the page structure/chrome on
        // load, then any on-screen content — translates before off-screen "near" content, no
        // matter which area it's in. This is what makes the visible page finish first instead of
        // waiting behind below-the-fold comments. Off-screen-far text isn't here at all (it's
        // deferred by the lazy observer until it approaches).
        const priorityCmp = (b.priority || 0) - (a.priority || 0);
        if (priorityCmp !== 0) return priorityCmp;
        // Within the same visibility bucket, keep the area ordering as a stable tiebreak.
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
        // Viewport bucket feeds the engine's paced scheduler; still below caption priority.
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

    async processQueuedTranslations() {
      if (!this.textJobs.length && !this.attrJobs.length) {
        return;
      }

      const textJobs = this.textJobs.splice(0, this.textJobs.length);
      const attrJobs = this.attrJobs.splice(0, this.attrJobs.length);

      try {
      if (textJobs.length) {
        const textGroups = this.groupJobsByAreaLanguage(textJobs);
        for (const group of textGroups) {
          if (!this.canRun()) return;
          const jobsBySource = new Map();
          group.jobs.forEach((job) => {
            if (!jobsBySource.has(job.source)) jobsBySource.set(job.source, []);
            jobsBySource.get(job.source).push(job);
          });
          const applyTextSource = (source, translated) => {
            const jobs = jobsBySource.get(source) || [];
            jobs.forEach((job) => {
              const state = this.textState.get(job.node);
              if (!state || state.requestId !== job.requestId) return;
              state.inflightSig = "";
              if (translated) {
                this.applyTextMode(job.node, state, job.source, translated, job.mode);
                state.lastSource = job.source;
                state.lastLanguage = job.language;
                state.lastMode = job.mode;
                this.recordSpacingParent(job.node);
              }
            });
          };
          const map = await this.translateGroupedJobs(group, {
            targetLanguage: group.language,
            area: group.area,
            titleCase: group.titleCase,
          }, ({ source, translation }) => {
            if (translation) {
              applyTextSource(source, translation);
            }
          });
          group.jobs.forEach((job) => {
            if (!this.canRun()) return;
            const state = this.textState.get(job.node);
            if (!state || state.requestId !== job.requestId) return;
            state.inflightSig = "";
            const translated = map.get(job.source) || null;
            if (translated) {
              this.applyTextMode(job.node, state, job.source, translated, job.mode);
              state.lastSource = job.source;
              state.lastLanguage = job.language;
              state.lastMode = job.mode;
              this.recordSpacingParent(job.node);
            } else {
              this.removeBilingualNode(state);
              if (state.applied && job.node.isConnected && job.node.nodeValue !== state.original) {
                job.node.nodeValue = state.original;
              }
              state.applied = false;
              state.injectedValue = "";
            }
          });
        }
      }

      if (attrJobs.length) {
        const attrGroups = this.groupJobsByAreaLanguage(attrJobs);
        for (const group of attrGroups) {
          if (!this.canRun()) return;
          const jobsBySource = new Map();
          group.jobs.forEach((job) => {
            if (!jobsBySource.has(job.source)) jobsBySource.set(job.source, []);
            jobsBySource.get(job.source).push(job);
          });
          const applyAttrSource = (source, translated) => {
            const jobs = jobsBySource.get(source) || [];
            jobs.forEach((job) => {
              const bucket = this.attrState.get(job.element);
              if (!bucket || bucket.requestIds[job.attr] !== job.requestId) return;
              bucket.inflight[job.attr] = "";
              if (!translated || !job.element.isConnected) return;
              if (job.element.getAttribute(job.attr) !== translated) {
                job.element.setAttribute(job.attr, translated);
              }
              bucket.applied[job.attr] = translated;
              bucket.lastSource[job.attr] = job.source;
              bucket.lastLanguage[job.attr] = job.language;
            });
          };
          const map = await this.translateGroupedJobs(group, {
            targetLanguage: group.language,
            area: group.area,
            titleCase: group.titleCase,
          }, ({ source, translation }) => {
            if (translation) {
              applyAttrSource(source, translation);
            }
          });
          group.jobs.forEach((job) => {
            if (!this.canRun()) return;
            const bucket = this.attrState.get(job.element);
            if (!bucket || bucket.requestIds[job.attr] !== job.requestId) return;
            bucket.inflight[job.attr] = "";
            if (!job.element.isConnected) return;
            const translated = map.get(job.source) || null;
            if (!translated) {
              bucket.lastSource[job.attr] = job.source;
              bucket.lastLanguage[job.attr] = job.language;
              return;
            }
            if (job.element.getAttribute(job.attr) !== translated) {
              job.element.setAttribute(job.attr, translated);
            }
            bucket.applied[job.attr] = translated;
            bucket.lastSource[job.attr] = job.source;
            bucket.lastLanguage[job.attr] = job.language;
          });
        }
      }
      this.flushSiblingSpacing();
      } finally {
        // If canRun() flipped false mid-flush, clear any still-set inflight markers so those
        // nodes re-queue instead of being skipped forever.
        textJobs.forEach((job) => {
          const state = this.textState.get(job.node);
          if (state && state.requestId === job.requestId && state.inflightSig) {
            state.inflightSig = "";
          }
        });
        attrJobs.forEach((job) => {
          const bucket = this.attrState.get(job.element);
          if (bucket && bucket.requestIds[job.attr] === job.requestId && bucket.inflight[job.attr]) {
            bucket.inflight[job.attr] = "";
          }
        });
      }
    }

    isInlineJoinChar(char) {
      return /[A-Za-z0-9+#]/.test(char || "");
    }

    // Bilibili renders @-mentions (and topic #tags) as separate clickable elements with
    // no surrounding whitespace, so after translation they sit flush against the text.
    // Detect them so we can insert a separating space for readability.
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

    needsSiblingSpace(leftNode, rightNode) {
      const tail = this.getTailChar(leftNode);
      const head = this.getHeadChar(rightNode);
      if (!tail || !head) return false;
      if (/\s/.test(tail) || /\s/.test(head)) return false;
      // Always separate an @-mention / #-topic chip from its neighbour (it's a distinct
      // clickable node), except when the neighbouring char is punctuation that should hug.
      if (this.isMentionNode(leftNode) || this.isMentionNode(rightNode)) {
        if (/[)\]}>,.!?;:\u3001\uff0c\u3002\uff01\uff1f\uff1b\uff1a]/.test(head)) return false;
        if (/[([{<\uff08]/.test(tail)) return false;
        return true;
      }
      if (!this.isInlineJoinChar(tail) && !this.isInlineJoinChar(head)) return false;
      if (/[\u4e00-\u9fff]/.test(tail) && /[\u4e00-\u9fff]/.test(head)) return false;
      return true;
    }

    // Record containers whose direct children may need a separating space after
    // translation. We add the text node's parent, then climb through inline wrappers
    // (span/a/b/…) to also reach the block container that holds sibling segments —
    // Bilibili splits one comment into many adjacent inline elements, and without this
    // their translated text runs together (e.g. "…Live Classes]Many students" or
    // "What I heard beforeOld HeI attended…"). We stop at the first block-level element
    // so we never space unrelated layout siblings.
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

    flushSiblingSpacing() {
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
      try {
        document.querySelectorAll(FORCED_SPACING_SELECTORS.join(",")).forEach((parent) => {
          this.enforceSiblingSpacing(parent);
        });
      } catch (_error) {
        // ignore selector issues
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
        /* ---- overflow fit (opt-in) --------------------------------------------------------
           Translated text runs wider than the Chinese it replaces, so a box sized for Chinese can
           clip it. An earlier version also shrank the font, which looked worse in most places, so
           this now ONLY relaxes the truncation on elements that are genuinely clipped — no font
           size, spacing or line-height changes anywhere. Off unless the user turns it on. */
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
