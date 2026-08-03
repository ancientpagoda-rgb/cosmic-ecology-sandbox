(() => {
  const status = document.getElementById('status');
  const fail = message => {
    status.textContent = message;
    status.classList.add('error');
  };

  try {
    if (!window.Potree || !window.THREE) throw new Error('Potree or Three.js failed to load');

    const viewer = new Potree.Viewer(document.getElementById('potree_render_area'));
    viewer.setEDLEnabled(true);
    viewer.setEDLRadius(1.2);
    viewer.setEDLStrength(0.8);
    viewer.setFOV(55);
    viewer.setPointBudget(700000);
    viewer.setMinNodeSize(20);
    viewer.setBackground('black');
    viewer.setDescription('');

    const geometry = new THREE.BufferGeometry();
    const count = /iPhone|iPad|iPod/i.test(navigator.userAgent) ? 85000 : 220000;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const golden = Math.PI * (3 - Math.sqrt(5));

    for (let i = 0; i < count; i++) {
      const y = 1 - (i / (count - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = golden * i;
      const x = Math.cos(theta) * r;
      const z = Math.sin(theta) * r;

      const elevation = clamp(
        0.5 +
        0.24 * Math.sin(x * 5.2 + z * 2.4) +
        0.18 * Math.sin(y * 7.1 - x * 3.3) +
        0.11 * Math.sin((x + y + z) * 13.7) +
        Math.abs(Math.sin(x * 15.3 + y * 9.2 - z * 11.7)) * 0.2,
        0,
        1,
      );
      const temperature = clamp(0.84 - Math.abs(y) * 0.74 - Math.max(0, elevation - 0.58) * 0.7, 0, 1);
      const moisture = clamp(0.5 + 0.28 * Math.sin(z * 6.4 - x * 2.7) + 0.2 * Math.sin(y * 11.2 + z * 4.3), 0, 1);
      const vegetation = clamp(moisture * temperature * 1.6 - 0.15, 0, 1);
      const river = clamp((1 - Math.abs(Math.sin(x * 22 + y * 13 - z * 17))) * moisture * Math.max(0, elevation - 0.44) * 2.8, 0, 1);
      const radius = 1 + (elevation - 0.46) * 0.14;
      const color = colorFor(elevation, temperature, moisture, vegetation, river);

      positions[i * 3] = x * radius;
      positions[i * 3 + 1] = y * radius;
      positions[i * 3 + 2] = z * radius;
      colors[i * 3] = color[0] / 255;
      colors[i * 3 + 1] = color[1] / 255;
      colors[i * 3 + 2] = color[2] / 255;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeBoundingSphere();

    const material = new THREE.PointsMaterial({
      size: /iPhone|iPad|iPod/i.test(navigator.userAgent) ? 0.012 : 0.008,
      vertexColors: true,
      sizeAttenuation: true,
      transparent: false,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = true;
    viewer.scene.scene.add(points);

    viewer.scene.view.position.set(0, 0, 3.2);
    viewer.scene.view.lookAt(new THREE.Vector3(0, 0, 0));

    let pinching = false;
    const active = new Map();
    let pinchStart = 0;
    let cameraStart = 3.2;
    const area = document.getElementById('potree_render_area');
    area.addEventListener('pointerdown', event => {
      active.set(event.pointerId, [event.clientX, event.clientY]);
      if (active.size === 2) {
        const values = [...active.values()];
        pinchStart = Math.hypot(values[0][0] - values[1][0], values[0][1] - values[1][1]);
        cameraStart = viewer.scene.view.position.distanceTo(new THREE.Vector3(0, 0, 0));
        pinching = true;
      }
    }, true);
    area.addEventListener('pointermove', event => {
      if (!active.has(event.pointerId)) return;
      active.set(event.pointerId, [event.clientX, event.clientY]);
      if (pinching && active.size >= 2) {
        const values = [...active.values()];
        const distance = Math.hypot(values[0][0] - values[1][0], values[0][1] - values[1][1]);
        const ratio = pinchStart / Math.max(1, distance);
        const next = clamp(cameraStart * ratio, 1.25, 8);
        viewer.scene.view.position.setLength(next);
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
    const release = event => {
      active.delete(event.pointerId);
      if (active.size < 2) pinching = false;
    };
    area.addEventListener('pointerup', release, true);
    area.addEventListener('pointercancel', release, true);

    status.remove();
    window.realitySandboxPotree = { viewer, points, geometry };
  } catch (error) {
    console.error(error);
    fail(`Potree failed: ${error.message}`);
  }

  function colorFor(elevation, temperature, moisture, vegetation, river) {
    if (elevation < 0.46) return [20, 64, 98];
    if (temperature < 0.16 || elevation > 0.84) return [226, 232, 235];
    if (river > 0.74) return [38, 132, 177];
    if (moisture < 0.22) return [181, 148, 80];
    if (vegetation > 0.62) return [44, 112, 61];
    if (vegetation > 0.28) return [82, 128, 72];
    return [108, 106, 80];
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
})();
