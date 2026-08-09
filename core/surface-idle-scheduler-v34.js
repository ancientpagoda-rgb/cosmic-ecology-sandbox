// Interaction-aware idle scheduler for Surface Mode tile work.
// Loaded before the terrain streamer so its requestIdleCallback calls inherit
// a near-first / distant-later policy without changing the proven renderer.
(() => {
  if (window.realitySandboxSurfaceIdleSchedulerV34?.installed) return;
  const nativeRic = typeof window.requestIdleCallback === 'function'
    ? window.requestIdleCallback.bind(window)
    : null;
  const nativeCic = typeof window.cancelIdleCallback === 'function'
    ? window.cancelIdleCallback.bind(window)
    : null;
  const pending = new Map();
  let nextId = -1;
  let lastInteraction = -Infinity;
  let scheduledPump = 0;
  const stats = {
    highPriorityRequests: 0,
    deferredRequests: 0,
    deferredRuns: 0,
    deferredCancels: 0,
    interactionDeferrals: 0,
    maxPending: 0,
  };

  const markInteraction = () => { lastInteraction = performance.now(); };
  for (const type of ['pointermove', 'pointerdown', 'wheel', 'keydown', 'touchstart', 'touchmove']) {
    window.addEventListener(type, markInteraction, { passive: true, capture: true });
  }

  function makeDeadline(start, budget = 5) {
    return {
      didTimeout: false,
      timeRemaining: () => Math.max(0, budget - (performance.now() - start)),
    };
  }

  function scheduleNative(fn, timeout) {
    if (nativeRic) return nativeRic(fn, { timeout });
    return setTimeout(() => {
      const start = performance.now();
      fn(makeDeadline(start, 4));
    }, 0);
  }

  function cancelNative(id) {
    if (nativeCic) nativeCic(id);
    else clearTimeout(id);
  }

  function pump() {
    scheduledPump = 0;
    if (!pending.size) return;
    const now = performance.now();
    const quietFor = now - lastInteraction;
    const due = [...pending.values()].sort((a, b) => a.createdAt - b.createdAt);
    const item = due.find(entry => quietFor >= 115 || now >= entry.deadlineAt);
    if (!item) {
      stats.interactionDeferrals++;
      scheduledPump = setTimeout(pump, 45);
      return;
    }
    pending.delete(item.id);
    stats.deferredRuns++;
    scheduleNative(deadline => item.callback(deadline), Math.max(40, item.deadlineAt - now));
    if (pending.size) scheduledPump = setTimeout(pump, 0);
  }

  window.requestIdleCallback = function prioritizedSurfaceIdle(callback, options = {}) {
    const timeout = Number(options?.timeout) || 0;
    const surfaceActive = document.documentElement.dataset.surfaceMode === 'active';
    if (!surfaceActive || timeout < 150) {
      if (surfaceActive && timeout > 0 && timeout <= 110) stats.highPriorityRequests++;
      return scheduleNative(callback, timeout || 100);
    }

    const id = nextId--;
    const now = performance.now();
    pending.set(id, {
      id,
      callback,
      createdAt: now,
      deadlineAt: now + Math.max(160, timeout || 220),
    });
    stats.deferredRequests++;
    stats.maxPending = Math.max(stats.maxPending, pending.size);
    if (!scheduledPump) scheduledPump = setTimeout(pump, 0);
    return id;
  };

  window.cancelIdleCallback = function cancelPrioritizedSurfaceIdle(id) {
    if (pending.delete(id)) {
      stats.deferredCancels++;
      return;
    }
    cancelNative(id);
  };

  const api = {
    installed: true,
    getStats: () => ({
      ...stats,
      pending: pending.size,
      millisecondsSinceInteraction: performance.now() - lastInteraction,
      policy: 'near-first-interaction-debounced-distant',
    }),
  };
  window.realitySandboxSurfaceIdleSchedulerV34 = api;
  document.documentElement.dataset.surfaceIdleSchedulerV34 = 'near-first-interaction-debounced-distant';

  const prev = window.realitySandboxPresentationDiagnostics;
  window.realitySandboxPresentationDiagnostics = () => ({
    ...(typeof prev === 'function' ? prev() : {}),
    surfaceIdleSchedulerV34: api.getStats(),
  });
})();

