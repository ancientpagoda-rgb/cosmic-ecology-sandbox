import { terrainHeightMeters } from '../reality-v5/world-model.js';
import { LivingWorldSimulation } from './simulation.js';

const loading = document.getElementById('loading');
const statsElement = document.getElementById('stats');
const coordinatesElement = document.getElementById('coords');
const inspectElement = document.getElementById('inspect');
const ageElement = document.getElementById('age');
const speedInput = document.getElementById('speed');
const speedOutput = document.getElementById('speedOut');
const simulation = new LivingWorldSimulation();
simulation.load();

const SPEEDS = [0, 1, 10, 100, 1_000, 10_000];
let viewer;
let simulationSource;
let refreshing = false;
let refreshAgain = false;
let simulationCarry = 0;
let lastFrame = performance.now();
let lastStep = performance.now();
let lastVisualRefresh = 0;
let lastHudRefresh = 0;

function formatYears(value) {
  if (value < 1_000) return `${Math.round(value).toLocaleString()} yr`;
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)} kyr`;
  return `${(value / 1_000_000).toFixed(2)} Myr`;
}

function formatPopulation(value) {
  if (value < 1_000) return Math.round(value).toLocaleString();
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)}k`;
  return `${(value / 1_000_000).toFixed(2)}m`;
}

function showLoading(message) {
  loading.textContent = message;
  if (!loading.isConnected) document.body.appendChild(loading);
}

function hideLoading() {
  loading.remove();
}

function terrainProvider() {
  const width = 33;
  const height = 33;
  const tilingScheme = new Cesium.GeographicTilingScheme();
  return new Cesium.CustomHeightmapTerrainProvider({
    width,
    height,
    tilingScheme,
    credit: 'Procedural terrain · Reality Sandbox V6',
    callback(x, y, level) {
      const rectangle = tilingScheme.tileXYToRectangle(x, y, level);
      const values = new Float32Array(width * height);
      for (let row = 0; row < height; row += 1) {
        const latitude = rectangle.north - (row / (height - 1)) * (rectangle.north - rectangle.south);
        for (let column = 0; column < width; column += 1) {
          const longitude = rectangle.west + (column / (width - 1)) * (rectangle.east - rectangle.west);
          values[row * width + column] = terrainHeightMeters(latitude, longitude);
        }
      }
      return values;
    },
  });
}

async function createImageryLayer() {
  const texture = simulation.createTexture(768, 384);
  const provider = await Cesium.SingleTileImageryProvider.fromUrl(texture.toDataURL('image/png'), {
    rectangle: Cesium.Rectangle.MAX_VALUE,
    credit: 'Persistent climate and civilization · Reality Sandbox V6',
  });
  return new Cesium.ImageryLayer(provider);
}

function buildSimulationSource() {
  const source = new Cesium.CustomDataSource('Reality V6 simulation');

  for (const river of simulation.rivers) {
    source.entities.add({
      id: river.id,
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(river.coordinates.flat()),
        width: 1.2 + river.strength * 2.8,
        material: Cesium.Color.fromCssColorString('#38a6df').withAlpha(0.86),
        clampToGround: true,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 7_000_000),
      },
    });
  }

  for (const road of simulation.roads) {
    source.entities.add({
      id: road.id,
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(road.coordinates.flat()),
        width: 1.35,
        material: Cesium.Color.fromCssColorString('#e2d5b5').withAlpha(0.72),
        clampToGround: true,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 5_000_000),
      },
    });
  }

  for (const settlement of simulation.settlements) {
    source.entities.add({
      id: settlement.id,
      name: settlement.name,
      position: Cesium.Cartesian3.fromRadians(
        settlement.longitude,
        settlement.latitude,
        settlement.heightMeters + 220,
      ),
      point: {
        pixelSize: 4 + Math.min(7, Math.log10(settlement.population + 1)),
        color: Cesium.Color.fromCssColorString('#efb34e'),
        outlineColor: Cesium.Color.BLACK.withAlpha(0.8),
        outlineWidth: 1.2,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 9_000_000),
      },
      label: {
        text: settlement.population > 25_000 ? settlement.name : '',
        font: '11px system-ui',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -14),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1_700_000),
        disableDepthTestDistance: 120_000,
      },
    });
  }

  return source;
}

async function refreshVisuals({ announce = false } = {}) {
  if (refreshing) {
    refreshAgain = true;
    return;
  }
  refreshing = true;
  if (announce) showLoading('Rebuilding rivers, roads and biomes…');
  try {
    const imageryLayer = await createImageryLayer();
    viewer.imageryLayers.removeAll(true);
    viewer.imageryLayers.add(imageryLayer);
    if (simulationSource) await viewer.dataSources.remove(simulationSource, true);
    simulationSource = buildSimulationSource();
    await viewer.dataSources.add(simulationSource);
    viewer.scene.requestRender();
    lastVisualRefresh = performance.now();
  } finally {
    refreshing = false;
    if (announce) hideLoading();
    if (refreshAgain) {
      refreshAgain = false;
      refreshVisuals();
    }
  }
}

