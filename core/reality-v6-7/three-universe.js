import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const BODY_COLORS = {
  0: 0xffd36a,
  1: 0x87a9e8,
  2: 0x4ebf87,
  3: 0xdfe8f2,
  4: 0x8c949e,
  5: 0xb6c2d6,
};
const BODY_BASE_RADIUS = { 0: 8.2, 1: 1.45, 2: 2.15, 3: 0.62, 4: 0.16, 5: 0.8 };
const BODY_MIN_PIXELS = { 0: 22, 1: 7, 2: 10, 3: 5.5, 4: 1.25, 5: 5 };
const SYSTEM_OFFSETS = [
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(520, 120, -390),
  new THREE.Vector3(-540, -150, 430),
  new THREE.Vector3(160, -260, 690),
];

function makeLabelTexture(text, color = '#dcecff') {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = '600 42px system-ui';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.shadowColor = 'rgba(0,0,0,.9)';
  context.shadowBlur = 12;
  context.fillStyle = color;
  context.fillText(text, 256, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  return texture;
}

function logarithmicPosition(body, livingBody = null) {
  if (body.type === 3 && livingBody) {
    const living = logarithmicPosition(livingBody, null);
    const dx = body.x - livingBody.x;
    const dy = body.y - livingBody.y;
    const dz = body.z - livingBody.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance <= 1e-12) return living;
    const renderedDistance = Math.max(2.4, Math.log1p(distance * 10_000) * 1.55);
    return new THREE.Vector3(
      living.x + dx / distance * renderedDistance,
      living.y + dz / distance * renderedDistance,
      living.z + dy / distance * renderedDistance,
    );
  }

  const distance = Math.hypot(body.x, body.y, body.z);
  if (distance <= 1e-12) return new THREE.Vector3();
  const renderedDistance = Math.log1p(distance * 12) * 21;
  return new THREE.Vector3(
    body.x / distance * renderedDistance,
    body.z / distance * renderedDistance,
    body.y / distance * renderedDistance,
  );
}

function seededRandom(seed) {
  let value = seed >>> 0 || 1;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 4294967296;
  };
}

