import '../reality-v6-4/app.js';
import { AstronomyClimateCoupling } from './orbit-climate.js';

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const CLOCK_SPEEDS = [0, 60, 3_600, 86_400, 2_592_000];
const CLOCK_LABELS = ['Clock paused', '1 min/s', '1 hour/s', '1 day/s', '30 days/s'];
let clockSpeedIndex = 2;
let couplingEnabled = true;
let snowLayer;
let orbitSource;
let refreshing = false;
let refreshQueued = false;
let lastFrame = performance.now();
let lastClimateStep = 0;
let lastHudRefresh = 0;
let lastVisualRefresh = 0;
let climateDayCarry = 0;
let visualDayCarry = 0;

const orbitStatus = document.getElementById('orbitStatus');
const clockSpeedButton = document.getElementById('clockSpeed');
const couplingToggleButton = document.getElementById('couplingToggle');
const inspectElement = document.getElementById('inspect');
const systemStatus = document.getElementById('systemStatus');

async function waitForWorld() {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (
      window.realityV6?.viewer &&
      window.realityV6?.simulation &&
      window.realityV63?.biomes &&
      window.realityV64
    ) return window.realityV6;
    await sleep(50);
  }
  throw new Error('The living world did not finish starting.');
}

function compactNumber(value) {
  if (value < 1_000) return Math.round(value).toLocaleString();
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)}k`;
  if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(2)}m`;
  return `${(value / 1_000_000_000).toFixed(2)}b`;
}

