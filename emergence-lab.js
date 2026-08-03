const canvas = document.getElementById('world');
const ctx = canvas.getContext('2d', { alpha: false });
const controls = Object.fromEntries(['uplift', 'rain', 'temp', 'speed'].map(id => [id, document.getElementById(id)]));
const stats = Object.fromEntries(['age','rivers','forest','cities','population','farms','roads','fires','floods','collapsed'].map(id => [id, document.getElementById(id)]));

const W = 128;
const H = 88;
const N = W * H;
const SEA = 0.34;
let seed = Date.now() >>> 0;
let rng;
let elevation, water, flow, moisture, vegetation, sediment, resources, farms, fire, flood, soil;
let settlements = [];
let roads = [];
let ageYears = 0;
let accumulator = 0;
let last = performance.now();
let collapsedCount = 0;

function initWorld() {
  rng = mulberry32(seed);
  elevation = new Float32Array(N);
  water = new Float32Array(N);
  flow = new Float32Array(N);
  moisture = new Float32Array(N);
  vegetation = new Float32Array(N);
  sediment = new Float32Array(N);
  resources = new Float32Array(N);
  farms = new Float32Array(N);
  fire = new Float32Array(N);
  flood = new Float32Array(N);
  soil = new Float32Array(N);
  settlements = [];
  roads = [];
  ageYears = 0;
  collapsedCount = 0;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      const nx = x / W - 0.5;
      const ny = y / H - 0.5;
      const continental = fbm(nx * 2.1, ny * 2.1, seed) * 0.58;
      const ridges = Math.abs(fbm(nx * 5.8 + 11, ny * 5.8 - 7, seed + 17) - 0.5) * 0.55;
      const islandFalloff = Math.max(0, 1 - Math.pow(Math.hypot(nx * 1.25, ny * 1.1), 2.2));
      elevation[i] = clamp(0.2 + continental + ridges * 0.32 + islandFalloff * 0.3, 0, 1);
      resources[i] = clamp(fbm(nx * 9 + 31, ny * 9 - 19, seed + 91), 0, 1);
      moisture[i] = 0.18 + rng() * 0.08;
      soil[i] = 0.25 + rng() * 0.25;
    }
  }
  normalize(elevation);
  render();
}

function stepSimulation(years = 20) {
  const upliftStrength = Number(controls.uplift.value);
  const rainStrength = Number(controls.rain.value);
  const temperature = Number(controls.temp.value);
  const upliftPhase = ageYears * 0.00004;

  upliftTerrain(upliftStrength, upliftPhase, years);
  applyRainfall(rainStrength, years);
  for (let pass = 0; pass < 3; pass++) routeWater(years);
  erodeAndDeposit(years);
  updateFloodplains(years);
  updateVegetationAndFire(temperature, years);
  updateSettlements(years);
  updateRoads();
  ageYears += years;
}

function upliftTerrain(strength, phase, years) {
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = idx(x, y);
      const wave = Math.sin((x / W) * Math.PI * 4 + phase) * Math.cos((y / H) * Math.PI * 3 - phase * 0.7);
      const boundary = Math.max(0, 1 - Math.abs(wave) * 2.8);
      elevation[i] = clamp(elevation[i] + boundary * strength * 0.00045 * years, 0, 1.4);
    }
  }
}

function applyRainfall(strength, years) {
  for (let y = 0; y < H; y++) {
    let shadow = 0;
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      const windward = Math.max(0, elevation[i] - (x ? elevation[idx(x - 1, y)] : elevation[i]));
      shadow = Math.max(0, shadow * 0.96 + windward * 0.8);
      const rain = clamp(strength * (0.72 + windward * 2.2 - shadow * 0.42) * (0.8 + noise2(x * 0.13, y * 0.13, seed + 7) * 0.35), 0, 1);
      water[i] += rain * 0.012 * years;
      moisture[i] = clamp(moisture[i] * 0.985 + rain * 0.018 * years, 0, 1);
      flow[i] *= 0.78;
      flood[i] *= 0.72;
    }
  }
}

