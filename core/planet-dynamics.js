import { samplePlanet } from './planet.js';
import { sampleHydrology } from './hydrology.js';

export function createPlanetDynamics(world, living) {
  const events = [];
  const weather = [];
  const geology = [];
  let time = 0;
  let weatherClock = 0;
  let geologyClock = 0;
  let narratorClock = 0;

  seedWeather();
  seedGeology();

  function step(dt) {
    time += dt;
    weatherClock += dt;
    geologyClock += dt;
    narratorClock += dt;
    updateWeather(dt);
    if (weatherClock >= 5) { weatherClock = 0; spawnWeather(); }
    if (geologyClock >= 14) { geologyClock = 0; geologicalCycle(); }
    if (narratorClock >= 20) { narratorClock = 0; narrateMeaningfulChange(); }
  }

  function seedWeather() {
    for (let i = 0; i < 14; i++) weather.push(makeWeather(Math.random() * world.width, Math.random() * world.height));
  }

  function seedGeology() {
    for (let i = 0; i < 12; i++) {
      for (let tries = 0; tries < 100; tries++) {
        const x = Math.random() * world.width;
        const y = Math.random() * world.height;
        const p = samplePlanet(x, y, world.width, world.height);
        if (p.land && p.plateBoundary > 0.55) {
          geology.push({ x, y, type: p.convergence > 0 ? 'volcano' : 'fault', activity: Math.random(), age: 0 });
          break;
        }
      }
    }
  }

  function makeWeather(x, y) {
    const p = samplePlanet(x, y, world.width, world.height);
    const cold = p.temperature < 0.3;
    return {
      x, y,
      vx: 5 + Math.random() * 10,
      vy: (Math.random() - 0.5) * 2.2,
      strength: 0.25 + Math.random() * 0.65,
      radius: 22 + Math.random() * 55,
      type: cold ? 'snow' : p.rainfall > 0.58 ? 'rain' : 'cloud',
      age: 0,
      life: 45 + Math.random() * 75,
    };
  }

  function updateWeather(dt) {
    for (const system of weather) {
      const latitudeFactor = Math.cos((system.y / world.height - 0.5) * Math.PI);
      system.x = wrap(system.x + system.vx * dt * (0.5 + latitudeFactor), world.width);
      system.y = clamp(system.y + system.vy * dt, 8, world.height - 8);
      system.age += dt;
      const p = living.sampleDynamicPlanet(system.x, system.y);
      if (p.temperature < 0.27) system.type = 'snow';
      else if (system.strength > 0.74 && p.rainfall > 0.5) system.type = 'storm';
      else if (p.rainfall > 0.52) system.type = 'rain';
      else system.type = 'cloud';
    }
    for (let i = weather.length - 1; i >= 0; i--) {
      if (weather[i].age > weather[i].life) weather.splice(i, 1);
    }
  }

  function spawnWeather() {
    while (weather.length < 18) weather.push(makeWeather(Math.random() * world.width, Math.random() * world.height));
    const storms = weather.filter(w => w.type === 'storm' && w.strength > 0.78);
    if (storms.length && Math.random() < 0.28) {
      const storm = storms[Math.floor(Math.random() * storms.length)];
      emit('Major storm', 'A powerful storm system is crossing the planet, bringing intense rain and lightning.', storm);
    }
  }

  function geologicalCycle() {
    for (const site of geology) {
      site.age += 14;
      site.activity = clamp(site.activity + (Math.random() - 0.48) * 0.18, 0, 1);
    }
    const active = geology.filter(g => g.activity > 0.76);
    if (!active.length) return;
    const site = active[Math.floor(Math.random() * active.length)];
    if (site.type === 'volcano') {
      emit('Volcanic eruption', 'A plate-boundary volcano erupted, spreading ash and enriching nearby soils.', site);
      site.activity *= 0.35;
    } else {
      emit('Earthquake', 'A strong earthquake released accumulated stress along a tectonic fault.', site);
      if (samplePlanet(site.x, site.y, world.width, world.height).elevation < 0.56 && Math.random() < 0.35) {
        emit('Tsunami', 'Seafloor movement generated a tsunami across the nearby ocean basin.', site);
      }
      site.activity *= 0.42;
    }
  }

  function narrateMeaningfulChange() {
    const c = world.ecs.components;
    const plants = [...c.resource.values()].filter(r => r.amount > 0).length;
    const animals = c.agent.size + c.predator.size + c.apex.size;
    const strongestStorm = weather.reduce((best, w) => !best || w.strength > best.strength ? w : best, null);
    let message;
    if (strongestStorm?.type === 'storm' && strongestStorm.strength > 0.8) message = 'A large storm is reorganizing rainfall across one of the major ocean basins.';
    else if (plants > animals * 2) message = 'Vegetation is expanding faster than animal populations, creating new ecological opportunities.';
    else if (animals > plants * 1.2) message = 'Animal pressure is rising while plant abundance falls, increasing competition for food.';
    else message = 'The planet is in a relatively stable interval, though climate and evolution continue to reshape its ecosystems.';
    emit('Planet narrator', message, strongestStorm || { x: world.width / 2, y: world.height / 2 }, true);
  }

  function inspect(x, y) {
    const p = living.sampleDynamicPlanet(x, y);
    const h = sampleHydrology(x, y, world.width, world.height);
    const nearbyWeather = nearest(weather, x, y, world.width);
    const nearbyGeology = nearest(geology, x, y, world.width);
    const counts = countNearbyLife(x, y, 90);
    return {
      x,
      y,
      title: regionName(x, y, p),
      biome: prettify(p.biome),
      elevation: Math.round((p.elevation - 0.53) * 6500),
      temperature: Math.round((p.temperature * 48 - 14) * 10) / 10,
      rainfall: Math.round(p.rainfall * 1800),
      water: h.lake > 0.2 ? 'Lake basin' : h.river > 0.2 ? 'River valley' : h.delta > 0.2 ? 'Coastal delta' : 'No major surface water',
      weather: nearbyWeather && distance(nearbyWeather, { x, y }, world.width) < nearbyWeather.radius * 1.8 ? prettify(nearbyWeather.type) : 'Clear',
      geology: nearbyGeology && distance(nearbyGeology, { x, y }, world.width) < 150 ? prettify(nearbyGeology.type) : 'Stable crust',
      counts,
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
    getWeather: () => weather,
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
const wrap = (v, max) => ((v % max) + max) % max;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
