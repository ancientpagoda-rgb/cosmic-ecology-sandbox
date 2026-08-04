export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');

  let lastWorld = null;

  function resize(world) {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  window.addEventListener('resize', () => {
    if (lastWorld) render(lastWorld);
  });

  function render(world) {
    lastWorld = world;
    resize(world);

    const { width, height, ecs } = world;

    // Global trippy time phase and regime-based color twist
    const t = world.tick * 0.01;
    const wobbleHue = Math.sin(t) * 18;              // ±18° global hue wobble
    const wobbleSat = 4 + Math.cos(t * 0.7) * 3;     // small global saturation wobble
    const wobbleLight = 3 * Math.sin(t * 0.5);       // small brightness wobble
    const isStorm = world.regime === 'storm';
    const stormHueShift = isStorm ? 70 : 0;          // twist into purple/blue in storms
    const stormSatBoost = isStorm ? 10 : 0;
    const stormLightShift = isStorm ? 5 : 0;

    // Trails: soft fade instead of hard clear
    ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
    ctx.fillRect(0, 0, width, height);

    // Background "fog" gradient instead of grid
    const fog = ctx.createRadialGradient(
      width * 0.5,
      height * 0.4,
      20,
      width * 0.5,
      height * 0.7,
      Math.max(width, height) * 0.9,
    );
    fog.addColorStop(0, 'rgba(30, 42, 90, 0.6)');
    fog.addColorStop(0.5, 'rgba(8, 10, 30, 0.7)');
    fog.addColorStop(1, 'rgba(0, 0, 0, 0.9)');
    ctx.fillStyle = fog;
    ctx.fillRect(0, 0, width, height);

    const { position, agent, predator, apex, burst, resource, forceField } = ecs.components;

    // Camera transform (zoom + pan around world.camera.x/y)
    const cam = world.camera || { zoom: 1, x: width * 0.5, y: height * 0.5 };
    ctx.save();
    ctx.translate(width * 0.5, height * 0.5);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);

    // Regime overlay
    if (world.regime === 'storm') {
      ctx.fillStyle = 'rgba(180, 80, 160, 0.05)';
      ctx.fillRect(0, 0, width, height);
    }

    // Draw resources with continuous 10-stage growth (size + color change)
    // For plants, add per-plant depth and a simple perspective warp so they feel 3D-ish.
    for (const [id, res] of resource.entries()) {
      const pos = position.get(id);
      if (!pos) continue;
      const age = res.age ?? 0;
      const cycles = res.cycles ?? 0;

      // Map age into a 0–1 growth phase for color/branch timing within a cycle
      const maxAge = 3 * 9; // reference scale ≈ 27s
      const phase = Math.max(0, Math.min(1, age / maxAge));
      const stage = Math.floor(phase * 9); // 0–9 for discrete styling when needed

      // Growth factor: base smooth growth + slow, unbounded thickening over cycles
      const baseGrowth = 0.5 + phase * 0.7; // 0.5 → 1.2 within a cycle
      const extraGrowth = 1 + 0.4 * Math.log1p(cycles); // slowly increases per completed cycle
      const growthFactor = baseGrowth * extraGrowth;

      const dna = res.dna;
      const depth = dna?.depth ?? 0.5;
      const depthScale = 0.65 + depth * 0.7;      // 0.65–1.35
      const depthFade = 0.55 + depth * 0.45;      // 0.55–1.0

      // Base radius from how eaten it is, then scaled by growth and depth
      const baseRadius = 2 + res.amount * 3;
      const radius = baseRadius * growthFactor * depthScale;

      // Color shifts smoothly with phase and kind
      const isPod = res.kind === 'pod';
      const baseG = isPod ? 210 : 220;
      const baseB = isPod ? 200 : 160;
      const baseR = isPod ? 150 : 130;
      let shade = baseR - phase * 18; // subtle darkening over full phase
      let g = baseG - phase * 13.5;
      let b = baseB - phase * 9;
      const alpha = (0.75 + phase * 0.15) * depthFade;
      // Apply global light wobble
      shade = Math.min(255, Math.max(0, shade + wobbleLight));
      g = Math.min(255, Math.max(0, g + wobbleLight));
      b = Math.min(255, Math.max(0, b + wobbleLight));
      const color = `rgba(${shade}, ${g}, ${b}, ${alpha})`;

      // Fake perspective: treat plants as rising "up" out of the board.
      const camTilt = 0.35;
      const height = (6 + cycles * 4) * (0.3 + phase * 0.8); // virtual height
      const rootX = pos.x;
      const rootY = pos.y;
      const trunkTopX = rootX;
      const trunkTopY = rootY - height * camTilt;

      // Core patch at root (ground contact)
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(rootX, rootY, radius, 0, Math.PI * 2);
      ctx.fill();

      // Seed pods get a distinct outline
      if (isPod) {
        ctx.strokeStyle = `rgba(${shade + 20}, ${g + 10}, ${b + 20}, 0.9)`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, radius + 1, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Circuitboard-style branches: later growth phases sprout orthogonal traces
      if (phase >= 0.5 && res.kind === 'plant') {
        const baseLen = radius * (0.8 + phase * 0.7);

        ctx.strokeStyle = `rgba(${shade}, ${g}, ${b}, 0.45)`;
        ctx.lineWidth = (res.dna?.thickness ?? 0.9);

        const dirs = [
          { x: 1, y: 0 },
          { x: -1, y: 0 },
          { x: 0, y: 1 },
          { x: 0, y: -1 },
        ];

        const depth = res.dna?.depth ?? 0.5;
        const lean = res.dna?.lean ?? 0;

        // Number of arms increases with growth cycles (more branches each cycle)
        const baseArms = res.dna?.branchCount ?? (2 + (id % 2));
        const extraArms = Math.min(6, cycles); // +1 arm per cycle, up to +6
        const arms = baseArms + extraArms;

        for (let i = 0; i < arms; i++) {
          // Steps per arm also increase with cycles
          const baseSteps = 2 + ((id + i) % 2); // 2–3
          const extraSteps = Math.min(4, cycles); // up to +4 extra segments over many cycles
          const steps = baseSteps + extraSteps;

          let cx = trunkTopX;
          let cy = trunkTopY;

          ctx.beginPath();
          ctx.moveTo(cx, cy);

          // Pick a primary direction per arm (stable per id/arm)
          let dirIndex = (id + i) % dirs.length;

          for (let s = 0; s < steps; s++) {
            // Deterministic right-angle turns: every other segment, turn left/right
            if (s > 0 && (s % 2 === 0)) {
              const turn = ((id + s) % 2) === 0 ? 1 : -1;
              dirIndex = (dirIndex + turn + dirs.length) % dirs.length;
            }

            const dir = dirs[dirIndex];
            const segLen = baseLen * (0.4 + (s + 1) / (steps + 1) * 0.8); // longer segments later
            const t = (s + 1) / (steps + 1); // 0–1 along the branch

            // Grow upwards and lean slightly based on depth and DNA
            cx += dir.x * segLen * (0.8 + depth * 0.4);
            cy += dir.y * segLen * (0.6 + depth * 0.4) - t * 3 * depth;
            cx += lean * t * 8;

            ctx.lineTo(cx, cy);

            // Side branches: small offshoots that make the structure more plant-like
            if (s > 0 && s < steps - 1 && (s + i + id) % 2 === 0) {
              const branchLen = segLen * 0.45;
              // perpendicular directions
              const off1 = { x: -dir.y, y: dir.x };
              const bx = cx + off1.x * branchLen * (0.7 + depth * 0.5);
              const by = cy + off1.y * branchLen * (0.6 + depth * 0.4);
              ctx.moveTo(cx, cy);
              ctx.lineTo(bx, by);
              ctx.moveTo(cx, cy);
            }
          }

          ctx.stroke();

          // Small pad at the end of the trace
          const pad = radius * 0.18;
          ctx.fillStyle = `rgba(${shade}, ${g}, ${b}, 0.7)`;
          ctx.beginPath();
          ctx.rect(cx - pad / 2, cy - pad / 2, pad, pad);
          ctx.fill();
        }
      }
    }

    // Draw burst particles (from apex explosions and absorbs)
    for (const [id, p] of burst.entries()) {
      const pos = position.get(id);
      if (!pos) continue;
      const life = Math.max(0, Math.min(1, p.life));
      const hue = (p.hue ?? 45) + wobbleHue;
      const radius = 2.5 + life * 3;
      ctx.fillStyle = `hsla(${hue}, 90%, ${65 + life * 10 + wobbleLight}%, ${0.25 + life * 0.45})`;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
      ctx.fill();

      // Heat ripple ring
      const rippleR = radius * 3;
      const rippleAlpha = 0.15 * life;
      const rippleHue = (hue + 40) % 360;
      ctx.strokeStyle = `hsla(${rippleHue}, 80%, 70%, ${rippleAlpha})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, rippleR, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Draw force fields as translucent, pulsing circles
    for (const [id, field] of forceField.entries()) {
      const pos = position.get(id);
      if (!pos) continue;
      const tField = world.tick * 0.08 + id * 0.5;
      const pulse = 0.8 + 0.3 * Math.sin(tField);
      const drawRadius = field.radius * pulse;
      const baseColor = field.strength >= 0
        ? { h: 200, s: 80, l: 60 }
        : { h: 340, s: 85, l: 65 };
      const alpha = 0.12 + 0.1 * (pulse - 0.8);
      ctx.fillStyle = `hsla(${baseColor.h + wobbleHue}, ${baseColor.s}%, ${baseColor.l + wobbleLight}%, ${alpha})`;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, drawRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw predators as sharp shapes behind agents
    for (const [id, pred] of predator.entries()) {
      const pos = position.get(id);
      if (!pos) continue;
      const energy = pred.energy ?? 1.5;
      const age = pred.age ?? 0;
      const radiusBase = 6 + energy * 2.5;
      // 7-stage growth based on age
      const ageNorm = Math.max(0, Math.min(1, age / 30));
      const stage = Math.floor(ageNorm * 7); // 0–6
      const growth = 0.7 + stage * (0.5 / 6); // ~0.7 → 1.2
      const radius = radiusBase * growth;
      const dna = pred.dna || { speed: 1, sense: 1, metabolism: 1, hueShift: 0 };

      // Map DNA traits into visual & behavioral differences
      const speedNorm = Math.max(0, Math.min(1, (dna.speed - 0.6) / 0.9));       // 0–1
      const senseNorm = Math.max(0, Math.min(1, (dna.sense - 0.6) / 0.9));       // 0–1
      const metaNorm  = Math.max(0, Math.min(1, (dna.metabolism - 0.6) / 1.0));  // 0–1
      const aggression = Math.max(0, Math.min(1, dna.speed + dna.sense - dna.metabolism));

      // Derive a wider hue range from DNA: warm hunters, cooler lurkers, oddballs
      let baseHue = 20
        + dna.hueShift * 0.7            // inherit family tint
        + speedNorm * 60               // fast → red/orange
        + senseNorm * 40               // perceptive → magenta
        - metaNorm * 30                // high metabolism → pull back toward yellow
        + wobbleHue + stormHueShift;   // global + storm twist
      baseHue = ((baseHue % 360) + 360) % 360; // normalize
      const hue = baseHue;

      const saturation = 65 + speedNorm * 30 + wobbleSat + stormSatBoost; // vivid + wobble
      const lightness = 48 + (1 - metaNorm) * 10 + wobbleLight + stormLightShift;
      const outlineAlpha = 0.65 + senseNorm * 0.35;     // high sense → stronger outline

      ctx.fillStyle = `hsla(${hue}, ${saturation}%, ${lightness}%, 0.95)`;
      ctx.strokeStyle = `hsla(${hue}, 95%, 35%, ${outlineAlpha})`;
      ctx.lineWidth = 1.2 + speedNorm * 0.6;

      // Shape variation: more aggressive → narrower, longer triangles
      const aspect = 0.7 + aggression * 0.6; // 0.7 (stubby) – 1.3 (narrow)

      // Determine facing from velocity: short side (base) leads the motion
      const vel = ecs.components.velocity.get(id);
      const hasVel = vel && (Math.abs(vel.vx) + Math.abs(vel.vy) > 0.5);
      const facing = hasVel ? Math.atan2(vel.vy, vel.vx) : (id * 0.7 + world.tick * 0.01);

      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        let a;
        let rScale;
        if (i === 0) {
          // Rear tip, pointing opposite to motion
          a = facing + Math.PI;
          rScale = 1.1 * aspect;
        } else {
          // Leading edge: short side centered on facing direction
          const sideOffset = i === 1 ? -0.4 : 0.4;
          a = facing + sideOffset;
          rScale = 0.7 / aspect;
        }
        const x = pos.x + Math.cos(a) * radius * rScale;
        const y = pos.y + Math.sin(a) * radius * rScale;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Show "stomachs" – little prey dots inside based on energy
      const preyCount = Math.max(0, Math.floor(energy));
      if (preyCount > 0) {
        const innerR = radius * 0.55;
        const dotR = Math.max(1.2, radius * 0.12);
        ctx.fillStyle = 'rgba(255, 245, 230, 0.8)';
        for (let k = 0; k < preyCount; k++) {
          const a = facing + (id * 0.3 + k * (Math.PI * 2 / preyCount));
          const x = pos.x + Math.cos(a) * innerR * 0.6;
          const y = pos.y + Math.sin(a) * innerR * 0.6;
          ctx.beginPath();
          ctx.arc(x, y, dotR, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Draw apex hunters as more organic, blobby shapes behind everything
    for (const [id, ap] of apex.entries()) {
      const pos = position.get(id);
      if (!pos) continue;
      const energy = ap.energy ?? 3;
      const age = ap.age ?? 0;
      const radiusBase = 9 + energy * 2;
      // 7-stage growth based on age
      const ageNorm = Math.max(0, Math.min(1, age / 40));
      const stage = Math.floor(ageNorm * 7); // 0–6
      const growth = 0.75 + stage * (0.6 / 6); // ~0.75 → 1.35
      const radius = radiusBase * growth;
      const hue = ap.colorHue;

      ctx.fillStyle = `hsla(${hue + wobbleHue + stormHueShift}, 70%, ${60 + wobbleLight + stormLightShift}%, 0.85)`;
      ctx.strokeStyle = `hsla(${hue + wobbleHue + stormHueShift}, 95%, 35%, 0.95)`;
      ctx.lineWidth = 1.6;

      // Soft, wobbly blob instead of perfect hexagon
      const baseAngle = (id * 0.4 + world.tick * 0.01) % (Math.PI * 2);
      const lobes = 6;
      ctx.beginPath();
      for (let i = 0; i <= lobes; i++) {
        const t = i / lobes;
        const a = baseAngle + t * Math.PI * 2;
        // Wobble radius a bit to feel organic
        const wobble = 1 + 0.18 * Math.sin(world.tick * 0.03 + id * 0.4 + i);
        const r = radius * wobble;
        const x = pos.x + Math.cos(a) * r;
        const y = pos.y + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Show predators eaten inside apex as orbiting dots based on energy
      const preyCount = Math.max(0, Math.floor(energy));
      if (preyCount > 0) {
        const innerR = radius * 0.6;
        const dotR = Math.max(1.4, radius * 0.13);
        ctx.fillStyle = 'rgba(255, 250, 235, 0.85)';
        for (let k = 0; k < preyCount; k++) {
          const theta = baseAngle + (id * 0.25 + k * (Math.PI * 2 / preyCount));
          const x = pos.x + Math.cos(theta) * innerR * 0.5;
          const y = pos.y + Math.sin(theta) * innerR * 0.5;
          ctx.beginPath();
          ctx.arc(x, y, dotR, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Restore world transform before HUD/overlays (none yet)
    ctx.restore();

    // Draw agents as colored blobs with outline, radius maps to energy
    // (Agents are still drawn in world coordinates; if we want them to respect camera,
    // we could move them before ctx.restore(). For now they float as a HUD-ish overlay.)
    for (const [id, ag] of agent.entries()) {
      const pos = position.get(id);
      if (!pos) continue;
      const hue = ag.colorHue;
      const energy = ag.energy ?? 1;
      const age = ag.age ?? 0;

      // 7-stage growth based on age
      const ageNorm = Math.max(0, Math.min(1, age / 24));
      const stage = Math.floor(ageNorm * 7); // 0–6
      const growth = 0.7 + stage * (0.5 / 6); // ~0.7 → 1.2

      let radius = (4 + energy * 2) * growth;

      const evolved = ag.evolved;
      const caste = ag.caste || 'balanced';

      let sat = 78;
      let lightness = evolved ? 72 : 65;
      let fillAlpha = evolved ? 1.0 : 0.95;
      let strokeAlpha = evolved ? 1.0 : 0.9;
      let strokeWidth = evolved ? 1.5 : 1;

      if (young) {
        lightness += 4;
        fillAlpha = 0.9;
      } else if (elder) {
        lightness -= 3;
      }

      // Caste-based styling tweaks
      if (caste === 'scout') {
        sat = 85;
        lightness += 3;
      } else if (caste === 'runner') {
        sat = 92;
      } else if (caste === 'saver') {
        lightness -= 4;
        fillAlpha = 0.9;
      }

      ctx.fillStyle = `hsla(${hue}, ${sat}%, ${lightness}%, ${fillAlpha})`;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `hsla(${hue}, 95%, 40%, ${strokeAlpha})`;
      ctx.lineWidth = strokeWidth;
      ctx.stroke();

      // Small halo for evolved forms
      if (evolved) {
        ctx.strokeStyle = `hsla(${hue}, 90%, 80%, 0.5)`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, radius + 2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  return { render };
}