function routeWater(years) {
  const delta = new Float32Array(N);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = idx(x, y);
      if (water[i] <= 0.00001) continue;
      let best = i;
      let bestHeight = elevation[i] + water[i];
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          const j = idx(x + ox, y + oy);
          const height = elevation[j] + water[j];
          if (height < bestHeight) {
            bestHeight = height;
            best = j;
          }
        }
      }
      if (best !== i) {
        const moved = Math.min(water[i], Math.max(0, (elevation[i] + water[i] - bestHeight) * 0.42));
        delta[i] -= moved;
        delta[best] += moved;
        flow[i] += moved * (0.5 + years * 0.01);
        if (moved > 0.035) flood[best] = clamp(flood[best] + moved * 0.45, 0, 1);
      }
    }
  }
  for (let i = 0; i < N; i++) water[i] = Math.max(0, water[i] + delta[i]);
}

function erodeAndDeposit(years) {
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = idx(x, y);
      const slope = localSlope(x, y);
      const erosion = Math.min(elevation[i], flow[i] * slope * 0.00019 * years);
      elevation[i] -= erosion;
      sediment[i] += erosion * 0.7;
      soil[i] = clamp(soil[i] - erosion * 2.5, 0, 1);
      if (slope < 0.025 && sediment[i] > 0) {
        const deposit = Math.min(sediment[i], 0.0001 * years * (1 + flood[i]));
        elevation[i] += deposit;
        sediment[i] -= deposit;
        soil[i] = clamp(soil[i] + deposit * 9, 0, 1);
      }
    }
  }
}

function updateFloodplains(years) {
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = idx(x, y);
      if (flow[i] > 0.12 && localSlope(x, y) < 0.035) {
        const spread = Math.min(0.12, flow[i] * 0.08);
        flood[i] = clamp(flood[i] + spread, 0, 1);
        soil[i] = clamp(soil[i] + spread * 0.14, 0, 1);
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const j = idx(x + ox, y + oy);
            flood[j] = clamp(flood[j] + spread * 0.35, 0, 1);
          }
        }
      }
      flood[i] *= Math.pow(0.97, years);
    }
  }
}

function updateVegetationAndFire(temperature, years) {
  const nextFire = new Float32Array(N);
  for (let y = 0; y < H; y++) {
    const latitude = Math.abs(y / (H - 1) - 0.5) * 2;
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      const localTemp = clamp(temperature - latitude * 0.48 - Math.max(0, elevation[i] - 0.5) * 0.42, 0, 1);
      const suitability = clamp(moisture[i] * 1.35 * localTemp * soil[i] * (1 - farms[i]) * (1 - Math.max(0, flow[i] - 0.35)), 0, 1);
      vegetation[i] = clamp(vegetation[i] + suitability * (1 - vegetation[i]) * 0.008 * years, 0, 1);
      vegetation[i] = clamp(vegetation[i] - (Math.max(0, 0.22 - moisture[i]) + Math.max(0, 0.2 - localTemp)) * 0.006 * years, 0, 1);

      const ignition = vegetation[i] * Math.max(0, 0.34 - moisture[i]) * Math.max(0, localTemp - 0.42) * 0.025 * years;
      if (rng() < ignition) nextFire[i] = 1;
      if (fire[i] > 0.04) {
        vegetation[i] *= Math.pow(0.2, fire[i] * years / 20);
        farms[i] *= Math.pow(0.55, fire[i] * years / 20);
        soil[i] = clamp(soil[i] + fire[i] * 0.025, 0, 1);
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (!ox && !oy) continue;
            const j = safeIdx(x + ox, y + oy);
            if (j >= 0 && rng() < fire[i] * vegetation[j] * Math.max(0, 0.45 - moisture[j]) * 0.22) nextFire[j] = Math.max(nextFire[j], 0.75);
          }
        }
      }
      fire[i] = Math.max(nextFire[i], fire[i] * 0.35);
      moisture[i] = clamp(moisture[i] - vegetation[i] * 0.0015 * years + flood[i] * 0.015, 0, 1);
      water[i] *= Math.pow(0.985, years);
    }
  }
}

