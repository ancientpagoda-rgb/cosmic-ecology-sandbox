const canvas = document.getElementById('world');
const ctx = canvas.getContext('2d', { alpha: false });
const controls = {
  uplift: document.getElementById('uplift'),
  rain: document.getElementById('rain'),
  temp: document.getElementById('temp'),
  speed: document.getElementById('speed'),
};
const stats = {
  age: document.getElementById('age'),
  rivers: document.getElementById('rivers'),
  forest: document.getElementById('forest'),
  cities: document.getElementById('cities'),
  population: document.getElementById('population'),
};

const W = 128;
const H = 88;
const N = W * H;
let seed = Date.now() >>> 0;
let rng;
let elevation;
let water;
let flow;
let moisture;
let vegetation;
let sediment;
let resources;
let settlements;
let ageYears = 0;
let running = true;
let accumulator = 0;
let last = performance.now();

function initWorld() {
  rng = mulberry32(seed);
  elevation = new Float32Array(N);
  water = new Float32Array(N);
  flow = new Float32Array(N);
  moisture = new Float32Array(N);
  vegetation = new Float32Array(N);
  sediment = new Float32Array(N);
  resources = new Float32Array(N);
  settlements = [];
  ageYears = 0;

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
      vegetation[i] = 0;
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

  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = idx(x, y);
      const plateWave = Math.sin((x / W) * Math.PI * 4 + upliftPhase) * Math.cos((y / H) * Math.PI * 3 - upliftPhase * 0.7);
      const boundary = Math.max(0, 1 - Math.abs(plateWave) * 2.8);
      elevation[i] = clamp(elevation[i] + boundary * upliftStrength * 0.00045 * years, 0, 1.4);
    }
  }

  const rainMap = new Float32Array(N);
  for (let y = 0; y < H; y++) {
    let shadow = 0;
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      const windward = Math.max(0, elevation[i] - (x > 0 ? elevation[idx(x - 1, y)] : elevation[i]));
      shadow = Math.max(0, shadow * 0.96 + windward * 0.8);
      rainMap[i] = clamp(rainStrength * (0.72 + windward * 2.2 - shadow * 0.42) * (0.8 + noise2(x * 0.13, y * 0.13, seed + 7) * 0.35), 0, 1);
      water[i] += rainMap[i] * 0.012 * years;
      moisture[i] = clamp(moisture[i] * 0.985 + rainMap[i] * 0.018 * years, 0, 1);
      flow[i] *= 0.78;
    }
  }

  for (let pass = 0; pass < 3; pass++) routeWater(years);

  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = idx(x, y);
      const slope = localSlope(x, y);
      const erosion = Math.min(elevation[i], flow[i] * slope * 0.00019 * years);
      elevation[i] -= erosion;
      sediment[i] += erosion * 0.7;
      if (slope < 0.025 && sediment[i] > 0) {
        const deposit = Math.min(sediment[i], 0.00008 * years);
        elevation[i] += deposit;
        sediment[i] -= deposit;
      }
    }
  }

  for (let y = 0; y < H; y++) {
    const latitude = Math.abs(y / (H - 1) - 0.5) * 2;
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      const localTemp = clamp(temperature - latitude * 0.48 - Math.max(0, elevation[i] - 0.5) * 0.42, 0, 1);
      const suitability = clamp(moisture[i] * 1.35 * localTemp * (1 - Math.max(0, flow[i] - 0.35)), 0, 1);
      const growth = suitability * (1 - vegetation[i]) * 0.008 * years;
      const death = (Math.max(0, 0.22 - moisture[i]) + Math.max(0, 0.2 - localTemp)) * 0.006 * years;
      vegetation[i] = clamp(vegetation[i] + growth - death, 0, 1);
      moisture[i] = clamp(moisture[i] - vegetation[i] * 0.0015 * years, 0, 1);
      water[i] *= Math.pow(0.985, years);
    }
  }

  updateSettlements(years, temperature);
  ageYears += years;
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
          const h = elevation[j] + water[j];
          if (h < bestHeight) {
            bestHeight = h;
            best = j;
          }
        }
      }
      if (best !== i) {
        const moved = Math.min(water[i], Math.max(0, (elevation[i] + water[i] - bestHeight) * 0.42));
        delta[i] -= moved;
        delta[best] += moved;
        flow[i] += moved * (0.5 + years * 0.01);
      }
    }
  }
  for (let i = 0; i < N; i++) water[i] = Math.max(0, water[i] + delta[i]);
}

