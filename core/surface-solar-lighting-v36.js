import * as THREE from 'three';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const DEG = Math.PI / 180;

async function waitForDependencies() {
  for (let attempt = 0; attempt < 300; attempt++) {
    const hook = window.realitySandboxSurfaceLightHookV36;
    const sky = window.realitySandboxSurfaceCelestialsV35;
    const mode = window.realitySandboxSurfaceMode;
    const objects = hook?.getObjects?.();
    if (
      hook?.installed &&
      sky?.installed &&
      mode?.isActive &&
      objects?.scene &&
      objects?.sun &&
      objects?.hemisphere
    ) return { hook, sky, mode };
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  return null;
}

function install({ hook, sky, mode }) {
  if (window.realitySandboxSurfaceSolarLightingV36?.installed) return;

  const objects = hook.getObjects();
  const { scene, sun, hemisphere } = objects;

  const daySky = new THREE.Color(0x7798aa);
  const twilightSky = new THREE.Color(0x8d655d);
  const nightSky = new THREE.Color(0x08111e);
  const daySun = new THREE.Color(0xfff0d2);
  const twilightSun = new THREE.Color(0xffa36a);
  const dayHemi = new THREE.Color(0xdceeff);
  const nightHemi = new THREE.Color(0x34445f);
  const dayGround = new THREE.Color(0x2d3a31);
  const nightGround = new THREE.Color(0x10151a);
  const targetSky = new THREE.Color();
  const targetSunColor = new THREE.Color();
  const targetHemiColor = new THREE.Color();
  const targetGroundColor = new THREE.Color();
  const up = new THREE.Vector3();
  const east = new THREE.Vector3();
  const south = new THREE.Vector3();
  const targetDirection = new THREE.Vector3(0.4, 0.8, 0.2).normalize();
  const smoothedDirection = targetDirection.clone();

  let last = performance.now();
  let targetSunIntensity = 2.35;
  let targetHemiIntensity = 1.8;
  let targetExposure = 1.03;
  let currentSunIntensity = sun.intensity;
  let currentHemiIntensity = hemisphere.intensity;
  let currentExposure = 1.03;

  const stats = {
    frames: 0,
    updates: 0,
    sunAltitudeDeg: 0,
    sunAzimuthDeg: 0,
    daylight: 1,
    twilight: 0,
    sunIntensity: currentSunIntensity,
    hemisphereIntensity: currentHemiIntensity,
    exposure: currentExposure,
    backgroundHex: scene.background?.getHexString?.() || '7798aa',
  };

  if (sun.target && !sun.target.parent && scene) scene.add(sun.target);
  sun.castShadow = false;

  function computeTargets() {
    const celestial = sky.getStats();
    const altitude = Number(celestial.sunAltitudeDeg) || 0;
    const azimuth = Number(celestial.sunAzimuthDeg) || 0;
    const daylight = clamp(Number(celestial.daylight) || 0, 0, 1);
    const twilight = clamp(Number(celestial.twilight) || 0, 0, 1);
    const camera = objects.camera;
    if (!camera) return false;

    up.copy(camera.up).normalize();
    east.set(up.y, -up.x, 0);
    if (east.lengthSq() < 1e-8) east.set(1, 0, 0);
    east.normalize();
    south.crossVectors(east, up).normalize();

    const alt = altitude * DEG;
    const az = azimuth * DEG;
    const horizontal = Math.cos(alt);
    const eastComponent = horizontal * Math.sin(az);
    const northComponent = horizontal * Math.cos(az);
    const southComponent = -northComponent;
    const upComponent = Math.sin(alt);

    targetDirection
      .copy(east).multiplyScalar(eastComponent)
      .addScaledVector(south, southComponent)
      .addScaledVector(up, upComponent)
      .normalize();

    targetSunIntensity = 0.025 + daylight * 2.55 + twilight * 0.42;
    targetHemiIntensity = 0.24 + daylight * 1.50 + twilight * 0.36;
    targetExposure = 0.62 + daylight * 0.41 + twilight * 0.08;

    targetSunColor.copy(twilightSun).lerp(daySun, clamp(daylight * 1.25, 0, 1));
    targetHemiColor.copy(nightHemi).lerp(dayHemi, clamp(daylight + twilight * 0.55, 0, 1));
    targetGroundColor.copy(nightGround).lerp(dayGround, clamp(daylight + twilight * 0.35, 0, 1));
    targetSky.copy(nightSky);
    targetSky.lerp(twilightSky, clamp(twilight * 0.9, 0, 1));
    targetSky.lerp(daySky, daylight);

    stats.sunAltitudeDeg = altitude;
    stats.sunAzimuthDeg = azimuth;
    stats.daylight = daylight;
    stats.twilight = twilight;
    stats.updates++;
    return true;
  }

  function loop(now) {
    requestAnimationFrame(loop);
    stats.frames++;

    if (!mode.isActive?.() || document.documentElement.dataset.surfaceMode !== 'active') {
      last = now;
      return;
    }

    const renderer = objects.renderer;
    const camera = objects.camera;
    if (!renderer || !camera || !computeTargets()) {
      last = now;
      return;
    }

    const dt = clamp((now - last) / 1000, 0, 0.08);
    last = now;
    const response = 1 - Math.exp(-dt * 5.5);

    smoothedDirection.lerp(targetDirection, response).normalize();
    currentSunIntensity += (targetSunIntensity - currentSunIntensity) * response;
    currentHemiIntensity += (targetHemiIntensity - currentHemiIntensity) * response;
    currentExposure += (targetExposure - currentExposure) * response;

    sun.intensity = currentSunIntensity;
    hemisphere.intensity = currentHemiIntensity;
    renderer.toneMappingExposure = currentExposure;
    sun.color.lerp(targetSunColor, response);
    hemisphere.color.lerp(targetHemiColor, response);
    hemisphere.groundColor.lerp(targetGroundColor, response);

    sun.position.copy(camera.position).addScaledVector(smoothedDirection, 520);
    if (sun.target) {
      sun.target.position.copy(camera.position);
      sun.target.updateMatrixWorld();
    }

    if (scene.background?.isColor) scene.background.lerp(targetSky, response);
    if (scene.fog?.color) scene.fog.color.lerp(targetSky, response);

    stats.sunIntensity = currentSunIntensity;
    stats.hemisphereIntensity = currentHemiIntensity;
    stats.exposure = currentExposure;
    stats.backgroundHex = scene.background?.getHexString?.() || stats.backgroundHex;
    document.documentElement.dataset.surfaceSolarLight = currentSunIntensity.toFixed(3);
  }
  requestAnimationFrame(loop);

  const api = {
    installed: true,
    getStats: () => ({
      ...stats,
      active: Boolean(mode.isActive?.()),
      rendererAttached: Boolean(objects.renderer),
      cameraAttached: Boolean(objects.camera),
      sunDirectionCoupled: true,
      sunBrightnessCoupled: true,
      hemisphereCoupled: true,
      fogAndSkyCoupled: true,
      exposureCoupled: true,
      usesExistingThreeLights: true,
      shadowsEnabled: false,
      performancePolicy: 'lighting-only-no-shadow-map',
    }),
  };

  window.realitySandboxSurfaceSolarLightingV36 = api;
  document.documentElement.dataset.surfaceSolarLightingV36 = 'real-sun-three-light-coupling';

  const previousDiagnostics = window.realitySandboxPresentationDiagnostics;
  window.realitySandboxPresentationDiagnostics = () => ({
    ...(typeof previousDiagnostics === 'function' ? previousDiagnostics() : {}),
    surfaceSolarLightingV36: api.getStats(),
  });
}

waitForDependencies().then(state => {
  if (!state) {
    document.documentElement.dataset.surfaceSolarLightingV36 = 'unavailable';
    return;
  }
  install(state);
});

