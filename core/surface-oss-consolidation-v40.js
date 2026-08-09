import * as THREE from 'three';

// v40 consolidates rendering ideas already proven in mature open-source globe/
// terrain engines without replacing the known-good v39 renderer:
// - Cesium: screen-space-error diagnostics, spherical horizon culling
// - deck.gl: retain best-available/view-priority behavior from v37
// - Terrain3D: terrain edge skirts + altitude-aware foliage LOD
// - WorldWind/OpenSpace: atmosphere shell tied to the real Sun / local globe
// Nullschool-style cached bilinear weather remains in v39.
(() => {
  if (window.realitySandboxSurfaceOssV40?.installed) return;

  const SKIRT_DEPTH = 6.5;
  const HORIZON_MARGIN = 90;
  const REAR_CULL_DOT = -0.20;
  const REAR_CULL_DISTANCE = 620;
  const SSE_TARGET_PIXELS = 2.0;
  const tracked = new Map();
  const stats = {
    frames: 0,
    activeFrames: 0,
    terrainMeshesObserved: 0,
    waterMeshesObserved: 0,
    skirtsBuilt: 0,
    skirtTriangles: 0,
    horizonCullTests: 0,
    horizonCulled: 0,
    rearCulled: 0,
    visibleTrackedMeshes: 0,
    screenSpaceErrorSamples: 0,
    averageScreenSpaceError: 0,
    maxScreenSpaceError: 0,
    foliageLodChanges: 0,
    atmosphereFrames: 0,
  };

  let runtime = null;
  let atmosphere = null;
  let atmosphereMaterial = null;
  let lastFoliageMode = '';
  let lastSurfaceActive = false;

  const tmpBox = new THREE.Box3();
  const tmpSize = new THREE.Vector3();
  const tmpCenter = new THREE.Vector3();
  const tmpForward = new THREE.Vector3();
  const tmpToTile = new THREE.Vector3();
  const tmpViewport = new THREE.Vector2();
  const tmpSun = new THREE.Vector3();

  function isWaterMesh(object) {
    return Boolean(
      object?.isMesh &&
      !object.userData?.surfaceOssV40Skirt &&
      !object.userData?.surfaceOssV40Fallback &&
      object.material?.isShaderMaterial &&
      object.geometry?.getAttribute?.('waterStrength') &&
      object.geometry?.getAttribute?.('position')
    );
  }

  function isTerrainMesh(object) {
    if (!object?.isMesh || object.userData?.surfaceOssV40Skirt || object.userData?.surfaceOssV40Fallback) return false;
    if (object.geometry?.type !== 'PlaneGeometry') return false;
    if (!object.material?.isMeshStandardMaterial || !object.material?.vertexColors) return false;
    if (!object.geometry?.getAttribute?.('position') || object.geometry?.getAttribute?.('waterStrength')) return false;
    return true;
  }

  function inferSegments(geometry) {
    const count = geometry?.getAttribute?.('position')?.count || 0;
    const side = Math.round(Math.sqrt(count));
    return side > 1 && side * side === count ? side - 1 : 0;
  }

  function buildSkirt(mesh) {
    if (mesh.userData?.surfaceOssV40SkirtBuilt) return;
    const geometry = mesh.geometry;
    const positions = geometry?.getAttribute?.('position');
    const colors = geometry?.getAttribute?.('color');
    const segments = inferSegments(geometry);
    if (!positions || segments < 2) return;

    const side = segments + 1;
    const perimeter = [];
    for (let x = 0; x < side; x++) perimeter.push(x);
    for (let z = 1; z < side; z++) perimeter.push(z * side + (side - 1));
    for (let x = side - 2; x >= 0; x--) perimeter.push((side - 1) * side + x);
    for (let z = side - 2; z > 0; z--) perimeter.push(z * side);
    if (perimeter.length < 4) return;

    const skirtPositions = [];
    const skirtColors = [];
    const pushVertex = (index, drop) => {
      skirtPositions.push(positions.getX(index), positions.getY(index) - drop, positions.getZ(index));
      if (colors) skirtColors.push(colors.getX(index), colors.getY(index), colors.getZ(index));
    };

    for (let i = 0; i < perimeter.length; i++) {
      const a = perimeter[i];
      const b = perimeter[(i + 1) % perimeter.length];
      pushVertex(a, 0);
      pushVertex(a, SKIRT_DEPTH);
      pushVertex(b, 0);
      pushVertex(b, 0);
      pushVertex(a, SKIRT_DEPTH);
      pushVertex(b, SKIRT_DEPTH);
    }

    const skirtGeometry = new THREE.BufferGeometry();
    skirtGeometry.setAttribute('position', new THREE.Float32BufferAttribute(skirtPositions, 3));
    if (colors) skirtGeometry.setAttribute('color', new THREE.Float32BufferAttribute(skirtColors, 3));
    skirtGeometry.computeVertexNormals();
    skirtGeometry.computeBoundingSphere();

    const skirt = new THREE.Mesh(skirtGeometry, mesh.material);
    skirt.name = 'surfaceTerrainSkirtV40';
    skirt.userData.surfaceOssV40Skirt = true;
    skirt.frustumCulled = false;
    skirt.castShadow = false;
    skirt.receiveShadow = false;
    mesh.add(skirt);
    mesh.userData.surfaceOssV40SkirtBuilt = true;
    stats.skirtsBuilt++;
    stats.skirtTriangles += skirtPositions.length / 9;
  }

  function observe(object) {
    if (isTerrainMesh(object)) {
      const segments = inferSegments(object.geometry);
      object.geometry.computeBoundingBox?.();
      const box = object.geometry.boundingBox;
      let radius = 300;
      if (box) {
        box.getSize(tmpSize);
        radius = Math.hypot(tmpSize.x, tmpSize.z) * 0.5 * Math.max(object.scale.x || 1, object.scale.z || 1);
      }
      tracked.set(object, { kind: 'terrain', segments, radius });
      stats.terrainMeshesObserved++;
      buildSkirt(object);
      return;
    }
    if (isWaterMesh(object)) {
      object.geometry.computeBoundingBox?.();
      const box = object.geometry.boundingBox;
      let radius = 300;
      if (box) {
        box.getSize(tmpSize);
        radius = Math.hypot(tmpSize.x, tmpSize.z) * 0.5 * Math.max(object.scale.x || 1, object.scale.z || 1);
      }
      tracked.set(object, { kind: 'water', segments: inferSegments(object.geometry), radius });
      stats.waterMeshesObserved++;
    }
  }

  const nativeSceneAdd = THREE.Scene.prototype.add;
  THREE.Scene.prototype.add = function surfaceOssObserveAdd(...objects) {
    const result = nativeSceneAdd.apply(this, objects);
    for (const object of objects) observe(object);
    return result;
  };

  const nativeSceneRemove = THREE.Scene.prototype.remove;
  THREE.Scene.prototype.remove = function surfaceOssObserveRemove(...objects) {
    for (const object of objects) tracked.delete(object);
    return nativeSceneRemove.apply(this, objects);
  };

  async function waitForRuntime() {
    for (let i = 0; i < 360; i++) {
      const planet = window.realitySandboxPlanet;
      const mode = window.realitySandboxSurfaceMode;
      const surface = window.realitySandboxSurfaceSphereV37;
      const hook = window.realitySandboxSurfaceLightHookV36;
      const objects = hook?.getObjects?.();
      if (
        planet?.world && mode?.getPlayer && mode?.isActive && surface?.getStats &&
        objects?.scene && objects?.camera
      ) return { planet, mode, surface, hook };
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    return null;
  }

  function installAtmosphere(state) {
    const objects = state.hook.getObjects();
    const scene = objects.scene;
    const surfaceStats = state.surface.getStats();
    const radius = Number(surfaceStats.curvatureRadius) || 2640;
    const shellRadius = radius + 210;

    const geometry = new THREE.SphereGeometry(shellRadius, 36, 20);
    atmosphereMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.BackSide,
      blending: THREE.NormalBlending,
      uniforms: {
        center: { value: new THREE.Vector3(0, -radius, 0) },
        sunDirection: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
        daylight: { value: 1 },
        strength: { value: 0.55 },
        dayColor: { value: new THREE.Color(0x78b7d8) },
        horizonColor: { value: new THREE.Color(0xcad8d9) },
        nightColor: { value: new THREE.Color(0x07111e) },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorldPosition = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: `
        uniform vec3 center;
        uniform vec3 sunDirection;
        uniform float daylight;
        uniform float strength;
        uniform vec3 dayColor;
        uniform vec3 horizonColor;
        uniform vec3 nightColor;
        varying vec3 vWorldPosition;
        void main() {
          vec3 radial = normalize(vWorldPosition - center);
          vec3 viewDir = normalize(cameraPosition - vWorldPosition);
          float tangent = clamp(1.0 - abs(dot(radial, viewDir)), 0.0, 1.0);
          float horizon = pow(tangent, 1.35);
          float sunGlow = pow(max(dot(-viewDir, normalize(sunDirection)), 0.0), 18.0);
          vec3 base = mix(nightColor, dayColor, clamp(daylight, 0.0, 1.0));
          vec3 color = mix(base, horizonColor, horizon * (0.30 + daylight * 0.32));
          color += vec3(1.0, 0.72, 0.38) * sunGlow * daylight * 0.14;
          float alpha = (0.045 + horizon * 0.19 + sunGlow * 0.035) * strength;
          gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.28));
        }
      `,
    });

    atmosphere = new THREE.Mesh(geometry, atmosphereMaterial);
    atmosphere.name = 'surfaceAtmosphereV40';
    atmosphere.position.set(0, -radius, 0);
    atmosphere.frustumCulled = false;
    atmosphere.renderOrder = -20;
    scene.add(atmosphere);
  }

  function screenSpaceError(mesh, record, camera, renderer) {
    const positions = mesh.geometry?.getAttribute?.('position');
    if (!positions || record.segments < 1) return 0;
    mesh.getWorldPosition(tmpCenter);
    const distance = Math.max(1, camera.position.distanceTo(tmpCenter));
    renderer.getSize(tmpViewport);
    const viewportHeight = Math.max(1, tmpViewport.y);
    const fov = Math.max(1, Number(camera.fov) || 100) * Math.PI / 180;
    const tileDiameter = Math.max(1, record.radius * 2 / Math.SQRT2);
    const geometricError = tileDiameter / record.segments;
    const pixelsPerWorld = viewportHeight / (2 * Math.tan(fov * 0.5) * distance);
    return geometricError * pixelsPerWorld;
  }

  function applyFoliageLod(scene, altitude, sse) {
    const group = scene.getObjectByName?.('surfaceVegetationV38');
    if (!group || group.children.length < 4) return;

    let mode = 'full';
    if (altitude > 390 || sse < 0.7) mode = 'far-only';
    else if (altitude > 235 || sse < 1.15) mode = 'canopy-far';
    else if (altitude > 125 || sse < 1.7) mode = 'reduced-ground';

    // Child order from v38: trunks, canopies, shrubs, simplified distant plants.
    const [trunks, canopies, shrubs, far] = group.children;
    if (mode === 'full') {
      trunks.visible = true; canopies.visible = true; shrubs.visible = true; far.visible = true;
    } else if (mode === 'reduced-ground') {
      trunks.visible = true; canopies.visible = true; shrubs.visible = false; far.visible = true;
    } else if (mode === 'canopy-far') {
      trunks.visible = false; canopies.visible = true; shrubs.visible = false; far.visible = true;
    } else {
      trunks.visible = false; canopies.visible = false; shrubs.visible = false; far.visible = true;
    }

    if (mode !== lastFoliageMode) {
      lastFoliageMode = mode;
      stats.foliageLodChanges++;
      document.documentElement.dataset.surfaceFoliageLodV40 = mode;
    }
  }

  function updateAtmosphere(state, altitude) {
    if (!atmosphere || !atmosphereMaterial) return;
    const objects = state.hook.getObjects();
    const celestial = window.realitySandboxSurfaceCelestialsV38?.getStats?.();
    const daylight = Number.isFinite(celestial?.daylight) ? celestial.daylight : 1;
    atmosphere.visible = state.mode.isActive?.() && document.documentElement.dataset.surfaceMode === 'active';
    atmosphereMaterial.uniforms.daylight.value = daylight;

    if (objects.sun?.position) {
      tmpSun.copy(objects.sun.position).normalize();
      atmosphereMaterial.uniforms.sunDirection.value.copy(tmpSun);
    }

    const radius = Number(state.surface.getStats().curvatureRadius) || 2640;
    const flightFade = THREE.MathUtils.clamp(1 - altitude / Math.max(650, radius * 0.32), 0.28, 1);
    atmosphereMaterial.uniforms.strength.value = 0.42 + flightFade * 0.28;
    stats.atmosphereFrames++;
  }

  function update(state) {
    const objects = state.hook.getObjects();
    const scene = objects.scene;
    const camera = objects.camera;
    const renderer = objects.renderer;
    if (!scene || !camera || !renderer) return;

    const player = state.mode.getPlayer();
    const altitude = Math.max(3.6, Number(player?.altitude) || 3.6);
    const radius = Number(state.surface.getStats().curvatureRadius) || 2640;
    const horizonDistance = Math.sqrt(Math.max(0, 2 * radius * altitude + altitude * altitude));
    camera.getWorldDirection(tmpForward).normalize();

    let visible = 0;
    let terrainSseTotal = 0;
    let terrainSseCount = 0;
    let maxSse = 0;

    for (const [mesh, record] of [...tracked.entries()]) {
      if (!mesh?.parent) {
        tracked.delete(mesh);
        continue;
      }
      mesh.getWorldPosition(tmpCenter);
      const dx = tmpCenter.x - camera.position.x;
      const dz = tmpCenter.z - camera.position.z;
      const horizontalDistance = Math.hypot(dx, dz);
      const worldDistance = Math.max(1, camera.position.distanceTo(tmpCenter));
      stats.horizonCullTests++;

      const beyondHorizon = horizontalDistance - record.radius > horizonDistance + HORIZON_MARGIN;
      tmpToTile.copy(tmpCenter).sub(camera.position).normalize();
      const rearDot = tmpForward.dot(tmpToTile);
      const behindCamera = altitude < 300 && worldDistance > REAR_CULL_DISTANCE && rearDot < REAR_CULL_DOT;
      const shouldShow = !beyondHorizon && !behindCamera;
      mesh.visible = shouldShow;
      if (!shouldShow) {
        if (beyondHorizon) stats.horizonCulled++;
        else stats.rearCulled++;
        continue;
      }
      visible++;

      if (record.kind === 'terrain') {
        const sse = screenSpaceError(mesh, record, camera, renderer);
        terrainSseTotal += sse;
        terrainSseCount++;
        maxSse = Math.max(maxSse, sse);
        stats.screenSpaceErrorSamples++;
      }
    }

    stats.visibleTrackedMeshes = visible;
    stats.averageScreenSpaceError = terrainSseCount ? terrainSseTotal / terrainSseCount : 0;
    stats.maxScreenSpaceError = maxSse;

    applyFoliageLod(scene, altitude, stats.averageScreenSpaceError);
    updateAtmosphere(state, altitude);

    document.documentElement.dataset.surfaceSseV40 = stats.averageScreenSpaceError.toFixed(2);
    document.documentElement.dataset.surfaceHorizonDistanceV40 = horizonDistance.toFixed(1);
  }

  function start(state) {
    runtime = state;
    installAtmosphere(state);

    function loop() {
      requestAnimationFrame(loop);
      stats.frames++;
      const active = state.mode.isActive?.() && document.documentElement.dataset.surfaceMode === 'active';
      if (!active) {
        if (lastSurfaceActive) {
          lastSurfaceActive = false;
          if (atmosphere) atmosphere.visible = false;
        }
        return;
      }
      lastSurfaceActive = true;
      stats.activeFrames++;
      update(state);
    }
    requestAnimationFrame(loop);
  }

  const api = {
    installed: true,
    getStats: () => ({
      ...stats,
      active: Boolean(runtime?.mode?.isActive?.() && document.documentElement.dataset.surfaceMode === 'active'),
      screenSpaceErrorEnabled: true,
      screenSpaceErrorTargetPixels: SSE_TARGET_PIXELS,
      sphericalHorizonCulling: true,
      rearViewCulling: true,
      terrainSkirts: true,
      terrainGeomorphContinuityStrategy: 'edge-skirts-best-available',
      altitudeAwareFoliageLod: true,
      atmosphereShell: Boolean(atmosphere),
      atmosphereSunCoupled: true,
      inheritedBestAvailableRefinement: Boolean(window.realitySandboxSurfaceSphereV37?.getStats?.().bestAvailableRefinement),
      inheritedViewPriority: Boolean(window.realitySandboxSurfaceSphereV37?.getStats?.().viewPriorityEnabled),
      inheritedBoundedNearCache: Number(window.realitySandboxSurfaceSphereV37?.getStats?.().nearCacheLimit || 0),
      inheritedCachedBilinearWeather: Boolean(window.realitySandboxSurfaceWeatherV39?.getStats?.().bilinearInterpolation),
      globalDisplayCap: false,
      renderLoopProceduralSamples: 0,
    }),
  };

  window.realitySandboxSurfaceOssV40 = api;
  document.documentElement.dataset.surfaceOssV40 = 'sse-horizon-skirts-atmosphere';

  const previousDiagnostics = window.realitySandboxPresentationDiagnostics;
  window.realitySandboxPresentationDiagnostics = () => ({
    ...(typeof previousDiagnostics === 'function' ? previousDiagnostics() : {}),
    surfaceOssV40: api.getStats(),
  });

  waitForRuntime().then(state => {
    if (!state) {
      document.documentElement.dataset.surfaceOssV40 = 'unavailable';
      return;
    }
    start(state);
  });
})();

