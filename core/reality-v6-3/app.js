import '../reality-v6-2/app.js';
import { ContourBiomes } from './biomes.js';

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const SEASON_SPEEDS = [0, 1, 10, 60];
let seasonSpeedIndex = 1;
let biomesEnabled = true;
let biomeSource;
let refreshing = false;
let refreshQueued = false;
let lastFrame = performance.now();
let lastHudRefresh = 0;
let lastModelRefresh = 0;
let lastSave = 0;
let lastBuildKey = '';

const biomeStatus = document.getElementById('biomeStatus');
const seasonSpeedButton = document.getElementById('seasonSpeed');
const advanceSeasonButton = document.getElementById('advanceSeason');
const biomeToggleButton = document.getElementById('biomeToggle');
const inspectElement = document.getElementById('inspect');

async function waitForWorld() {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (window.realityV6?.viewer && window.realityV6?.simulation) return window.realityV6;
    await sleep(50);
  }
  throw new Error('The living world did not finish starting.');
}

function positionsFromRing(ring) {
  return Cesium.Cartesian3.fromDegreesArray(ring.flatMap((coordinate) => [coordinate[0], coordinate[1]]));
}

function hierarchyFromPolygon(polygon) {
  const outer = positionsFromRing(polygon[0]);
  const holes = polygon.slice(1).map((ring) => new Cesium.PolygonHierarchy(positionsFromRing(ring)));
  return new Cesium.PolygonHierarchy(outer, holes);
}

function ringAreaDegrees(ring) {
  let area = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    area += ring[index][0] * ring[index + 1][1] - ring[index + 1][0] * ring[index][1];
  }
  return Math.abs(area) * 0.5;
}

function ringCenter(ring) {
  let longitude = 0;
  let latitude = 0;
  const limit = Math.max(1, ring.length - 1);
  for (let index = 0; index < limit; index += 1) {
    longitude += ring[index][0];
    latitude += ring[index][1];
  }
  return [longitude / limit, latitude / limit];
}

