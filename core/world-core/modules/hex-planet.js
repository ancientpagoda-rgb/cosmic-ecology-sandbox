export function createHexPlanetModule(hexGrid, octree, options = {}) {
  const seaLevel = options.seaLevel ?? 0.46;
  const rainfall = options.rainfall ?? 0.58;
  const temperature = options.temperature ?? 0.62;
  let initialized = false;
  let settlements = [];
  let roads = [];

  return {
    id: 'world.hex-planet',
    initialize(world) {
      if (initialized) return;
      initialized = true;
      for (const cell of hexGrid.cells) {
        const [x,y,z] = cell.position;
        const latitude = Math.asin(y);
        const terrain = fractal(x * 2.4, y * 2.4, z * 2.4, world.seed);
        const ridge = Math.abs(fractal(x * 5 + 7, y * 5 - 4, z * 5 + 2, `${world.seed}:ridge`) - 0.5);
        cell.elevation = clamp(terrain * 0.75 + ridge * 0.42, 0, 1);
        cell.temperature = clamp(temperature - Math.abs(latitude) / Math.PI * 0.95 - Math.max(0, cell.elevation - 0.58) * 0.55, 0, 1);
        cell.moisture = clamp(rainfall * (0.5 + fractal(x * 4, y * 4, z * 4, `${world.seed}:rain`) * 0.75), 0, 1);
        cell.water = cell.elevation < seaLevel ? 1 : 0;
        cell.flow = 0;
        cell.vegetation = 0;
        cell.soil = clamp(0.25 + fractal(x * 8, y * 8, z * 8, `${world.seed}:soil`) * 0.65, 0, 1);
        cell.resources = clamp(fractal(x * 11, y * 11, z * 11, `${world.seed}:ore`), 0, 1);
        cell.fire = 0;
        cell.settlementId = null;
        const entity = world.createEntity('hex-cell', {
          cellId: cell.id,
          position: cell.position,
          sides: cell.sides,
        }, `hex-${cell.id}`);
        cell.entityId = entity.id;
      }
      world.history.record({ type: 'hex-planet-created', time: 0, title: `${hexGrid.cells.length} geodesic world cells initialized` });
    },
    step(years, world) {
      const waterDelta = new Float32Array(hexGrid.cells.length);
      const moistureDelta = new Float32Array(hexGrid.cells.length);
      const vegetationDelta = new Float32Array(hexGrid.cells.length);

      for (const cell of hexGrid.cells) {
        if (cell.elevation < seaLevel) {
          cell.water = 1;
          cell.moisture = 1;
          continue;
        }
        const rain = rainfall * (0.35 + cell.moisture * 0.65) * years * 0.004;
        cell.water += rain;
        let target = null;
        let targetHeight = cell.elevation + cell.water;
        for (const neighborId of cell.neighbors) {
          const neighbor = hexGrid.cells[neighborId];
          const height = neighbor.elevation + neighbor.water * 0.25;
          if (height < targetHeight) { target = neighbor; targetHeight = height; }
          moistureDelta[neighborId] += (cell.moisture - neighbor.moisture) * 0.002 * years;
        }
        if (target) {
          const moved = Math.min(cell.water, Math.max(0, (cell.elevation + cell.water - targetHeight) * 0.3));
          waterDelta[cell.id] -= moved;
          waterDelta[target.id] += moved;
          cell.flow = cell.flow * 0.78 + moved;
          cell.elevation = Math.max(0, cell.elevation - moved * 0.0005 * years);
          target.soil = clamp(target.soil + moved * 0.001 * years, 0, 1);
        } else {
          cell.flow *= 0.8;
        }

        const suitability = clamp(cell.moisture * cell.temperature * cell.soil * (1 - Math.min(1, cell.water)), 0, 1);
        vegetationDelta[cell.id] += suitability * (1 - cell.vegetation) * 0.01 * years;
        if (cell.moisture < 0.2 || cell.temperature < 0.15) vegetationDelta[cell.id] -= 0.005 * years;
        const ignition = cell.vegetation * Math.max(0, 0.28 - cell.moisture) * Math.max(0, cell.temperature - 0.48) * 0.02 * years;
        if (world.rng.chance(ignition)) cell.fire = 1;
        if (cell.fire > 0.05) {
          vegetationDelta[cell.id] -= cell.fire * 0.08 * years;
          for (const neighborId of cell.neighbors) {
            const neighbor = hexGrid.cells[neighborId];
            if (world.rng.chance(cell.fire * neighbor.vegetation * 0.08)) neighbor.fire = Math.max(neighbor.fire, 0.65);
          }
          cell.fire *= 0.35;
        }
      }

      for (const cell of hexGrid.cells) {
        cell.water = clamp(cell.water + waterDelta[cell.id], 0, 1.5);
        cell.moisture = clamp(cell.moisture + moistureDelta[cell.id] + cell.water * 0.01 * years - cell.vegetation * 0.002 * years, 0, 1);
        cell.vegetation = clamp(cell.vegetation + vegetationDelta[cell.id], 0, 1);
      }

      updateSettlements(hexGrid, settlements, roads, world, years, seaLevel);
      rebuildRoads(hexGrid, settlements, roads);
    },
    save() {
      return { initialized, settlements, roads };
    },
    load(state) {
      if (!state) return;
      initialized = Boolean(state.initialized);
      settlements = state.settlements || [];
      roads = state.roads || [];
    },
    getSettlements: () => settlements,
    getRoads: () => roads,
    getSeaLevel: () => seaLevel,
    inspectCell(id) {
      const cell = hexGrid.cells[id];
      if (!cell) return null;
      const nearby = octree.querySphere(cell.position, 0.2);
      return { ...cell, nearbyCount: nearby.length };
    },
  };
}