function updateSettlements(years) {
  if (ageYears > 1500 && settlements.length < 22 && rng() < 0.08 * years / 20) foundSettlement();

  for (const city of settlements) {
    if (!city.alive) continue;
    city.age += years;
    const i = idx(city.x, city.y);
    cultivateAround(city, years);
    const nearbyFarm = sumAround(city.x, city.y, farms, 4) / 81;
    const waterAccess = clamp(flow[i] * 1.5 + moisture[i] * 0.45, 0, 1.5);
    const floodRisk = flood[i] + Math.max(0, water[i] - 0.08) * 2;
    const fireRisk = fire[i];
    const trade = roadTrade(city);
    const food = nearbyFarm * 1.4 + vegetation[i] * 0.25 + waterAccess * 0.45;
    const carrying = 40 + food * 1200 + resources[i] * 350 + trade * 500;
    const stress = floodRisk * 0.7 + fireRisk * 1.2 + Math.max(0, 0.18 - moisture[i]) * 1.4;
    const growthRate = 0.0017 * clamp(1 - city.population / Math.max(1, carrying), -0.55, 1) - stress * 0.0012;
    city.population = Math.max(0, city.population + city.population * growthRate * years);
    city.wealth = clamp(city.wealth + (trade + resources[i] * 0.25 + nearbyFarm * 0.35 - stress * 0.3) * years * 0.02, 0, 1000);
    if (city.population < 10 || (stress > 1.2 && city.wealth < 8)) {
      city.alive = false;
      collapsedCount++;
      farms[i] *= 0.35;
    }
  }
}

function foundSettlement() {
  let best = null;
  for (let attempt = 0; attempt < 220; attempt++) {
    const x = 2 + Math.floor(rng() * (W - 4));
    const y = 2 + Math.floor(rng() * (H - 4));
    const i = idx(x, y);
    const score = flow[i] * 1.9 + moisture[i] * 0.9 + vegetation[i] * 0.35 + resources[i] * 0.8 + soil[i] * 0.8 - localSlope(x, y) * 3 - flood[i] * 1.1;
    if (!best || score > best.score) best = { x, y, score };
  }
  if (best && best.score > 0.5 && settlements.filter(s => s.alive).every(s => Math.hypot(s.x - best.x, s.y - best.y) > 8)) {
    settlements.push({ id: `city-${settlements.length}`, x: best.x, y: best.y, population: 30 + rng() * 70, wealth: 12, age: 0, alive: true });
  }
}

function cultivateAround(city, years) {
  const pressure = clamp(city.population / 900, 0, 1);
  for (let oy = -4; oy <= 4; oy++) {
    for (let ox = -4; ox <= 4; ox++) {
      const x = city.x + ox;
      const y = city.y + oy;
      const i = safeIdx(x, y);
      if (i < 0 || elevation[i] < SEA || localSlope(x, y) > 0.08 || flood[i] > 0.65) continue;
      const fertility = soil[i] * moisture[i] * (0.5 + flow[i]);
      const expansion = pressure * fertility * 0.004 * years / Math.max(1, Math.hypot(ox, oy));
      farms[i] = clamp(farms[i] + expansion, 0, 1);
      vegetation[i] = clamp(vegetation[i] - expansion * 0.7, 0, 1);
      soil[i] = clamp(soil[i] - farms[i] * 0.0009 * years + flood[i] * 0.004 * years, 0, 1);
    }
  }
}

function updateRoads() {
  const active = settlements.filter(city => city.alive && city.population > 60);
  const wanted = new Map();
  for (const city of active) {
    const candidates = active.filter(other => other !== city).sort((a, b) => roadCost(city, a) - roadCost(city, b)).slice(0, 2);
    for (const other of candidates) {
      const key = [city.id, other.id].sort().join('|');
      wanted.set(key, { a: city, b: other });
    }
  }
  roads = [...wanted.entries()].map(([id, road]) => ({ id, ...road }));
}

