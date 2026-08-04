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
const mobileWeather = matchMedia('(max-width: 720px), (pointer: coarse)').matches
  || (navigator.deviceMemory && navigator.deviceMemory <= 4);
const CLOUD_TEXTURE_SIZE = mobileWeather ? [160, 80] : [256, 128];
const WEATHER_REFRESH_MS = mobileWeather ? 5_500 : 3_500;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
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
    const canvas = weather.createCloudTexture(...CLOUD_TEXTURE_SIZE);
    const provider = await Cesium.SingleTileImageryProvider.fromUrl(canvas.toDataURL('image/png'), {
      rectangle: Cesium.Rectangle.MAX_VALUE,
      credit: 'Cloud fields generated with FastNoiseLite 1.1.1',
    });
    const layer = new Cesium.ImageryLayer(provider);
    layer.alpha = 0.68;
    layer.brightness = 1.08;
    layer.contrast = 1.12;
    layer.gamma = 0.96;
    return layer;
  }

  async function crossfadeCloudLayer(nextLayer) {
    const previousLayer = cloudLayer;
    const targetAlpha = nextLayer.alpha;
    nextLayer.alpha = previousLayer ? 0 : targetAlpha;
    viewer.imageryLayers.add(nextLayer);
    nextLayer.show = weatherEnabled;
    cloudLayer = nextLayer;

    if (!previousLayer || !viewer.imageryLayers.contains(previousLayer)) return;
    if (reducedMotion) {
      nextLayer.alpha = targetAlpha;
      viewer.imageryLayers.remove(previousLayer, true);
      return;
    }
    const previousAlpha = previousLayer.alpha;
    await new Promise((resolve) => {
      const started = performance.now();
      const animate = (now) => {
        const progress = Math.min(1, (now - started) / 900);
        const eased = progress * progress * (3 - 2 * progress);
        nextLayer.alpha = targetAlpha * eased;
        previousLayer.alpha = previousAlpha * (1 - eased);
        viewer.scene.requestRender();
        if (progress < 1) requestAnimationFrame(animate);
        else resolve();
      };
      requestAnimationFrame(animate);
    });
    if (viewer.imageryLayers.contains(previousLayer)) viewer.imageryLayers.remove(previousLayer, true);
  }

  function stormHash(seed, salt) {
    let value = (seed + Math.imul(salt + 1, 0x9e3779b9)) | 0;
    value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
    value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
    return ((value ^ (value >>> 15)) >>> 0) / 4294967296;
  }

  function stormCartesian(system, alongDegrees, crossDegrees, height) {
    const position = weather.offsetStormPosition(system, alongDegrees, crossDegrees);
    return Cesium.Cartesian3.fromDegrees(position.longitude, position.latitude, height);
  }

  function buildStormSource() {
    const source = new Cesium.CustomDataSource('FastNoiseLite weather systems');
    const systems = weather.stormSystems();
    activeStormCount = systems.length;

    for (let index = 0; index < systems.length; index += 1) {
      const system = systems[index];
      const radius = 75_000 + system.storm * 190_000;
      const extentDegrees = radius / 111_000;
      const severe = system.storm > 0.72;
      const color = severe
        ? Cesium.Color.fromCssColorString('#a8c7df')
        : Cesium.Color.fromCssColorString('#d6e3eb');

      const lobeCount = severe ? 4 : 3;
      for (let lobe = 0; lobe < lobeCount; lobe += 1) {
        const along = (stormHash(system.shapeSeed, lobe * 4) - 0.5) * extentDegrees * 1.15;
        const cross = (stormHash(system.shapeSeed, lobe * 4 + 1) - 0.5) * extentDegrees * 1.3;
        const lobeRadius = radius * (0.42 + stormHash(system.shapeSeed, lobe * 4 + 2) * 0.38);
        const aspect = 0.44 + stormHash(system.shapeSeed, lobe * 4 + 3) * 0.3;
        source.entities.add({
          id: `${system.id}-lobe-${lobe}`,
          position: new Cesium.CallbackProperty(
            () => stormCartesian(system, along, cross, 72_000 + lobe * 900),
            false,
          ),
          ellipse: {
            semiMajorAxis: lobeRadius,
            semiMinorAxis: lobeRadius * aspect,
            height: 72_000 + lobe * 900,
            rotation: system.windAngle + (stormHash(system.shapeSeed, 20 + lobe) - 0.5) * 0.72,
            material: color.withAlpha(0.045 + system.storm * 0.055),
            outline: false,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 8_500_000),
          },
        });
      }

      source.entities.add({
        id: `${system.id}-front`,
        polyline: {
          positions: new Cesium.CallbackProperty(() => {
            const points = [];
            for (let pointIndex = -2; pointIndex <= 2; pointIndex += 1) {
              const cross = pointIndex * extentDegrees * 0.42;
              const curve = (1 - Math.abs(pointIndex) / 2) * extentDegrees * 0.28;
              const irregularity = (stormHash(system.shapeSeed, 40 + pointIndex + 2) - 0.5) * extentDegrees * 0.22;
              const point = weather.offsetStormPosition(system, curve + irregularity, cross);
              points.push(point.longitude, point.latitude, 103_000);
            }
            return Cesium.Cartesian3.fromDegreesArrayHeights(points);
          }, false),
          width: severe ? 1.7 : 1.05,
          material: color.withAlpha(0.2),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 4_200_000),
        },
      });

      if (severe) {
        source.entities.add({
          id: `${system.id}-core`,
          position: new Cesium.CallbackProperty(
            () => stormCartesian(system, 0, 0, 112_000),
            false,
          ),
          point: {
            pixelSize: 3 + system.storm * 3,
            color: Cesium.Color.fromCssColorString('#d9efff').withAlpha(0.58),
            outlineColor: Cesium.Color.fromCssColorString('#597991').withAlpha(0.45),
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
      await crossfadeCloudLayer(nextCloudLayer);

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
    if (weatherEnabled && (cloudMissing || now - lastTextureRefresh > WEATHER_REFRESH_MS)) refreshWeather();
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
