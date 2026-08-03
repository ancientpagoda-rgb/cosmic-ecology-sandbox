export function renderPointNodes(ctx, canvas, nodes, camera, options = {}) {
  const width = canvas.width;
  const height = canvas.height;
  const relief = options.relief ?? 1;
  const image = ctx.createImageData(width, height);
  const data = image.data;
  let drawn = 0;

  for (const node of nodes) {
    for (const point of node.points) {
      const radius = 1 + (point.elevation - 0.46) * 0.16 * relief;
      const projected = project(point, camera, width, height, radius);
      if (!projected) continue;
      const index = (projected.py * width + projected.px) * 4;
      const light = clamp(0.34 - projected.x * 0.18 + projected.y * 0.12 + projected.z * 0.82, 0.18, 1.18);
      data[index] = Math.min(255, Math.round(point.color[0] * light));
      data[index + 1] = Math.min(255, Math.round(point.color[1] * light));
      data[index + 2] = Math.min(255, Math.round(point.color[2] * light));
      data[index + 3] = 255;
      drawn++;
    }
  }

  ctx.putImageData(image, 0, 0);
  return drawn;
}

function project(point, camera, width, height, radius) {
  const [x, y, z] = rotate(point.x, point.y, point.z, camera.rx, camera.ry, radius);
  if (z <= 0) return null;
  const px = Math.round(width / 2 + x * camera.scale);
  const py = Math.round(height / 2 - y * camera.scale);
  if (px < 0 || py < 0 || px >= width || py >= height) return null;
  return { x, y, z, px, py };
}

function rotate(x0, y0, z0, rx, ry, radius) {
  const cy = Math.cos(ry), sy = Math.sin(ry), cx = Math.cos(rx), sx = Math.sin(rx);
  const x = x0 * cy - z0 * sy;
  const z = x0 * sy + z0 * cy;
  return [x * radius, (y0 * cx - z * sx) * radius, (y0 * sx + z * cx) * radius];
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
