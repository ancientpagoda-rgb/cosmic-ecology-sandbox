import { samplePlanet } from './planet.js';

const GRID_W = 180;
const GRID_H = 90;
let cached = null;

export function getHydrology() {
  if (!cached) cached = buildHydrology(GRID_W, GRID_H);
  return cached;
}

export function sampleHydrology(x, y, width, height) {
  const hydro = getHydrology();
  const gx = wrap(Math.floor((x / width) * hydro.width), hydro.width);
  const gy = clamp(Math.floor((y / height) * hydro.height), 0, hydro.height - 1);
  const i = gy * hydro.width + gx;
  return {
    flow: hydro.flow[i],
    river: hydro.river[i],
    lake: hydro.lake[i],
    delta: hydro.delta[i],
    erosion: hydro.erosion[i],
  };
}

export function buildHydrology(width = GRID_W, height = GRID_H) {
  const count = width * height;
  const elevation = new Float32Array(count);
  const rainfall = new Float32Array(count);
  const land = new Uint8Array(count);
  const downstream = new Int32Array(count);
  downstream.fill(-1);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const s = samplePlanet(x + 0.5, y + 0.5, width, height);
      elevation[i] = s.elevation;
      rainfall[i] = s.rainfall;
      land[i] = s.land ? 1 : 0;
    }
  }

  // Route every land cell to its steepest neighboring descent. Small
  // deterministic jitter prevents broad plateaus from becoming motionless.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!land[i]) continue;
      let best = i;
      let bestHeight = elevation[i] + jitter(x, y) * 0.0015;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          const nx = wrap(x + ox, width);
          const ny = clamp(y + oy, 0, height - 1);
          const ni = ny * width + nx;
          const h = elevation[ni] + jitter(nx, ny) * 0.0015;
          if (h < bestHeight) {
            bestHeight = h;
            best = ni;
          }
        }
      }
      downstream[i] = best === i ? -1 : best;
    }
  }

  const flow = new Float32Array(count);
  for (let i = 0; i < count; i++) flow[i] = land[i] ? 0.15 + rainfall[i] : 0;

  const order = Array.from({ length: count }, (_, i) => i)
    .sort((a, b) => elevation[b] - elevation[a]);
  for (const i of order) {
    const d = downstream[i];
    if (d >= 0) flow[d] += flow[i];
  }

  const river = new Float32Array(count);
  const lake = new Float32Array(count);
  const delta = new Float32Array(count);
  const erosion = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    if (!land[i]) continue;
    const d = downstream[i];
    const slope = d >= 0 ? Math.max(0, elevation[i] - elevation[d]) : 0;
    river[i] = clamp((Math.log1p(flow[i]) - 1.65) / 2.4, 0, 1);
    erosion[i] = clamp(river[i] * (0.25 + slope * 9), 0, 1);

    if (d < 0 && flow[i] > 3.2 && elevation[i] < 0.68) {
      lake[i] = clamp((flow[i] - 3.2) / 8, 0.25, 1);
    }

    if (d >= 0 && !land[d] && flow[i] > 4) {
      delta[i] = clamp((flow[i] - 4) / 12, 0.2, 1);
    }
  }

  // Expand lakes and deltas slightly so they remain visible on the globe.
  blurMask(lake, width, height, 1, 0.55);
  blurMask(delta, width, height, 1, 0.45);

  return { width, height, elevation, rainfall, land, downstream, flow, river, lake, delta, erosion };
}

export function hydrologyColor(base, hydro) {
  let [r, g, b] = base;
  if (hydro.lake > 0.1) {
    const t = hydro.lake * 0.82;
    r = mix(r, 18, t); g = mix(g, 96, t); b = mix(b, 154, t);
  } else if (hydro.river > 0.12) {
    const t = 0.35 + hydro.river * 0.58;
    r = mix(r, 35, t); g = mix(g, 126, t); b = mix(b, 190, t);
  }
  if (hydro.delta > 0.1) {
    const t = hydro.delta * 0.55;
    r = mix(r, 75, t); g = mix(g, 145, t); b = mix(b, 111, t);
  }
  return [Math.round(r), Math.round(g), Math.round(b)];
}

function blurMask(mask, width, height, radius, strength) {
  const source = mask.slice();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (source[i] <= 0) continue;
      for (let oy = -radius; oy <= radius; oy++) {
        for (let ox = -radius; ox <= radius; ox++) {
          const nx = wrap(x + ox, width);
          const ny = clamp(y + oy, 0, height - 1);
          const ni = ny * width + nx;
          mask[ni] = Math.max(mask[ni], source[i] * strength);
        }
      }
    }
  }
}

function jitter(x, y) {
  let h = Math.imul(x + 31, 374761393) ^ Math.imul(y + 17, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const mix = (a, b, t) => a + (b - a) * clamp(t, 0, 1);
const wrap = (v, max) => ((v % max) + max) % max;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
