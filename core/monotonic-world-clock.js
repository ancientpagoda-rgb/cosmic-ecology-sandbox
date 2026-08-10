async function start() {
  try {
    await waitForSandboxReady();
    const planet = window.realitySandboxPlanet;
    if (!planet?.world) throw new Error('Living world did not become available.');

    const api = installMonotonicWorldClock(planet.world);
    planet.monotonicWorldClock = api;
    window.realitySandboxMonotonicWorldClock = api;
    window.dispatchEvent(new CustomEvent('eidolon-monotonic-world-clock-ready', {
      detail: api.getSnapshot(),
    }));
  } catch (error) {
    console.warn('[monotonic-world-clock] disabled:', error);
  }
}

function waitForSandboxReady() {
  const afterDom = document.readyState === 'loading'
    ? new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }))
    : Promise.resolve();

  return afterDom.then(async () => {
    const ready = window.realitySandboxReady;
    if (ready && typeof ready.then === 'function') {
      await ready;
      return;
    }
    if (window.realitySandboxPlanet?.world) return;
    await new Promise((resolve, reject) => {
      const started = performance.now();
      const poll = () => {
        if (window.realitySandboxPlanet?.world) {
          resolve();
          return;
        }
        if (performance.now() - started > 10000) {
          reject(new Error('Timed out waiting for the living world.'));
          return;
        }
        setTimeout(poll, 25);
      };
      poll();
    });
  });
}

export function installMonotonicWorldClock(world) {
  const descriptor = Object.getOwnPropertyDescriptor(world, 'tick');
  if (descriptor && descriptor.configurable === false) return emptyApi();
  if (world.__monotonicWorldClockInstalled) return world.__monotonicWorldClockInstalled;

  let tick = Math.max(0, finite(world.tick));
  let ecosystemEpoch = Math.max(0, Math.floor(finite(world.ecosystemEpoch)));
  let preventedRewinds = 0;
  let lastTransition = world.lastEcosystemReseed || null;

  Object.defineProperty(world, 'tick', {
    configurable: true,
    enumerable: true,
    get() {
      return tick;
    },
    set(value) {
      const next = Math.max(0, finite(value, tick));
      if (next < tick) {
        ecosystemEpoch += 1;
        preventedRewinds += 1;
        lastTransition = {
          epoch: ecosystemEpoch,
          planetaryTick: tick,
          attemptedTick: next,
          reason: 'ecosystem-reseed-without-time-reversal',
        };
        world.ecosystemEpoch = ecosystemEpoch;
        world.lastEcosystemReseed = { ...lastTransition };
        return;
      }
      tick = next;
    },
  });

  world.ecosystemEpoch = ecosystemEpoch;

  const api = {
    getSnapshot() {
      return {
        version: 2,
        model: 'monotonic-planetary-time-with-ecological-epochs',
        installed: true,
        tick,
        ecosystemEpoch,
        preventedRewinds,
        lastTransition: lastTransition ? { ...lastTransition } : null,
      };
    },
  };

  Object.defineProperty(world, '__monotonicWorldClockInstalled', {
    configurable: true,
    enumerable: false,
    writable: false,
    value: api,
  });

  return api;
}

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function emptyApi() {
  return {
    getSnapshot: () => ({
      version: 2,
      model: 'monotonic-planetary-time-with-ecological-epochs',
      disabled: true,
    }),
  };
}

if (typeof window !== 'undefined') start();
