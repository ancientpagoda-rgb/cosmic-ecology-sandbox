import * as THREE from 'three';

export function createGalaxyRenderLayer(container, galaxySystem, options = {}) {
  const mobile = options.mobile ?? matchMedia('(pointer: coarse)').matches;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(mobile ? 46 : 40, 1, 0.1, 1200);
  camera.position.set(0, 92, 205);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: false,
    powerPreference: mobile ? 'low-power' : 'high-performance',
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, mobile ? 1 : 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.82;
  renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;opacity:0;transition:opacity .3s ease;z-index:2';
  container.append(renderer.domElement);

  const galaxy = new THREE.Group();
  galaxy.rotation.x = -0.18;
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
    const color = restrainedStarColor(star.color);
    colors[index * 3] = color[0];
    colors[index * 3 + 1] = color[1];
    colors[index * 3 + 2] = color[2];
    sizes[index] = Math.min(1.65, star.size * (0.55 + Math.log10(Math.max(1, star.luminosity + 1)) * 0.12));
  }

  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  starGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  starGeometry.setAttribute('starSize', new THREE.BufferAttribute(sizes, 1));

  const starMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
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
        float distanceScale = clamp(145.0 / max(16.0, -mvPosition.z), 0.28, 1.8);
        gl_PointSize = max(1.0, starSize * pixelRatio * distanceScale * 1.45);
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
        float edge = smoothstep(0.5, 0.15, radius);
        float core = smoothstep(0.22, 0.0, radius);
        vec3 color = vColor * (0.72 + core * 0.55);
        gl_FragColor = vec4(color, opacity * edge * (0.72 + core * 0.28));
      }
    `,
  });

  const starPoints = new THREE.Points(starGeometry, starMaterial);
  galaxy.add(starPoints);

  const core = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeRadialTexture(),
    color: 0xd9c6a3,
    transparent: true,
    opacity: 0,
    blending: THREE.NormalBlending,
    depthWrite: false,
  }));
  core.scale.set(31, 13, 1);
  galaxy.add(core);

  const dust = createDustLayer(stars, mobile ? 3200 : 8000);
  galaxy.add(dust);

  const nebulae = new THREE.Group();
  const selectedNebulae = galaxySystem.getNebulae().filter((_, index) => index % 3 === 0);
  for (const nebula of selectedNebulae) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeCloudTexture(),
      color: 0x796f76,
      transparent: true,
      opacity: 0,
      blending: THREE.NormalBlending,
      depthWrite: false,
    }));
    sprite.position.set(nebula.position.x, nebula.position.y, nebula.position.z);
    sprite.scale.setScalar(nebula.radius * 1.5);
    sprite.userData.baseOpacity = nebula.density * 0.065;
    nebulae.add(sprite);
  }
  galaxy.add(nebulae);

  const localMarker = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeRadialTexture(),
    color: 0xb7c6d2,
    transparent: true,
    opacity: 0,
    blending: THREE.NormalBlending,
    depthWrite: false,
  }));
  const localStar = galaxySystem.getLocalStar();
  localMarker.position.set(localStar.position.x, localStar.position.y, localStar.position.z);
  localMarker.scale.set(1.7, 1.7, 1);
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

  function render(cameraDistance) {
    resize();
    visibleAmount = smoothstep(39, 52, cameraDistance);
    renderer.domElement.style.opacity = String(visibleAmount);
    if (visibleAmount < 0.005) return;

    starMaterial.uniforms.opacity.value = visibleAmount * 0.8;
    core.material.opacity = visibleAmount * 0.18;
    dust.material.opacity = visibleAmount * 0.055;
    localMarker.material.opacity = visibleAmount * 0.32;
    for (const sprite of nebulae.children) {
      sprite.material.opacity = visibleAmount * sprite.userData.baseOpacity;
    }

    const zoom = smoothstep(40, 52, cameraDistance);
    camera.position.set(0, 82 + zoom * 92, 180 + zoom * 130);
    camera.lookAt(0, 0, 0);
    galaxy.rotation.y += mobile ? 0.000025 : 0.00004;
    renderer.render(scene, camera);
  }

  return {
    render,
    getVisibleAmount: () => visibleAmount,
    get element() { return renderer.domElement; },
  };
}

function restrainedStarColor(color) {
  const average = (color[0] + color[1] + color[2]) / 3;
  return color.map(channel => average + (channel - average) * 0.45);
}

function createDustLayer(stars, count) {
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index++) {
    const star = stars[(index * 37) % stars.length];
    positions[index * 3] = star.position.x + (Math.random() - 0.5) * 2.2;
    positions[index * 3 + 1] = star.position.y * 0.28 + (Math.random() - 0.5) * 0.9;
    positions[index * 3 + 2] = star.position.z + (Math.random() - 0.5) * 2.2;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return new THREE.Points(geometry, new THREE.PointsMaterial({
    color: 0x3c3a40,
    size: 0.32,
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
  gradient.addColorStop(0, 'rgba(255,255,255,.92)');
  gradient.addColorStop(0.12, 'rgba(235,228,214,.48)');
  gradient.addColorStop(0.48, 'rgba(180,165,145,.10)');
  gradient.addColorStop(1, 'rgba(120,110,100,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

function makeCloudTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 96;
  const context = canvas.getContext('2d');
  for (let index = 0; index < 14; index++) {
    const x = 20 + Math.random() * 56;
    const y = 20 + Math.random() * 56;
    const radius = 10 + Math.random() * 22;
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, 'rgba(165,154,164,.055)');
    gradient.addColorStop(1, 'rgba(110,105,116,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 96, 96);
  }
  return new THREE.CanvasTexture(canvas);
}

function smoothstep(edge0, edge1, value) {
  const x = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return x * x * (3 - 2 * x);
}
