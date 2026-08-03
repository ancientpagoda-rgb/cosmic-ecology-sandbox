import * as THREE from 'three';

export function createGalaxyRenderLayer(container, galaxySystem, options = {}) {
  const mobile = options.mobile ?? matchMedia('(pointer: coarse)').matches;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(mobile ? 48 : 42, 1, 0.1, 1200);
  camera.position.set(0, 82, 180);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: false,
    powerPreference: mobile ? 'low-power' : 'high-performance',
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, mobile ? 1 : 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;opacity:0;transition:opacity .25s ease;z-index:2';
  container.append(renderer.domElement);

  const galaxy = new THREE.Group();
  galaxy.rotation.x = -0.22;
  scene.add(galaxy);

  const stars = galaxySystem.getStars();
  const positions = new Float32Array(stars.length * 3);
  const colors = new Float32Array(stars.length * 3);
  const sizes = new Float32Array(stars.length);

  for (let index = 0; index < stars.length; index++) {
    const star = stars[index];
    positions[index * 3] = star.position.x;
    positions[index * 3 + 1] = star.position.y;
    positions[index * 3 + 2] = star.position.z;
    colors[index * 3] = star.color[0];
    colors[index * 3 + 1] = star.color[1];
    colors[index * 3 + 2] = star.color[2];
    sizes[index] = star.size * (0.7 + Math.log10(Math.max(1, star.luminosity + 1)) * 0.22);
  }

  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  starGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  starGeometry.setAttribute('starSize', new THREE.BufferAttribute(sizes, 1));

  const starMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    uniforms: {
      opacity: { value: 0 },
      pixelRatio: { value: renderer.getPixelRatio() },
    },
    vertexShader: `
      attribute float starSize;
      varying vec3 vColor;
      uniform float pixelRatio;
      void main() {
        vColor = color;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        float distanceScale = clamp(180.0 / max(12.0, -mvPosition.z), 0.35, 3.2);
        gl_PointSize = starSize * pixelRatio * distanceScale * 2.2;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      uniform float opacity;
      void main() {
        vec2 centered = gl_PointCoord - 0.5;
        float radius = length(centered);
        if (radius > 0.5) discard;
        float core = smoothstep(0.5, 0.0, radius);
        float glow = pow(core, 2.2) + pow(core, 8.0) * 1.8;
        gl_FragColor = vec4(vColor * glow, opacity * core);
      }
    `,
  });

  const starPoints = new THREE.Points(starGeometry, starMaterial);
  galaxy.add(starPoints);

  const core = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeRadialTexture(),
    color: 0xffd69a,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }));
  core.scale.set(38, 18, 1);
  galaxy.add(core);

  const dust = createDustLayer(stars, mobile ? 4500 : 12000);
  galaxy.add(dust);

  const nebulae = new THREE.Group();
  for (const nebula of galaxySystem.getNebulae()) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeCloudTexture(nebula.hue),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    sprite.position.set(nebula.position.x, nebula.position.y, nebula.position.z);
    sprite.scale.setScalar(nebula.radius * 2.4);
    sprite.userData.baseOpacity = nebula.density * 0.24;
    nebulae.add(sprite);
  }
  galaxy.add(nebulae);

  const localMarker = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeRadialTexture(),
    color: 0x75c8ff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }));
  const localStar = galaxySystem.getLocalStar();
  localMarker.position.set(localStar.position.x, localStar.position.y, localStar.position.z);
  localMarker.scale.set(3.5, 3.5, 1);
  galaxy.add(localMarker);

  let lastWidth = 0;
  let lastHeight = 0;
  let visibleAmount = 0;

  function resize() {
    const rect = container.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    if (width === lastWidth && height === lastHeight) return;
    lastWidth = width;
    lastHeight = height;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function render(cameraDistance, timestamp = performance.now()) {
    resize();
    visibleAmount = smoothstep(38, 52, cameraDistance);
    renderer.domElement.style.opacity = String(visibleAmount);
    if (visibleAmount < 0.005) return;

    starMaterial.uniforms.opacity.value = visibleAmount * 0.92;
    core.material.opacity = visibleAmount * 0.42;
    dust.material.opacity = visibleAmount * 0.13;
    localMarker.material.opacity = visibleAmount * (0.45 + Math.sin(timestamp * 0.004) * 0.2);
    for (const sprite of nebulae.children) {
      sprite.material.opacity = visibleAmount * sprite.userData.baseOpacity;
    }

    const zoom = smoothstep(40, 52, cameraDistance);
    camera.position.set(
      0,
      70 + zoom * 82,
      150 + zoom * 115,
    );
    camera.lookAt(0, 0, 0);
    galaxy.rotation.y += mobile ? 0.00008 : 0.00013;
    renderer.render(scene, camera);
  }

  return {
    render,
    getVisibleAmount: () => visibleAmount,
    get element() { return renderer.domElement; },
  };
}

function createDustLayer(stars, count) {
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index++) {
    const star = stars[(index * 37) % stars.length];
    positions[index * 3] = star.position.x + (Math.random() - 0.5) * 2.5;
    positions[index * 3 + 1] = star.position.y * 0.35 + (Math.random() - 0.5) * 1.4;
    positions[index * 3 + 2] = star.position.z + (Math.random() - 0.5) * 2.5;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return new THREE.Points(geometry, new THREE.PointsMaterial({
    color: 0x5f4664,
    size: 0.46,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  }));
}

function makeRadialTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.18, 'rgba(255,235,190,.85)');
  gradient.addColorStop(0.52, 'rgba(255,150,75,.22)');
  gradient.addColorStop(1, 'rgba(255,100,30,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

function makeCloudTexture(hue) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 96;
  const context = canvas.getContext('2d');
  const color = `hsla(${Math.floor(hue * 320)},75%,65%,`;
  for (let index = 0; index < 22; index++) {
    const x = 18 + Math.random() * 60;
    const y = 18 + Math.random() * 60;
    const radius = 8 + Math.random() * 25;
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `${color}${0.06 + Math.random() * 0.11})`);
    gradient.addColorStop(1, `${color}0)`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, 96, 96);
  }
  return new THREE.CanvasTexture(canvas);
}

function smoothstep(edge0, edge1, value) {
  const x = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return x * x * (3 - 2 * x);
}
