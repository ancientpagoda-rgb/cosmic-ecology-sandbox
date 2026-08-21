import { clamp, pickBestHarborSettlementId, wrapPosition } from './utils.js';

export function createSettlement(ecs, tile, options = {}) {
  const id = ecs.createEntity();
  const x = Number.isFinite(options.x) ? options.x : tile.x;
  const y = Number.isFinite(options.y) ? options.y : tile.y;
  ecs.components.position.set(id, { x, y, tileId: tile.id });
  ecs.components.settlement.set(id, {
    name: options.name || `Settlement ${id}`,
    kind: options.kind || (tile.harborQuality > 0.62 ? 'port' : 'hamlet'),
    factionId: options.factionId ?? null,
    population: Math.max(40, Math.round(options.population || 80)),
    households: Math.max(10, Math.round((options.population || 80) / 4)),
    labor: Math.max(20, Math.round((options.population || 80) * 0.38)),
    foodStored: options.foodStored ?? 140,
    timberStored: options.timberStored ?? 60,
    oreStored: options.oreStored ?? 18,
    coinStored: options.coinStored ?? 45,
    foodProduction: 0,
    craftProduction: 0,
    tradeValue: 0,
    wallLevel: options.wallLevel ?? 0,
    harborLevel: options.harborLevel ?? (tile.harborQuality > 0.62 ? 1 : 0),
    marketLevel: options.marketLevel ?? 0,
    garrison: options.garrison ?? 8,
    fear: 0,
    unrest: 0,
    prosperity: 0.42,
    loyalty: 0.55,
  });
  ecs.components.memory.set(id, {
    raidMemory: 0,
    hungerMemory: 0,
    tradeMemory: 0,
  });
  return id;
}

export function createFaction(ecs, options = {}) {
  const id = ecs.createEntity();
  ecs.components.faction.set(id, {
    name: options.name || `Faction ${id}`,
    capitalSettlementId: options.capitalSettlementId ?? null,
    treasury: options.treasury ?? 180,
    authority: options.authority ?? 0.4,
    cohesion: options.cohesion ?? 0.5,
    navalCapacity: options.navalCapacity ?? 0.25,
    militaryCapacity: options.militaryCapacity ?? 0.35,
    taxRate: options.taxRate ?? 0.08,
    patrolBudget: options.patrolBudget ?? 0.18,
    raidTolerance: options.raidTolerance ?? 0.25,
    buildBias: options.buildBias ?? 0.5,
  });
  return id;
}

export function createRoute(ecs, options = {}) {
  const id = ecs.createEntity();
  ecs.components.route.set(id, {
    kind: options.kind || 'road',
    fromSettlementId: options.fromSettlementId,
    toSettlementId: options.toSettlementId,
    distance: options.distance ?? 120,
    capacity: options.capacity ?? 0.25,
    danger: options.danger ?? 0.1,
    patrolCoverage: options.patrolCoverage ?? 0.2,
    chokepointScore: options.chokepointScore ?? 0.2,
    activeTrade: [],
  });
  return id;
}

export function createMobileUnit(ecs, options = {}) {
  const id = ecs.createEntity();
  const start = wrapPosition(options.position || { x: 0, y: 0 }, options.worldWidth || 1200, options.worldHeight || 720);
  ecs.components.position.set(id, { x: start.x, y: start.y, tileId: options.tileId ?? null });
  ecs.components.velocity.set(id, { vx: 0, vy: 0 });
  ecs.components.mobileUnit.set(id, {
    kind: options.kind || 'caravan',
    factionId: options.factionId ?? null,
    homeSettlementId: options.homeSettlementId ?? null,
    targetId: options.targetId ?? null,
    routeId: options.routeId ?? null,
    state: options.state || 'idle',
    crew: options.crew ?? 10,
    strength: options.strength ?? 10,
    speed: options.speed ?? 0.8,
    morale: options.morale ?? 0.6,
    progress: options.progress ?? 0,
  });
  ecs.components.cargo.set(id, {
    goods: { ...(options.goods || {}) },
    maxCapacity: options.maxCapacity ?? 80,
  });
  return id;
}

