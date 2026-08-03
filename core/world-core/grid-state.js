export function createGridState(width = 128, height = 88, snapshot = null) {
  const size = width * height;
  const fields = ['elevation','water','flow','moisture','vegetation','sediment','resources','farms','fire','flood','soil'];
  const grid = { width, height, size };
  for (const name of fields) {
    const source = snapshot?.[name];
    grid[name] = source ? Float32Array.from(source) : new Float32Array(size);
  }
  grid.settlements = structuredCloneSafe(snapshot?.settlements || []);
  grid.roads = structuredCloneSafe(snapshot?.roads || []);
  grid.collapsedCount = snapshot?.collapsedCount || 0;
  grid.seaLevel = snapshot?.seaLevel ?? 0.34;
  grid.index = (x, y) => y * width + x;
  grid.safeIndex = (x, y) => x >= 0 && x < width && y >= 0 && y < height ? y * width + x : -1;
  grid.save = () => ({
    width,
    height,
    seaLevel: grid.seaLevel,
    collapsedCount: grid.collapsedCount,
    settlements: structuredCloneSafe(grid.settlements),
    roads: structuredCloneSafe(grid.roads),
    ...Object.fromEntries(fields.map(name => [name, Array.from(grid[name])])),
  });
  return grid;
}

export function localSlope(grid, x, y) {
  const centerIndex = grid.safeIndex(x, y);
  if (centerIndex < 0) return 1;
  const center = grid.elevation[centerIndex];
  let max = 0;
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    if (!ox && !oy) continue;
    const index = grid.safeIndex(x + ox, y + oy);
    if (index >= 0) max = Math.max(max, Math.abs(center - grid.elevation[index]));
  }
  return max;
}

export function sumAround(grid, array, cx, cy, radius) {
  let total = 0;
  let count = 0;
  for (let y = cy - radius; y <= cy + radius; y++) for (let x = cx - radius; x <= cx + radius; x++) {
    const index = grid.safeIndex(x, y);
    if (index >= 0) { total += array[index]; count++; }
  }
  return count ? total : 0;
}

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const lerp = (a, b, t) => a + (b - a) * t;

function structuredCloneSafe(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
