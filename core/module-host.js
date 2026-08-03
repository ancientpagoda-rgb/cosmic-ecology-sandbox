export function createModuleHost(context = {}) {
  const modules = new Map();
  const capabilities = new Map();
  const ordered = [];
  let initialized = false;

  function register(module) {
    validateModule(module);
    if (modules.has(module.id)) throw new Error(`Module already registered: ${module.id}`);
    modules.set(module.id, module);
    initialized = false;
    return api;
  }

  async function initialize() {
    ordered.length = 0;
    ordered.push(...topologicalOrder([...modules.values()]));

    for (const module of ordered) {
      const moduleContext = {
        ...context,
        host: api,
        capabilities,
        requireCapability,
        provideCapability: (name, value) => provideCapability(module.id, name, value),
      };
      await module.initialize?.(moduleContext);
      for (const capability of module.provides || []) {
        if (!capabilities.has(capability)) {
          capabilities.set(capability, { provider: module.id, value: module });
        }
      }
    }
    initialized = true;
    return api;
  }

  function step(dt) {
    if (!initialized) return;
    for (const module of ordered) module.step?.(dt);
  }

  function render(frame) {
    if (!initialized) return;
    for (const module of ordered) module.render?.(frame);
  }

  function provideCapability(provider, name, value) {
    capabilities.set(name, { provider, value });
  }

  function requireCapability(name) {
    const entry = capabilities.get(name);
    if (!entry) throw new Error(`Missing simulation capability: ${name}`);
    return entry.value;
  }

  function getCapability(name) {
    return capabilities.get(name)?.value;
  }

  function getStatus() {
    return ordered.map(module => ({
      id: module.id,
      name: module.name,
      version: module.version || '0.0.0',
      execution: module.execution || 'browser',
      provides: module.provides || [],
      requires: module.requires || [],
      source: module.source || null,
      license: module.license || null,
    }));
  }

  function save() {
    const state = {};
    for (const module of ordered) {
      const value = module.save?.();
      if (value !== undefined) state[module.id] = value;
    }
    return state;
  }

  async function load(state = {}) {
    for (const module of ordered) {
      if (Object.hasOwn(state, module.id)) await module.load?.(state[module.id]);
    }
  }

  const api = { register, initialize, step, render, save, load, getCapability, requireCapability, getStatus };
  return api;
}

function validateModule(module) {
  if (!module || typeof module !== 'object') throw new TypeError('Simulation module must be an object.');
  if (!module.id || typeof module.id !== 'string') throw new TypeError('Simulation module requires a string id.');
  for (const field of ['provides', 'requires', 'after']) {
    if (module[field] !== undefined && !Array.isArray(module[field])) throw new TypeError(`${module.id}.${field} must be an array.`);
  }
}

function topologicalOrder(modules) {
  const byId = new Map(modules.map(module => [module.id, module]));
  const providers = new Map();
  for (const module of modules) for (const capability of module.provides || []) providers.set(capability, module.id);

  const visiting = new Set();
  const visited = new Set();
  const result = [];

  function visit(module) {
    if (visited.has(module.id)) return;
    if (visiting.has(module.id)) throw new Error(`Circular module dependency involving ${module.id}`);
    visiting.add(module.id);

    const dependencies = new Set(module.after || []);
    for (const capability of module.requires || []) {
      const provider = providers.get(capability);
      if (provider) dependencies.add(provider);
    }
    for (const dependency of dependencies) {
      const target = byId.get(dependency);
      if (target) visit(target);
    }

    visiting.delete(module.id);
    visited.add(module.id);
    result.push(module);
  }

  for (const module of modules) visit(module);
  return result;
}