function updateSettlements(years, temperature) {
  if (ageYears > 1500 && settlements.length < 18 && rng() < 0.08 * years / 20) {
    let best = null;
    for (let attempt = 0; attempt < 160; attempt++) {
      const x = 2 + Math.floor(rng() * (W - 4));
      const y = 2 + Math.floor(rng() * (H - 4));
      const i = idx(x, y);
      const score = flow[i] * 1.8 + moisture[i] * 0.9 + vegetation[i] * 0.5 + resources[i] * 0.7 - localSlope(x, y) * 2.5 - Math.max(0, water[i] - 0.05) * 2;
      if (!best || score > best.score) best = { x, y, score };
    }
    if (best && best.score > 0.35 && settlements.every(s => Math.hypot(s.x - best.x, s.y - best.y) > 8)) {
      settlements.push({ x: best.x, y: best.y, population: 24 + Math.floor(rng() * 60), age: 0 });
    }
  }

  for (const city of settlements) {
    const i = idx(city.x, city.y);
    const food = vegetation[i] * 0.7 + moisture[i] * 0.5 + flow[i] * 0.65;
    const trade = settlements.reduce((sum, other) => sum + (other === city ? 0 : 1 / Math.max(5, Math.hypot(other.x - city.x, other.y - city.y))), 0);
    const carrying = 80 + food * 900 + resources[i] * 450 + trade * 180;
    const growth = city.population * 0.0018 * years * clamp(1 - city.population / Math.max(1, carrying), -0.3, 1);
    city.population = Math.max(8, city.population + growth);
    city.age += years;
  }
}

function render() {
  const image = ctx.createImageData(W, H);
  let riverCells = 0;
  let forestSum = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      const e = elevation[i];
      const river = flow[i] > 0.08;
      if (river) riverCells++;
      forestSum += vegetation[i];
      let color;
      if (e < 0.34) color = [18, 61, 91];
      else if (e < 0.39) color = [72, 92, 76];
      else if (e > 0.78) color = [172, 170, 159];
      else {
        const green = vegetation[i];
        const dry = 1 - moisture[i];
        color = [
          72 + dry * 70 - green * 28,
          88 + green * 80 - dry * 26,
          57 + green * 30,
        ];
      }
      if (river && e >= 0.34) color = [28, 106, 151];
      const shade = clamp(0.78 + (x > 0 ? elevation[i] - elevation[idx(x - 1, y)] : 0) * 7, 0.55, 1.18);
      const p = i * 4;
      image.data[p] = clamp(color[0] * shade, 0, 255);
      image.data[p + 1] = clamp(color[1] * shade, 0, 255);
      image.data[p + 2] = clamp(color[2] * shade, 0, 255);
      image.data[p + 3] = 255;
    }
  }
  const temp = document.createElement('canvas');
  temp.width = W;
  temp.height = H;
  temp.getContext('2d').putImageData(image, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(temp, 0, 0, canvas.width, canvas.height);

  for (const city of settlements) {
    const x = (city.x + 0.5) / W * canvas.width;
    const y = (city.y + 0.5) / H * canvas.height;
    const size = 2.5 + Math.log10(city.population + 1) * 2.3;
    ctx.beginPath();
    ctx.arc(x, y, size + 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,205,120,.18)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fillStyle = '#f0c27b';
    ctx.fill();
  }

  stats.age.textContent = `${Math.round(ageYears).toLocaleString()} yr`;
  stats.rivers.textContent = riverCells.toLocaleString();
  stats.forest.textContent = `${Math.round(forestSum / N * 100)}%`;
  stats.cities.textContent = settlements.length;
  stats.population.textContent = Math.round(settlements.reduce((sum, city) => sum + city.population, 0)).toLocaleString();
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const speed = Number(controls.speed.value);
  if (running && speed > 0) {
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
  if (x >= 0 && x < W && y >= 0 && y < H) {
    const i = idx(x, y);
    elevation[i] = clamp(elevation[i] + 0.08, 0, 1.4);
  }
});

document.getElementById('reset').addEventListener('click', () => {
  seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
  initWorld();
});
document.getElementById('step').addEventListener('click', () => {
  for (let i = 0; i < 5; i++) stepSimulation(20);
  render();
});

function localSlope(x, y) {
  const c = elevation[idx(x, y)];
  let max = 0;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      max = Math.max(max, Math.abs(c - elevation[idx(x + ox, y + oy)]));
    }
  }
  return max;
}
function normalize(array) {
  let min = Infinity;
  let max = -Infinity;
  for (const value of array) { min = Math.min(min, value); max = Math.max(max, value); }
  const span = max - min || 1;
  for (let i = 0; i < array.length; i++) array[i] = (array[i] - min) / span;
}
function fbm(x, y, s) {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let octave = 0; octave < 5; octave++) {
    value += noise2(x * frequency, y * frequency, s + octave * 101) * amplitude;
    frequency *= 2;
    amplitude *= 0.5;
  }
  return value;
}
function noise2(x, y, s) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const tx = x - xi;
  const ty = y - yi;
  const a = hashNoise(xi, yi, s);
  const b = hashNoise(xi + 1, yi, s);
  const c = hashNoise(xi, yi + 1, s);
  const d = hashNoise(xi + 1, yi + 1, s);
  const ux = tx * tx * (3 - 2 * tx);
  const uy = ty * ty * (3 - 2 * ty);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
}
function hashNoise(x, y, s) {
  let h = Math.imul(x ^ s, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ h >>> 13, 1274126177);
  return ((h ^ h >>> 16) >>> 0) / 4294967295;
}
function mulberry32(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const idx = (x, y) => y * W + x;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const lerp = (a, b, t) => a + (b - a) * t;

initWorld();
requestAnimationFrame(frame);
