export function createCloseupPolish(globe) {
  const canvas = document.createElement('canvas');
  canvas.className = 'closeup-polish';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.append(canvas);
  const ctx = canvas.getContext('2d', { alpha: true });

  let width = 0;
  let height = 0;
  let dpr = 1;
  let lastSeed = '';
  let detail = [];

  function resize() {
    const nextWidth = Math.max(1, innerWidth);
    const nextHeight = Math.max(1, innerHeight);
    const nextDpr = Math.min(devicePixelRatio || 1, 1.5);
    if (nextWidth === width && nextHeight === height && nextDpr === dpr) return;
    width = nextWidth;
    height = nextHeight;
    dpr = nextDpr;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function rebuildDetail(cameraState) {
    const lon = Math.round((cameraState.rotationY || 0) * 6);
    const lat = Math.round((cameraState.rotationX || 0) * 6);
    const seedKey = `${lon}:${lat}`;
    if (seedKey === lastSeed) return;
    lastSeed = seedKey;
    const rng = mulberry32(hash(seedKey));
    detail = [];
    const count = width < 700 ? 42 : 84;
    for (let i = 0; i < count; i++) {
      const typeRoll = rng();
      detail.push({
        type: typeRoll < 0.54 ? 'grass' : typeRoll < 0.78 ? 'rock' : typeRoll < 0.94 ? 'tree' : 'water',
        x: rng(),
        depth: Math.pow(rng(), 0.62),
        size: 0.55 + rng() * 1.15,
        lean: (rng() - 0.5) * 0.45,
        phase: rng() * Math.PI * 2,
      });
    }
    detail.sort((a, b) => b.depth - a.depth);
  }

  function draw(timestamp) {
    requestAnimationFrame(draw);
    resize();
    const state = globe.getCameraState();
    const distance = state.distance || 3;
    const amount = 1 - smoothstep(1.36, 1.88, distance);
    ctx.clearRect(0, 0, width, height);
    if (amount <= 0.002) return;

    rebuildDetail(state);
    drawSkyHaze(amount, distance);
    drawHorizon(amount, distance);
    drawGroundFog(amount, timestamp);
    drawDetail(amount, timestamp, state);
  }

  function drawSkyHaze(amount, distance) {
    const horizonY = horizonPosition(distance);
    const gradient = ctx.createLinearGradient(0, horizonY - height * 0.28, 0, horizonY + height * 0.18);
    gradient.addColorStop(0, `rgba(72,112,150,${0.02 * amount})`);
    gradient.addColorStop(0.55, `rgba(132,166,186,${0.11 * amount})`);
    gradient.addColorStop(1, `rgba(196,202,190,${0.16 * amount})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, horizonY + height * 0.22);
  }

  function drawHorizon(amount, distance) {
    const y = horizonPosition(distance);
    const curvature = width * (0.035 + (distance - 1.18) * 0.025);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(-width * 0.1, height);
    ctx.lineTo(-width * 0.1, y + curvature);
    ctx.quadraticCurveTo(width / 2, y - curvature, width * 1.1, y + curvature);
    ctx.lineTo(width * 1.1, height);
    ctx.closePath();
    const ground = ctx.createLinearGradient(0, y, 0, height);
    ground.addColorStop(0, `rgba(58,74,61,${0.11 * amount})`);
    ground.addColorStop(0.45, `rgba(34,45,37,${0.2 * amount})`);
    ground.addColorStop(1, `rgba(8,12,11,${0.43 * amount})`);
    ctx.fillStyle = ground;
    ctx.fill();
    ctx.restore();
  }

  function drawGroundFog(amount, timestamp) {
    const y = height * 0.66;
    const drift = Math.sin(timestamp * 0.00014) * width * 0.03;
    const gradient = ctx.createRadialGradient(width * 0.5 + drift, y, 0, width * 0.5, y, width * 0.72);
    gradient.addColorStop(0, `rgba(188,204,198,${0.11 * amount})`);
    gradient.addColorStop(0.6, `rgba(150,170,165,${0.045 * amount})`);
    gradient.addColorStop(1, 'rgba(120,140,140,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, height * 0.42, width, height * 0.58);
  }

  function drawDetail(amount, timestamp, state) {
    const movement = (state.rotationY || 0) * width * 0.18;
    for (const item of detail) {
      const perspective = 1 - item.depth;
      const y = height * (0.57 + perspective * 0.38);
      const x = wrapPx(item.x * width + movement * item.depth, width);
      const scale = item.size * (0.28 + perspective * 1.3);
      const alpha = amount * (0.18 + perspective * 0.66);
      if (item.type === 'grass') drawGrass(x, y, scale, alpha, item, timestamp);
      else if (item.type === 'rock') drawRock(x, y, scale, alpha, item);
      else if (item.type === 'tree') drawTree(x, y, scale, alpha, item, timestamp);
      else drawWater(x, y, scale, alpha);
    }
  }

  function drawGrass(x, y, scale, alpha, item, timestamp) {
    const sway = Math.sin(timestamp * 0.001 + item.phase) * 2.2 * scale;
    ctx.strokeStyle = `rgba(67,91,62,${alpha})`;
    ctx.lineWidth = Math.max(0.7, scale * 0.9);
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(x + i * scale * 1.8, y);
      ctx.quadraticCurveTo(x + i * scale + sway, y - 8 * scale, x + i * scale * 0.6 + sway, y - 16 * scale);
      ctx.stroke();
    }
  }

  function drawRock(x, y, scale, alpha, item) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(item.lean);
    ctx.beginPath();
    ctx.moveTo(-8 * scale, 0);
    ctx.lineTo(-5 * scale, -7 * scale);
    ctx.lineTo(2 * scale, -11 * scale);
    ctx.lineTo(9 * scale, -4 * scale);
    ctx.lineTo(7 * scale, 0);
    ctx.closePath();
    ctx.fillStyle = `rgba(78,80,75,${alpha})`;
    ctx.fill();
    ctx.restore();
  }

  function drawTree(x, y, scale, alpha, item, timestamp) {
    const sway = Math.sin(timestamp * 0.0007 + item.phase) * 1.5 * scale;
    ctx.strokeStyle = `rgba(63,49,37,${alpha})`;
    ctx.lineWidth = Math.max(1, scale * 2.1);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + sway, y - 28 * scale);
    ctx.stroke();
    ctx.fillStyle = `rgba(43,74,50,${alpha * 0.9})`;
    ctx.beginPath();
    ctx.ellipse(x + sway, y - 35 * scale, 12 * scale, 18 * scale, item.lean, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawWater(x, y, scale, alpha) {
    ctx.strokeStyle = `rgba(112,151,169,${alpha * 0.75})`;
    ctx.lineWidth = Math.max(0.8, scale);
    ctx.beginPath();
    ctx.moveTo(x - 14 * scale, y);
    ctx.quadraticCurveTo(x, y - 2 * scale, x + 14 * scale, y);
    ctx.stroke();
  }

  function horizonPosition(distance) {
    const close = 1 - smoothstep(1.18, 1.55, distance);
    return height * (0.5 + close * 0.08);
  }

  requestAnimationFrame(draw);

  return {
    destroy() { canvas.remove(); },
  };
}

function hash(text) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}
function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let result = value;
    result = Math.imul(result ^ result >>> 15, result | 1);
    result ^= result + Math.imul(result ^ result >>> 7, result | 61);
    return ((result ^ result >>> 14) >>> 0) / 4294967296;
  };
}
function smoothstep(a, b, value) {
  const x = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return x * x * (3 - 2 * x);
}
function wrapPx(value, max) {
  return ((value % max) + max) % max;
}
