import { samplePlanet } from './planet.js';
import { getHydrology } from './hydrology.js';

// Uses established open simulation ideas: semi-Lagrangian-style moisture
// transport and D8-style runoff routing. This implementation is original
// and dependency-free so it remains lightweight on mobile browsers.

export function createWaterCycle(world) {
  const hydro = getHydrology();
  const width = hydro.width;
  const height = hydro.height;
  const count = width * height;

  const vapor = new Float32Array(count);
  const cloud = new Float32Array(count);
  const rain = new Float32Array(count);
  const snow = new Float32Array(count);
  const soil = new Float32Array(count);
  const surface = new Float32Array(count);
  const runoff = new Float32Array(count);
  const flood = new Float32Array(count);
  const drought = new Float32Array(count);
  const nextVapor = new Float32Array(count);
  const nextCloud = new Float32Array(count);

  let time = 0;
  let eventClock = 0;

  initialize();

  function initialize() {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const p = samplePlanet(x + 0.5, y + 0.5, width, height);
        vapor[i] = p.land ? p.rainfall * 0.22 : 0.58 + p.temperature * 0.18;
        cloud[i] = Math.max(0, p.rainfall - 0.48) * 0.7;
        soil[i] = p.land ? p.rainfall * 0.48 : 0;
        surface[i] = hydro.lake[i] * 0.6;
      }
    }
  }

  function step(dt) {
    time += dt;
    eventClock += dt;
    advectAndEvaporate(dt);
    condenseAndPrecipitate(dt);
    routeWater(dt);
    updateExtremes(dt);
    if (eventClock >= 12) {
      eventClock = 0;
      emitMajorEvent();
    }
  }

  function advectAndEvaporate(dt) {
    nextVapor.fill(0);
    nextCloud.fill(0);
    for (let y = 0; y < height; y++) {
      const lat = Math.abs(y / (height - 1) - 0.5) * 2;
      const wind = (1.2 + Math.cos(lat * Math.PI) * 2.8) * dt;
      const vertical = Math.sin((y / height) * Math.PI * 3) * 0.18 * dt;
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const sx = wrap(Math.round(x - wind), width);
        const sy = clamp(Math.round(y - vertical), 0, height - 1);
        const si = sy * width + sx;
        const p = samplePlanet(x + 0.5, y + 0.5, width, height);
        const waterSource = !p.land ? 1 : hydro.lake[i] + surface[i] * 0.5;
        const evaporation = waterSource * (0.004 + p.temperature * 0.01) * dt;
        nextVapor[i] = clamp(vapor[si] * 0.994 + evaporation + soil[i] * p.temperature * 0.0008 * dt, 0, 1.5);
        nextCloud[i] = clamp(cloud[si] * 0.996, 0, 1.4);
      }
    }
    vapor.set(nextVapor);
    cloud.set(nextCloud);
  }

  function condenseAndPrecipitate(dt) {
    rain.fill(0);
    snow.fill(0);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const p = samplePlanet(x + 0.5, y + 0.5, width, height);
        const saturation = 0.28 + p.temperature * 0.54;
        const uplift = p.plateBoundary * 0.08 + Math.max(0, p.elevation - 0.62) * 0.6;
        const excess = Math.max(0, vapor[i] - saturation + uplift);
        const condensed = excess * 0.2 * dt;
        vapor[i] = Math.max(0, vapor[i] - condensed);
        cloud[i] = clamp(cloud[i] + condensed, 0, 1.4);

        if (cloud[i] > 0.46) {
          const amount = (cloud[i] - 0.46) * (0.055 + uplift * 0.1) * dt;
          cloud[i] = Math.max(0, cloud[i] - amount);
          if (p.temperature < 0.27) snow[i] = amount;
          else rain[i] = amount;
        }

        const melt = p.temperature > 0.32 ? snow[i] * p.temperature * 0.25 : 0;
        rain[i] += melt;
        snow[i] -= melt;
        if (p.land) {
          soil[i] = clamp(soil[i] + rain[i] * 0.7 - (0.0015 + p.temperature * 0.0025) * dt, 0, 1.2);
          surface[i] = clamp(surface[i] + rain[i] * 0.3 + snow[i] * 0.05, 0, 2);
        }
      }
    }
  }

  function routeWater(dt) {
    runoff.fill(0);
    const order = Array.from({ length: count }, (_, i) => i)
      .sort((a, b) => hydro.elevation[b] - hydro.elevation[a]);

    for (let i = 0; i < count; i++) {
      const saturationExcess = Math.max(0, soil[i] - 0.82) * 0.05 * dt;
      const flow = surface[i] * 0.08 * dt + saturationExcess;
      runoff[i] += flow;
      surface[i] = Math.max(0, surface[i] - flow);
    }

    for (const i of order) {
      const d = hydro.downstream[i];
      if (d >= 0) {
        const moved = runoff[i] * 0.92;
        runoff[d] += moved;
        runoff[i] -= moved;
      } else if (hydro.land[i]) {
        surface[i] = clamp(surface[i] + runoff[i] * 0.45, 0, 2);
      }
    }
  }

  function updateExtremes(dt) {
    for (let i = 0; i < count; i++) {
      const wetness = soil[i] + surface[i] * 0.5 + runoff[i] * 0.08;
      flood[i] = clamp(flood[i] * Math.pow(0.985, dt) + Math.max(0, wetness - 0.92) * 0.08, 0, 1);
      drought[i] = clamp(drought[i] * Math.pow(0.99, dt) + Math.max(0, 0.25 - soil[i]) * 0.04, 0, 1);
    }
  }

  function emitMajorEvent() {
    let wettest = 0;
    let driest = 0;
    for (let i = 1; i < count; i++) {
      if (flood[i] > flood[wettest]) wettest = i;
      if (drought[i] > drought[driest]) driest = i;
    }
    if (flood[wettest] > 0.72) emit('Major flood', 'Heavy precipitation and saturated soils caused widespread flooding.', wettest);
    else if (drought[driest] > 0.72) emit('Severe drought', 'Persistent moisture loss has reduced soil water and river flow.', driest);
  }

  function emit(title, description, index) {
    const x = (index % width + 0.5) / width * world.width;
    const y = (Math.floor(index / width) + 0.5) / height * world.height;
    window.dispatchEvent(new CustomEvent('water-cycle-event', { detail: { title, description, x, y, time } }));
  }

  function sample(x, y) {
    const gx = wrap(Math.floor(x / world.width * width), width);
    const gy = clamp(Math.floor(y / world.height * height), 0, height - 1);
    const i = gy * width + gx;
    return {
      vapor: vapor[i], cloud: cloud[i], rain: rain[i], snow: snow[i],
      soil: soil[i], surface: surface[i], runoff: runoff[i], flood: flood[i], drought: drought[i],
      river: clamp(hydro.river[i] + runoff[i] * 0.05, 0, 1),
      lake: clamp(hydro.lake[i] + surface[i] * 0.22, 0, 1),
    };
  }

  function getCloudCells(limit = 240) {
    const cells = [];
    for (let i = 0; i < count; i++) {
      if (cloud[i] < 0.22) continue;
      cells.push({
        x: (i % width + 0.5) / width * world.width,
        y: (Math.floor(i / width) + 0.5) / height * world.height,
        cloud: cloud[i], rain: rain[i], snow: snow[i], flood: flood[i], drought: drought[i],
      });
    }
    cells.sort((a, b) => b.cloud - a.cloud);
    return cells.slice(0, limit);
  }

  return { step, sample, getCloudCells, getTime: () => time };
}

const wrap = (v, max) => ((v % max) + max) % max;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
