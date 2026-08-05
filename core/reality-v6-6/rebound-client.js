const STATE_STRIDE = 8;

function moduleUrl() {
  return new URL('./rebound-v6-6/rebound.js', document.baseURI).href;
}

export class ReboundWasmSystem {
  static async load() {
    if (!('WebAssembly' in globalThis)) throw new Error('This browser does not support WebAssembly.');
    const url = moduleUrl();
    const imported = await import(/* @vite-ignore */ url);
    const createModule = imported.default;
    if (typeof createModule !== 'function') throw new Error('The REBOUND module factory was not found.');
    const module = await createModule({
      locateFile(path) {
        return new URL(path, url).href;
      },
      print(message) {
        console.info(`[REBOUND] ${message}`);
      },
      printErr(message) {
        console.warn(`[REBOUND] ${message}`);
      },
    });
    return new ReboundWasmSystem(module);
  }

  constructor(module) {
    this.module = module;
    this.api = {
      init: module.cwrap('rs_init', 'number', ['number', 'number', 'number']),
      reset: module.cwrap('rs_reset', 'number', []),
      setIntegrator: module.cwrap('rs_set_integrator', 'number', ['number']),
      step: module.cwrap('rs_step', 'number', ['number']),
      spawnImpactor: module.cwrap('rs_spawn_impactor', 'number', []),
      writeState: module.cwrap('rs_write_state', 'number', []),
      stateBuffer: module.cwrap('rs_state_buffer', 'number', []),
      count: module.cwrap('rs_count', 'number', []),
      time: module.cwrap('rs_time', 'number', []),
      energyError: module.cwrap('rs_energy_error', 'number', []),
      impacts: module.cwrap('rs_impacts', 'number', []),
      impactEnergy: module.cwrap('rs_last_impact_energy', 'number', []),
      impactSpeed: module.cwrap('rs_last_impact_speed', 'number', []),
      impactTarget: module.cwrap('rs_last_impact_target', 'number', []),
      livingIndex: module.cwrap('rs_living_world_index', 'number', []),
      particleType: module.cwrap('rs_particle_type', 'number', ['number']),
      particleName: module.cwrap('rs_particle_name', 'string', ['number']),
      seed: module.cwrap('rs_system_seed', 'number', []),
    };
    this.metadata = [];
    this.lastImpactCount = 0;
    this.pendingImpactorDays = 0;
  }

  initialize({ seed = 1, planets = 6, asteroids = 48 } = {}) {
    const count = this.api.init(seed >>> 0, planets, asteroids);
    if (count <= 0) throw new Error('REBOUND could not initialize the generated system.');
    this.refreshMetadata();
    this.lastImpactCount = this.api.impacts();
    this.pendingImpactorDays = 0;
    return count;
  }

  refreshMetadata() {
    const count = this.api.count();
    this.metadata = Array.from({ length: count }, (_, index) => ({
      name: this.api.particleName(index) || `Body ${index + 1}`,
      type: this.api.particleType(index),
    }));
  }

  reset() {
    const count = this.api.reset();
    this.refreshMetadata();
    this.lastImpactCount = this.api.impacts();
    this.pendingImpactorDays = 0;
    return count;
  }

  setIntegrator(mode) {
    return this.api.setIntegrator(mode);
  }

  step(days) {
    if (!Number.isFinite(days) || days <= 0) return 0;
    if (this.pendingImpactorDays > 0) {
      const sharedDays = Math.min(days, this.pendingImpactorDays);
      const coupling = window.realityV65?.coupling;
      if (coupling) coupling.advanceDays(sharedDays);
      this.pendingImpactorDays = Math.max(0, this.pendingImpactorDays - sharedDays);
    }
    const before = this.api.count();
    const status = this.api.step(days);
    const after = this.api.count();
    if (after !== before) this.refreshMetadata();
    return status;
  }

  spawnImpactor() {
    const index = this.api.spawnImpactor();
    if (index >= 0) {
      this.pendingImpactorDays = 3;
      this.refreshMetadata();
    }
    return index;
  }

  snapshot() {
    const count = this.api.writeState();
    const pointer = this.api.stateBuffer();
    if (!pointer || count <= 0) return [];
    const heap = this.module.HEAPF64;
    if (!heap || typeof heap.subarray !== 'function') {
      throw new Error('The REBOUND Emscripten module did not export HEAPF64.');
    }
    const start = pointer >> 3;
    const raw = heap.subarray(start, start + count * STATE_STRIDE);
    const bodies = new Array(count);
    for (let index = 0; index < count; index += 1) {
      const offset = index * STATE_STRIDE;
      const metadata = this.metadata[index] || {
        name: this.api.particleName(index) || `Body ${index + 1}`,
        type: this.api.particleType(index),
      };
      bodies[index] = {
        index,
        ...metadata,
        x: raw[offset],
        y: raw[offset + 1],
        z: raw[offset + 2],
        vx: raw[offset + 3],
        vy: raw[offset + 4],
        vz: raw[offset + 5],
        mass: raw[offset + 6],
        radius: raw[offset + 7],
      };
    }
    return bodies;
  }

  stats() {
    const impacts = this.api.impacts();
    return {
      count: this.api.count(),
      timeDays: this.api.time(),
      energyError: this.api.energyError(),
      impacts,
      newImpacts: Math.max(0, impacts - this.lastImpactCount),
      impactEnergyJoules: this.api.impactEnergy(),
      impactSpeedMetersPerSecond: this.api.impactSpeed(),
      impactTargetType: this.api.impactTarget(),
      livingIndex: this.api.livingIndex(),
      seed: this.api.seed() >>> 0,
    };
  }

  acknowledgeImpacts() {
    this.lastImpactCount = this.api.impacts();
  }
}
