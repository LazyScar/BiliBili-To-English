(function () {
  const ROOT = (window.BTE = window.BTE || {});

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  ROOT.isExtensionAlive = function isExtensionAlive() {
    try {
      return !!(typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id);
    } catch (_error) {
      return false;
    }
  };

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

    jitter(engine) {
      if (!(engine.baseIntervalMs > 0) || engine.minIntervalMs <= engine.baseIntervalMs) return 0;
      return Math.random() * engine.minIntervalMs * 0.25;
    },

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

    maxConcurrent(engine) {
      if (engine.maxConcurrent > 0) return engine.maxConcurrent;
      return engine.consecutiveFailures > 0 ? 1 : 4;
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
          const capacity = this.maxConcurrent(engine);
          const captionPriority = (ROOT.SchedulePriority && ROOT.SchedulePriority.CAPTION) || 100;
          const limit =
            queue[best].priority >= captionPriority ? capacity : Math.max(1, capacity - 1);
          if ((engine._pqInFlight || 0) >= limit) break;

          const item = queue.splice(best, 1)[0];
          const elapsed = Date.now() - (engine.lastRequestAt || 0);
          let waitMs = Math.max(0, (engine.minIntervalMs || 0) - elapsed);
          waitMs += this.jitter(engine) || 0;
          if (waitMs > 0) await sleep(waitMs);
          engine.lastRequestAt = Date.now();
          engine._pqInFlight = (engine._pqInFlight || 0) + 1;
          Promise.resolve()
            .then(() => item.task())
            .then(item.resolve, item.reject)
            .then(() => {
              engine._pqInFlight -= 1;
              this._pump(engine);
            });
        }
      } finally {
        engine._pqPumping = false;
      }
    },
  };

  ROOT.RateGovernor = RateGovernor;
  ROOT.SchedulePriority = { CAPTION: 100, VISIBLE: 20, NEAR: 10, DEFAULT: 0 };
})();
