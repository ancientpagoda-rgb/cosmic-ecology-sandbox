const STORAGE_PREFIX = 'eidolon-season-chronicle-v1';
const REGION = Object.freeze({
  id: 'saltglass-delta',
  name: 'Saltglass Delta',
  x: 770,
  y: 468,
  biome: 'tidal wetland',
});

export function createSeasonChronicle({ world, waterCycle, lineageFoundry, seed = 'eidolon', advanceSimulation }) {
  const storageKey = `${STORAGE_PREFIX}:${seed}`;
  let entryNumber = 0;
  let state = readState() || {
    season: 14,
    region: { drought: 0.72, releasedLineageId: null, releasedSeason: null },
    history: [entry(14, 'Saltglass Delta is drying.', 'Water has retreated from the outer reed beds, and reed-horn sightings are thinning.')],
  };

  function entry(season, title, description, kind = 'planet') {
    entryNumber += 1;
    return { id: `${season}-${entryNumber}-${kind}`, season, title, description, kind };
  }

  function record(title, description, kind = 'planet') {
    state.history.unshift(entry(state.season, title, description, kind));
    state.history.length = Math.min(state.history.length, 36);
    persist();
  }

  function getRegion() {
    return {
      ...REGION,
      drought: state.region.drought,
      releasedLineageId: state.region.releasedLineageId,
      releasedSeason: state.region.releasedSeason,
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
      description: latest?.description || 'A distant watershed is waiting to be understood.',
      releaseAvailable,
      releaseLabel: releaseAvailable ? 'Release drought lineage' : 'Lineage established',
    };
  }

  function releaseDroughtLineage() {
    if (state.region.releasedLineageId) return { capsule: lineageFoundry.list().find(item => item.id === state.region.releasedLineageId), existing: true };
    const capsule = lineageFoundry.create({
      name: 'Saltglass Reedrunner',
      guild: 'grazer',
      visual: { color: '#d4c77b', form: 'kite' },
      traits: { speed: 1.08, sense: 1.16, metabolism: 0.72, thermal: 0.78 },
    });
    const released = lineageFoundry.release(capsule.id, REGION);
    state.region.releasedLineageId = capsule.id;
    state.region.releasedSeason = state.season;
    record('A new lineage crossed the salt flats.', 'You released Saltglass Reedrunners into the drying delta. They can endure heat, but every new mouth changes the food web.', 'intervention');
    return { capsule, released, existing: false };
  }

  function advanceSeason() {
    // Advance enough fixed steps for the existing coupled systems to respond,
    // while keeping the player action responsive on an ordinary browser.
    advanceSimulation?.(36);
    const water = waterCycle.sample(REGION.x, REGION.y);
    const observedStress = clamp(0.78 - water.soil + water.drought * 0.28 - water.rain * 4, 0, 1);
    const released = Boolean(state.region.releasedLineageId);
    state.season += 1;
    state.region.drought = clamp(state.region.drought * 0.62 + observedStress * 0.38 - (released ? 0.08 : 0), 0, 1);

    if (released && state.season === state.region.releasedSeason + 1) {
      record('The Reedrunners survived the dry flats.', 'The new grazers are feeding where the retreating reeds can no longer support the old herds. Fresh predator tracks mark the eastern channel.', 'consequence');
    } else if (released && state.region.drought > 0.62) {
      record('Saltglass adapted, but did not heal.', 'The Reedrunners persist through the drought, while the remaining wetlands contract toward deeper channels.', 'consequence');
    } else if (released) {
      record('Water returned to the reed margins.', 'The delta is holding for now. Reedrunners and the older herd are sharing the recovering shallows.', 'consequence');
    } else if (state.region.drought > 0.62) {
      record('The outer reed beds retreated again.', 'Dry flats widened across Saltglass Delta. The old grazer paths are becoming harder to find.', 'consequence');
    } else {
      record('A brief rain reached Saltglass.', 'The marshes took in enough water to slow the retreat, but the delta is still fragile.', 'consequence');
    }
    persist();
    return getPulse();
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
      return saved;
    } catch { return null; }
  }

  return { getPulse, getRegion, releaseDroughtLineage, advanceSeason, reset };
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
