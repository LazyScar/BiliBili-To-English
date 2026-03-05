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

  // Pre-joined selector strings — avoids rebuilding on every node visit
  const TIME_CONTAINER_SELECTOR = TIME_CONTAINER_SELECTORS.join(",");
  const AREA_COMBINED_SELECTORS = {
    comments: AREA_SELECTORS.comments.join(","),
    dynamic: AREA_SELECTORS.dynamic.join(","),
    danmaku: AREA_SELECTORS.danmaku.join(","),
    captions: AREA_SELECTORS.captions.join(","),
  };
  const STRICT_ALLOWED_TAGS = new Set(["SPAN", "P", "A", "BUTTON", "LABEL", "H1", "H2", "H3", "LI", "DT", "DD"]);

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
      this.pendingNodes = new Set();
      this.flushScheduled = false;
      this.flushInProgress = false;
      this.textJobs = [];
      this.attrJobs = [];
      this.textState = new Map();
      this.attrState = new Map();
      this.commentPoll = null;
      this.rescanPoll = null;
      this.stylesInjected = false;
      this.maxNodesPerFlush = 140;
      this.cleanupCounter = 0;
      this.spacingNodes = new Set();
      this.spacingParents = new Set();
      this.iframeOverlays = new Map();
      this.creatorLayoutReady = true;
      this.creatorGateTimer = null;
      this.creatorMutationCounter = 0;
      this.creatorGateLastCounter = 0;
      this.creatorStableTicks = 0;
      this.creatorGateStartedAt = 0;
      this.creatorGateUrl = "";
      this.handleMutations = this.handleMutations.bind(this);
      this.titleObserver = null;
      this.titleOriginal = "";
      this.titleInjected = "";
    }

    async initialize() {
      this.settings = await this.settingsManager.initialize();
      this.injectStyles();
    }

    updateSettings(nextSettings) {
      this.settings = nextSettings;
      if (!this.settings.enabled || this.isRouteExcluded()) {
        this.stop({ restore: true });
        return;
      }
      if (!this.running) {
        this.start();
        return;
      }
      this.beginCreatorLayoutGate();
      this.queueNode(document.body);
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

    stop(options) {
      const restore = !!options?.restore;
      this.running = false;
      this.observers.forEach((observer) => observer.disconnect());
      this.observers.clear();
      this.observedRoots = new WeakSet();
      this.pendingNodes.clear();
      this.flushScheduled = false;
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

    ensureIFrameAllowTranslator(iframe) {
      try {
        const current = String(iframe.getAttribute("allow") || "");
        if (/translator/i.test(current)) return;
        const next = current ? `${current}; translator` : "translator";
        iframe.setAttribute("allow", next);
      } catch (_error) {
        // ignore
      }
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

    async flush() {
      if (!this.canRun()) return;
      if (this.flushInProgress) {
        this.scheduleFlush();
        return;
      }
      this.flushInProgress = true;
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
        await this.processQueuedTranslations();
        this.cleanupCounter += 1;
        if (this.cleanupCounter % 20 === 0) {
          this.pruneStateMaps();
        }
      } finally {
        this.flushInProgress = false;
      }
      if (this.pendingNodes.size || this.textJobs.length || this.attrJobs.length) {
        this.scheduleFlush();
      }
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
      if (/^[\p{P}\p{S}\s]+$/u.test(normalized)) return true;
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

    applyTextMode(node, state, original, translated, mode) {
      if (mode === "off") {
        this.removeBilingualNode(state);
        node.nodeValue = translated;
        state.injectedValue = translated;
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
          extraNode.textContent = translated;
        } else {
          extraNode.textContent = ` | ${translated}`;
        }
        state.extraNode = extraNode;
        state.injectedValue = mode === "stacked" ? `${original}\n${translated}` : `${original} | ${translated}`;
      }
      state.translation = translated;
      state.original = original;
      state.applied = true;
      state.inflightSig = "";
      this.textState.set(node, state);
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

    processTextNode(node) {
      if (!this.canRun()) return;
      if (!node || node.nodeType !== Node.TEXT_NODE || !node.parentElement) return;
      if (!node.isConnected) return;
      if (this.shouldSkipElement(node.parentElement)) return;
      const area = this.detectArea(node.parentElement);
      if (!this.isAreaEnabled(area) || area === "captions") return;
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
        if (node.parentElement) {
          this.spacingParents.add(node.parentElement);
        }
        return;
      }
      if (quick.fromCache && !quick.translation) {
        this.removeBilingualNode(state);
        if (state.applied && node.isConnected) {
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

      if (
        state.lastSource === source &&
        state.lastLanguage === language &&
        state.lastMode === mode &&
        this.isStateApplied(node, state, mode)
      ) {
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
        priority: this.getPriorityBucket(node.parentElement),
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

        const quick = this.translationManager.peekCached(source, {
          targetLanguage: language,
          area,
          titleCase,
        });
        if (quick.translation) {
          element.setAttribute(attr, quick.translation);
          bucket.applied[attr] = quick.translation;
          bucket.inflight[attr] = "";
          return;
        }
        if (quick.fromCache && !quick.translation) {
          bucket.inflight[attr] = "";
          if (bucket.applied[attr]) {
            element.setAttribute(attr, source);
            bucket.applied[attr] = "";
          }
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
      const near = rect.bottom >= -vh && rect.top <= vh * 2;
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
        const ia = AREA_PRIORITY.indexOf(a.area);
        const ib = AREA_PRIORITY.indexOf(b.area);
        const areaCmp = (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
        if (areaCmp !== 0) return areaCmp;
        return (b.priority || 0) - (a.priority || 0);
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
                if (job.node.parentElement) {
                  this.spacingParents.add(job.node.parentElement);
                }
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
              if (job.node.parentElement) {
                this.spacingParents.add(job.node.parentElement);
              }
            } else {
              this.removeBilingualNode(state);
              if (state.applied && job.node.isConnected) {
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
              job.element.setAttribute(job.attr, translated);
              bucket.applied[job.attr] = translated;
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
            const translated = map.get(job.source) || null;
            if (!translated || !job.element.isConnected) return;
            job.element.setAttribute(job.attr, translated);
            bucket.applied[job.attr] = translated;
          });
        }
      }
      this.flushSiblingSpacing();
    }

    isInlineJoinChar(char) {
      return /[A-Za-z0-9+#]/.test(char || "");
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
      if (!this.isInlineJoinChar(tail) && !this.isInlineJoinChar(head)) return false;
      if (/[\u4e00-\u9fff]/.test(tail) && /[\u4e00-\u9fff]/.test(head)) return false;
      return true;
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
      `;
      (document.head || document.documentElement).appendChild(style);
    }
  }

  ROOT.DomTranslator = DomTranslator;
})();
