import { samplePlanet } from './planet.js';
import { sampleHydrology } from './hydrology.js';

export function createPlanetDynamics(world, living, waterCycle, rng = Math.random) {
  const random = typeof rng === 'function' ? rng : rng.float.bind(rng);
  const events = [];
  const geology = [];
  let time = 0;
  let geologyClock = 0;
  let narratorClock = 0;

  seedGeology();

  function step(dt) {
    time += dt;
    geologyClock += dt;
    narratorClock += dt;
    if (geologyClock >= 14) {
      geologyClock = 0;
      geologicalCycle();
    }
    if (narratorClock >= 20) {
      narratorClock = 0;
      narrateMeaningfulChange();
    }
  }

  function seedGeology() {
    for (let i = 0; i < 12; i++) {
      for (let tries = 0; tries < 100; tries++) {
        const x = random() * world.width;
        const y = random() * world.height;
        const p = samplePlanet(x, y, world.width, world.height);
        if (p.land && p.plateBoundary > 0.55) {
          geology.push({ x, y, type: p.convergence > 0 ? 'volcano' : 'fault', activity: random(), age: 0 });
          break;
        }
      }
    }
  }

  function geologicalCycle() {
    for (const site of geology) {
      site.age += 14;
      site.activity = clamp(site.activity + (random() - 0.48) * 0.18, 0, 1);
    }
    const active = geology.filter(g => g.activity > 0.76);
    if (!active.length) return;
    const site = active[Math.floor(random() * active.length)];
    if (site.type === 'volcano') {
      emit('Volcanic eruption', 'A plate-boundary volcano erupted, spreading ash and enriching nearby soils.', site);
      site.activity *= 0.35;
    } else {
      emit('Earthquake', 'A strong earthquake released accumulated stress along a tectonic fault.', site);
      if (samplePlanet(site.x, site.y, world.width, world.height).elevation < 0.56 && random() < 0.35) {
        emit('Tsunami', 'Seafloor movement generated a tsunami across the nearby ocean basin.', site);
      }
      site.activity *= 0.42;
    }
  }

  function getWeather() {
    if (!waterCycle) return [];
    return waterCycle.getCloudCells(28).map(cell => ({
      x: cell.x,
      y: cell.y,
      strength: clamp(cell.cloud, 0, 1),
      radius: 18 + cell.cloud * 55,
      type: cell.snow > cell.rain && cell.snow > 0.001
        ? 'snow'
        : cell.rain > 0.006 || cell.flood > 0.6
          ? 'storm'
          : cell.rain > 0.001
            ? 'rain'
            : 'cloud',
    }));
  }

  function narrateMeaningfulChange() {
    const c = world.ecs.components;
    const plants = [...c.resource.values()].filter(r => r.amount > 0).length;
    const animals = c.agent.size + c.predator.size + c.apex.size;
    const cells = waterCycle?.getCloudCells(80) || [];
    const flood = cells.find(cell => cell.flood > 0.68);
    const drought = cells.find(cell => cell.drought > 0.68);
    const storm = cells.find(cell => cell.rain > 0.006 && cell.cloud > 0.75);

    let message;
    let location = { x: world.width / 2, y: world.height / 2 };
    if (flood) {
      message = 'Saturated soils and sustained runoff are producing major flooding in a river basin.';
      location = flood;
    } else if (drought) {
      message = 'Low soil moisture and continued evaporation are intensifying a regional drought.';
      location = drought;
    } else if (storm) {
      message = 'Moisture transported from the ocean is condensing into a powerful storm system.';
      location = storm;
    } else if (plants > animals * 2) {
      message = 'Vegetation is expanding where recent rainfall has replenished soil moisture.';
    } else {
      message = 'Evaporation, clouds, rainfall, runoff, and river flow continue cycling water around the planet.';
    }
    emit('Planet narrator', message, location, true);
  }

  function inspect(x, y) {
    const p = living.sampleDynamicPlanet(x, y);
    const h = sampleHydrology(x, y, world.width, world.height);
    const w = waterCycle?.sample(x, y) || {};
    const nearbyGeology = nearest(geology, x, y, world.width);
    const counts = countNearbyLife(x, y, 90);
    const weather = w.snow > 0.001 ? 'Snow' : w.rain > 0.006 ? 'Storm' : w.rain > 0.001 ? 'Rain' : w.cloud > 0.3 ? 'Cloudy' : 'Clear';
    const water = w.flood > 0.55
      ? 'Flooded basin'
      : (w.lake ?? h.lake) > 0.25
        ? 'Lake basin'
        : (w.river ?? h.river) > 0.2
          ? 'Flowing river valley'
          : h.delta > 0.2
            ? 'Coastal delta'
            : 'No major surface water';

    return {
      x,
      y,
      title: regionName(x, y, p),
      biome: prettify(p.biome),
      elevation: Math.round((p.elevation - 0.53) * 6500),
      temperature: Math.round((p.temperature * 48 - 14) * 10) / 10,
      rainfall: Math.round((p.rainfall + (w.rain || 0) * 12) * 1800),
      water,
      weather,
      geology: nearbyGeology && distance(nearbyGeology, { x, y }, world.width) < 150 ? prettify(nearbyGeology.type) : 'Stable crust',
      counts,
      soilMoisture: Math.round((w.soil || 0) * 100),
      floodRisk: Math.round((w.flood || 0) * 100),
      droughtRisk: Math.round((w.drought || 0) * 100),
    };
  }

  function countNearbyLife(x, y, radius) {
    const c = world.ecs.components;
    const result = { plants: 0, grazers: 0, predators: 0, apex: 0 };
    for (const [id, pos] of c.position.entries()) {
      if (distance(pos, { x, y }, world.width) > radius) continue;
      if (c.resource.has(id) && c.resource.get(id).amount > 0) result.plants++;
      else if (c.agent.has(id)) result.grazers++;
      else if (c.predator.has(id)) result.predators++;
      else if (c.apex.has(id)) result.apex++;
    }
    return result;
  }

  function emit(title, description, location, narrator = false) {
    const event = { title, description, x: location.x, y: location.y, narrator, time };
    events.unshift(event);
    if (events.length > 30) events.length = 30;
    window.dispatchEvent(new CustomEvent('planet-event', { detail: event }));
  }

  return {
    step,
    inspect,
    getWeather,
    getGeology: () => geology,
    getEvents: () => events,
    getTime: () => time,
  };
}

function regionName(x, y, p) {
  const ns = y < 240 ? 'Northern' : y > 480 ? 'Southern' : 'Equatorial';
  const terrain = p.elevation > 0.76 ? 'Highlands' : p.rainfall > 0.65 ? 'Green Basin' : p.rainfall < 0.28 ? 'Drylands' : p.land ? 'Plains' : 'Ocean';
  return `${ns} ${terrain}`;
}

function nearest(items, x, y, width) {
  let best = null;
  let bestDistance = Infinity;
  for (const item of items) {
    const d = distance(item, { x, y }, width);
    if (d < bestDistance) { bestDistance = d; best = item; }
  }
  return best;
}

function distance(a, b, width) {
  let dx = Math.abs(a.x - b.x);
  dx = Math.min(dx, width - dx);
  return Math.hypot(dx, a.y - b.y);
}

const prettify = text => text.replaceAll('-', ' ').replace(/\b\w/g, c => c.toUpperCase());
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
