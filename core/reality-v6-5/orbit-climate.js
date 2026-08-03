import * as Astronomy from 'https://cdn.jsdelivr.net/npm/astronomy-engine@2.1.19/+esm';
import { GRID_WIDTH, GRID_HEIGHT, CELL_COUNT } from '../reality-v6/simulation.js';

const STORAGE_KEY = 'reality-v6-5-orbital-climate';
const AU_KM = 149_597_870.7;
const TAU = Math.PI * 2;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));

function wrapX(x) {
  const value = x % GRID_WIDTH;
  return value < 0 ? value + GRID_WIDTH : value;
}

function clampY(y) {
  return Math.max(0, Math.min(GRID_HEIGHT - 1, y));
}

function indexOf(x, y) {
  return clampY(y) * GRID_WIDTH + wrapX(x);
}

function normalizeDegrees(value) {
  let result = value % 360;
  if (result > 180) result -= 360;
  if (result < -180) result += 360;
  return result;
}

function astroDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value.date instanceof Date) return value.date;
  if (value.time?.date instanceof Date) return value.time.date;
  const parsed = new Date(value.date || value.time || value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function phaseName(degrees) {
  const phase = ((degrees % 360) + 360) % 360;
  if (phase < 22.5 || phase >= 337.5) return 'new moon';
  if (phase < 67.5) return 'waxing crescent';
  if (phase < 112.5) return 'first quarter';
  if (phase < 157.5) return 'waxing gibbous';
  if (phase < 202.5) return 'full moon';
  if (phase < 247.5) return 'waning gibbous';
  if (phase < 292.5) return 'third quarter';
  return 'waning crescent';
}

function seasonName(date, seasons) {
  const time = date.getTime();
  const march = astroDate(seasons?.mar_equinox)?.getTime() ?? Infinity;
  const june = astroDate(seasons?.jun_solstice)?.getTime() ?? Infinity;
  const september = astroDate(seasons?.sep_equinox)?.getTime() ?? Infinity;
  const december = astroDate(seasons?.dec_solstice)?.getTime() ?? Infinity;
  if (time >= december || time < march) return 'northern winter';
  if (time < june) return 'northern spring';
  if (time < september) return 'northern summer';
  return 'northern autumn';
}

function eclipseLabel(info, fallback) {
  if (!info) return fallback;
  const kind = String(info.kind || '').replace(/^.*\./, '').toLowerCase();
  return kind ? `${kind} ${fallback}` : fallback;
}

export class AstronomyClimateCoupling {
  constructor(simulation) {
    this.simulation = simulation;
    this.date = new Date();
    this.snow = new Float32Array(CELL_COUNT);
    this.coastal = new Uint8Array(CELL_COUNT);
    this.coastalCells = [];
    this.lastState = null;
    this.events = null;
    this.eventKey = '';
    this.seasonCache = null;
    this.seasonYear = null;
    this._buildCoastMask();
    this.load();
    this.lastState = this.astronomyState();
  }

  _buildCoastMask() {
    for (let y = 0; y < GRID_HEIGHT; y += 1) {
      for (let x = 0; x < GRID_WIDTH; x += 1) {
        const i = indexOf(x, y);
        if (this.simulation.baseElevation[i] <= 0) continue;
        const oceanNeighbor =
          this.simulation.baseElevation[indexOf(x - 1, y)] <= 0 ||
          this.simulation.baseElevation[indexOf(x + 1, y)] <= 0 ||
          this.simulation.baseElevation[indexOf(x, y - 1)] <= 0 ||
          this.simulation.baseElevation[indexOf(x, y + 1)] <= 0;
        if (oceanNeighbor) {
          this.coastal[i] = 1;
          this.coastalCells.push(i);
        }
      }
    }
  }

  load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!saved) return false;
      const date = new Date(saved.date);
      if (Number.isFinite(date.getTime())) this.date = date;
      if (Array.isArray(saved.snow) && saved.snow.length === CELL_COUNT) {
        this.snow.set(saved.snow.map((value) => clamp(Number(value) || 0)));
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1,
        date: this.date.toISOString(),
        snow: Array.from(this.snow),
      }));
      return true;
    } catch (_) {
      return false;
    }
  }

  resetClock() {
    this.date = new Date();
    this.snow.fill(0);
    this.eventKey = '';
    this.events = null;
    this.lastState = this.astronomyState();
    this.save();
  }

  _equatorial(body, date) {
    const vector = Astronomy.GeoVector(body, date, true);
    const rotation = Astronomy.Rotation_EQJ_EQD(date);
    return Astronomy.EquatorFromVector(Astronomy.RotateVector(rotation, vector));
  }

  astronomyState(date = this.date) {
    const sun = this._equatorial(Astronomy.Body.Sun, date);
    const moon = this._equatorial(Astronomy.Body.Moon, date);
    const siderealDegrees = Astronomy.SiderealTime(date) * 15;
    const moonVector = Astronomy.GeoVector(Astronomy.Body.Moon, date, true);
    const lunarDistanceKm = Math.hypot(moonVector.x, moonVector.y, moonVector.z) * AU_KM;
    const moonPhaseDegrees = Astronomy.MoonPhase(date);
    const springAlignment = 0.5 + 0.5 * Math.cos(moonPhaseDegrees * Math.PI / 90);
    const distanceFactor = Math.pow(384_400 / Math.max(320_000, lunarDistanceKm), 3);
    const tideIndex = clamp((0.36 + springAlignment * 0.74) * distanceFactor, 0.18, 1.55);

    const year = date.getUTCFullYear();
    if (year !== this.seasonYear) {
      this.seasonYear = year;
      try {
        this.seasonCache = Astronomy.Seasons(year);
      } catch (_) {
        this.seasonCache = null;
      }
    }

    const eventKey = `${year}-${date.getUTCMonth()}`;
    if (eventKey !== this.eventKey) {
      this.eventKey = eventKey;
      try {
        const solar = Astronomy.SearchGlobalSolarEclipse(date);
        const lunar = Astronomy.SearchLunarEclipse(date);
        this.events = {
          solar: {
            date: astroDate(solar?.peak),
            label: eclipseLabel(solar, 'solar eclipse'),
          },
          lunar: {
            date: astroDate(lunar?.peak),
            label: eclipseLabel(lunar, 'lunar eclipse'),
          },
        };
      } catch (_) {
        this.events = null;
      }
    }

    const state = {
      date: new Date(date),
      sunDeclination: sun.dec,
      moonDeclination: moon.dec,
      subsolarLongitude: normalizeDegrees(sun.ra * 15 - siderealDegrees),
      subsolarLatitude: sun.dec,
      sublunarLongitude: normalizeDegrees(moon.ra * 15 - siderealDegrees),
      sublunarLatitude: moon.dec,
      moonPhaseDegrees,
      moonPhase: phaseName(moonPhaseDegrees),
      lunarDistanceKm,
      tideIndex,
      season: seasonName(date, this.seasonCache),
      seasons: this.seasonCache,
      events: this.events,
    };
    this.lastState = state;
    return state;
  }

  setDate(date, { applyClimate = true } = {}) {
    const next = new Date(date);
    if (!Number.isFinite(next.getTime())) return this.lastState;
    const elapsedDays = (next.getTime() - this.date.getTime()) / 86_400_000;
    if (applyClimate && Math.abs(elapsedDays) > 0.01) {
      return this.advanceDays(elapsedDays);
    }
    this.date = next;
    this.lastState = this.astronomyState();
    return this.lastState;
  }

  advanceDays(days) {
    if (!Number.isFinite(days) || days === 0) return this.lastState;
    const direction = Math.sign(days);
    let remaining = Math.min(Math.abs(days), 3650);
    while (remaining > 0.001) {
      const chunk = Math.min(30, remaining) * direction;
      this.date = new Date(this.date.getTime() + chunk * 86_400_000);
      const state = this.astronomyState();
      this._applyClimateChunk(chunk, state);
      remaining -= Math.abs(chunk);
    }
    this.simulation.rebuildFeatures();
    this.simulation.save();
    this.save();
    return this.lastState;
  }

  _applyClimateChunk(days, state) {
    const magnitude = Math.abs(days);
    const direction = Math.sign(days);
    const declinationRadians = state.sunDeclination * Math.PI / 180;
    const tideStress = Math.max(0, state.tideIndex - 1.02);

    for (let y = 0; y < GRID_HEIGHT; y += 1) {
      const latitude = -Math.PI / 2 + ((y + 0.5) / GRID_HEIGHT) * Math.PI;
      const seasonalAnomaly = Math.sin(latitude) * Math.sin(declinationRadians);
      for (let x = 0; x < GRID_WIDTH; x += 1) {
        const i = indexOf(x, y);
        if (this.simulation.baseElevation[i] <= 0) {
          this.snow[i] = 0;
          continue;
        }

        const effectiveTemperature = clamp(
          this.simulation.temperature[i] + seasonalAnomaly * 0.19 - this.simulation.baseElevation[i] * 0.035,
          0,
          1,
        );
        const snowTarget = effectiveTemperature < 0.24
          ? clamp((0.25 - effectiveTemperature) * 4.6 + this.simulation.moisture[i] * 0.28)
          : 0;
        const snowRate = snowTarget > this.snow[i] ? 0.018 : 0.035;
        this.snow[i] = clamp(this.snow[i] + (snowTarget - this.snow[i]) * snowRate * magnitude * direction);

        const growingTemperature = clamp(1 - Math.abs(effectiveTemperature - 0.6) * 2.45);
        const growthTarget = clamp(
          growingTemperature * this.simulation.moisture[i] * (1 - this.snow[i] * 0.88) -
          Math.max(0, 0.2 - this.simulation.moisture[i]) * 1.7,
        );
        const vegetationDelta = (growthTarget - this.simulation.vegetation[i]) * 0.0011 * magnitude * direction;
        this.simulation.vegetation[i] = clamp(this.simulation.vegetation[i] + vegetationDelta);

        if (this.coastal[i]) {
          const tidalWetness = (state.tideIndex - 0.62) * 0.00038 * magnitude * direction;
          this.simulation.moisture[i] = clamp(this.simulation.moisture[i] + tidalWetness);
          this.simulation.runoff[i] = clamp(
            this.simulation.runoff[i] + Math.max(0, state.tideIndex - 0.9) * 0.0003 * magnitude * direction,
          );
          if (this.simulation.population[i] > 0) {
            const coastalBenefit = state.tideIndex < 1.05 ? 0.000006 : 0;
            const coastalRisk = tideStress * (0.000021 + this.snow[i] * 0.00001);
            const multiplier = clamp(1 + (coastalBenefit - coastalRisk) * magnitude * direction, 0.985, 1.012);
            this.simulation.population[i] = clamp(this.simulation.population[i] * multiplier, 0, 180_000);
          }
        }
      }
    }
  }

  coastalSettlements() {
    const tide = this.lastState?.tideIndex ?? 0.6;
    return this.simulation.settlements
      .filter((settlement) => this.coastal[settlement.cell])
      .map((settlement) => ({
        ...settlement,
        tideRisk: clamp((tide - 0.82) * 1.55 + this.snow[settlement.cell] * 0.2),
        snow: this.snow[settlement.cell],
      }))
      .sort((a, b) => b.tideRisk - a.tideRisk);
  }

  statistics() {
    let snowLand = 0;
    let land = 0;
    let coastalPopulation = 0;
    for (let i = 0; i < CELL_COUNT; i += 1) {
      if (this.simulation.baseElevation[i] > 0) {
        land += 1;
        if (this.snow[i] > 0.22) snowLand += 1;
      }
      if (this.coastal[i]) coastalPopulation += this.simulation.population[i];
    }
    return {
      snowPercent: land ? Math.round((snowLand / land) * 100) : 0,
      coastalCells: this.coastalCells.length,
      coastalPopulation: Math.round(coastalPopulation),
      coastalSettlements: this.coastalSettlements().length,
    };
  }

  createSnowTideTexture(width = 256, height = 128) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    const image = context.createImageData(width, height);
    const pixels = image.data;
    const tide = this.lastState?.tideIndex ?? 0.6;

    for (let y = 0; y < height; y += 1) {
      const gridY = clampY(Math.floor(((height - 1 - y) / Math.max(1, height - 1)) * GRID_HEIGHT));
      for (let x = 0; x < width; x += 1) {
        const gridX = wrapX(Math.floor((x / Math.max(1, width - 1)) * GRID_WIDTH));
        const i = indexOf(gridX, gridY);
        const offset = (y * width + x) * 4;
        const snow = this.snow[i];
        const coastalGlow = this.coastal[i] ? clamp((tide - 0.45) * 0.38) : 0;
        pixels[offset] = Math.round(210 + snow * 45);
        pixels[offset + 1] = Math.round(232 + snow * 23);
        pixels[offset + 2] = 255;
        pixels[offset + 3] = Math.round(clamp(snow * 0.72 + coastalGlow) * 220);
      }
    }

    context.putImageData(image, 0, 0);
    return canvas;
  }
}
