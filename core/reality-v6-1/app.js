import '../reality-v6/app.js';
import { FastNoiseWeather } from './weather.js';

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForWorld() {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (window.realityV6?.viewer && window.realityV6?.simulation) return window.realityV6;
    await sleep(50);
  }
  throw new Error('The V6 world did not finish starting.');
}

const WEATHER_SPEEDS = [0, 1, 4, 16];
const DAY_SPEEDS = [0, 600, 2_400];
let weatherSpeedIndex = 1;
let daySpeedIndex = 1;
let weatherEnabled = true;
let cloudLayer;
let stormSource;
let activeStormCount = 0;
let refreshingWeather = false;
let refreshQueued = false;
let lastFrame = performance.now();
let lastTextureRefresh = 0;
let lastLocalRefresh = 0;
let lastWeatherSave = 0;

const weatherStatus = document.getElementById('weatherStatus');
const weatherSpeedButton = document.getElementById('weatherSpeed');
const weatherToggleButton = document.getElementById('weatherToggle');
const daySpeedButton = document.getElementById('daySpeed');
const inspectElement = document.getElementById('inspect');

function formatWeatherSpeed() {
  const speed = WEATHER_SPEEDS[weatherSpeedIndex];
  weatherSpeedButton.textContent = speed === 0 ? 'Weather paused' : `Weather ×${speed}`;
}

function formatDaySpeed() {
  const speed = DAY_SPEEDS[daySpeedIndex];
  daySpeedButton.textContent = speed === 0 ? 'Sun paused' : speed === 600 ? 'Sun natural' : 'Sun fast';
}

function degrees(value) {
  return value * 180 / Math.PI;
}

