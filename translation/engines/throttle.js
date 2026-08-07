(function () {
  const ROOT = (window.BTE = window.BTE || {});

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // After an extension reload the already-injected scripts keep running but chrome.runtime.id
  // becomes undefined and sendMessage throws. Callers check this to fail fast and stay silent.
  ROOT.isExtensionAlive = function isExtensionAlive() {
    try {
      return !!(typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id);
    } catch (_error) {
      return false;
    }
  };

  // AIMD pacing: back off fast on a 429, recover one step per success so the rate settles just
  // under the provider's limit. While healthy, interval === baseIntervalMs and jitter is 0, so
  // there is no added latency.
  const RateGovernor = {
    rateLimited(engine) {
      engine.consecutiveFailures = Math.min((engine.consecutiveFailures || 0) + 1, 6);
      engine.minIntervalMs = Math.min(
        engine.maxIntervalMs,
        Math.max(engine.minIntervalMs * 2, engine.baseIntervalMs * 2)
      );
    },

    success(engine) {
      engine.consecutiveFailures = 0;
      if (engine.minIntervalMs > engine.baseIntervalMs) {
        const step = engine._recoveryStepMs || Math.max(20, Math.round(engine.baseIntervalMs * 0.5));
        engine.minIntervalMs = Math.max(engine.baseIntervalMs, engine.minIntervalMs - step);
      }
    },

    // De-synchronises bursts across frames/tabs, but only while recovering. Engines without
    // baseIntervalMs (fixed-pace, e.g. DeepL) always get 0 so their spacing is never perturbed.
    jitter(engine) {
      if (!(engine.baseIntervalMs > 0) || engine.minIntervalMs <= engine.baseIntervalMs) return 0;
      return Math.random() * engine.minIntervalMs * 0.25;
    },

    // One paced queue per engine. When the pacing gate opens the highest-priority task runs next
    // (captions before page text), FIFO among equal priorities. Pacing is unchanged — this only
    // decides who goes first when there is a backlog.
    schedule(engine, task, priority) {
      if (!engine._pq) engine._pq = [];
      return new Promise((resolve, reject) => {
        engine._pq.push({
          task,
          priority: Number(priority) || 0,
          seq: (engine._pqSeq = (engine._pqSeq || 0) + 1),
          resolve,
          reject,
        });
        this._pump(engine);
      });
    },

    async _pump(engine) {
      if (engine._pqPumping) return;
      engine._pqPumping = true;
      try {
        const queue = engine._pq;
        while (queue && queue.length) {
          let best = 0;
          for (let i = 1; i < queue.length; i += 1) {
            if (
              queue[i].priority > queue[best].priority ||
              (queue[i].priority === queue[best].priority && queue[i].seq < queue[best].seq)
            ) {
              best = i;
            }
          }
          const item = queue.splice(best, 1)[0];
          const elapsed = Date.now() - (engine.lastRequestAt || 0);
          let waitMs = Math.max(0, (engine.minIntervalMs || 0) - elapsed);
          waitMs += this.jitter(engine) || 0;
          if (waitMs > 0) await sleep(waitMs);
          engine.lastRequestAt = Date.now();
          try {
            item.resolve(await item.task());
          } catch (error) {
            item.reject(error);
          }
        }
      } finally {
        engine._pqPumping = false;
      }
    },
  };

  ROOT.RateGovernor = RateGovernor;
  ROOT.SchedulePriority = { CAPTION: 100, VISIBLE: 20, NEAR: 10, DEFAULT: 0 };
})();
