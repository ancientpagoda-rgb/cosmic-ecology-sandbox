const TAU = Math.PI * 2;
const GLOBE_RADIUS_FACTOR = 0.43;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const wrap01 = value => ((value % 1) + 1) % 1;

async function installSurfaceDoubleClickBridge() {
  for (let attempt = 0; attempt < 160; attempt++) {
    const api = window.realitySandboxSurfaceMode;
    const runtime = window.realitySandboxUnified;
    const planet = window.realitySandboxPlanet;
    const canvas = document.getElementById('lofiLivingCanvas');
    if (api?.enterAt && runtime?.getCamera && planet?.world && canvas) {
      if (canvas.__surfaceModeDoubleClickBridgeInstalled) return;
      canvas.addEventListener('dblclick', event => {
        if (api.isActive?.()) return;
        const rect = canvas.getBoundingClientRect();
        const camera = runtime.getCamera();
        const radius = Math.min(rect.width, rect.height) * GLOBE_RADIUS_FACTOR * camera.zoom;
        const sx = (event.clientX - rect.left - rect.width * 0.5) / radius;
        const sy = -(event.clientY - rect.top - rect.height * 0.5) / radius;
        const rho2 = sx * sx + sy * sy;
        if (rho2 > 1) return;

        const z = Math.sqrt(Math.max(0, 1 - rho2));
        const lon0 = (camera.centerX - 0.5) * TAU;
        const lat0 = (0.5 - camera.centerY) * Math.PI;
        const sinLat0 = Math.sin(lat0);
        const cosLat0 = Math.cos(lat0);
        const latitude = Math.asin(clamp(sy * cosLat0 + z * sinLat0, -1, 1));
        const longitude = lon0 + Math.atan2(sx, z * cosLat0 - sy * sinLat0);
        const x = wrap01(longitude / TAU + 0.5) * planet.world.width;
        const y = clamp(0.5 - latitude / Math.PI, 0, 1) * planet.world.height;

        event.preventDefault();
        event.stopImmediatePropagation();
        api.enterAt(x, y);
      }, true);
      canvas.__surfaceModeDoubleClickBridgeInstalled = true;
      document.documentElement.dataset.surfaceModeDoubleClick = 'active';
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  document.documentElement.dataset.surfaceModeDoubleClick = 'runtime-timeout';
}

installSurfaceDoubleClickBridge();
