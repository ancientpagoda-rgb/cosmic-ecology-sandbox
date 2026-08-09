import * as THREE from 'three';

(() => {
  if (window.realitySandboxSurfaceWaterStabilityV38b?.installed) return;

  const WET = 0.145;
  const MAX_EDGE_SLOPE = 0.34;
  const MAX_INLAND_TRIANGLE_SLOPE = 0.95;
  const nativeAdd = THREE.Scene.prototype.add;
  const stats = {
    meshesProcessed: 0,
    trianglesBefore: 0,
    trianglesAfter: 0,
    trianglesRemoved: 0,
    wetVerticesSmoothed: 0,
    materialsPatched: 0,
  };

  function looksLikeSurfaceWater(object) {
    const material = object?.material;
    const geometry = object?.geometry;
    return Boolean(
      object?.isMesh &&
      material?.isShaderMaterial &&
      material.uniforms?.time &&
      material.uniforms?.deepColor &&
      material.uniforms?.shallowColor &&
      geometry?.getAttribute?.('position') &&
      geometry?.getAttribute?.('waterStrength')
    );
  }

  function patchMaterial(material) {
    if (material.userData?.surfaceWaterV38b) return;
    material.userData.surfaceWaterV38b = true;
    material.transparent = false;
    material.depthWrite = true;
    material.depthTest = true;
    material.side = THREE.FrontSide;

    // Keep the mesh itself level. All visible wave motion is calculated per
    // fragment, so coarse LOD water no longer bends into large moving facets.
    material.vertexShader = `
      attribute float waterStrength;
      varying float vWater;
      varying vec2 vWaterPosition;
      void main() {
        vWater = waterStrength;
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWaterPosition = worldPosition.xz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `;
    material.fragmentShader = `
      uniform float time;
      uniform vec3 deepColor;
      uniform vec3 shallowColor;
      varying float vWater;
      varying vec2 vWaterPosition;
      void main() {
        if (vWater < 0.145) discard;
        float strength = smoothstep(0.145, 0.90, vWater);
        float waveA = sin((vWaterPosition.x + time * 4.6) * 0.15);
        float waveB = cos((vWaterPosition.y - time * 3.9) * 0.13);
        float waveC = sin((vWaterPosition.x + vWaterPosition.y + time * 2.1) * 0.055);
        float wave = waveA * 0.45 + waveB * 0.38 + waveC * 0.17;
        float depthMix = clamp(0.22 + strength * 0.67 - wave * 0.035, 0.0, 1.0);
        vec3 color = mix(shallowColor, deepColor, depthMix);
        float glint = pow(max(0.0, wave * 0.5 + 0.5), 6.0) * 0.055;
        color += vec3(glint);
        gl_FragColor = vec4(color, 1.0);
      }
    `;
    material.needsUpdate = true;
    stats.materialsPatched++;
  }

  function stabilizeGeometry(geometry) {
    if (geometry.userData?.surfaceWaterV38b) return;
    geometry.userData.surfaceWaterV38b = true;

    const positions = geometry.getAttribute('position');
    const strengths = geometry.getAttribute('waterStrength');
    const sourceIndex = geometry.index?.array;
    if (!positions || !strengths || !sourceIndex) return;

    const kept = [];
    const adjacency = Array.from({ length: positions.count }, () => new Set());
    const before = Math.floor(sourceIndex.length / 3);

    function connect(a, b) {
      adjacency[a].add(b);
      adjacency[b].add(a);
    }

    for (let i = 0; i < sourceIndex.length; i += 3) {
      const a = sourceIndex[i];
      const b = sourceIndex[i + 1];
      const c = sourceIndex[i + 2];
      const sa = strengths.getX(a);
      const sb = strengths.getX(b);
      const sc = strengths.getX(c);
      const wetCount = (sa >= WET ? 1 : 0) + (sb >= WET ? 1 : 0) + (sc >= WET ? 1 : 0);
      if (wetCount < 2) continue;

      const ya = positions.getY(a);
      const yb = positions.getY(b);
      const yc = positions.getY(c);
      const spread = Math.max(ya, yb, yc) - Math.min(ya, yb, yc);
      const fullyWet = wetCount === 3;
      const seaLike = Math.min(sa, sb, sc) > 0.96 && (ya + yb + yc) / 3 < 35.5;

      // A wet/dry boundary is only allowed across nearly-level ground. This
      // removes the triangular sheets that previously climbed cliff faces.
      if (!fullyWet && spread > MAX_EDGE_SLOPE) continue;
      if (fullyWet && !seaLike && spread > MAX_INLAND_TRIANGLE_SLOPE) continue;

      kept.push(a, b, c);
      connect(a, b);
      connect(b, c);
      connect(c, a);
    }

    // Locally relax inland lake/river vertices without touching the global sea
    // surface. This preserves downhill drainage while eliminating sharp facets.
    let current = new Float32Array(positions.count);
    for (let i = 0; i < positions.count; i++) current[i] = positions.getY(i);
    for (let pass = 0; pass < 2; pass++) {
      const next = current.slice();
      for (let i = 0; i < positions.count; i++) {
        const s = strengths.getX(i);
        if (s < WET) continue;
        const seaLike = s > 0.96 && current[i] < 35.5;
        if (seaLike || adjacency[i].size < 2) continue;
        let total = 0;
        for (const n of adjacency[i]) total += current[n];
        const average = total / adjacency[i].size;
        const delta = Math.max(-0.34, Math.min(0.34, average - current[i]));
        next[i] = current[i] + delta * 0.62;
        stats.wetVerticesSmoothed++;
      }
      current = next;
    }
    for (let i = 0; i < positions.count; i++) positions.setY(i, current[i]);
    positions.needsUpdate = true;

    geometry.setIndex(kept);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const after = Math.floor(kept.length / 3);
    stats.meshesProcessed++;
    stats.trianglesBefore += before;
    stats.trianglesAfter += after;
    stats.trianglesRemoved += before - after;
  }

  THREE.Scene.prototype.add = function stableSurfaceWaterAdd(...objects) {
    for (const object of objects) {
      if (!looksLikeSurfaceWater(object)) continue;
      patchMaterial(object.material);
      stabilizeGeometry(object.geometry);
    }
    return nativeAdd.apply(this, objects);
  };

  const api = {
    installed: true,
    getStats: () => ({
      ...stats,
      geometryWaves: false,
      fragmentWaves: true,
      worldSpaceWaves: true,
      wetDryBridgeTrianglesRemoved: true,
      steepInlandWaterRejected: true,
      frontFacesOnly: true,
      waterOpaque: true,
    }),
  };
  window.realitySandboxSurfaceWaterStabilityV38b = api;
  document.documentElement.dataset.surfaceWaterStabilityV38b = 'level-fragment-wave-water';

  const previousDiagnostics = window.realitySandboxPresentationDiagnostics;
  window.realitySandboxPresentationDiagnostics = () => ({
    ...(typeof previousDiagnostics === 'function' ? previousDiagnostics() : {}),
    surfaceWaterStabilityV38b: api.getStats(),
  });
})();