function roadCost(a, b) {
  const distance = Math.hypot(a.x - b.x, a.y - b.y);
  const steps = Math.max(2, Math.ceil(distance));
  let terrain = 0;
  for (let n = 0; n <= steps; n++) {
    const t = n / steps;
    const x = Math.round(lerp(a.x, b.x, t));
    const y = Math.round(lerp(a.y, b.y, t));
    terrain += localSlope(x, y) * 8 + flood[idx(x, y)] * 2;
  }
  return distance + terrain;
}

function roadTrade(city) {
  let value = 0;
  for (const road of roads) {
    if (road.a !== city && road.b !== city) continue;
    const other = road.a === city ? road.b : road.a;
    value += other.alive ? Math.log10(other.population + 10) / Math.max(4, Math.hypot(city.x - other.x, city.y - other.y)) : 0;
  }
  return value;
}

function render() {
  const image = ctx.createImageData(W, H);
  let riverCells = 0, forestSum = 0, farmSum = 0, activeFires = 0, floodedCells = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      const river = flow[i] > 0.08;
      if (river) riverCells++;
      if (fire[i] > 0.08) activeFires++;
      if (flood[i] > 0.12) floodedCells++;
      forestSum += vegetation[i];
      farmSum += farms[i];
      let color;
      if (elevation[i] < SEA) color = [18, 61, 91];
      else if (elevation[i] < SEA + 0.05) color = [72, 92, 76];
      else if (elevation[i] > 0.78) color = [172, 170, 159];
      else {
        const green = vegetation[i];
        const dry = 1 - moisture[i];
        color = [72 + dry * 70 - green * 28, 88 + green * 80 - dry * 26, 57 + green * 30];
      }
      if (farms[i] > 0.05) color = mix(color, [182, 155, 88], farms[i] * 0.8);
      if (flood[i] > 0.12) color = mix(color, [53, 113, 137], flood[i] * 0.55);
      if (river && elevation[i] >= SEA) color = [28, 106, 151];
      if (fire[i] > 0.08) color = mix(color, [197, 86, 42], fire[i]);
      const shade = clamp(0.78 + (x ? elevation[i] - elevation[idx(x - 1, y)] : 0) * 7, 0.55, 1.18);
      const p = i * 4;
      image.data[p] = clamp(color[0] * shade, 0, 255);
      image.data[p + 1] = clamp(color[1] * shade, 0, 255);
      image.data[p + 2] = clamp(color[2] * shade, 0, 255);
      image.data[p + 3] = 255;
    }
  }
  const temp = document.createElement('canvas');
  temp.width = W; temp.height = H;
  temp.getContext('2d').putImageData(image, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(temp, 0, 0, canvas.width, canvas.height);
  drawRoads();
  drawCities();

  const alive = settlements.filter(city => city.alive);
  stats.age.textContent = `${Math.round(ageYears).toLocaleString()} yr`;
  stats.rivers.textContent = riverCells.toLocaleString();
  stats.forest.textContent = `${Math.round(forestSum / N * 100)}%`;
  stats.cities.textContent = alive.length;
  stats.population.textContent = Math.round(alive.reduce((sum, city) => sum + city.population, 0)).toLocaleString();
  stats.farms.textContent = `${Math.round(farmSum / N * 100)}%`;
  stats.roads.textContent = roads.length;
  stats.fires.textContent = activeFires;
  stats.floods.textContent = floodedCells;
  stats.collapsed.textContent = collapsedCount;
}

function drawRoads() {
  ctx.strokeStyle = 'rgba(150,155,160,.55)';
  ctx.lineWidth = 1.4;
  for (const road of roads) {
    if (!road.a.alive || !road.b.alive) continue;
    ctx.beginPath();
    ctx.moveTo((road.a.x + 0.5) / W * canvas.width, (road.a.y + 0.5) / H * canvas.height);
    ctx.lineTo((road.b.x + 0.5) / W * canvas.width, (road.b.y + 0.5) / H * canvas.height);
    ctx.stroke();
  }
}

