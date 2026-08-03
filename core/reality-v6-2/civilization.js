import * as turf from 'https://cdn.jsdelivr.net/npm/@turf/turf@7.3.5/+esm';

const STORAGE_KEY = 'reality-v6-2-politics-years';
const COLORS = ['#62c7ff','#ffb866','#82e6a7','#d39cff','#ff7f8f','#f2de74','#6ee7de','#b6c7ff','#f0a6ff','#9ed47b'];
const PREFIXES = ['Astra','Bel','Cael','Doro','Eris','Fara','Galen','Helio','Iria','Koro','Luma','Mero','Nara','Orin','Pavo','Qara','Rhea','Sola','Taro','Vela'];
const SUFFIXES = ['ria','on','ara','en','is','um','or','ea','ai','os','eth','une'];
const FORMS = ['River Commonwealth','Maritime League','Highland Realm','Free Cities','Solar Republic','Green Confederacy','Crown Union','Frontier Compact'];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function hashText(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function unitHash(text) {
  return (hashText(text) % 1_000_003) / 1_000_003;
}

function nationName(id) {
  const seed = hashText(id);
  return `${PREFIXES[seed % PREFIXES.length]}${SUFFIXES[(seed >>> 7) % SUFFIXES.length]}`;
}

function greatCircle(start, end, properties = {}) {
  try {
    const route = turf.greatCircle(start, end, { npoints: 48, offset: 12 });
    route.properties = properties;
    return route;
  } catch (_) {
    return turf.lineString([start.geometry.coordinates, end.geometry.coordinates], properties);
  }
}

export class TurfCivilizations {
  constructor(simulation) {
    this.simulation = simulation;
    try {
      this.politicsYears = Number(localStorage.getItem(STORAGE_KEY)) || 0;
    } catch (_) {
      this.politicsYears = 0;
    }
    this.snapshot = this.build();
  }

  advance(years) {
    this.politicsYears += years;
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, String(this.politicsYears));
      return true;
    } catch (_) {
      return false;
    }
  }

  reset() {
    this.politicsYears = 0;
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    this.snapshot = this.build();
  }

  chooseCapitals() {
    const sorted = [...this.simulation.settlements]
      .filter((settlement) => Math.abs(settlement.latitude * 180 / Math.PI) < 80)
      .sort((a, b) => b.population - a.population);
    if (!sorted.length) return [];

    const targetCount = clamp(Math.round(sorted.length / 8), 3, 10);
    const chosen = [];
    for (const settlement of sorted) {
      const point = turf.point([
        settlement.longitude * 180 / Math.PI,
        settlement.latitude * 180 / Math.PI,
      ]);
      const farEnough = chosen.every((existing) => turf.distance(point, existing.point, { units: 'kilometers' }) > 1_350);
      if (!farEnough && chosen.length >= 2) continue;
      chosen.push({ settlement, point });
      if (chosen.length >= targetCount) break;
    }

    for (const settlement of sorted) {
      if (chosen.length >= Math.min(targetCount, sorted.length)) break;
      if (chosen.some((entry) => entry.settlement.id === settlement.id)) continue;
      chosen.push({
        settlement,
        point: turf.point([
          settlement.longitude * 180 / Math.PI,
          settlement.latitude * 180 / Math.PI,
        ]),
      });
    }
    return chosen;
  }

  build() {
    const capitals = this.chooseCapitals();
    if (capitals.length < 2) {
      return {
        nations: [], territories: turf.featureCollection([]), influence: turf.featureCollection([]),
        tradeRoutes: [], migrations: [], conflicts: [], stats: { nations: 0, tradeRoutes: 0, conflicts: 0, migrants: 0 },
      };
    }

    const era = Math.floor((this.simulation.years + this.politicsYears) / 250);
    const capitalPoints = turf.featureCollection(capitals.map((entry, index) => {
      const seed = `${entry.settlement.id}:${era}`;
      const power = entry.settlement.population * (0.8 + unitHash(`${seed}:power`) * 0.65);
      const nation = {
        id: `nation-${entry.settlement.id}`,
        name: nationName(entry.settlement.id),
        form: FORMS[hashText(entry.settlement.id) % FORMS.length],
        color: COLORS[index % COLORS.length],
        capital: entry.settlement,
        power,
        stability: 0.42 + unitHash(`${seed}:stability`) * 0.55,
        wealth: 0.3 + unitHash(`${seed}:wealth`) * 0.68,
      };
      entry.nation = nation;
      return turf.point(entry.point.geometry.coordinates, { nationId: nation.id, index });
    }));

    let territories = turf.featureCollection([]);
    try {
      const voronoi = turf.voronoi(capitalPoints, { bbox: [-179.8, -82, 179.8, 82] });
      const features = (voronoi?.features || []).filter(Boolean).map((feature) => {
        const center = turf.centroid(feature);
        const nearest = turf.nearestPoint(center, capitalPoints);
        const nation = capitals[Number(nearest.properties.index)].nation;
        feature.properties = {
          nationId: nation.id,
          nation: nation.name,
          color: nation.color,
          stability: nation.stability,
        };
        return feature;
      });
      territories = turf.featureCollection(features);
    } catch (_) {}

    const influenceFeatures = [];
    for (const entry of capitals) {
      const nation = entry.nation;
      const radius = clamp(780 + Math.log10(nation.power + 10) * 235 + nation.stability * 280, 900, 2_350);
      try {
        const zone = turf.buffer(entry.point, radius, { units: 'kilometers', steps: 18 });
        if (zone) {
          zone.properties = { nationId: nation.id, nation: nation.name, color: nation.color, radius };
          influenceFeatures.push(zone);
        }
      } catch (_) {}
    }

    const tradeRoutes = [];
    const conflicts = [];
    const seenPairs = new Set();
    for (let index = 0; index < capitals.length; index += 1) {
      const origin = capitals[index];
      const neighbors = capitals
        .map((target, targetIndex) => ({
          target,
          targetIndex,
          distance: targetIndex === index ? Infinity : turf.distance(origin.point, target.point, { units: 'kilometers' }),
        }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 3);

      for (const neighbor of neighbors) {
        const key = index < neighbor.targetIndex ? `${index}:${neighbor.targetIndex}` : `${neighbor.targetIndex}:${index}`;
        if (seenPairs.has(key)) continue;
        seenPairs.add(key);
        const relation = unitHash(`${origin.nation.id}:${neighbor.target.nation.id}:${era}`) * 2 - 1;
        if (relation < -0.56 && neighbor.distance < 4_200) {
          const midpoint = turf.midpoint(origin.point, neighbor.target.point);
          conflicts.push({
            id: `conflict-${key}`,
            from: origin.nation,
            to: neighbor.target.nation,
            intensity: clamp((-relation - 0.45) * 1.65, 0.15, 1),
            location: midpoint.geometry.coordinates,
          });
          continue;
        }
        if (relation > -0.25 && neighbor.distance < 7_000) {
          tradeRoutes.push({
            id: `trade-${key}`,
            from: origin.nation,
            to: neighbor.target.nation,
            value: Math.round(Math.sqrt(origin.nation.power * neighbor.target.nation.power) / Math.max(1, neighbor.distance) * 10),
            feature: greatCircle(origin.point, neighbor.target.point, {
              from: origin.nation.name,
              to: neighbor.target.nation.name,
              color: origin.nation.color,
            }),
          });
        }
      }
    }

    const migrations = [];
    const capitalCollection = turf.featureCollection(capitals.map((entry, index) => turf.point(entry.point.geometry.coordinates, { index })));
    for (const settlement of this.simulation.settlements) {
      if (capitals.some((entry) => entry.settlement.id === settlement.id)) continue;
      const start = turf.point([
        settlement.longitude * 180 / Math.PI,
        settlement.latitude * 180 / Math.PI,
      ]);
      const nearest = turf.nearestPoint(start, capitalCollection);
      const destination = capitals[Number(nearest.properties.index)];
      const distance = turf.distance(start, destination.point, { units: 'kilometers' });
      if (distance > 3_800) continue;
      const pressure = 0.02 + unitHash(`${settlement.id}:${era}:migration`) * 0.12;
      const people = Math.round(settlement.population * pressure);
      if (people < 20) continue;
      migrations.push({
        id: `migration-${settlement.id}`,
        destination: destination.nation,
        people,
        feature: greatCircle(start, destination.point, { destination: destination.nation.name, people }),
      });
    }
    migrations.sort((a, b) => b.people - a.people);

    const nations = capitals.map((entry) => entry.nation);
    const snapshot = {
      nations,
      territories,
      influence: turf.featureCollection(influenceFeatures),
      tradeRoutes,
      migrations: migrations.slice(0, 28),
      conflicts,
      stats: {
        nations: nations.length,
        tradeRoutes: tradeRoutes.length,
        conflicts: conflicts.length,
        migrants: migrations.reduce((sum, migration) => sum + migration.people, 0),
      },
    };
    this.snapshot = snapshot;
    return snapshot;
  }

  locate(longitude, latitude) {
    const point = turf.point([longitude, latitude]);
    for (const feature of this.snapshot.territories.features) {
      try {
        if (turf.booleanPointInPolygon(point, feature)) {
          return this.snapshot.nations.find((nation) => nation.id === feature.properties.nationId) || null;
        }
      } catch (_) {}
    }
    return null;
  }
}