function eventDate(event) {
  if (!event?.date) return 'unavailable';
  return event.date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function moonGlyph(phaseDegrees) {
  const phase = ((phaseDegrees % 360) + 360) % 360;
  if (phase < 22.5 || phase >= 337.5) return '●';
  if (phase < 67.5) return '◔';
  if (phase < 112.5) return '◐';
  if (phase < 157.5) return '◕';
  if (phase < 202.5) return '○';
  if (phase < 247.5) return '◕';
  if (phase < 292.5) return '◑';
  return '◔';
}

function dayOfYear(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  return (date.getTime() - start) / 86_400_000;
}

function pauseLegacyClocks() {
  const daySpeedButton = document.getElementById('daySpeed');
  const seasonSpeedButton = document.getElementById('seasonSpeed');
  if (daySpeedButton) {
    daySpeedButton.click();
    daySpeedButton.click();
    daySpeedButton.textContent = 'Sun linked';
    daySpeedButton.disabled = true;
  }
  if (seasonSpeedButton) {
    seasonSpeedButton.click();
    seasonSpeedButton.click();
    seasonSpeedButton.click();
    seasonSpeedButton.textContent = 'Seasons linked';
    seasonSpeedButton.disabled = true;
  }
}

try {
  const { viewer, simulation } = await waitForWorld();
  const coupling = new AstronomyClimateCoupling(simulation);
  pauseLegacyClocks();

  viewer.clock.shouldAnimate = false;
  viewer.clock.multiplier = 1;
  viewer.scene.globe.enableLighting = true;
  if ('dynamicAtmosphereLighting' in viewer.scene.globe) viewer.scene.globe.dynamicAtmosphereLighting = true;
  if ('dynamicAtmosphereLightingFromSun' in viewer.scene.globe) viewer.scene.globe.dynamicAtmosphereLightingFromSun = true;

  async function createSnowLayer() {
    const texture = coupling.createSnowTideTexture(256, 128);
    const provider = await Cesium.SingleTileImageryProvider.fromUrl(texture.toDataURL('image/png'), {
      rectangle: Cesium.Rectangle.MAX_VALUE,
      credit: 'Astronomy Engine orbital snow and tide coupling',
    });
    const layer = new Cesium.ImageryLayer(provider);
    layer.alpha = 0.78;
    layer.brightness = 1.06;
    layer.contrast = 1.08;
    return layer;
  }

  function buildOrbitSource() {
    const source = new Cesium.CustomDataSource('Astronomy Engine orbital coupling');
    const state = coupling.lastState;
    const stats = coupling.statistics();

    source.entities.add({
      id: 'subsolar-point',
      name: 'Subsolar point',
      position: Cesium.Cartesian3.fromDegrees(state.subsolarLongitude, state.subsolarLatitude, 42_000),
      point: {
        pixelSize: 10,
        color: Cesium.Color.fromCssColorString('#ffe18a').withAlpha(0.92),
        outlineColor: Cesium.Color.WHITE.withAlpha(0.75),
        outlineWidth: 1.5,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 18_000_000),
      },
      label: {
        text: 'NOON',
        font: '10px system-ui',
        fillColor: Cesium.Color.fromCssColorString('#fff1b8'),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -18),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 5_500_000),
      },
    });

    source.entities.add({
      id: 'sublunar-point',
      name: 'Sublunar tidal point',
      position: Cesium.Cartesian3.fromDegrees(state.sublunarLongitude, state.sublunarLatitude, 48_000),
      ellipse: {
        semiMajorAxis: 180_000 + state.tideIndex * 260_000,
        semiMinorAxis: 180_000 + state.tideIndex * 260_000,
        height: 18_000,
        material: Cesium.Color.fromCssColorString('#8ccfff').withAlpha(0.035 + state.tideIndex * 0.035),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString('#9edcff').withAlpha(0.34),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 12_000_000),
      },
      point: {
        pixelSize: 8,
        color: Cesium.Color.fromCssColorString('#c8e8ff').withAlpha(0.88),
        outlineColor: Cesium.Color.fromCssColorString('#477797'),
        outlineWidth: 1.5,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 14_000_000),
      },
      label: {
        text: `TIDE ${state.tideIndex.toFixed(2)}`,
        font: '10px system-ui',
        fillColor: Cesium.Color.fromCssColorString('#caeaff'),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -18),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 5_500_000),
      },
    });

    const coastalSettlements = coupling.coastalSettlements().slice(0, 36);
    for (const settlement of coastalSettlements) {
      const riskColor = Cesium.Color.fromCssColorString(
        settlement.tideRisk > 0.72 ? '#ff7469' : settlement.tideRisk > 0.38 ? '#ffc76e' : '#74d7f2',
      );
      source.entities.add({
        id: `coastal-${settlement.id}`,
        name: `${settlement.name} coastal exposure`,
        position: Cesium.Cartesian3.fromRadians(
          settlement.longitude,
          settlement.latitude,
          settlement.heightMeters + 1_200,
        ),
        point: {
          pixelSize: 4 + settlement.tideRisk * 7,
          color: riskColor.withAlpha(0.72),
          outlineColor: Cesium.Color.BLACK.withAlpha(0.75),
          outlineWidth: 1,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 3_200_000),
        },
      });
    }

    source.name = `Astronomy coupling · ${stats.coastalSettlements} coastal settlements`;
    source.show = couplingEnabled;
    return source;
  }

  function syncClockAndSeasons() {
    viewer.clock.currentTime = Cesium.JulianDate.fromDate(coupling.date);
    viewer.clock.shouldAnimate = false;
    window.realityV63.biomes.seasonDay = ((dayOfYear(coupling.date) - 1) % 365.2422 + 365.2422) % 365.2422;
  }

  async function refreshOrbitalVisuals({ force = false } = {}) {
    if (!couplingEnabled && !force) return;
    if (refreshing) {
      refreshQueued = true;
      return;
    }
    refreshing = true;
    try {
      syncClockAndSeasons();
      await window.realityV6.refreshVisuals();

      const nextSnowLayer = await createSnowLayer();
      if (snowLayer && viewer.imageryLayers.contains(snowLayer)) viewer.imageryLayers.remove(snowLayer, true);
      snowLayer = nextSnowLayer;
      viewer.imageryLayers.add(snowLayer);
      snowLayer.show = couplingEnabled;

      await window.realityV63.refreshBiomes({ force: true });
      if (window.realityV62?.refreshCivilizations) await window.realityV62.refreshCivilizations({ force: true });

      if (orbitSource) await viewer.dataSources.remove(orbitSource, true);
      orbitSource = buildOrbitSource();
      await viewer.dataSources.add(orbitSource);
      orbitSource.show = couplingEnabled;
      lastVisualRefresh = performance.now();
      visualDayCarry = 0;
      viewer.scene.requestRender();
    } finally {
      refreshing = false;
      if (refreshQueued) {
        refreshQueued = false;
        refreshOrbitalVisuals();
      }
    }
  }

  function updateOrbitMarkers() {
    if (!orbitSource) return;
    const state = coupling.lastState;
    const sun = orbitSource.entities.getById('subsolar-point');
    const moon = orbitSource.entities.getById('sublunar-point');
    if (sun) sun.position = Cesium.Cartesian3.fromDegrees(state.subsolarLongitude, state.subsolarLatitude, 42_000);
    if (moon) {
      moon.position = Cesium.Cartesian3.fromDegrees(state.sublunarLongitude, state.sublunarLatitude, 48_000);
      moon.ellipse.semiMajorAxis = 180_000 + state.tideIndex * 260_000;
      moon.ellipse.semiMinorAxis = 180_000 + state.tideIndex * 260_000;
      moon.label.text = `TIDE ${state.tideIndex.toFixed(2)}`;
    }
  }

  function updateStatus() {
    const state = coupling.lastState;
    const stats = coupling.statistics();
    const solar = state.events?.solar;
    const lunar = state.events?.lunar;
    orbitStatus.innerHTML = [
      `ASTRONOMY ENGINE · ${state.date.toLocaleString()}`,
      `${state.season} · Sun ${state.sunDeclination >= 0 ? '+' : ''}${state.sunDeclination.toFixed(1)}°`,
      `${moonGlyph(state.moonPhaseDegrees)} ${state.moonPhase} · tide ${state.tideIndex.toFixed(2)}`,
      `snow ${stats.snowPercent}% · ${compactNumber(stats.coastalPopulation)} coastal population`,
      `next: ${solar?.label || 'solar eclipse'} ${eventDate(solar)}`,
      `${lunar?.label || 'lunar eclipse'} ${eventDate(lunar)}`,
    ].join('<br>');
    clockSpeedButton.textContent = CLOCK_LABELS[clockSpeedIndex];
    couplingToggleButton.textContent = couplingEnabled ? 'Orbit coupling on' : 'Orbit coupling off';
    if (systemStatus && document.body.classList.contains('system-active')) {
      systemStatus.textContent = `REBOUND orbital lab · shared surface date ${state.date.toISOString().slice(0, 10)} · Astronomy Engine tide ${state.tideIndex.toFixed(2)}`;
    }
  }

  async function advanceAndRefresh(days, message) {
    coupling.advanceDays(days);
    syncClockAndSeasons();
    inspectElement.textContent = message;
    await refreshOrbitalVisuals({ force: true });
    updateStatus();
  }

  clockSpeedButton.addEventListener('click', () => {
    clockSpeedIndex = (clockSpeedIndex + 1) % CLOCK_SPEEDS.length;
    updateStatus();
  });

  couplingToggleButton.addEventListener('click', async () => {
    couplingEnabled = !couplingEnabled;
    if (snowLayer && viewer.imageryLayers.contains(snowLayer)) snowLayer.show = couplingEnabled;
    if (orbitSource) orbitSource.show = couplingEnabled;
    if (couplingEnabled && (!snowLayer || !viewer.imageryLayers.contains(snowLayer))) {
      await refreshOrbitalVisuals({ force: true });
    }
    updateStatus();
    viewer.scene.requestRender();
  });

  document.getElementById('advanceOrbitDay').addEventListener('click', () => advanceAndRefresh(1, 'Orbital clock advanced one day.'));
  document.getElementById('advanceOrbitMonth').addEventListener('click', () => advanceAndRefresh(30, 'Orbital clock advanced thirty days.'));
  document.getElementById('advanceOrbitYear').addEventListener('click', () => advanceAndRefresh(365.2422, 'Orbital clock advanced one year.'));
  document.getElementById('orbitNow').addEventListener('click', async () => {
    coupling.setDate(new Date(), { applyClimate: false });
    syncClockAndSeasons();
    inspectElement.textContent = 'Orbital clock returned to the present.';
    await refreshOrbitalVisuals({ force: true });
    updateStatus();
  });

  document.getElementById('resetWorld').addEventListener('click', () => {
    setTimeout(async () => {
      coupling.resetClock();
      await refreshOrbitalVisuals({ force: true });
      updateStatus();
    }, 260);
  });

  const clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  clickHandler.setInputAction((movement) => {
    const ray = viewer.camera.getPickRay(movement.position);
    const cartesian = viewer.scene.globe.pick(ray, viewer.scene);
    if (!cartesian) return;
    const location = Cesium.Cartographic.fromCartesian(cartesian);
    const sample = simulation.sample(location.latitude, location.longitude);
    const gridX = Math.floor(((location.longitude + Math.PI) / (Math.PI * 2)) * 96);
    const gridY = Math.floor(((location.latitude + Math.PI / 2) / Math.PI) * 48);
    const cell = Math.max(0, Math.min(47, gridY)) * 96 + ((gridX % 96) + 96) % 96;
    const snow = coupling.snow[cell];
    const coast = coupling.coastal[cell] === 1;
    inspectElement.textContent = `${coast ? 'coast' : 'interior'} · snow ${Math.round(snow * 100)}% · vegetation ${Math.round(sample.vegetation * 100)}% · moisture ${Math.round(sample.moisture * 100)}% · tide ${coupling.lastState.tideIndex.toFixed(2)} · ${coupling.lastState.season}`;
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  addEventListener('pagehide', () => coupling.save());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) coupling.save();
  });

  syncClockAndSeasons();
  await refreshOrbitalVisuals({ force: true });
  updateStatus();

  function animate(now) {
    requestAnimationFrame(animate);
    const deltaSeconds = Math.min(0.25, (now - lastFrame) / 1_000);
    lastFrame = now;
    const clockRate = CLOCK_SPEEDS[clockSpeedIndex];
    if (couplingEnabled && clockRate > 0) {
      climateDayCarry += deltaSeconds * clockRate / 86_400;
      if (Math.abs(climateDayCarry) >= 0.25 && now - lastClimateStep > 500) {
        const days = climateDayCarry;
        climateDayCarry = 0;
        coupling.advanceDays(days);
        visualDayCarry += Math.abs(days);
        lastClimateStep = now;
        syncClockAndSeasons();
        updateOrbitMarkers();
      }
    }

    const snowMissing = couplingEnabled && (!snowLayer || !viewer.imageryLayers.contains(snowLayer));
    if (
      couplingEnabled &&
      !refreshing &&
      (snowMissing || (visualDayCarry >= 3 && now - lastVisualRefresh > 6_000))
    ) refreshOrbitalVisuals();

    if (now - lastHudRefresh > 1_000) {
      updateStatus();
      lastHudRefresh = now;
    }
  }

  requestAnimationFrame(animate);
  window.realityV65 = { coupling, refreshOrbitalVisuals };
} catch (error) {
  orbitStatus.textContent = `Orbital coupling failed to start: ${error.message}`;
  console.error(error);
}