function resetCamera() {
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(18, 12, 17_000_000),
    duration: 1.2,
  });
}

function updateHud() {
  const worldStats = simulation.stats();
  const cartographic = viewer.camera.positionCartographic;
  const altitude = Math.max(0, cartographic.height);
  coordinatesElement.textContent = `${Cesium.Math.toDegrees(cartographic.latitude).toFixed(1)}°, ${Cesium.Math.toDegrees(cartographic.longitude).toFixed(1)}°`;
  ageElement.textContent = formatYears(worldStats.years);
  speedOutput.value = SPEEDS[Number(speedInput.value)] === 0
    ? 'paused'
    : `${SPEEDS[Number(speedInput.value)].toLocaleString()} yr/s`;
  statsElement.innerHTML = [
    'V6 persistent world',
    `${altitude > 1_000 ? `${Math.round(altitude / 1_000).toLocaleString()} km` : `${Math.round(altitude)} m`} altitude`,
    `${worldStats.rivers} river links`,
    `${worldStats.settlements} cities · ${worldStats.roads} roads`,
    `${formatPopulation(worldStats.population)} population`,
    `${worldStats.forestPercent}% forest`,
  ].join('<br>');
}

async function stepWorld(years) {
  showLoading(`Simulating ${years.toLocaleString()} years…`);
  await new Promise((resolve) => requestAnimationFrame(resolve));
  simulation.step(years);
  simulation.save();
  await refreshVisuals();
  updateHud();
  hideLoading();
}

try {
  const baseLayer = await createImageryLayer();
  viewer = new Cesium.Viewer('cesium', {
    terrainProvider: terrainProvider(),
    baseLayer,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    animation: false,
    timeline: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    shouldAnimate: true,
    requestRenderMode: true,
    maximumRenderTimeChange: 0.5,
  });

  viewer.scene.globe.enableLighting = true;
  viewer.scene.globe.depthTestAgainstTerrain = true;
  viewer.scene.globe.maximumScreenSpaceError = 2.1;
  viewer.scene.globe.tileCacheSize = 360;
  viewer.scene.fog.enabled = true;
  viewer.scene.skyAtmosphere.show = true;
  viewer.scene.screenSpaceCameraController.minimumZoomDistance = 3;
  viewer.scene.screenSpaceCameraController.maximumZoomDistance = 60_000_000;
  simulationSource = buildSimulationSource();
  await viewer.dataSources.add(simulationSource);
  resetCamera();

  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction((movement) => {
    const ray = viewer.camera.getPickRay(movement.position);
    const cartesian = viewer.scene.globe.pick(ray, viewer.scene);
    if (!cartesian) return;
    const location = Cesium.Cartographic.fromCartesian(cartesian);
    const sample = simulation.sample(location.latitude, location.longitude);
    inspectElement.textContent = `elev ${Math.round(sample.heightMeters).toLocaleString()} m · temp ${Math.round(sample.temperature * 42 - 12)}°C · moisture ${Math.round(sample.moisture * 100)}% · vegetation ${Math.round(sample.vegetation * 100)}% · runoff ${Math.round(sample.runoff * 100)}% · population ${Math.round(sample.population).toLocaleString()}`;
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  document.getElementById('step100').addEventListener('click', () => stepWorld(100));
  document.getElementById('step1000').addEventListener('click', () => stepWorld(1_000));
  document.getElementById('save').addEventListener('click', () => {
    simulation.save();
    inspectElement.textContent = 'World history saved on this device.';
  });
  document.getElementById('resetWorld').addEventListener('click', async () => {
    simulation.reset();
    await refreshVisuals({ announce: true });
    inspectElement.textContent = 'World reset to year zero.';
    updateHud();
  });
  document.getElementById('resetCamera').addEventListener('click', resetCamera);
  addEventListener('pagehide', () => simulation.save());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) simulation.save();
  });

  function animate(now) {
    requestAnimationFrame(animate);
    const dt = Math.min(0.2, (now - lastFrame) / 1_000);
    lastFrame = now;
    const yearsPerSecond = SPEEDS[Number(speedInput.value)];
    if (yearsPerSecond > 0) {
      simulationCarry += yearsPerSecond * dt;
      if (simulationCarry >= 20 && now - lastStep > 450) {
        simulation.step(simulationCarry);
        simulationCarry = 0;
        lastStep = now;
        simulation.save();
      }
      if (now - lastVisualRefresh > 1_500 && now - lastStep < 700) refreshVisuals();
    }
    if (now - lastHudRefresh > 300) {
      updateHud();
      lastHudRefresh = now;
    }
  }

  updateHud();
  hideLoading();
  requestAnimationFrame(animate);
  window.realityV6 = { viewer, simulation, refreshVisuals };
} catch (error) {
  loading.textContent = `V6 failed to start: ${error.message}`;
  console.error(error);
}
