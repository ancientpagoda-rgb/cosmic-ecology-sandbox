export function createPointField(count = 52000) {
  const points = new Array(count);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    const x = Math.cos(theta) * r;
    const z = Math.sin(theta) * r;
    const elevation = clamp(0.5 + 0.24 * Math.sin(x * 5.2 + z * 2.4) + 0.18 * Math.sin(y * 7.1 - x * 3.3) + 0.11 * Math.sin((x + y + z) * 13.7) + Math.abs(Math.sin(x * 15.3 + y * 9.2 - z * 11.7)) * 0.2, 0, 1);
    const temperature = clamp(0.84 - Math.abs(y) * 0.74 - Math.max(0, elevation - 0.58) * 0.7, 0, 1);
    const moisture = clamp(0.5 + 0.28 * Math.sin(z * 6.4 - x * 2.7) + 0.2 * Math.sin(y * 11.2 + z * 4.3), 0, 1);
    const vegetation = clamp(moisture * temperature * 1.6 - 0.15, 0, 1);
    const river = clamp((1 - Math.abs(Math.sin(x * 22 + y * 13 - z * 17))) * moisture * Math.max(0, elevation - 0.44) * 2.8, 0, 1);
    const city = elevation > 0.48 && elevation < 0.66 && moisture > 0.56 && river > 0.72 && hash01(i) > 0.997;
    points[i] = { x, y, z, elevation, moisture, temperature, vegetation, river, city, color: colorFor({ elevation, moisture, temperature, vegetation, river, city }) };
  }
  return points;
}

export function updatePointField(points, worldAge, years) {
  const pulse = Math.sin(worldAge * 0.0008) * 0.015;
  for (let i = 0; i < points.length; i += 2) {
    const point = points[i];
    const target = clamp(point.moisture * (point.temperature + pulse) * 1.6 - 0.15, 0, 1);
    point.vegetation += (target - point.vegetation) * Math.min(1, years * 0.008);
    point.color = colorFor(point);
  }
}

function colorFor(point) {
  if (point.elevation < 0.46) return [20, 64, 98];
  if (point.temperature < 0.16 || point.elevation > 0.84) return [226, 232, 235];
  if (point.river > 0.74) return [38, 132, 177];
  if (point.city) return [241, 195, 100];
  if (point.moisture < 0.22) return [181, 148, 80];
  if (point.vegetation > 0.62) return [44, 112, 61];
  if (point.vegetation > 0.28) return [82, 128, 72];
  return [108, 106, 80];
}

function hash01(index) { let h = Math.imul(index ^ 91, 2654435761); h ^= h >>> 16; return (h >>> 0) / 4294967295; }
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