function drawCities() {
  for (const city of settlements) {
    const x = (city.x + 0.5) / W * canvas.width;
    const y = (city.y + 0.5) / H * canvas.height;
    const size = 2.5 + Math.log10(city.population + 1) * 2.3;
    ctx.beginPath(); ctx.arc(x, y, size + 3, 0, Math.PI * 2);
    ctx.fillStyle = city.alive ? 'rgba(255,205,120,.18)' : 'rgba(80,80,80,.16)'; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fillStyle = city.alive ? '#f0c27b' : '#55585c'; ctx.fill();
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const speed = Number(controls.speed.value);
  if (speed > 0) {
    accumulator += dt * speed;
    while (accumulator >= 0.18) {
      stepSimulation(20);
      accumulator -= 0.18;
    }
  }
  render();
}

canvas.addEventListener('pointerdown', event => {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((event.clientX - rect.left) / rect.width * W);
  const y = Math.floor((event.clientY - rect.top) / rect.height * H);
  if (safeIdx(x, y) >= 0) elevation[idx(x, y)] = clamp(elevation[idx(x, y)] + 0.08, 0, 1.4);
});
document.getElementById('reset').addEventListener('click', () => { seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0; initWorld(); });
document.getElementById('step').addEventListener('click', () => { for (let i = 0; i < 5; i++) stepSimulation(20); render(); });

function sumAround(cx, cy, array, radius) {
  let total = 0, count = 0;
  for (let y = cy - radius; y <= cy + radius; y++) for (let x = cx - radius; x <= cx + radius; x++) { const i = safeIdx(x, y); if (i >= 0) { total += array[i]; count++; } }
  return count ? total : 0;
}
function localSlope(x, y) {
  const i = safeIdx(x, y); if (i < 0) return 1;
  const center = elevation[i]; let max = 0;
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) { if (!ox && !oy) continue; const j = safeIdx(x + ox, y + oy); if (j >= 0) max = Math.max(max, Math.abs(center - elevation[j])); }
  return max;
}
function normalize(array) { let min = Infinity, max = -Infinity; for (const v of array) { min = Math.min(min, v); max = Math.max(max, v); } const span = max - min || 1; for (let i = 0; i < array.length; i++) array[i] = (array[i] - min) / span; }
function fbm(x, y, s) { let value = 0, amplitude = 0.5, frequency = 1; for (let octave = 0; octave < 5; octave++) { value += noise2(x * frequency, y * frequency, s + octave * 101) * amplitude; frequency *= 2; amplitude *= 0.5; } return value; }
function noise2(x, y, s) { const xi = Math.floor(x), yi = Math.floor(y), tx = x - xi, ty = y - yi; const a = hashNoise(xi, yi, s), b = hashNoise(xi + 1, yi, s), c = hashNoise(xi, yi + 1, s), d = hashNoise(xi + 1, yi + 1, s); const ux = tx * tx * (3 - 2 * tx), uy = ty * ty * (3 - 2 * ty); return lerp(lerp(a, b, ux), lerp(c, d, ux), uy); }
function hashNoise(x, y, s) { let h = Math.imul(x ^ s, 374761393) + Math.imul(y, 668265263); h = Math.imul(h ^ h >>> 13, 1274126177); return ((h ^ h >>> 16) >>> 0) / 4294967295; }
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function mix(a, b, t) { return a.map((v, i) => v + (b[i] - v) * clamp(t, 0, 1)); }
const idx = (x, y) => y * W + x;
const safeIdx = (x, y) => x >= 0 && x < W && y >= 0 && y < H ? idx(x, y) : -1;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const lerp = (a, b, t) => a + (b - a) * t;

initWorld();
requestAnimationFrame(frame);
