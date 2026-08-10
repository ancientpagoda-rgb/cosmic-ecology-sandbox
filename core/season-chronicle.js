const STORAGE_PREFIX = 'eidolon-season-chronicle-v1';
const REGION = Object.freeze({
  id: 'saltglass-delta',
  name: 'Saltglass Delta',
  x: 770,
  y: 468,
  biome: 'tidal wetland',
  observationRadius: 135,
});

export function createSeasonChronicle({ world, waterCycle, lineageFoundry, seed = 'eidolon', advanceSimulation }) {
  const storageKey = `${STORAGE_PREFIX}:${seed}`;
  let entryNumber = 0;
  let state = readState() || {
    season: 14,
    region: {
      drought: 0.72,
      releasedLineageId: null,
      releasedSeason: null,
      observation: null,
    },
    history: [],
  };

  restoreReleasedLineage();
  let observation = observeRegion();
  state.region.observation = observation;

  if (!state.history.length) {
    recordObservation(observation, {
      title: 'Saltglass Delta is under observation.',
      description: describeSnapshot(observation),
      kind: 'planet',
    });
  } else {
    persist();
  }

  function entry(season, title, description, kind = 'planet', snapshot = null) {
    entryNumber += 1;
    return {
      id: `${season}-${world.tick}-${entryNumber}-${kind}`,
      season,
      title,
      description,
      kind,
      snapshot: snapshot ? clone(snapshot) : null,
    };
  }

  function record(title, description, kind = 'planet', snapshot = observation) {
    state.history.unshift(entry(state.season, title, description, kind, snapshot));
    state.history.length = Math.min(state.history.length, 36);
    persist();
  }

  function recordObservation(snapshot, { title, description, kind = 'planet' }) {
    observation = snapshot;
    state.region.observation = clone(snapshot);
    state.region.drought = snapshot.stress;
    record(title, description, kind, snapshot);
  }

  function getRegion() {
    return {
      ...REGION,
      drought: state.region.drought,
      releasedLineageId: state.region.releasedLineageId,
      releasedSeason: state.region.releasedSeason,
      observation: clone(observation),
      history: state.history.filter(item => item.season <= state.season).slice(0, 6),
    };
  }

  function getPulse() {
    const latest = state.history[0];
    const releaseAvailable = !state.region.releasedLineageId;
    return {
      season: state.season,
      region: getRegion(),
      title: latest?.title || 'Eidolon is changing.',
      description: latest?.description || describeSnapshot(observation),
      releaseAvailable,
      releaseLabel: releaseAvailable ? 'Release drought lineage' : 'Lineage established',
    };
  }

  function releaseDroughtLineage() {
    if (state.region.releasedLineageId) {
      const capsule = lineageFoundry.list().find(item => item.id === state.region.releasedLineageId) || null;
      return { capsule, existing: true };
    }

    const capsule = lineageFoundry.create({
      name: 'Saltglass Reedrunner',
      guild: 'grazer',
      visual: { color: '#d4c77b', form: 'kite' },
      traits: { speed: 1.08, sense: 1.16, metabolism: 0.72, thermal: 0.78 },
    });
    const released = lineageFoundry.release(capsule.id, REGION);
    state.region.releasedLineageId = capsule.id;
    state.region.releasedSeason = state.season;

    const afterRelease = observeRegion();
    const releasedPopulation = afterRelease.releasedLineage;
    recordObservation(afterRelease, {
      title: 'A new lineage entered Saltglass.',
      description: `The release placed ${releasedPopulation} Saltglass Reedrunner${releasedPopulation === 1 ? '' : 's'} inside the observed watershed. ${describeSnapshot(afterRelease)}`,
      kind: 'intervention',
    });
    return { capsule, released, existing: false };
  }

  function advanceSeason() {
    const before = observeRegion();

    // Advance the same authoritative fixed-step systems used by normal play.
    // The chronicle observes their result; it never edits forage, population,
    // predation, or water levels to force a particular story.
    advanceSimulation?.(36);

    const after = observeRegion();
    state.season += 1;
    state.region.drought = after.stress;
    const consequence = describeConsequence(before, after);
    recordObservation(after, consequence);
    return getPulse();
  }

  function observeRegion() {
    const water = waterCycle.sample(REGION.x, REGION.y);
    const ecology = scanEcology(REGION.x, REGION.y, REGION.observationRadius);
    const soil = finite(water.soil);
    const drought = finite(water.drought);
    const rain = finite(water.rain);
    const river = finite(water.river);
    const delta = finite(water.delta);
    const tide = finite(water.tide);
    const stress = clamp(0.78 - soil + drought * 0.28 - rain * 4 - river * 0.08 - delta * tide * 0.06, 0, 1);

    return {
      tick: world.tick,
      stress: round(stress),
      water: {
        soil: round(soil),
        drought: round(drought),
        rain: round(rain),
        river: round(river),
        delta: round(delta),
        tide: round(tide),
      },
      ...ecology,
    };
  }

  function scanEcology(x, y, radius) {
    const components = world.ecs?.components || {};
    const position = components.position;
    if (!position) {
      return {
        plants: 0,
        plantBiomass: 0,
        grazers: 0,
        predators: 0,
        apex: 0,
        animals: 0,
        releasedLineage: 0,
        infected: 0,
        meanEnergy: 0,
      };
    }

    let plants = 0;
    let plantBiomassTotal = 0;
    for (const [id, resource] of components.resource || []) {
      const pos = position.get(id);
      if (!pos || resource?.kind !== 'plant' || distanceToRegion(pos, { x, y }) > radius) continue;
      plants += 1;
      plantBiomassTotal += finite(resource.amount);
    }

    const counts = {
      grazers: 0,
      predators: 0,
      apex: 0,
      animals: 0,
      releasedLineage: 0,
      infected: 0,
      energyTotal: 0,
      energySamples: 0,
    };

    const groups = [
      ['grazers', components.agent],
      ['predators', components.predator],
      ['apex', components.apex],
    ];
    for (const [label, group] of groups) {
      for (const [id, organism] of group || []) {
        const pos = position.get(id);
        if (!pos || distanceToRegion(pos, { x, y }) > radius) continue;
        counts[label] += 1;
        counts.animals += 1;
        if (organism?.lineageCapsuleId && organism.lineageCapsuleId === state.region.releasedLineageId) counts.releasedLineage += 1;
        if (finite(organism?.infected) > 0) counts.infected += 1;
        if (Number.isFinite(Number(organism?.energy))) {
          counts.energyTotal += Number(organism.energy);
          counts.energySamples += 1;
        }
      }
    }

    return {
      plants,
      plantBiomass: round(plants ? plantBiomassTotal / plants : 0),
      grazers: counts.grazers,
      predators: counts.predators,
      apex: counts.apex,
      animals: counts.animals,
      releasedLineage: counts.releasedLineage,
      infected: counts.infected,
      meanEnergy: round(counts.energySamples ? counts.energyTotal / counts.energySamples : 0),
    };
  }

  function restoreReleasedLineage() {
    const lineageId = state.region.releasedLineageId;
    if (!lineageId || countReleasedLineage(lineageId) > 0) return;

    const capsule = lineageFoundry.list().find(item => item.id === lineageId);
    if (!capsule) {
      state.region.releasedLineageId = null;
      state.region.releasedSeason = null;
      return;
    }

    try {
      lineageFoundry.release(capsule.id, REGION);
    } catch {
      // The world still starts even if an old local lineage capsule is invalid.
    }
  }

  function countReleasedLineage(lineageId) {
    const components = world.ecs?.components || {};
    let count = 0;
    for (const group of [components.agent, components.predator, components.apex]) {
      for (const [, organism] of group || []) {
        if (organism?.lineageCapsuleId === lineageId) count += 1;
      }
    }
    return count;
  }

  function describeConsequence(before, after) {
    const stressDelta = after.stress - before.stress;
    const biomassDelta = after.plantBiomass - before.plantBiomass;
    const releasedDelta = after.releasedLineage - before.releasedLineage;
    const predatorBefore = before.predators + before.apex;
    const predatorAfter = after.predators + after.apex;
    const predatorDelta = predatorAfter - predatorBefore;
    const released = Boolean(state.region.releasedLineageId);

    let title;
    if (released && after.releasedLineage === 0) {
      title = 'The introduced lineage disappeared from Saltglass.';
    } else if (released && releasedDelta >= 2) {
      title = 'The Reedrunners are expanding through Saltglass.';
    } else if (released && releasedDelta <= -2) {
      title = 'The Reedrunners lost ground this season.';
    } else if (stressDelta >= 0.08) {
      title = 'Saltglass dried further.';
    } else if (stressDelta <= -0.08) {
      title = 'Water stress eased across Saltglass.';
    } else if (biomassDelta >= 0.08) {
      title = 'Plant biomass increased around the delta.';
    } else if (biomassDelta <= -0.08) {
      title = 'Plant biomass declined around the delta.';
    } else if (predatorDelta >= 2) {
      title = 'Predator pressure rose around Saltglass.';
    } else {
      title = 'Saltglass entered a new seasonal balance.';
    }

    const parts = [
      `Measured water stress ${trendWord(stressDelta, true)} to ${percent(after.stress)}.`,
      `Mean local plant biomass ${trendWord(biomassDelta)} to ${percent(after.plantBiomass)} across ${after.plants} plant patches.`,
      `${after.grazers} grazers, ${after.predators} predators, and ${after.apex} apex predators were inside the ${REGION.observationRadius}-unit observation radius.`,
    ];

    if (released) {
      parts.push(`${after.releasedLineage} Saltglass Reedrunner${after.releasedLineage === 1 ? '' : 's'} remained in the observed region${releasedDelta ? ` (${signed(releasedDelta)} this season)` : ''}.`);
    }
    if (after.infected) parts.push(`${after.infected} observed animal${after.infected === 1 ? '' : 's'} carried active infection.`);
    if (after.meanEnergy) parts.push(`Mean observed animal energy was ${after.meanEnergy.toFixed(2)}.`);

    return { title, description: parts.join(' '), kind: 'consequence' };
  }

  function describeSnapshot(snapshot) {
    const predators = snapshot.predators + snapshot.apex;
    return `Measured water stress is ${percent(snapshot.stress)}; mean plant biomass is ${percent(snapshot.plantBiomass)} across ${snapshot.plants} local patches, with ${snapshot.grazers} grazers and ${predators} predators observed nearby.`;
  }

  function distanceToRegion(a, b) {
    const dx = Math.min(Math.abs(a.x - b.x), world.width - Math.abs(a.x - b.x));
    return Math.hypot(dx, a.y - b.y);
  }

  function reset() {
    try { localStorage.removeItem(storageKey); } catch { /* storage is optional */ }
  }

  function persist() {
    try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch { /* storage is optional */ }
  }

  function readState() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (!saved || !Number.isInteger(saved.season) || !saved.region || !Array.isArray(saved.history)) return null;
      saved.region.observation ??= null;
      return saved;
    } catch {
      return null;
    }
  }

  return { getPulse, getRegion, releaseDroughtLineage, advanceSeason, observeRegion, reset };
}

function trendWord(delta, inverse = false) {
  const adjusted = inverse ? -delta : delta;
  if (adjusted > 0.035) return inverse ? 'fell' : 'rose';
  if (adjusted < -0.035) return inverse ? 'rose' : 'fell';
  return 'held near';
}

function percent(value) {
  return `${Math.round(clamp(finite(value), 0, 1) * 100)}%`;
}

function signed(value) {
  return value > 0 ? `+${value}` : String(value);
}

function round(value) {
  return Math.round(finite(value) * 1000) / 1000;
}

function finite(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