try {
  const { viewer, simulation } = await waitForWorld();
  const biomes = new ContourBiomes(simulation);

  function buildBiomeSource() {
    const source = new Cesium.CustomDataSource('D3 Contour biomes and watersheds');
    let entityIndex = 0;
    let labelCount = 0;

    for (const feature of biomes.snapshot.features) {
      for (const polygon of feature.polygons) {
        const id = `${feature.id}-${entityIndex}`;
        entityIndex += 1;
        source.entities.add({
          id: `biome-${id}`,
          polygon: {
            hierarchy: hierarchyFromPolygon(polygon),
            material: Cesium.Color.fromCssColorString(feature.color).withAlpha(feature.alpha),
            outline: false,
            height: 0,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            classificationType: Cesium.ClassificationType.TERRAIN,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 18_000_000),
          },
        });

        source.entities.add({
          id: `biome-edge-${id}`,
          polyline: {
            positions: positionsFromRing(polygon[0]),
            width: feature.id === 'lake' ? 1.45 : 0.8,
            material: Cesium.Color.fromCssColorString(feature.outline).withAlpha(feature.id === 'lake' ? 0.62 : 0.23),
            clampToGround: true,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, feature.id === 'lake' ? 7_000_000 : 4_500_000),
          },
        });

        const area = ringAreaDegrees(polygon[0]);
        if (area > 42 && labelCount < 24) {
          const center = ringCenter(polygon[0]);
          source.entities.add({
            id: `biome-label-${id}`,
            position: Cesium.Cartesian3.fromDegrees(center[0], center[1], 15_000),
            label: {
              text: feature.label.toUpperCase(),
              font: '9px system-ui',
              fillColor: Cesium.Color.fromCssColorString(feature.outline).withAlpha(0.72),
              outlineColor: Cesium.Color.BLACK.withAlpha(0.8),
              outlineWidth: 3,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(200_000, 3_500_000),
              disableDepthTestDistance: 100_000,
            },
          });
          labelCount += 1;
        }
      }
    }

    source.show = biomesEnabled;
    return source;
  }

  async function refreshBiomes({ force = false } = {}) {
    if (refreshing) {
      refreshQueued = true;
      return;
    }
    if (!biomesEnabled && !force) return;
    refreshing = true;
    try {
      biomes.build();
      const nextSource = buildBiomeSource();
      if (biomeSource) await viewer.dataSources.remove(biomeSource, true);
      biomeSource = nextSource;
      await viewer.dataSources.add(biomeSource);
      biomeSource.show = biomesEnabled;
      biomes.save();
      lastModelRefresh = performance.now();
      lastBuildKey = `${Math.floor(simulation.years / 100)}:${Math.floor(biomes.seasonDay / 30)}`;
      viewer.scene.requestRender();
    } finally {
      refreshing = false;
      if (refreshQueued) {
        refreshQueued = false;
        refreshBiomes();
      }
    }
  }

  function updateStatus() {
    const snapshot = biomes.snapshot;
    biomeStatus.innerHTML = [
      `D3 CONTOUR ECOLOGY · ${snapshot.season}`,
      `${snapshot.regions} natural regions · ${snapshot.lakeRegions} lake basins`,
      `forest ${snapshot.percentages.forest}% · desert ${snapshot.percentages.desert}%`,
      `wetland ${snapshot.percentages.wetland}% · snow ${snapshot.percentages.snow}%`,
    ].join('<br>');
    const speed = SEASON_SPEEDS[seasonSpeedIndex];
    seasonSpeedButton.textContent = speed === 0 ? 'Seasons paused' : `Seasons ×${speed}`;
  }

  const clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  clickHandler.setInputAction((movement) => {
    const ray = viewer.camera.getPickRay(movement.position);
    const cartesian = viewer.scene.globe.pick(ray, viewer.scene);
    if (!cartesian) return;
    const location = Cesium.Cartographic.fromCartesian(cartesian);
    const biome = biomes.classify(location.latitude, location.longitude);
    inspectElement.textContent = `${biome.label} · ${biome.season} · moisture ${Math.round(biome.moisture * 100)}% · vegetation ${Math.round(biome.vegetation * 100)}% · runoff ${Math.round(biome.runoff * 100)}%`;
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  seasonSpeedButton.addEventListener('click', () => {
    seasonSpeedIndex = (seasonSpeedIndex + 1) % SEASON_SPEEDS.length;
    updateStatus();
  });

  advanceSeasonButton.addEventListener('click', async () => {
    biomes.advance(90);
    inspectElement.textContent = 'The planet advanced one season.';
    await refreshBiomes({ force: true });
    updateStatus();
  });

  biomeToggleButton.addEventListener('click', async () => {
    biomesEnabled = !biomesEnabled;
    biomeToggleButton.textContent = biomesEnabled ? 'Biomes on' : 'Biomes off';
    if (biomeSource) biomeSource.show = biomesEnabled;
    if (biomesEnabled && !biomeSource) await refreshBiomes({ force: true });
    viewer.scene.requestRender();
  });

  document.getElementById('resetWorld').addEventListener('click', () => {
    setTimeout(async () => {
      biomes.reset();
      await refreshBiomes({ force: true });
      updateStatus();
    }, 180);
  });

  addEventListener('pagehide', () => biomes.save());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) biomes.save();
  });

  await refreshBiomes({ force: true });
  updateStatus();

  function animate(now) {
    requestAnimationFrame(animate);
    const deltaSeconds = Math.min(0.25, (now - lastFrame) / 1_000);
    lastFrame = now;
    const seasonSpeed = SEASON_SPEEDS[seasonSpeedIndex];
    if (seasonSpeed > 0) biomes.advance(deltaSeconds * seasonSpeed);

    const buildKey = `${Math.floor(simulation.years / 100)}:${Math.floor(biomes.seasonDay / 30)}`;
    if (biomesEnabled && buildKey !== lastBuildKey && now - lastModelRefresh > 3_000) refreshBiomes();
    if (now - lastHudRefresh > 1_000) {
      updateStatus();
      lastHudRefresh = now;
    }
    if (now - lastSave > 30_000) {
      biomes.save();
      lastSave = now;
    }
  }

  requestAnimationFrame(animate);
  window.realityV63 = { biomes, refreshBiomes };
} catch (error) {
  biomeStatus.textContent = `Biomes failed to start: ${error.message}`;
  console.error(error);
}