export function createSite(ecs, tile, options = {}) {
  const id = ecs.createEntity();
  ecs.components.position.set(id, { x: tile.x, y: tile.y, tileId: tile.id });
  ecs.components.site.set(id, {
    kind: options.kind || 'watchtower',
    factionId: options.factionId ?? null,
    settlementId: options.settlementId ?? null,
    level: options.level ?? 1,
    garrison: options.garrison ?? 4,
    upkeep: options.upkeep ?? 2,
    controlRadius: options.controlRadius ?? 90,
    hidden: options.hidden ?? false,
  });
  return id;
}

export function seedFrontierWorld(world, options = {}) {
  const ecs = world.ecs;
  const coastline = options.coastline || [
    { id: 'north-harbor', x: world.width * 0.24, y: world.height * 0.28, harborQuality: 0.82, fertility: 0.56, fish: 0.74, timber: 0.38, ore: 0.18, chokepointScore: 0.44 },
    { id: 'estuary-town', x: world.width * 0.52, y: world.height * 0.42, harborQuality: 0.7, fertility: 0.68, fish: 0.62, timber: 0.48, ore: 0.22, chokepointScore: 0.71 },
    { id: 'island-roadstead', x: world.width * 0.78, y: world.height * 0.35, harborQuality: 0.88, fertility: 0.32, fish: 0.81, timber: 0.15, ore: 0.08, chokepointScore: 0.84 },
    { id: 'inland-grain', x: world.width * 0.42, y: world.height * 0.62, harborQuality: 0.14, fertility: 0.86, fish: 0.04, timber: 0.52, ore: 0.24, chokepointScore: 0.22 },
  ];
  world.mapFeatures = {
    regions: [
      {
        id: 'marcher-coast',
        label: 'Marcher Coast',
        kind: 'coast',
        x: world.width * 0.18,
        y: world.height * 0.18,
        width: world.width * 0.42,
        height: world.height * 0.34,
        rotation: -0.18,
      },
      {
        id: 'estuary-basin',
        label: 'Estuary Basin',
        kind: 'river-basin',
        x: world.width * 0.36,
        y: world.height * 0.34,
        width: world.width * 0.34,
        height: world.height * 0.28,
        rotation: 0.06,
      },
      {
        id: 'blackwater-isle',
        label: 'Blackwater Isle',
        kind: 'island',
        x: world.width * 0.7,
        y: world.height * 0.22,
        width: world.width * 0.18,
        height: world.height * 0.16,
        rotation: 0.22,
      },
      {
        id: 'grainwatch-interior',
        label: 'Grainwatch Interior',
        kind: 'plain',
        x: world.width * 0.24,
        y: world.height * 0.48,
        width: world.width * 0.36,
        height: world.height * 0.3,
        rotation: -0.08,
      },
    ],
    notes: [
      { x: world.width * 0.61, y: world.height * 0.3, text: 'Piracy corridor' },
      { x: world.width * 0.37, y: world.height * 0.51, text: 'Grain routes' },
      { x: world.width * 0.46, y: world.height * 0.26, text: 'Fortified estuary' },
    ],
  };

  const marcherFactionId = createFaction(ecs, { name: 'Marcher League', treasury: 260, cohesion: 0.62, navalCapacity: 0.38, militaryCapacity: 0.44 });
  const isleFactionId = createFaction(ecs, { name: 'Isle Freeholds', treasury: 170, cohesion: 0.45, navalCapacity: 0.46, militaryCapacity: 0.28 });

  const northHarborId = createSettlement(ecs, coastline[0], { name: 'North Harbor', kind: 'port', factionId: marcherFactionId, population: 180, harborLevel: 2, marketLevel: 1 });
  const estuaryTownId = createSettlement(ecs, coastline[1], { name: 'Estuary Town', kind: 'town', factionId: marcherFactionId, population: 220, wallLevel: 1, marketLevel: 2 });
  const islandPortId = createSettlement(ecs, coastline[2], { name: 'Blackwater Cay', kind: 'port', factionId: isleFactionId, population: 130, harborLevel: 2, marketLevel: 1 });
  const inlandId = createSettlement(ecs, coastline[3], { name: 'Grainwatch', kind: 'village', factionId: marcherFactionId, population: 160, wallLevel: 1 });

  ecs.components.faction.get(marcherFactionId).capitalSettlementId = estuaryTownId;
  ecs.components.faction.get(isleFactionId).capitalSettlementId = islandPortId;

  createRoute(ecs, { kind: 'seaLane', fromSettlementId: northHarborId, toSettlementId: estuaryTownId, distance: 180, capacity: 0.64, danger: 0.24, patrolCoverage: 0.42, chokepointScore: 0.4 });
  createRoute(ecs, { kind: 'seaLane', fromSettlementId: estuaryTownId, toSettlementId: islandPortId, distance: 230, capacity: 0.82, danger: 0.48, patrolCoverage: 0.2, chokepointScore: 0.88 });
  createRoute(ecs, { kind: 'road', fromSettlementId: estuaryTownId, toSettlementId: inlandId, distance: 140, capacity: 0.55, danger: 0.16, patrolCoverage: 0.34, chokepointScore: 0.18 });

  createSite(ecs, coastline[1], { kind: 'fort', factionId: marcherFactionId, settlementId: estuaryTownId, level: 1, garrison: 18, controlRadius: 110 });
  createSite(ecs, { ...coastline[2], x: coastline[2].x + 38, y: coastline[2].y + 26 }, { kind: 'raiderCove', factionId: null, settlementId: islandPortId, level: 1, garrison: 12, controlRadius: 90, hidden: true });

  createMobileUnit(ecs, {
    kind: 'merchantShip',
    factionId: marcherFactionId,
    homeSettlementId: estuaryTownId,
    targetId: islandPortId,
    routeId: [...ecs.components.route.keys()].find(id => ecs.components.route.get(id).kind === 'seaLane' && ecs.components.route.get(id).toSettlementId === islandPortId),
    state: 'trading',
    crew: 18,
    strength: 10,
    speed: 1.15,
    morale: 0.74,
    goods: { grain: 36, tools: 18 },
    maxCapacity: 90,
    position: { x: coastline[1].x, y: coastline[1].y },
    worldWidth: world.width,
    worldHeight: world.height,
  });

  createMobileUnit(ecs, {
    kind: 'patrolShip',
    factionId: marcherFactionId,
    homeSettlementId: northHarborId,
    targetId: estuaryTownId,
    routeId: [...ecs.components.route.keys()].find(id => ecs.components.route.get(id).kind === 'seaLane' && ecs.components.route.get(id).fromSettlementId === northHarborId),
    state: 'patrolling',
    crew: 24,
    strength: 16,
    speed: 1.05,
    morale: 0.8,
    maxCapacity: 20,
    position: { x: coastline[0].x, y: coastline[0].y },
    worldWidth: world.width,
    worldHeight: world.height,
  });

  const coveSite = [...ecs.components.site.entries()].find(([, site]) => site.kind === 'raiderCove');
  if (coveSite) {
    const [coveId, cove] = coveSite;
    const covePos = ecs.components.position.get(coveId);
    createMobileUnit(ecs, {
      kind: 'raiderShip',
      factionId: null,
      homeSettlementId: cove.settlementId ?? pickBestHarborSettlementId(ecs),
      targetId: estuaryTownId,
      state: 'raiding',
      crew: 16,
      strength: 18,
      speed: 1.2,
      morale: 0.7,
      goods: {},
      maxCapacity: 70,
      position: { x: covePos.x, y: covePos.y },
      worldWidth: world.width,
      worldHeight: world.height,
    });
  }

  for (const settlement of ecs.components.settlement.values()) {
    settlement.foodProduction = clamp(settlement.population * 0.05, 6, 28);
    settlement.craftProduction = clamp(settlement.population * 0.018, 2, 14);
  }

  return {
    marcherFactionId,
    isleFactionId,
    northHarborId,
    estuaryTownId,
    islandPortId,
    inlandId,
  };
}
