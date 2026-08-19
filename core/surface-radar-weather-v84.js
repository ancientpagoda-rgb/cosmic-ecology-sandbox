import * as THREE from 'three';

const BUILD = 'v84-radar-weather-clouds';
const html = document.documentElement;
const stats = {
  installed: true,
  meshesPatched: 0,
  materialsPatched: 0,
  scans: 0,
};

function radarVertexShader() {
  return `
    attribute float weatherAlpha;
    attribute float weatherSize;
    varying float vIntensity;
    varying float vAlpha;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vIntensity = clamp((weatherAlpha - 0.025) / 0.62, 0.0, 1.0);
      vAlpha = clamp(0.12 + vIntensity * 0.78, 0.0, 0.90);
      gl_PointSize = clamp(weatherSize * (310.0 / max(12.0, -mv.z)), 3.0, 86.0);
      gl_Position = projectionMatrix * mv;
    }
  `;
}

function radarFragmentShader() {
  return `
    varying float vIntensity;
    varying float vAlpha;

    vec3 radarColor(float intensity) {
      vec3 green = vec3(0.08, 0.95, 0.30);
      vec3 yellow = vec3(0.98, 0.92, 0.10);
      vec3 orange = vec3(1.00, 0.48, 0.06);
      vec3 red = vec3(0.98, 0.08, 0.08);
      vec3 magenta = vec3(0.78, 0.06, 0.88);

      if (intensity < 0.34) return mix(green, yellow, intensity / 0.34);
      if (intensity < 0.58) return mix(yellow, orange, (intensity - 0.34) / 0.24);
      if (intensity < 0.82) return mix(orange, red, (intensity - 0.58) / 0.24);
      return mix(red, magenta, (intensity - 0.82) / 0.18);
    }

    void main() {
      vec2 p = gl_PointCoord * 2.0 - 1.0;
      float r2 = dot(p, p);
      if (r2 > 1.0) discard;

      // Soft radar-cell blobs: strong centers, feathered edges, never white.
      float cell = 1.0 - smoothstep(0.30, 1.0, r2);
      float edge = 1.0 - smoothstep(0.78, 1.0, r2);
      vec3 color = radarColor(vIntensity);
      float alpha = vAlpha * max(cell * 0.82, edge * 0.34);
      gl_FragColor = vec4(color, alpha);
    }
  `;
}

function patchCloudMesh(mesh) {
  if (!mesh?.isPoints || mesh.name !== 'surfaceWeatherCloudsV39') return false;
  if (mesh.userData?.surfaceRadarWeatherV84) return true;

  const geometry = mesh.geometry;
  const material = mesh.material;
  if (!geometry?.getAttribute?.('weatherAlpha') || !geometry?.getAttribute?.('weatherSize') || !material?.isShaderMaterial) {
    return false;
  }

  mesh.userData.surfaceRadarWeatherV84 = true;
  material.uniforms = {};
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = true;
  material.blending = THREE.NormalBlending;
  material.vertexShader = radarVertexShader();
  material.fragmentShader = radarFragmentShader();
  material.needsUpdate = true;
  mesh.renderOrder = 6;

  stats.meshesPatched++;
  stats.materialsPatched++;
  html.dataset.surfaceRadarWeatherV84 = BUILD;
  return true;
}

function scan() {
  stats.scans++;
  const scene = window.realitySandboxSurfaceLightHookV36?.getObjects?.()?.scene;
  if (!scene?.traverse) return false;
  let patched = false;
  scene.traverse(object => {
    if (patchCloudMesh(object)) patched = true;
  });
  return patched;
}

let attempts = 0;
function waitForClouds() {
  attempts++;
  if (scan()) return;
  if (attempts < 600) setTimeout(waitForClouds, 100);
  else html.dataset.surfaceRadarWeatherV84 = 'cloud-mesh-unavailable';
}

window.realitySandboxSurfaceRadarWeatherV84 = {
  installed: true,
  build: BUILD,
  getStats: () => ({ ...stats }),
  rescan: scan,
};
html.dataset.surfaceRadarWeatherV84 = 'waiting';
waitForClouds();

const previousDiagnostics = window.realitySandboxPresentationDiagnostics;
window.realitySandboxPresentationDiagnostics = () => ({
  ...(typeof previousDiagnostics === 'function' ? previousDiagnostics() : {}),
  surfaceRadarWeatherV84: window.realitySandboxSurfaceRadarWeatherV84.getStats(),
});