export class ThreeReboundUniverse {
  constructor(canvas, { mobile = false } = {}) {
    this.canvas = canvas;
    this.mobile = mobile;
    this.active = false;
    this.autoScale = true;
    this.systems = [];
    this.flashes = [];
    this.fly = null;
    this.clock = new THREE.Clock();
    this.lastRender = 0;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !mobile,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, mobile ? 1.1 : 1.7));
    this.renderer.setClearColor(0x01040a, 1);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x01040a, 0.00025);
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.05, 5000);
    this.camera.position.set(0, 78, 150);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.minDistance = 7;
    this.controls.maxDistance = 2200;
    this.controls.zoomToCursor = true;

    this.scene.add(new THREE.HemisphereLight(0x9bb9de, 0x080b12, 0.22));
    this._addStarField(mobile ? 750 : 1800);
    this._addInterstellarGuide();
    this.renderer.setAnimationLoop((time) => this._render(time));
  }

  _addStarField(count) {
    const random = seededRandom(0x7f4a7c15);
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const color = new THREE.Color();
    for (let index = 0; index < count; index += 1) {
      const radius = 900 + random() * 1700;
      const azimuth = random() * Math.PI * 2;
      const elevation = Math.asin(random() * 2 - 1);
      positions[index * 3] = Math.cos(elevation) * Math.cos(azimuth) * radius;
      positions[index * 3 + 1] = Math.sin(elevation) * radius;
      positions[index * 3 + 2] = Math.cos(elevation) * Math.sin(azimuth) * radius;
      color.setHSL(0.53 + random() * 0.12, 0.2 + random() * 0.35, 0.72 + random() * 0.26);
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size: this.mobile ? 1.15 : 1.4,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
    });
    this.scene.add(new THREE.Points(geometry, material));
  }

  _addInterstellarGuide() {
    const geometry = new THREE.BufferGeometry().setFromPoints(SYSTEM_OFFSETS);
    const material = new THREE.LineDashedMaterial({
      color: 0x365071,
      transparent: true,
      opacity: 0.22,
      dashSize: 12,
      gapSize: 10,
    });
    const line = new THREE.Line(geometry, material);
    line.computeLineDistances();
    this.scene.add(line);
  }

  addSystem({ name, seed, index }) {
    const group = new THREE.Group();
    const offset = SYSTEM_OFFSETS[index] || new THREE.Vector3(index * 480, 0, 0);
    group.position.copy(offset);
    this.scene.add(group);

    const system = {
      index,
      name,
      seed,
      group,
      offset,
      meshes: new Map(),
      trails: new Map(),
      trailData: new Map(),
      asteroidPositions: [],
      asteroidMesh: null,
      livingPosition: new THREE.Vector3(),
      bodyPositions: new Map(),
      label: null,
      pointLight: null,
      stats: null,
    };

    const labelMaterial = new THREE.SpriteMaterial({
      map: makeLabelTexture(`${name} · ${seed}`, '#b8d7ff'),
      transparent: true,
      depthWrite: false,
    });
    const label = new THREE.Sprite(labelMaterial);
    label.scale.set(78, 19.5, 1);
    label.position.set(0, 36, 0);
    group.add(label);
    system.label = label;

    const asteroidGeometry = new THREE.IcosahedronGeometry(1, 0);
    const asteroidMaterial = new THREE.MeshStandardMaterial({
      color: 0x8d9298,
      roughness: 0.92,
      metalness: 0.04,
    });
    const asteroidCapacity = this.mobile ? 72 : 160;
    const asteroidMesh = new THREE.InstancedMesh(asteroidGeometry, asteroidMaterial, asteroidCapacity);
    asteroidMesh.count = 0;
    asteroidMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    asteroidMesh.frustumCulled = false;
    group.add(asteroidMesh);
    system.asteroidMesh = asteroidMesh;

    this.systems.push(system);
    return system;
  }

  _createBodyMesh(system, body) {
    const segments = this.mobile ? 16 : 28;
    const geometry = new THREE.SphereGeometry(1, segments, Math.max(10, Math.floor(segments * 0.65)));
    let material;
    if (body.type === 0) {
      material = new THREE.MeshBasicMaterial({ color: BODY_COLORS[0] });
    } else {
      material = new THREE.MeshStandardMaterial({
        color: BODY_COLORS[body.type] || BODY_COLORS[5],
        roughness: body.type === 2 ? 0.72 : 0.84,
        metalness: body.type === 1 ? 0.08 : 0.02,
        emissive: body.type === 2 ? 0x032418 : 0x000000,
        emissiveIntensity: body.type === 2 ? 0.18 : 0,
      });
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData = {
      bodyName: body.name,
      bodyType: body.type,
      baseRadius: BODY_BASE_RADIUS[body.type] || BODY_BASE_RADIUS[5],
      minPixels: BODY_MIN_PIXELS[body.type] || BODY_MIN_PIXELS[5],
    };
    system.group.add(mesh);

    if (body.type === 0) {
      const light = new THREE.PointLight(0xffe6a2, this.mobile ? 90 : 145, 340, 1.35);
      light.position.copy(mesh.position);
      system.group.add(light);
      system.pointLight = light;

      const glowMaterial = new THREE.SpriteMaterial({
        map: makeLabelTexture('✦', '#ffe28a'),
        color: 0xffdf8c,
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const glow = new THREE.Sprite(glowMaterial);
      glow.scale.set(28, 28, 1);
      mesh.add(glow);
    }

    system.meshes.set(body.name, mesh);
    return mesh;
  }

  _updateTrail(system, body, position) {
    if (body.type === 0 || body.type === 4) return;
    const key = body.name;
    let points = system.trailData.get(key);
    if (!points) {
      points = [];
      system.trailData.set(key, points);
    }
    const previous = points[points.length - 1];
    if (previous && previous.distanceToSquared(position) < 0.03) return;
    points.push(position.clone());
    const limit = this.mobile ? 58 : 150;
    if (points.length > limit) points.splice(0, points.length - limit);

    let line = system.trails.get(key);
    if (!line) {
      const geometry = new THREE.BufferGeometry();
      const material = new THREE.LineBasicMaterial({
        color: BODY_COLORS[body.type] || BODY_COLORS[5],
        transparent: true,
        opacity: body.type === 3 ? 0.42 : 0.3,
        depthWrite: false,
      });
      line = new THREE.Line(geometry, material);
      system.group.add(line);
      system.trails.set(key, line);
    }
    line.geometry.dispose();
    line.geometry = new THREE.BufferGeometry().setFromPoints(points);
  }

  updateSystem(index, bodies, stats) {
    const system = this.systems[index];
    if (!system) return;
    system.stats = stats;
    const livingBody = bodies.find((body) => body.type === 2) || bodies[stats?.livingIndex] || null;
    system.bodyPositions.clear();
    const activeNames = new Set();
    const asteroidPositions = [];

    for (const body of bodies) {
      const position = logarithmicPosition(body, livingBody);
      system.bodyPositions.set(body.name, position);
      if (body.type === 2) system.livingPosition.copy(position);
      if (body.type === 4) {
        asteroidPositions.push(position);
        continue;
      }
      activeNames.add(body.name);
      const mesh = system.meshes.get(body.name) || this._createBodyMesh(system, body);
      mesh.position.copy(position);
      mesh.visible = true;
      if (body.type === 0 && system.pointLight) system.pointLight.position.copy(position);
      this._updateTrail(system, body, position);
    }

    for (const [name, mesh] of system.meshes) {
      if (!activeNames.has(name)) mesh.visible = false;
    }

    system.asteroidPositions = asteroidPositions.slice(0, system.asteroidMesh.instanceMatrix.count);
    this._updateAsteroidInstances(system, true);
  }

  _updateAsteroidInstances(system, force = false) {
    if (!system.asteroidMesh) return;
    const distance = this.camera.position.distanceTo(system.offset);
    const pixelWorld = 2 * distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5)) /
      Math.max(1, this.renderer.domElement.clientHeight);
    const scale = this.autoScale ? Math.max(0.12, pixelWorld * (this.mobile ? 1.05 : 1.35)) : 0.16;
    if (!force && Math.abs(scale - (system.asteroidScale || 0)) < scale * 0.08) return;
    system.asteroidScale = scale;
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const vectorScale = new THREE.Vector3(scale, scale, scale);
    const count = Math.min(system.asteroidPositions.length, system.asteroidMesh.instanceMatrix.count);
    system.asteroidMesh.count = count;
    for (let index = 0; index < count; index += 1) {
      matrix.compose(system.asteroidPositions[index], quaternion, vectorScale);
      system.asteroidMesh.setMatrixAt(index, matrix);
    }
    system.asteroidMesh.instanceMatrix.needsUpdate = true;
  }

  setActive(active) {
    this.active = Boolean(active);
    if (active) {
      this.resize();
      this.clock.start();
    }
  }

  setAutoScale(enabled) {
    this.autoScale = Boolean(enabled);
  }

  resize() {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  travelToSystem(index, { living = false } = {}) {
    const system = this.systems[index];
    if (!system) return;
    const target = system.offset.clone().add(living ? system.livingPosition : new THREE.Vector3());
    const distance = living ? 30 : 155;
    const destination = target.clone().add(new THREE.Vector3(distance * 0.62, distance * 0.35, distance));
    this.fly = {
      started: performance.now(),
      duration: 1200,
      fromPosition: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      toPosition: destination,
      toTarget: target,
    };
  }

  focusLivingWorld(index) {
    this.travelToSystem(index, { living: true });
  }

  flashImpact(systemIndex, bodyName = 'Living World', intensity = 1) {
    const system = this.systems[systemIndex];
    const local = system?.bodyPositions.get(bodyName);
    if (!system || !local) return;
    const geometry = new THREE.SphereGeometry(1, this.mobile ? 12 : 20, this.mobile ? 8 : 14);
    const material = new THREE.MeshBasicMaterial({
      color: 0xff6d3d,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      wireframe: true,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(system.offset).add(local);
    mesh.scale.setScalar(2.5);
    this.scene.add(mesh);
    this.flashes.push({ mesh, age: 0, intensity: Math.max(0.5, intensity) });
  }

  _updateAutomaticScales() {
    const height = Math.max(1, this.renderer.domElement.clientHeight);
    const tangent = Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5));
    for (const system of this.systems) {
      for (const mesh of system.meshes.values()) {
        if (!mesh.visible) continue;
        const worldPosition = new THREE.Vector3();
        mesh.getWorldPosition(worldPosition);
        const distance = Math.max(0.1, this.camera.position.distanceTo(worldPosition));
        const pixelWorld = 2 * distance * tangent / height;
        const baseRadius = mesh.userData.baseRadius;
        const screenRadius = pixelWorld * mesh.userData.minPixels;
        const renderedRadius = this.autoScale ? Math.max(baseRadius, screenRadius) : baseRadius;
        mesh.scale.setScalar(renderedRadius);
      }
      this._updateAsteroidInstances(system);
      const systemDistance = this.camera.position.distanceTo(system.offset);
      system.label.visible = systemDistance > 120;
      const labelScale = Math.max(55, systemDistance * 0.08);
      system.label.scale.set(labelScale, labelScale * 0.25, 1);
    }
  }

  _updateFly(time) {
    if (!this.fly) return;
    const elapsed = (time - this.fly.started) / this.fly.duration;
    const t = THREE.MathUtils.clamp(elapsed, 0, 1);
    const smooth = t * t * (3 - 2 * t);
    this.camera.position.lerpVectors(this.fly.fromPosition, this.fly.toPosition, smooth);
    this.controls.target.lerpVectors(this.fly.fromTarget, this.fly.toTarget, smooth);
    if (t >= 1) this.fly = null;
  }

  _updateFlashes(delta) {
    for (let index = this.flashes.length - 1; index >= 0; index -= 1) {
      const flash = this.flashes[index];
      flash.age += delta;
      const life = 2.4;
      const progress = flash.age / life;
      flash.mesh.scale.setScalar(2.5 + progress * 24 * flash.intensity);
      flash.mesh.material.opacity = Math.max(0, 0.9 * (1 - progress));
      if (progress >= 1) {
        this.scene.remove(flash.mesh);
        flash.mesh.geometry.dispose();
        flash.mesh.material.dispose();
        this.flashes.splice(index, 1);
      }
    }
  }

  _render(time) {
    if (!this.active) return;
    const minimumFrameInterval = this.mobile ? 1000 / 30 : 0;
    if (time - this.lastRender < minimumFrameInterval) return;
    const delta = Math.min(0.1, this.clock.getDelta());
    this.lastRender = time;
    this.resize();
    this._updateFly(time);
    this.controls.update();
    this._updateAutomaticScales();
    this._updateFlashes(delta);
    this.renderer.render(this.scene, this.camera);
  }

  qualityLabel() {
    return `${this.mobile ? 'mobile' : 'desktop'} · ${this.renderer.getPixelRatio().toFixed(2)}× pixel ratio · WebGL2`;
  }
}

export { THREE };
