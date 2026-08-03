export function createCanvasSphereView(canvas, grid) {
  const ctx = canvas.getContext('2d', { alpha: false });
  let rotationX = -0.18;
  let rotationY = 0.45;
  let pointerId = null;
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener('pointerdown', event => {
    pointerId = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.setPointerCapture?.(event.pointerId);
  });
  canvas.addEventListener('pointermove', event => {
    if (event.pointerId !== pointerId) return;
    rotationY += (event.clientX - lastX) * 0.01;
    rotationX += (event.clientY - lastY) * 0.01;
    rotationX = Math.max(-1.35, Math.min(1.35, rotationX));
    lastX = event.clientX;
    lastY = event.clientY;
  });
  const end = event => { if (event.pointerId === pointerId) pointerId = null; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  function render(colorForCell) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    const width = Math.max(1, Math.floor(rect.width * dpr));
    const height = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#071018';
    ctx.fillRect(0, 0, width, height);

    const radius = Math.min(width, height) * 0.42;
    const centerX = width / 2;
    const centerY = height / 2;
    const step = Math.max(2, Math.floor(radius / 100));

    const image = ctx.createImageData(width, height);
    const data = image.data;
    const sinX = Math.sin(rotationX), cosX = Math.cos(rotationX);
    const sinY = Math.sin(rotationY), cosY = Math.cos(rotationY);

    for (let py = Math.floor(centerY - radius); py <= Math.ceil(centerY + radius); py += step) {
      const ny = (py - centerY) / radius;
      for (let px = Math.floor(centerX - radius); px <= Math.ceil(centerX + radius); px += step) {
        const nx = (px - centerX) / radius;
        const rr = nx * nx + ny * ny;
        if (rr > 1) continue;
        const nz = Math.sqrt(1 - rr);

        let x = nx;
        let y = -ny;
        let z = nz;

        const y1 = y * cosX - z * sinX;
        const z1 = y * sinX + z * cosX;
        y = y1; z = z1;
        const x2 = x * cosY + z * sinY;
        const z2 = -x * sinY + z * cosY;
        x = x2; z = z2;

        const longitude = Math.atan2(x, z);
        const latitude = Math.asin(Math.max(-1, Math.min(1, y)));
        let gx = Math.floor(((longitude + Math.PI) / (Math.PI * 2)) * grid.width);
        let gy = Math.floor(((Math.PI / 2 - latitude) / Math.PI) * grid.height);
        gx = ((gx % grid.width) + grid.width) % grid.width;
        gy = Math.max(0, Math.min(grid.height - 1, gy));
        const color = colorForCell(grid.index(gx, gy), gx, gy);

        const light = Math.max(0.2, Math.min(1.15, 0.35 + nx * -0.35 + ny * -0.2 + nz * 0.8));
        for (let oy = 0; oy < step; oy++) for (let ox = 0; ox < step; ox++) {
          const tx = px + ox;
          const ty = py + oy;
          if (tx < 0 || tx >= width || ty < 0 || ty >= height) continue;
          const index = (ty * width + tx) * 4;
          data[index] = Math.min(255, color[0] * light);
          data[index + 1] = Math.min(255, color[1] * light);
          data[index + 2] = Math.min(255, color[2] * light);
          data[index + 3] = 255;
        }
      }
    }
    ctx.putImageData(image, 0, 0);

    const rim = ctx.createRadialGradient(centerX - radius * 0.28, centerY - radius * 0.32, radius * 0.2, centerX, centerY, radius * 1.08);
    rim.addColorStop(0, 'rgba(255,255,255,0)');
    rim.addColorStop(0.82, 'rgba(75,130,170,0.02)');
    rim.addColorStop(1, 'rgba(82,150,205,0.32)');
    ctx.fillStyle = rim;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * 1.04, 0, Math.PI * 2);
    ctx.fill();

    drawCities(ctx, grid, centerX, centerY, radius, rotationX, rotationY);
  }

  return { render };
}

function drawCities(ctx, grid, cx, cy, radius, rotationX, rotationY) {
  const sinX = Math.sin(rotationX), cosX = Math.cos(rotationX);
  const sinY = Math.sin(rotationY), cosY = Math.cos(rotationY);
  for (const city of grid.settlements) {
    const longitude = (city.x / grid.width) * Math.PI * 2 - Math.PI;
    const latitude = Math.PI / 2 - (city.y / grid.height) * Math.PI;
    let x = Math.cos(latitude) * Math.sin(longitude);
    let y = Math.sin(latitude);
    let z = Math.cos(latitude) * Math.cos(longitude);
    const x1 = x * cosY - z * sinY;
    const z1 = x * sinY + z * cosY;
    x = x1; z = z1;
    const y2 = y * cosX + z * sinX;
    const z2 = -y * sinX + z * cosX;
    y = y2; z = z2;
    if (z <= 0) continue;
    const px = cx + x * radius;
    const py = cy - y * radius;
    const size = 2 + Math.log10(city.population + 1) * 1.4;
    ctx.fillStyle = city.alive ? '#f0c27b' : '#55585c';
    ctx.beginPath();
    ctx.arc(px, py, size, 0, Math.PI * 2);
    ctx.fill();
  }
}