function updateSettlements(grid, settlements, roads, world, years, seaLevel) {
  if (world.getTimeYears() > 1200 && settlements.length < 18 && world.rng.chance(0.05 * years / 20)) {
    let best = null;
    for (let attempt = 0; attempt < 100; attempt++) {
      const cell = grid.cells[world.rng.int(grid.cells.length)];
      if (cell.elevation < seaLevel || cell.settlementId) continue;
      const riverAccess = cell.flow + cell.neighbors.reduce((sum,id)=>sum+grid.cells[id].flow,0) / cell.neighbors.length;
      const score = riverAccess * 1.8 + cell.moisture + cell.soil + cell.resources * 0.7 + cell.vegetation * 0.4 - cell.fire;
      if (!best || score > best.score) best = { cell, score };
    }
    if (best?.score > 1.5) {
      const entity = world.createEntity('settlement', { cellId: best.cell.id, population: 40 });
      const settlement = { id: entity.id, cellId: best.cell.id, population: 40 + world.rng.int(80), wealth: 10, alive: true };
      settlements.push(settlement);
      best.cell.settlementId = settlement.id;
      world.history.record({ type: 'city-founded', time: world.getTimeYears(), title: `Settlement founded in cell ${best.cell.id}`, entities: [settlement.id, best.cell.entityId] });
    }
  }

  for (const settlement of settlements) {
    if (!settlement.alive) continue;
    const cell = grid.cells[settlement.cellId];
    const trade = roads.filter(road => road.aId === settlement.id || road.bId === settlement.id).length;
    const food = cell.vegetation * 0.6 + cell.soil * 0.7 + cell.moisture * 0.6 + Math.min(1, cell.flow * 3);
    const carrying = 60 + food * 850 + cell.resources * 300 + trade * 130;
    const stress = cell.fire * 1.4 + Math.max(0, cell.water - 0.65) + Math.max(0, 0.14 - cell.moisture);
    settlement.population = Math.max(0, settlement.population + settlement.population * (0.0016 * (1 - settlement.population / carrying) - stress * 0.001) * years);
    settlement.wealth = clamp(settlement.wealth + (trade * 0.1 + cell.resources * 0.15 - stress * 0.25) * years, 0, 1000);
    if (settlement.population < 8) {
      settlement.alive = false;
      cell.settlementId = null;
      world.history.record({ type: 'city-collapse', time: world.getTimeYears(), title: `${settlement.id} collapses`, entities: [settlement.id, cell.entityId] });
    }
  }
}

function rebuildRoads(grid, settlements, roads) {
  const active = settlements.filter(item => item.alive);
  const next = new Map();
  for (const settlement of active) {
    const nearest = active.filter(other => other !== settlement).sort((a,b)=>graphDistance(grid,a.cellId,b.cellId)-graphDistance(grid,a.cellId,b.cellId)).slice(0,2);
    for (const other of nearest) {
      const key = [settlement.id, other.id].sort().join('|');
      next.set(key, { id:key, aId:settlement.id, bId:other.id, path:shortestPath(grid, settlement.cellId, other.cellId) });
    }
  }
  roads.splice(0, roads.length, ...next.values());
}

function shortestPath(grid, start, goal) {
  const queue = [start];
  const cameFrom = new Map([[start, null]]);
  while (queue.length) {
    const current = queue.shift();
    if (current === goal) break;
    for (const neighbor of grid.cells[current].neighbors) {
      if (cameFrom.has(neighbor)) continue;
      cameFrom.set(neighbor, current);
      queue.push(neighbor);
    }
  }
  if (!cameFrom.has(goal)) return [];
  const path = [];
  let current = goal;
  while (current !== null) { path.push(current); current = cameFrom.get(current); }
  return path.reverse();
}
function graphDistance(grid,a,b){ return Math.acos(clamp(dot(grid.cells[a].position,grid.cells[b].position),-1,1)); }
function dot(a,b){ return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
function fractal(x,y,z,seed){ let value=0,amp=.5,freq=1; for(let i=0;i<4;i++){value+=noise(x*freq,y*freq,z*freq,`${seed}:${i}`)*amp;freq*=2;amp*=.5;} return value; }
function noise(x,y,z,seed){ let h=2166136261; const text=`${seed}:${Math.floor(x*997)}:${Math.floor(y*991)}:${Math.floor(z*983)}`; for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619); return (h>>>0)/4294967295; }
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
