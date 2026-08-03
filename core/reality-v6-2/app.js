import '../reality-v6-1/app.js';
import { TurfCivilizations } from './civilization.js';

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const POLITICS_SPEEDS = [0, 1, 10, 100];
let politicsSpeedIndex = 1;
let overlayEnabled = true;
let civilizationSource;
let refreshing = false;
let refreshQueued = false;
let lastFrame = performance.now();
let lastHudRefresh = 0;
let lastModelRefresh = 0;
let lastSave = 0;
let lastBuildKey = '';

const civilizationStatus = document.getElementById('civilizationStatus');
const politicsSpeedButton = document.getElementById('politicsSpeed');
const advancePoliticsButton = document.getElementById('advancePolitics');
const overlayToggleButton = document.getElementById('overlayToggle');
const inspectElement = document.getElementById('inspect');

async function waitForWorld() {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (window.realityV6?.viewer && window.realityV6?.simulation) return window.realityV6;
    await sleep(50);
  }
  throw new Error('The living world did not finish starting.');
}

function compactNumber(value) {
  if (value < 1_000) return Math.round(value).toLocaleString();
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)}k`;
  return `${(value / 1_000_000).toFixed(2)}m`;
}

function polygonParts(feature) {
  if (feature.geometry?.type === 'Polygon') return [feature.geometry.coordinates];
  if (feature.geometry?.type === 'MultiPolygon') return feature.geometry.coordinates;
  return [];
}

function lineParts(feature) {
  if (feature.geometry?.type === 'LineString') return [feature.geometry.coordinates];
  if (feature.geometry?.type === 'MultiLineString') return feature.geometry.coordinates;
  return [];
}

function positionsFromRing(ring) {
  return Cesium.Cartesian3.fromDegreesArray(ring.flatMap((coordinate) => [coordinate[0], coordinate[1]]));
}

function hierarchyFromPolygon(polygon) {
  const outer = positionsFromRing(polygon[0]);
  const holes = polygon.slice(1).map((ring) => new Cesium.PolygonHierarchy(positionsFromRing(ring)));
  return new Cesium.PolygonHierarchy(outer, holes);
}

function styleColor(css, alpha) {
  return Cesium.Color.fromCssColorString(css).withAlpha(alpha);
}

try {
  const { viewer, simulation } = await waitForWorld();
  const civilizations = new TurfCivilizations(simulation);

  function buildCivilizationSource() {
    const source = new Cesium.CustomDataSource('Turf.js civilizations');
    const snapshot = civilizations.snapshot;
    const nationById = new Map(snapshot.nations.map((nation) => [nation.id, nation]));

    for (const feature of snapshot.influence.features) {
      const nation = nationById.get(feature.properties.nationId);
      if (!nation) continue;
      polygonParts(feature).forEach((polygon, index) => {
        source.entities.add({
          id: `influence-${nation.id}-${index}`,
          polygon: {
            hierarchy: hierarchyFromPolygon(polygon),
            material: styleColor(nation.color, 0.025),
            height: 0,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            classificationType: Cesium.ClassificationType.TERRAIN,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 18_000_000),
          },
        });
      });
    }

    for (const feature of snapshot.territories.features) {
      const nation = nationById.get(feature.properties.nationId);
      if (!nation) continue;
      polygonParts(feature).forEach((polygon, index) => {
        source.entities.add({
          id: `territory-${nation.id}-${index}`,
          polygon: {
            hierarchy: hierarchyFromPolygon(polygon),
            material: styleColor(nation.color, 0.033),
            height: 0,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            classificationType: Cesium.ClassificationType.TERRAIN,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(1_200_000, 30_000_000),
          },
        });
        const outerRing = polygon[0];
        source.entities.add({
          id: `border-${nation.id}-${index}`,
          polyline: {
            positions: positionsFromRing(outerRing),
            width: 1.25,
            material: styleColor(nation.color, 0.62),
            clampToGround: true,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 16_000_000),
          },
        });
      });
    }

    for (const nation of snapshot.nations) {
      const longitude = nation.capital.longitude * 180 / Math.PI;
      const latitude = nation.capital.latitude * 180 / Math.PI;
      source.entities.add({
        id: `capital-${nation.id}`,
        name: nation.name,
        position: Cesium.Cartesian3.fromDegrees(longitude, latitude, nation.capital.heightMeters + 900),
        point: {
          pixelSize: 9,
          color: styleColor(nation.color, 0.95),
          outlineColor: Cesium.Color.WHITE.withAlpha(0.82),
          outlineWidth: 1.5,
          disableDepthTestDistance: 150_000,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 9_000_000),
        },
        label: {
          text: `${nation.name}\n${nation.form}`,
          font: '11px system-ui',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -22),
          disableDepthTestDistance: 150_000,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 3_800_000),
        },
      });
    }

    for (const route of snapshot.tradeRoutes) {
      lineParts(route.feature).forEach((coordinates, index) => {
        source.entities.add({
          id: `${route.id}-${index}`,
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArrayHeights(coordinates.flatMap((coordinate) => [coordinate[0], coordinate[1], 18_000])),
            width: 2.1,
            material: new Cesium.PolylineGlowMaterialProperty({
              glowPower: 0.18,
              color: styleColor(route.from.color, 0.67),
            }),
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 9_000_000),
          },
        });
      });
    }

    for (const migration of snapshot.migrations) {
      lineParts(migration.feature).forEach((coordinates, index) => {
        source.entities.add({
          id: `${migration.id}-${index}`,
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArrayHeights(coordinates.flatMap((coordinate) => [coordinate[0], coordinate[1], 32_000])),
            width: 1.2 + Math.min(2.2, Math.log10(migration.people + 1) * 0.3),
            material: new Cesium.PolylineDashMaterialProperty({
              color: Cesium.Color.WHITE.withAlpha(0.45),
              dashLength: 13,
            }),
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 4_800_000),
          },
        });
      });
    }

    for (const conflict of snapshot.conflicts) {
      source.entities.add({
        id: conflict.id,
        position: Cesium.Cartesian3.fromDegrees(conflict.location[0], conflict.location[1], 45_000),
        point: {
          pixelSize: 8 + conflict.intensity * 9,
          color: Cesium.Color.fromCssColorString('#ff594f').withAlpha(0.85),
          outlineColor: Cesium.Color.fromCssColorString('#ffd3a7').withAlpha(0.9),
          outlineWidth: 2,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 8_000_000),
        },
        label: {
          text: 'CONFLICT',
          font: '10px system-ui',
          fillColor: Cesium.Color.fromCssColorString('#ffd3c9'),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -18),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 3_500_000),
        },
      });
    }

    source.show = overlayEnabled;
    return source;
  }

  async function refreshCivilizations({ force = false } = {}) {
    if (refreshing) {
      refreshQueued = true;
      return;
    }
    if (!overlayEnabled && !force) return;
    refreshing = true;
    try {
      civilizations.build();
      const nextSource = buildCivilizationSource();
      if (civilizationSource) await viewer.dataSources.remove(civilizationSource, true);
      civilizationSource = nextSource;
      await viewer.dataSources.add(civilizationSource);
      civilizationSource.show = overlayEnabled;
      civilizations.save();
      lastModelRefresh = performance.now();
      lastBuildKey = `${Math.floor(simulation.years / 100)}:${Math.floor(civilizations.politicsYears / 100)}`;
      viewer.scene.requestRender();
    } finally {
      refreshing = false;
      if (refreshQueued) {
        refreshQueued = false;
        refreshCivilizations();
      }
    }
  }

  function updateStatus() {
    const stats = civilizations.snapshot.stats;
    const leading = [...civilizations.snapshot.nations].sort((a, b) => b.power - a.power)[0];
    civilizationStatus.innerHTML = [
      `TURF.JS CIVILIZATIONS · ${stats.nations} nations`,
      `${stats.tradeRoutes} trade routes · ${stats.conflicts} conflicts`,
      `${compactNumber(stats.migrants)} migrating this era`,
      leading ? `leading power: ${leading.name}` : 'civilizations emerging',
    ].join('<br>');
    const speed = POLITICS_SPEEDS[politicsSpeedIndex];
    politicsSpeedButton.textContent = speed === 0 ? 'Politics paused' : `Politics ×${speed}`;
  }

  const clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  clickHandler.setInputAction((movement) => {
    const ray = viewer.camera.getPickRay(movement.position);
    const cartesian = viewer.scene.globe.pick(ray, viewer.scene);
    if (!cartesian) return;
    const location = Cesium.Cartographic.fromCartesian(cartesian);
    const longitude = Cesium.Math.toDegrees(location.longitude);
    const latitude = Cesium.Math.toDegrees(location.latitude);
    const nation = civilizations.locate(longitude, latitude);
    if (!nation) return;
    inspectElement.textContent = `${nation.name} · ${nation.form} · capital population ${nation.capital.population.toLocaleString()} · stability ${Math.round(nation.stability * 100)}% · wealth ${Math.round(nation.wealth * 100)}%`;
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  politicsSpeedButton.addEventListener('click', () => {
    politicsSpeedIndex = (politicsSpeedIndex + 1) % POLITICS_SPEEDS.length;
    updateStatus();
  });

  advancePoliticsButton.addEventListener('click', async () => {
    civilizations.advance(250);
    inspectElement.textContent = 'Civilizations advanced 250 years.';
    await refreshCivilizations({ force: true });
    updateStatus();
  });

  overlayToggleButton.addEventListener('click', async () => {
    overlayEnabled = !overlayEnabled;
    overlayToggleButton.textContent = overlayEnabled ? 'Borders on' : 'Borders off';
    if (civilizationSource) civilizationSource.show = overlayEnabled;
    if (overlayEnabled && !civilizationSource) await refreshCivilizations({ force: true });
    viewer.scene.requestRender();
  });

  document.getElementById('resetWorld').addEventListener('click', () => {
    setTimeout(async () => {
      civilizations.reset();
      await refreshCivilizations({ force: true });
      updateStatus();
    }, 150);
  });

  addEventListener('pagehide', () => civilizations.save());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) civilizations.save();
  });

  await refreshCivilizations({ force: true });
  updateStatus();

  function animate(now) {
    requestAnimationFrame(animate);
    const deltaSeconds = Math.min(0.25, (now - lastFrame) / 1_000);
    lastFrame = now;
    const politicsSpeed = POLITICS_SPEEDS[politicsSpeedIndex];
    if (politicsSpeed > 0) civilizations.advance(deltaSeconds * politicsSpeed);

    const buildKey = `${Math.floor(simulation.years / 100)}:${Math.floor(civilizations.politicsYears / 100)}`;
    if (overlayEnabled && buildKey !== lastBuildKey && now - lastModelRefresh > 3_000) refreshCivilizations();
    if (now - lastHudRefresh > 1_000) {
      updateStatus();
      lastHudRefresh = now;
    }
    if (now - lastSave > 30_000) {
      civilizations.save();
      lastSave = now;
    }
  }

  requestAnimationFrame(animate);
  window.realityV62 = { civilizations, refreshCivilizations };
} catch (error) {
  civilizationStatus.textContent = `Civilizations failed to start: ${error.message}`;
  console.error(error);
}