function compassDirection(angle) {
  const directions = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'];
  const index = Math.round((((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8;
  return directions[index];
}

try {
  const { viewer, simulation } = await waitForWorld();
  const weather = new FastNoiseWeather(simulation);

  viewer.scene.requestRenderMode = false;
  viewer.clock.multiplier = DAY_SPEEDS[daySpeedIndex];
  viewer.clock.shouldAnimate = true;
  viewer.clock.clockRange = Cesium.ClockRange.UNBOUNDED;
  viewer.scene.sun.show = true;
  viewer.scene.moon.show = true;
  if ('dynamicAtmosphereLighting' in viewer.scene.globe) {
    viewer.scene.globe.dynamicAtmosphereLighting = true;
  }
  if ('dynamicAtmosphereLightingFromSun' in viewer.scene.globe) {
    viewer.scene.globe.dynamicAtmosphereLightingFromSun = true;
  }

  async function createCloudLayer() {
    const canvas = weather.createCloudTexture(256, 128);
    const provider = await Cesium.SingleTileImageryProvider.fromUrl(canvas.toDataURL('image/png'), {
      rectangle: Cesium.Rectangle.MAX_VALUE,
      credit: 'Cloud fields generated with FastNoiseLite 1.1.1',
    });
    const layer = new Cesium.ImageryLayer(provider);
    layer.alpha = 0.78;
    layer.brightness = 1.08;
    layer.contrast = 1.12;
    layer.gamma = 0.96;
    return layer;
  }

  function buildStormSource() {
    const source = new Cesium.CustomDataSource('FastNoiseLite weather systems');
    const systems = weather.stormSystems();
    activeStormCount = systems.length;

    for (let index = 0; index < systems.length; index += 1) {
      const system = systems[index];
      const endpoint = weather.windEndpoint(system, 4 + system.windSpeed * 0.07);
      const radius = 150_000 + system.storm * 520_000;
      const severe = system.storm > 0.72;
      const color = severe
        ? Cesium.Color.fromCssColorString('#a8c7df')
        : Cesium.Color.fromCssColorString('#d6e3eb');

      source.entities.add({
        id: `storm-area-${index}`,
        position: Cesium.Cartesian3.fromDegrees(system.longitude, system.latitude, 72_000),
        ellipse: {
          semiMajorAxis: radius * 1.35,
          semiMinorAxis: radius,
          height: 72_000,
          rotation: system.windAngle,
          material: color.withAlpha(0.055 + system.storm * 0.07),
          outline: severe,
          outlineColor: Cesium.Color.fromCssColorString('#b9ddf5').withAlpha(0.25),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 8_500_000),
        },
      });

      source.entities.add({
        id: `storm-wind-${index}`,
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArrayHeights([
            system.longitude, system.latitude, 105_000,
            endpoint.longitude, endpoint.latitude, 105_000,
          ]),
          width: severe ? 2.1 : 1.2,
          material: color.withAlpha(0.28),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 4_200_000),
        },
      });

      if (severe) {
        source.entities.add({
          id: `storm-core-${index}`,
          position: Cesium.Cartesian3.fromDegrees(system.longitude, system.latitude, 112_000),
          point: {
            pixelSize: 4 + system.storm * 5,
            color: Cesium.Color.fromCssColorString('#d9efff').withAlpha(0.82),
            outlineColor: Cesium.Color.fromCssColorString('#597991').withAlpha(0.7),
            outlineWidth: 1,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 5_500_000),
          },
        });
      }
    }
    return source;
  }

  async function refreshWeather({ force = false } = {}) {
    if (!weatherEnabled && !force) return;
    if (refreshingWeather) {
      refreshQueued = true;
      return;
    }
    refreshingWeather = true;
    try {
      const nextCloudLayer = await createCloudLayer();
      if (cloudLayer && viewer.imageryLayers.contains(cloudLayer)) {
        viewer.imageryLayers.remove(cloudLayer, true);
      }
      cloudLayer = nextCloudLayer;
      viewer.imageryLayers.add(cloudLayer);
      cloudLayer.show = weatherEnabled;

      if (stormSource) await viewer.dataSources.remove(stormSource, true);
      stormSource = buildStormSource();
      await viewer.dataSources.add(stormSource);
      stormSource.show = weatherEnabled;
      weather.save();
      lastWeatherSave = performance.now();
      lastTextureRefresh = performance.now();
      viewer.scene.requestRender();
    } finally {
      refreshingWeather = false;
      if (refreshQueued) {
        refreshQueued = false;
        refreshWeather();
      }
    }
  }

  function localWeather() {
    const camera = viewer.camera.positionCartographic;
    const sample = weather.sample(camera.latitude, camera.longitude);
    const altitude = Math.max(0, camera.height);
    const altitudeFade = Cesium.Math.clamp(1 - altitude / 3_000_000, 0, 1);
    viewer.scene.fog.density = 0.00018 + altitudeFade * (sample.cloud * 0.00007 + sample.storm * 0.00013);
    viewer.scene.fog.minimumBrightness = 0.04 + sample.cloud * 0.04;
    weatherStatus.innerHTML = [
      `FASTNOISELITE WEATHER · ${weather.condition(sample)}`,
      `${sample.temperatureC}°C · humidity ${Math.round(sample.humidity * 100)}%`,
      `wind ${Math.round(sample.windSpeed)} km/h ${compassDirection(sample.windAngle)}`,
      `clouds ${weather.latestStats.cloudCover}% · ${activeStormCount} storm systems`,
    ].join('<br>');
  }

  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction((movement) => {
    const ray = viewer.camera.getPickRay(movement.position);
    const cartesian = viewer.scene.globe.pick(ray, viewer.scene);
    if (!cartesian) return;
    const location = Cesium.Cartographic.fromCartesian(cartesian);
    const sample = weather.sample(location.latitude, location.longitude);
    inspectElement.textContent = `${weather.condition(sample)} · ${sample.temperatureC}°C · humidity ${Math.round(sample.humidity * 100)}% · precipitation ${Math.round(sample.precipitation * 100)}% · wind ${Math.round(sample.windSpeed)} km/h ${compassDirection(sample.windAngle)} · ${degrees(location.latitude).toFixed(1)}°, ${degrees(location.longitude).toFixed(1)}°`;
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  weatherSpeedButton.addEventListener('click', () => {
    weatherSpeedIndex = (weatherSpeedIndex + 1) % WEATHER_SPEEDS.length;
    formatWeatherSpeed();
  });

  daySpeedButton.addEventListener('click', () => {
    daySpeedIndex = (daySpeedIndex + 1) % DAY_SPEEDS.length;
    viewer.clock.multiplier = DAY_SPEEDS[daySpeedIndex];
    viewer.clock.shouldAnimate = DAY_SPEEDS[daySpeedIndex] !== 0;
    formatDaySpeed();
  });

  weatherToggleButton.addEventListener('click', async () => {
    weatherEnabled = !weatherEnabled;
    weatherToggleButton.textContent = weatherEnabled ? 'Clouds on' : 'Clouds off';
    if (cloudLayer && viewer.imageryLayers.contains(cloudLayer)) cloudLayer.show = weatherEnabled;
    if (stormSource) stormSource.show = weatherEnabled;
    if (weatherEnabled && (!cloudLayer || !viewer.imageryLayers.contains(cloudLayer))) await refreshWeather({ force: true });
    viewer.scene.requestRender();
  });

  addEventListener('pagehide', () => weather.save());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) weather.save();
  });

  formatWeatherSpeed();
  formatDaySpeed();
  await refreshWeather({ force: true });
  localWeather();

  function animate(now) {
    requestAnimationFrame(animate);
    const deltaSeconds = Math.min(0.25, (now - lastFrame) / 1_000);
    lastFrame = now;
    const weatherSpeed = WEATHER_SPEEDS[weatherSpeedIndex];
    if (weatherSpeed > 0) weather.advance(deltaSeconds * weatherSpeed);

    const cloudMissing = weatherEnabled && (!cloudLayer || !viewer.imageryLayers.contains(cloudLayer));
    if (weatherEnabled && (cloudMissing || now - lastTextureRefresh > 3_500)) refreshWeather();
    if (now - lastLocalRefresh > 700) {
      localWeather();
      lastLocalRefresh = now;
    }
    if (now - lastWeatherSave > 30_000) {
      weather.save();
      lastWeatherSave = now;
    }
  }

  requestAnimationFrame(animate);
  window.realityV61 = { weather, refreshWeather };
} catch (error) {
  weatherStatus.textContent = `Weather failed to start: ${error.message}`;
  console.error(error);
}
