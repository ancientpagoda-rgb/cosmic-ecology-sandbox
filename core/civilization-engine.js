import { samplePlanet } from './planet.js';
import { sampleHydrology } from './hydrology.js';
import { createCivilizationVisuals } from './civilization-visuals.js';

const GRAPH_SOURCES = [
  'https://cdn.jsdelivr.net/npm/graphology@0.26.0/+esm',
  'https://esm.sh/graphology@0.26.0',
];
const ROLES = ['agent', 'predator', 'apex'];
const CONCEPTS = [
  'food', 'water', 'danger', 'home', 'kin', 'fire', 'tool', 'path', 'trade', 'peace',
  'enemy', 'leader', 'child', 'weather', 'animal', 'plant', 'stone', 'wood', 'future', 'past',
];
const TECH = [
  { id: 'fire', req: [], threshold: 0.42, factors: ['intelligence', 'dexterity', 'scarcity'] },
  { id: 'storage', req: [], threshold: 0.46, factors: ['construction', 'surplus', 'population'] },
  { id: 'crafting', req: ['fire'], threshold: 0.52, factors: ['dexterity', 'knowledge', 'materials'] },
  { id: 'agriculture', req: ['storage'], threshold: 0.58, factors: ['plantAccess', 'population', 'scarcity'] },
  { id: 'roads', req: ['storage'], threshold: 0.61, factors: ['construction', 'trade', 'population'] },
  { id: 'irrigation', req: ['agriculture'], threshold: 0.66, factors: ['waterAccess', 'construction', 'knowledge'] },
  { id: 'sanitation', req: ['storage'], threshold: 0.65, factors: ['disease', 'waterAccess', 'knowledge'] },
  { id: 'transport', req: ['crafting', 'roads'], threshold: 0.7, factors: ['trade', 'dexterity', 'knowledge'] },
  { id: 'writing', req: ['storage'], threshold: 0.72, factors: ['language', 'knowledge', 'population'] },
  { id: 'metallurgy', req: ['fire', 'crafting'], threshold: 0.78, factors: ['materials', 'fireMastery', 'knowledge'] },
];

export function createCivilizationEngine(world, embodiedEvolution, groundLevel, options = {}) {
  const mobile = options.mobile ?? matchMedia('(max-width: 720px), (pointer: coarse)').matches;
  const rng = mulberry32(options.seed ?? 0xC1711A7);
  const communities = new Map();
  const languages = new Map();
  const cultures = new Map();
  const polities = new Map();
  const minds = new Map();
  const routes = new Map();
  const inventions = new Map();
  const events = [];
  const migrations = [];
  const languageFamilies = new Map();
  const culturalLineages = new Map();
  const savedCommunities = new Map();
  const savedMinds = new Map();
  let network;
  let graphologyLoaded = false;
  let visuals;
  let elapsed = 0;
  let cognitionClock = 0;
  let communityClock = 0;
  let networkClock = 0;
  let environmentClock = 0;
  let nextLanguage = 1;
  let nextCulture = 1;
  let nextPolity = 1;
  let nextEvent = 1;
  let nextInvention = 1;
  let destroyed = false;
  const ui = createHistoryUI(mobile);

  async function initialize({ provideCapability }) {
    const GraphCtor = await loadGraphology();
    graphologyLoaded = Boolean(GraphCtor);
    network = createNetwork(GraphCtor);
    visuals = createCivilizationVisuals(
      options.container || document.getElementById('world') || document.body,
      groundLevel,
      api,
      { mobile, worldWidth: world.width, worldHeight: world.height },
    );
    provideCapability('civilization.emergent', api);
    provideCapability('culture.lineages', api);
    provideCapability('language.evolution', api);
    provideCapability('history.observatory', api);
    provideCapability('networks.graphology', network.graph);
  }

  function step(dt) {
    if (destroyed || !network) return;
    elapsed += Math.max(0, dt);
    cognitionClock += dt;
    communityClock += dt;
    networkClock += dt;
    environmentClock += dt;
    syncMinds();
    syncCommunities();

    if (cognitionClock >= (mobile ? 1.1 : 0.72)) {
      const amount = cognitionClock;
      cognitionClock = 0;
      cognitionCycle(amount);
    }
    if (communityClock >= (mobile ? 2.35 : 1.55)) {
      const amount = communityClock;
      communityClock = 0;
      communityCycle(amount);
    }
    if (networkClock >= (mobile ? 4.8 : 3.2)) {
      const amount = networkClock;
      networkClock = 0;
      networkCycle(amount);
    }
    if (environmentClock >= 2.1) {
      const amount = environmentClock;
      environmentClock = 0;
      environmentCycle(amount);
    }
  }

  function syncMinds() {
    const seen = new Set();
    const cap = mobile ? 90 : 220;
    let inspected = 0;
    for (const role of ROLES) {
      for (const [entityId, component] of world.ecs.components[role].entries()) {
        if (inspected++ >= cap) break;
        const position = world.ecs.components.position.get(entityId);
        const genome = component.embodiment;
        if (!position || !genome) continue;
        seen.add(entityId);
        let mind = minds.get(entityId);
        if (!mind) {
          mind = makeMind(entityId, role, component, genome, position);
          minds.set(entityId, mind);
        }
        mind.position = position;
        mind.component = component;
        mind.genome = genome;
        mind.speciesId = genome.speciesId || mind.speciesId;
        mind.energy = component.energy || 0;
      }
    }
    for (const entityId of minds.keys()) if (!seen.has(entityId)) minds.delete(entityId);
  }

  function makeMind(entityId, role, component, genome, position) {
    const creatureId = component.creatureId || `entity-${entityId}`;
    const restored = savedMinds.get(creatureId);
    if (restored) savedMinds.delete(creatureId);
    return {
      entityId,
      creatureId,
      role,
      speciesId: genome.speciesId || role,
      position,
      component,
      genome,
      energy: component.energy || 0,
      communityId: null,
      languageId: restored?.languageId || null,
      cultureId: restored?.cultureId || null,
      prestige: restored?.prestige ?? clamp(genome.display * 0.24 + genome.intelligence * 0.36 + genome.communication * 0.24, 0, 1),
      biases: restored?.biases || {
        imitation: clamp(genome.social * 0.45 + genome.memory * 0.3 + rng() * 0.18, 0, 1),
        innovation: clamp(genome.intelligence * 0.44 + genome.curiosity * 0.38 + rng() * 0.16, 0, 1),
        conformity: clamp(genome.social * 0.5 + (1 - genome.curiosity) * 0.24 + rng() * 0.15, 0, 1),
        trust: clamp(genome.social * 0.42 + genome.communication * 0.28 - genome.aggression * 0.18 + rng() * 0.18, 0, 1),
      },
      associations: new Map(restored?.associations || []),
      lexicon: new Map(restored?.lexicon || []),
      skills: new Map(restored?.skills || []),
      episodes: restored?.episodes?.slice(-36) || [],
      status: restored?.status || 'foraging',
    };
  }

  function syncCommunities() {
    const structures = (embodiedEvolution.getStructures?.() || []).filter(item => item.type === 'settlement');
    const seen = new Set();
    for (const structure of structures) {
      seen.add(structure.id);
      let community = communities.get(structure.id);
      if (!community) {
        community = restoreOrCreateCommunity(structure);
        communities.set(community.id, community);
        record('Settlement enters history', `${community.name} became a persistent community of ${community.speciesId}.`, 'settlement', community.id);
      }
      community.x = structure.x;
      community.y = structure.y;
      community.phasePopulation = Math.max(community.phasePopulation || 0, structure.population || 0);
      community.lastSeen = elapsed;
    }

    for (const community of communities.values()) community.members = [];
    for (const mind of minds.values()) {
      let best;
      let bestDistance = 180 * 180;
      for (const community of communities.values()) {
        if (community.status === 'abandoned' || community.speciesId !== mind.speciesId) continue;
        const distance = distance2(mind.position, community, world.width, world.height);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = community;
        }
      }
      mind.communityId = best?.id || null;
      mind.languageId = best?.languageId || mind.languageId;
      mind.cultureId = best?.cultureId || mind.cultureId;
      if (best) best.members.push(mind.entityId);
    }

    for (const community of communities.values()) {
      community.population = Math.max(community.members.length, Math.round(community.phasePopulation || 0));
      if (!seen.has(community.id)) community.abandonment += 0.035;
      else community.abandonment = Math.max(0, community.abandonment - 0.08);
      if (community.abandonment > 1 && community.status !== 'abandoned') {
        community.status = 'abandoned';
        community.collapsedAt = elapsed;
        record('Settlement abandoned', `${community.name} lost its sustaining population and became an archaeological site.`, 'collapse', community.id);
      } else if (community.status === 'abandoned' && seen.has(community.id) && community.population >= 3) {
        community.status = 'recovering';
        community.abandonment = 0.45;
        record('Settlement recovered', `${community.name} was resettled after abandonment.`, 'recovery', community.id);
      }
      network.mergeNode(community.id, communityNode(community));
    }
  }

  function restoreOrCreateCommunity(structure) {
    const saved = savedCommunities.get(structure.id);
    if (saved) savedCommunities.delete(structure.id);
    let language = saved?.languageId ? languages.get(saved.languageId) : null;
    let culture = saved?.cultureId ? cultures.get(saved.cultureId) : null;
    if (!language) language = createLanguage(structure.speciesId, structure.x, structure.y, null);
    if (!culture) culture = createCulture(structure.speciesId, null);
    const environment = sampleEnvironment(world, structure.x, structure.y);
    if (saved) {
      return {
        ...saved,
        x: structure.x,
        y: structure.y,
        languageId: language.id,
        cultureId: culture.id,
        technologies: new Set(saved.technologies || []),
        buildings: new Set(saved.buildings || ['shelter', 'hearth']),
        inventions: [...(saved.inventions || [])],
        history: [...(saved.history || [])],
        members: [],
        roles: { ...(saved.roles || {}) },
        environment,
      };
    }
    return {
      id: structure.id,
      name: settlementName(structure.id, language),
      speciesId: structure.speciesId,
      x: structure.x,
      y: structure.y,
      foundedAt: elapsed,
      lastSeen: elapsed,
      collapsedAt: null,
      status: 'growing',
      population: Math.max(1, structure.population || 1),
      phasePopulation: structure.population || 0,
      members: [],
      languageId: language.id,
      cultureId: culture.id,
      polityId: null,
      leaderId: null,
      roles: {},
      technologies: new Set(),
      inventions: [],
      buildings: new Set(['shelter', 'hearth']),
      food: clamp(environment.plantAccess * 0.55 + environment.waterAccess * 0.2, 0.12, 0.8),
      storedFood: 0,
      materials: environment.materials,
      water: environment.waterAccess,
      disease: 0.04,
      stress: 0.12,
      stability: 0.48,
      knowledge: 0.08,
      trade: 0,
      conflict: 0,
      carryingCapacity: Math.max(3, structure.population || 3),
      surplus: 0,
      environmentalImpact: 0,
      climateImpact: 0,
      abandonment: 0,
      history: [],
      environment,
      languageComplexity: language.complexity,
      culturalDivergence: 0,
    };
  }

  function cognitionCycle(dt) {
    const list = [...minds.values()];
    for (const mind of list) {
      const concept = experience(mind);
      const old = mind.associations.get(concept) || 0;
      mind.associations.set(concept, clamp(old + dt * (0.025 + mind.genome.memory * 0.045), 0, 1));
      mind.episodes.push({ concept, at: elapsed, strength: mind.associations.get(concept) });
      if (mind.episodes.length > 36) mind.episodes.splice(0, mind.episodes.length - 36);
      learnSkill(mind, concept, dt);

      const language = languages.get(mind.languageId);
      if (!mind.lexicon.has(concept)) {
        const communal = language?.lexicon?.[concept];
        if (communal && rng() < mind.biases.conformity * 0.7 + 0.15) mind.lexicon.set(concept, communal);
        else if (mind.biases.innovation > 0.55 && rng() < 0.045) mind.lexicon.set(concept, generateWord(rng, concept));
      }

      const teacher = learningPartner(mind, list);
      if (teacher && rng() < mind.biases.imitation * teacher.prestige * dt * 0.35) {
        const word = teacher.lexicon.get(concept);
        if (word) mind.lexicon.set(concept, mutateWord(word, rng, mind.biases.innovation * 0.08));
        const skill = strongestSkill(teacher);
        if (skill) mind.skills.set(skill[0], clamp((mind.skills.get(skill[0]) || 0) + skill[1] * 0.04, 0, 1));
      }
    }
  }

  function experience(mind) {
    const env = sampleEnvironment(world, mind.position.x, mind.position.y);
    if (mind.energy < 0.45) return 'food';
    if (env.waterAccess < 0.16) return 'water';
    if (nearbyRole(mind, ['predator', 'apex'], 115)) return 'danger';
    if (mind.role !== 'agent' && nearbyRole(mind, ['agent'], 145)) return 'animal';
    if (mind.communityId && rng() < 0.28) return rng() < 0.5 ? 'home' : 'kin';
    return weightedChoice([
      ['weather', 0.1 + env.climateStress * 0.35],
      ['plant', 0.1 + env.plantAccess * 0.3],
      ['stone', 0.08 + env.materials * 0.2],
      ['wood', 0.08 + env.plantAccess * 0.18],
      ['path', mind.communityId ? 0.18 : 0.04],
      ['trade', mind.communityId ? 0.12 : 0.01],
      ['future', mind.genome.intelligence * 0.08],
      ['past', mind.genome.memory * 0.08],
    ], rng);
  }

  function nearbyRole(mind, roles, radius) {
    for (const other of minds.values()) {
      if (other.entityId === mind.entityId || !roles.includes(other.role)) continue;
      if (distance2(mind.position, other.position, world.width, world.height) < radius * radius) return true;
    }
    return false;
  }

  function learningPartner(mind, list) {
    let best;
    let score = -Infinity;
    for (const other of list) {
      if (other.entityId === mind.entityId || other.speciesId !== mind.speciesId) continue;
      const distance = distance2(mind.position, other.position, world.width, world.height);
      if (distance > 95 * 95) continue;
      const sameCommunity = other.communityId && other.communityId === mind.communityId ? 0.3 : 0;
      const next = other.prestige * 0.42 + other.genome.communication * 0.3 + sameCommunity - Math.sqrt(distance) / 400 + rng() * 0.08;
      if (next > score) { score = next; best = other; }
    }
    return best;
  }

  function learnSkill(mind, concept, dt) {
    const map = {
      food: 'gathering', plant: 'gathering', stone: 'crafting', wood: 'construction', path: 'navigation',
      trade: 'exchange', danger: 'defense', animal: 'hunting', fire: 'firecraft', water: 'watercraft',
      future: 'planning', past: 'teaching',
    };
    const skill = map[concept];
    if (!skill) return;
    mind.skills.set(skill, clamp((mind.skills.get(skill) || 0) + dt * (0.008 + mind.genome.dexterity * 0.012 + mind.genome.intelligence * 0.008), 0, 1));
  }

  function communityCycle(dt) {
    for (const community of communities.values()) {
      if (community.status === 'abandoned') continue;
      community.environment = sampleEnvironment(world, community.x, community.y);
      const members = community.members.map(id => minds.get(id)).filter(Boolean);
      const traits = meanTraits(members);
      aggregateKnowledge(community, members, traits, dt);
      evolveLanguage(community, members, traits, dt);
      evolveCulture(community, traits, dt);
      economy(community, dt);
      invent(community, members, traits, dt);
      assignRoles(community);
      chooseLeader(community, members);
      updateStatus(community, dt);
      network.mergeNode(community.id, communityNode(community));
    }
  }

  function aggregateKnowledge(community, members, traits, dt) {
    const teaching = mean(members.map(m => m.skills.get('teaching') || 0));
    const writing = community.technologies.has('writing') ? 0.35 : 0;
    const loss = members.length ? 0.0015 : 0.018;
    community.knowledge = clamp(community.knowledge + dt * (traits.memory * traits.intelligence * traits.communication * 0.012 + teaching * 0.009 + writing * 0.012 - loss), 0, 2.5);
  }

  function evolveLanguage(community, members, traits, dt) {
    let language = languages.get(community.languageId);
    if (!language) {
      language = createLanguage(community.speciesId, community.x, community.y, null);
      community.languageId = language.id;
    }
    const variants = new Map();
    for (const mind of members) {
      for (const [concept, word] of mind.lexicon) {
        if (!variants.has(concept)) variants.set(concept, new Map());
        const words = variants.get(concept);
        words.set(word, (words.get(word) || 0) + 1);
      }
    }
    for (const concept of CONCEPTS) {
      const words = variants.get(concept);
      if (words?.size) language.lexicon[concept] = [...words.entries()].sort((a, b) => b[1] - a[1])[0][0];
      else if (!language.lexicon[concept] && rng() < traits.innovation * 0.04) language.lexicon[concept] = generateWord(rng, concept);
    }
    const known = Object.keys(language.lexicon).length / CONCEPTS.length;
    const contact = routeContact(community.id);
    const isolation = clamp(1 - contact, 0, 1);
    language.complexity = clamp(language.complexity + dt * (traits.communication * traits.memory * known * 0.012 + community.population * 0.0003 - isolation * 0.001), 0.04, 1.5);
    language.grammar.marking = clamp(language.grammar.marking + dt * traits.communication * known * 0.003, 0, 1);
    language.grammar.recursion = clamp(language.grammar.recursion + dt * community.knowledge * traits.intelligence * 0.0016, 0, 1);
    language.drift += dt * isolation * (0.004 + traits.innovation * 0.004);
    language.speakers = community.population;
    language.x = community.x;
    language.y = community.y;
    community.languageComplexity = language.complexity;

    if (language.drift > 1 && community.population >= 3 && isolation > 0.45) {
      const child = createLanguage(community.speciesId, community.x, community.y, language.id);
      community.languageId = child.id;
      language.drift *= 0.25;
      record('Language branches', `${community.name} developed ${child.name}, a daughter language of ${language.name}.`, 'language', community.id);
    }
    const current = languages.get(community.languageId);
    for (const mind of members) {
      mind.languageId = current.id;
      for (const [concept, word] of Object.entries(current.lexicon)) {
        if (rng() < mind.biases.conformity * 0.18 + mind.genome.communication * 0.08) mind.lexicon.set(concept, word);
      }
    }
  }

  function createLanguage(speciesId, x, y, parentId) {
    const parent = parentId ? languages.get(parentId) : null;
    const id = `lang-${nextLanguage++}`;
    const familyId = parent?.familyId || `family-${id}`;
    const language = {
      id,
      name: languageName(id, speciesId),
      familyId,
      parentId: parentId || null,
      speciesId,
      foundedAt: elapsed,
      extinctAt: null,
      speakers: 0,
      x,
      y,
      complexity: parent ? parent.complexity * 0.84 : 0.08,
      drift: 0,
      lexicon: parent ? mutateLexicon(parent.lexicon, rng, 0.12) : initialLexicon(rng),
      grammar: parent ? { ...parent.grammar } : { order: rng() < 0.5 ? 'SOV' : 'SVO', marking: 0.05, recursion: 0 },
    };
    languages.set(id, language);
    if (!languageFamilies.has(familyId)) languageFamilies.set(familyId, { id: familyId, rootLanguageId: id, languages: [] });
    languageFamilies.get(familyId).languages.push(id);
    return language;
  }

  function evolveCulture(community, traits, dt) {
    let culture = cultures.get(community.cultureId);
    if (!culture) {
      culture = createCulture(community.speciesId, null);
      community.cultureId = culture.id;
    }
    const scarcity = clamp(1 - community.food, 0, 1);
    culture.norms.cooperation = clamp(culture.norms.cooperation + dt * (traits.social * traits.trust - traits.aggression * scarcity * 0.45) * 0.008, 0, 1);
    culture.norms.sharing = clamp(culture.norms.sharing + dt * (traits.social * scarcity * 0.5 + traits.trust * 0.2) * 0.006, 0, 1);
    culture.norms.hierarchy = clamp(culture.norms.hierarchy + dt * (traits.aggression * 0.25 + community.population / 80 - traits.trust * 0.12) * 0.004, 0, 1);
    culture.norms.exogamy = clamp(culture.norms.exogamy + dt * (community.trade * 0.2 + 0.02 - traits.conformity * 0.05) * 0.003, 0, 1);
    culture.traditionStrength = clamp(culture.traditionStrength + dt * traits.conformity * community.knowledge * 0.002, 0, 1.5);
    culture.population = community.population;
    community.culturalDivergence = clamp(community.culturalDivergence + dt * (routeContact(community.id) < 0.18 ? 0.006 : -0.002), 0, 1.5);
    if (community.culturalDivergence > 1 && community.population >= 4) {
      const child = createCulture(community.speciesId, culture.id);
      child.norms = mutateNorms(culture.norms, rng, 0.15);
      community.cultureId = child.id;
      community.culturalDivergence *= 0.25;
      record('Culture branches', `${community.name} formed the distinct ${child.name} lineage.`, 'culture', community.id);
    }
  }

  function createCulture(speciesId, parentId) {
    const parent = parentId ? cultures.get(parentId) : null;
    const id = `culture-${nextCulture++}`;
    const culture = {
      id,
      name: cultureName(id, speciesId),
      speciesId,
      parentId: parentId || null,
      foundedAt: elapsed,
      extinctAt: null,
      population: 0,
      norms: parent ? { ...parent.norms } : {
        cooperation: 0.32 + rng() * 0.32,
        sharing: 0.25 + rng() * 0.35,
        hierarchy: 0.12 + rng() * 0.38,
        exogamy: 0.18 + rng() * 0.3,
      },
      traditions: parent ? { ...parent.traditions } : {},
      traditionStrength: parent ? parent.traditionStrength * 0.7 : 0.1,
    };
    cultures.set(id, culture);
    culturalLineages.set(id, { id, parentId: parentId || null, children: [] });
    if (parentId && culturalLineages.has(parentId)) culturalLineages.get(parentId).children.push(id);
    return culture;
  }

  function economy(community, dt) {
    const env = community.environment;
    const roles = community.roles;
    const gatherers = roles.gatherer || Math.max(1, community.population * 0.32);
    const farmers = roles.farmer || 0;
    const hunters = roles.hunter || 0;
    const traders = roles.trader || 0;
    const irrigation = community.technologies.has('irrigation') ? 0.42 : 0;
    const sanitation = community.technologies.has('sanitation') ? 0.52 : 0;
    const transport = community.technologies.has('transport') ? 0.3 : 0;
    const production = env.plantAccess * gatherers * 0.008 + env.preyAccess * hunters * 0.006 +
      (community.technologies.has('agriculture') ? (env.plantAccess + env.waterAccess * 0.3 + irrigation) * farmers * 0.014 : 0) +
      transport * traders * 0.003;
    const consumption = community.population * (0.006 + community.disease * 0.0015);
    community.food = clamp(community.food + dt * (production - consumption), 0, 2.5);
    if (community.technologies.has('storage')) {
      const stored = Math.max(0, community.food - 0.72) * 0.18;
      community.food -= stored;
      community.storedFood = clamp(community.storedFood + stored - dt * 0.0018, 0, 4);
    }
    if (community.food < 0.3 && community.storedFood > 0) {
      const release = Math.min(community.storedFood, dt * 0.035);
      community.storedFood -= release;
      community.food += release;
    }
    community.materials = clamp(community.materials + dt * (env.materials * gatherers * 0.002 - community.population * 0.0005), 0, 3);
    community.surplus = clamp(community.food + community.storedFood * 0.7 - 0.62, -1, 3);
    community.trade = clamp(community.trade * 0.98 + traders / Math.max(1, community.population) * 0.08 + routeTrade(community.id) * 0.1, 0, 2);
    community.disease = clamp(community.disease + dt * (community.population / Math.max(3, community.carryingCapacity) * 0.006 + community.trade * 0.0018 - sanitation * 0.008 - env.waterAccess * 0.001), 0, 1);
    community.carryingCapacity = Math.max(3, 3 + env.plantAccess * 10 + env.waterAccess * 7 +
      (community.technologies.has('agriculture') ? 15 : 0) + (community.technologies.has('storage') ? 7 : 0) +
      (community.technologies.has('sanitation') ? 8 : 0) + (community.technologies.has('transport') ? 5 : 0));
    community.stress = clamp((1 - clamp(community.food + community.storedFood * 0.4, 0, 1)) * 0.48 + community.disease * 0.32 + community.conflict * 0.28 + Math.max(0, community.population - community.carryingCapacity) / Math.max(3, community.carryingCapacity) * 0.35, 0, 1.5);
  }

  function invent(community, members, traits, dt) {
    const context = {
      intelligence: traits.intelligence,
      dexterity: traits.dexterity,
      construction: traits.construction,
      scarcity: clamp(1 - community.food, 0, 1),
      surplus: clamp(community.surplus, 0, 1),
      population: clamp(community.population / 14, 0, 1),
      knowledge: clamp(community.knowledge / 1.3, 0, 1),
      materials: clamp(community.materials, 0, 1),
      plantAccess: community.environment.plantAccess,
      waterAccess: community.environment.waterAccess,
      disease: community.disease,
      trade: clamp(community.trade, 0, 1),
      language: clamp(community.languageComplexity, 0, 1),
      fireMastery: community.technologies.has('fire') ? clamp(community.knowledge + 0.2, 0, 1) : 0,
    };
    for (const technology of TECH) {
      if (community.technologies.has(technology.id) || !technology.req.every(id => community.technologies.has(id))) continue;
      const score = mean(technology.factors.map(factor => context[factor] || 0));
      if (score < technology.threshold) continue;
      const probability = clamp((score - technology.threshold + 0.04) * (traits.innovation + community.knowledge * 0.35 + routeKnowledge(community.id) * 0.12) * dt * 0.16, 0, 0.28);
      if (rng() > probability) continue;
      community.technologies.add(technology.id);
      const invention = { id: `invention-${nextInvention++}`, technologyId: technology.id, communityId: community.id, cultureId: community.cultureId, languageId: community.languageId, inventedAt: elapsed, pressure: score };
      inventions.set(invention.id, invention);
      community.inventions.push(invention.id);
      if (technology.id === 'storage') community.buildings.add('granary');
      if (technology.id === 'agriculture') community.buildings.add('field');
      if (technology.id === 'irrigation') community.buildings.add('canal');
      if (technology.id === 'sanitation') community.buildings.add('reservoir');
      if (technology.id === 'roads') community.buildings.add('road');
      if (technology.id === 'writing') community.buildings.add('archive');
      record('Technology emerges', `${community.name} developed ${technology.id} from need, materials, skill, and accumulated knowledge.`, 'technology', community.id);
      break;
    }
  }

  function assignRoles(community) {
    const p = community.population;
    const roles = {
      gatherer: Math.max(1, Math.round(p * (0.28 + clamp(1 - community.food, 0, 1) * 0.16))),
      hunter: Math.round(p * community.environment.preyAccess * 0.12),
      builder: Math.round(p * (community.technologies.has('storage') ? 0.09 : 0.04)),
      teacher: Math.round(p * community.languageComplexity * 0.07),
      healer: Math.round(p * (community.disease * 0.08 + (community.technologies.has('sanitation') ? 0.04 : 0))),
      farmer: community.technologies.has('agriculture') ? Math.max(1, Math.round(p * 0.22)) : 0,
      crafter: community.technologies.has('crafting') ? Math.max(1, Math.round(p * 0.11)) : 0,
      trader: community.trade > 0.15 ? Math.max(1, Math.round(p * 0.07)) : 0,
      recorder: community.technologies.has('writing') ? Math.max(1, Math.round(p * 0.035)) : 0,
    };
    const total = Object.values(roles).reduce((sum, value) => sum + value, 0);
    if (total > p * 1.15) {
      const scale = p * 1.15 / total;
      for (const key of Object.keys(roles)) roles[key] = Math.round(roles[key] * scale);
    }
    community.roles = roles;
  }

  function chooseLeader(community, members) {
    const culture = cultures.get(community.cultureId);
    if (!culture || culture.norms.hierarchy < 0.35 || !members.length) { community.leaderId = null; return; }
    const leader = [...members].sort((a, b) => leadershipScore(b, culture) - leadershipScore(a, culture))[0];
    if (leader && leader.creatureId !== community.leaderId) {
      community.leaderId = leader.creatureId;
      if (rng() < 0.18) record('Leadership changes', `${leader.creatureId} became a recognized leader in ${community.name}.`, 'leadership', community.id);
    }
  }

  function updateStatus(community, dt) {
    const cooperation = cultures.get(community.cultureId)?.norms.cooperation || 0;
    community.stability = clamp(0.42 + community.food * 0.22 + community.storedFood * 0.08 + community.knowledge * 0.1 + cooperation * 0.18 - community.stress * 0.38, 0, 1);
    if (community.stress > 1.02 && community.stability < 0.22) community.abandonment += dt * 0.045;
    else community.abandonment = Math.max(0, community.abandonment - dt * 0.018);
    if (community.abandonment > 1 && community.status !== 'abandoned') {
      community.status = 'abandoned';
      community.collapsedAt = elapsed;
      record('Civilization collapse', `${community.name} collapsed after interacting shortages, disease, conflict, and population pressure.`, 'collapse', community.id);
    } else if (community.status !== 'abandoned') {
      community.status = community.stability > 0.72 ? 'flourishing' : community.stability > 0.4 ? 'stable' : 'stressed';
    }
  }

  function networkCycle(dt) {
    rebuildRoutes();
    updateRelations(dt);
    updatePolities();
    spreadKnowledge(dt);
    migrate(dt);
  }

  function rebuildRoutes() {
    const active = [...communities.values()].filter(c => c.status !== 'abandoned');
    const activeIds = new Set(active.map(c => c.id));
    for (const id of network.nodes()) if (!activeIds.has(id)) network.dropNode(id);
    for (const community of active) network.mergeNode(community.id, communityNode(community));

    const validEdges = new Set();
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i];
        const b = active[j];
        const distance = Math.sqrt(distance2(a, b, world.width, world.height));
        const range = (mobile ? 260 : 390) * ((a.technologies.has('roads') || b.technologies.has('roads')) ? 1.45 : 1) * ((a.technologies.has('transport') || b.technologies.has('transport')) ? 1.35 : 1);
        if (distance > range) continue;
        const edge = edgeId(a.id, b.id);
        validEdges.add(edge);
        let route = routes.get(edge);
        if (!route) {
          route = { id: `route-${edge}`, edgeId: edge, from: a.id, to: b.id, kind: 'contact', trust: 0.28, hostility: 0.08, flow: 0, migration: 0, knowledge: 0, createdAt: elapsed, lastEventAt: -Infinity };
          routes.set(edge, route);
        }
        network.mergeEdge(a.id, b.id, routeAttributes(route));
      }
    }
    for (const edge of routes.keys()) if (!validEdges.has(edge)) routes.delete(edge);
  }

  function updateRelations(dt) {
    for (const route of routes.values()) {
      const a = communities.get(route.from);
      const b = communities.get(route.to);
      if (!a || !b) continue;
      const languageSimilarity = lexicalSimilarity(languages.get(a.languageId), languages.get(b.languageId));
      const cultureSimilarity = normSimilarity(cultures.get(a.cultureId), cultures.get(b.cultureId));
      const complement = resourceComplementarity(a, b);
      const scarcity = (clamp(1 - a.food, 0, 1) + clamp(1 - b.food, 0, 1)) * 0.5;
      const territoriality = ((cultures.get(a.cultureId)?.norms.hierarchy || 0) + (cultures.get(b.cultureId)?.norms.hierarchy || 0)) * 0.25;
      const tradePotential = complement * (0.35 + languageSimilarity * 0.25 + route.trust * 0.35);
      route.flow = clamp(route.flow + dt * (tradePotential * 0.015 - route.hostility * 0.01), 0, 1.5);
      route.trust = clamp(route.trust + dt * (route.flow * 0.009 + cultureSimilarity * 0.003 - route.hostility * 0.012), 0, 1);
      route.hostility = clamp(route.hostility + dt * (scarcity * territoriality * 0.008 - route.flow * 0.006 - route.trust * 0.002), 0, 1);
      route.knowledge = clamp(route.knowledge + dt * route.flow * languageSimilarity * 0.012, 0, 1);
      route.migration = clamp((a.stress + b.stress) * 0.2 + route.flow * 0.1, 0, 1);
      route.kind = route.hostility > 0.64 && route.trust < 0.24 ? 'conflict' : route.trust > 0.68 && route.flow > 0.32 ? 'alliance' : route.flow > 0.12 ? 'trade' : 'contact';
      a.trade = clamp(a.trade + route.flow * 0.015, 0, 2);
      b.trade = clamp(b.trade + route.flow * 0.015, 0, 2);
      a.conflict = clamp(a.conflict * 0.92 + (route.kind === 'conflict' ? route.hostility * 0.12 : 0), 0, 1);
      b.conflict = clamp(b.conflict * 0.92 + (route.kind === 'conflict' ? route.hostility * 0.12 : 0), 0, 1);
      if (route.kind === 'conflict' && elapsed - route.lastEventAt > 18 && rng() < 0.16) resolveConflict(route, a, b);
      else if (route.kind === 'alliance' && elapsed - route.lastEventAt > 24 && rng() < 0.12) {
        route.lastEventAt = elapsed;
        record('Alliance formed', `${a.name} and ${b.name} formalized an alliance through repeated exchange and trust.`, 'diplomacy', a.id);
      }
      network.mergeEdge(a.id, b.id, routeAttributes(route));
    }
  }

  function resolveConflict(route, a, b) {
    route.lastEventAt = elapsed;
    const strengthA = a.population * (0.4 + a.knowledge * 0.2 + (a.technologies.has('metallurgy') ? 0.35 : 0) + a.stability * 0.2);
    const strengthB = b.population * (0.4 + b.knowledge * 0.2 + (b.technologies.has('metallurgy') ? 0.35 : 0) + b.stability * 0.2);
    const winner = rng() < strengthA / Math.max(0.001, strengthA + strengthB) ? a : b;
    const loser = winner === a ? b : a;
    const loss = clamp(0.08 + route.hostility * 0.14 + rng() * 0.08, 0, 0.32);
    loser.food = Math.max(0, loser.food - loss);
    loser.storedFood = Math.max(0, loser.storedFood - loss * 0.7);
    loser.stress = clamp(loser.stress + loss * 0.9, 0, 1.5);
    winner.materials = clamp(winner.materials + loss * 0.4, 0, 3);
    route.hostility *= 0.76;
    route.trust *= 0.72;
    record('Raid and conflict', `${winner.name} prevailed in a conflict with ${loser.name}; resources and migration pressures shifted.`, 'conflict', winner.id);
  }

  function updatePolities() {
    const adjacency = new Map([...communities.keys()].map(id => [id, new Set()]));
    for (const route of routes.values()) {
      if (route.kind !== 'alliance' || route.trust < 0.67) continue;
      adjacency.get(route.from)?.add(route.to);
      adjacency.get(route.to)?.add(route.from);
    }
    const visited = new Set();
    const activePolityIds = new Set();
    for (const community of communities.values()) {
      if (visited.has(community.id) || community.status === 'abandoned') continue;
      const group = [];
      const queue = [community.id];
      while (queue.length) {
        const id = queue.shift();
        if (visited.has(id)) continue;
        visited.add(id);
        group.push(id);
        for (const neighbor of adjacency.get(id) || []) queue.push(neighbor);
      }
      if (group.length < 2) { community.polityId = null; continue; }
      const existing = mostCommon(group.map(id => communities.get(id)?.polityId).filter(Boolean));
      const id = existing || `polity-${nextPolity++}`;
      const polity = polities.get(id) || { id, name: polityName(id, community), foundedAt: elapsed, dissolvedAt: null, members: [], population: 0, stability: 0 };
      polity.members = group;
      polity.population = group.reduce((sum, memberId) => sum + (communities.get(memberId)?.population || 0), 0);
      polity.stability = mean(group.map(memberId => communities.get(memberId)?.stability || 0));
      polity.dissolvedAt = null;
      polities.set(id, polity);
      activePolityIds.add(id);
      for (const memberId of group) communities.get(memberId).polityId = id;
      if (!existing) record('Federation emerges', `${polity.name} formed from ${group.length} allied settlements.`, 'federation', group[0]);
    }
    for (const polity of polities.values()) {
      if (!activePolityIds.has(polity.id) && polity.dissolvedAt == null) {
        polity.dissolvedAt = elapsed;
        record('Federation dissolves', `${polity.name} dissolved as its alliance network fragmented.`, 'collapse', polity.members[0]);
      }
    }
  }

  function spreadKnowledge(dt) {
    for (const route of routes.values()) {
      if (route.flow <= 0.08) continue;
      const a = communities.get(route.from);
      const b = communities.get(route.to);
      if (!a || !b) continue;
      const transfer = route.flow * route.trust * dt * 0.006;
      const targetKnowledge = (a.knowledge + b.knowledge) * 0.5;
      a.knowledge += (targetKnowledge - a.knowledge) * transfer;
      b.knowledge += (targetKnowledge - b.knowledge) * transfer;
      blendLanguages(languages.get(a.languageId), languages.get(b.languageId), transfer * 0.7, rng);
      if (rng() < transfer * 0.2) {
        const source = rng() < 0.5 ? a : b;
        const target = source === a ? b : a;
        const technology = [...source.technologies].find(id => !target.technologies.has(id) && techPrerequisitesMet(id, target));
        if (technology) {
          target.technologies.add(technology);
          record('Technology diffuses', `${technology} spread from ${source.name} to ${target.name} through exchange.`, 'technology', target.id);
        }
      }
    }
  }

  function migrate(dt) {
    for (const route of routes.values()) {
      if (route.migration < 0.22 || route.kind === 'conflict') continue;
      const a = communities.get(route.from);
      const b = communities.get(route.to);
      if (!a || !b) continue;
      const source = a.stress > b.stress ? a : b;
      const target = source === a ? b : a;
      const pressure = clamp(source.stress - target.stress + route.trust * 0.2, 0, 1);
      if (pressure < 0.18 || rng() > pressure * dt * 0.02) continue;
      const amount = Math.max(1, Math.floor(source.population * clamp(pressure * 0.08, 0.01, 0.16)));
      source.phasePopulation = Math.max(1, source.phasePopulation - amount);
      target.phasePopulation += amount;
      migrations.push({ from: source.id, to: target.id, amount, at: elapsed, languageId: source.languageId, cultureId: source.cultureId });
      if (migrations.length > 180) migrations.splice(0, migrations.length - 180);
      record('Migration', `${amount} inhabitants moved from ${source.name} to ${target.name}, carrying language and traditions.`, 'migration', target.id);
    }
  }

  function environmentCycle(dt) {
    let totalImpact = 0;
    for (const community of communities.values()) {
      if (community.status === 'abandoned') continue;
      const techIntensity = community.technologies.size / TECH.length;
      const populationIntensity = clamp(community.population / 30, 0, 2);
      community.environmentalImpact = clamp(community.environmentalImpact + dt * (techIntensity * populationIntensity * 0.004 - community.stability * 0.0015), 0, 1.5);
      community.climateImpact = community.environmentalImpact * community.population * (community.technologies.has('metallurgy') ? 0.00018 : 0.00004);
      totalImpact += community.climateImpact;
      supportPopulation(community, dt);
      cultivate(community, dt);
      degrade(community, dt);
    }
    world.globals.civilizationPressure = clamp([...communities.values()].reduce((sum, c) => sum + c.environmentalImpact, 0), 0, 25);
    world.globals.anthropogenicImpact = clamp(totalImpact, 0, 1);
  }

  function supportPopulation(community, dt) {
    const foodSupport = community.technologies.has('storage') ? community.storedFood * 0.002 : 0;
    const sanitation = community.technologies.has('sanitation') ? 0.003 : 0;
    for (const role of ROLES) {
      for (const [entityId, component] of world.ecs.components[role].entries()) {
        const position = world.ecs.components.position.get(entityId);
        if (!position || distance2(position, community, world.width, world.height) > 150 * 150) continue;
        if (component.embodiment?.speciesId === community.speciesId) {
          component.energy = Math.min(role === 'agent' ? 2 : role === 'predator' ? 3.5 : 5, (component.energy || 0) + dt * (foodSupport + sanitation));
        } else if (community.environmentalImpact > 0.65) {
          component.energy = Math.max(0, (component.energy || 0) - dt * community.environmentalImpact * 0.0015);
        }
      }
    }
  }

  function cultivate(community, dt) {
    if (!community.technologies.has('agriculture') || !world.makeResourceAt) return;
    const opportunity = community.food < 0.85 || community.population > community.carryingCapacity * 0.75;
    if (!opportunity || rng() > dt * (0.008 + community.knowledge * 0.005)) return;
    const angle = rng() * Math.PI * 2;
    const distance = 12 + rng() * 48;
    world.makeResourceAt(wrap(community.x + Math.cos(angle) * distance, world.width), clamp(community.y + Math.sin(angle) * distance, 0, world.height));
  }

  function degrade(community, dt) {
    if (community.environmentalImpact < 0.48) return;
    const radius = 110 + community.population * 2;
    let affected = 0;
    for (const [entityId, resource] of world.ecs.components.resource.entries()) {
      if (affected >= (mobile ? 2 : 5)) break;
      const position = world.ecs.components.position.get(entityId);
      if (!position || distance2(position, community, world.width, world.height) > radius * radius) continue;
      resource.amount = Math.max(0.08, resource.amount - dt * community.environmentalImpact * 0.008);
      affected++;
    }
  }

  function routeContact(communityId) {
    const related = [...routes.values()].filter(route => route.from === communityId || route.to === communityId);
    return clamp(mean(related.map(route => route.flow * 0.45 + route.trust * 0.35 + route.migration * 0.2)), 0, 1);
  }
  function routeTrade(communityId) {
    return mean([...routes.values()].filter(route => route.from === communityId || route.to === communityId).map(route => route.flow));
  }
  function routeKnowledge(communityId) {
    return mean([...routes.values()].filter(route => route.from === communityId || route.to === communityId).map(route => route.knowledge));
  }

  function render(frame = {}) {
    visuals?.render(frame);
    const timestamp = frame.timestamp ?? performance.now();
    if (timestamp - ui.lastUpdate > 700) {
      ui.lastUpdate = timestamp;
      updateHistoryUI(ui, getState(), events, communities, languages, polities);
    }
  }

  function getState() {
    const active = [...communities.values()].filter(c => c.status !== 'abandoned');
    return {
      elapsed,
      communities: active.length,
      archaeologicalSites: communities.size - active.length,
      languages: [...languages.values()].filter(language => language.extinctAt == null).length,
      languageFamilies: languageFamilies.size,
      cultures: cultures.size,
      polities: [...polities.values()].filter(polity => polity.dissolvedAt == null).length,
      routes: routes.size,
      technologies: inventions.size,
      migrations: migrations.length,
      population: active.reduce((sum, community) => sum + community.population, 0),
      historyEvents: events.length,
      graphology: graphologyLoaded,
    };
  }

  function save() {
    return {
      version: 2,
      elapsed,
      counters: { nextLanguage, nextCulture, nextPolity, nextEvent, nextInvention },
      communities: [...communities.values()].map(serializeCommunity),
      languages: [...languages.values()],
      cultures: [...cultures.values()],
      polities: [...polities.values()],
      routes: [...routes.values()],
      inventions: [...inventions.values()],
      events: events.slice(-350),
      migrations: migrations.slice(-180),
      languageFamilies: [...languageFamilies.values()],
      culturalLineages: [...culturalLineages.values()],
      minds: [...minds.values()].slice(0, mobile ? 90 : 220).map(serializeMind),
    };
  }

  function load(state) {
    if (!state) return;
    elapsed = Math.max(0, state.elapsed || 0);
    nextLanguage = Math.max(1, state.counters?.nextLanguage || 1);
    nextCulture = Math.max(1, state.counters?.nextCulture || 1);
    nextPolity = Math.max(1, state.counters?.nextPolity || 1);
    nextEvent = Math.max(1, state.counters?.nextEvent || 1);
    nextInvention = Math.max(1, state.counters?.nextInvention || 1);
    for (const item of state.languages || []) languages.set(item.id, { ...item, lexicon: { ...(item.lexicon || {}) }, grammar: { ...(item.grammar || {}) } });
    for (const item of state.cultures || []) cultures.set(item.id, { ...item, norms: { ...(item.norms || {}) }, traditions: { ...(item.traditions || {}) } });
    for (const item of state.polities || []) polities.set(item.id, { ...item, members: [...(item.members || [])] });
    for (const item of state.routes || []) routes.set(item.edgeId || edgeId(item.from, item.to), { ...item });
    for (const item of state.inventions || []) inventions.set(item.id, { ...item });
    for (const item of state.events || []) events.push(item);
    for (const item of state.migrations || []) migrations.push(item);
    for (const item of state.languageFamilies || []) languageFamilies.set(item.id, { ...item, languages: [...(item.languages || [])] });
    for (const item of state.culturalLineages || []) culturalLineages.set(item.id, { ...item, children: [...(item.children || [])] });
    for (const item of state.communities || []) savedCommunities.set(item.id, item);
    for (const item of state.minds || []) savedMinds.set(item.creatureId, item);
  }

  function destroy() {
    destroyed = true;
    visuals?.destroy?.();
    ui.destroy();
    network?.clear?.();
    communities.clear();
    languages.clear();
    cultures.clear();
    polities.clear();
    minds.clear();
    routes.clear();
  }

  function record(title, description, type, communityId) {
    const event = { id: `history-${nextEvent++}`, title, description, type, communityId: communityId || null, at: elapsed, tick: world.tick, date: new Date().toISOString() };
    events.unshift(event);
    if (events.length > 500) events.length = 500;
    const community = communityId ? communities.get(communityId) : null;
    if (community) {
      community.history.unshift(event.id);
      if (community.history.length > 80) community.history.length = 80;
    }
    window.dispatchEvent(new CustomEvent('civilization-history', { detail: event }));
  }

  const api = {
    id: 'civilization.emergent-graphology',
    name: 'Emergent Language, Culture, and Planetary Civilizations',
    version: '1.1.0',
    execution: 'browser-graphology-three',
    source: 'Graphology 0.26.0 plus deterministic cognitive, linguistic, technological, and historical simulation',
    license: 'MIT / project license',
    provides: ['civilization.emergent', 'culture.lineages', 'language.evolution', 'history.observatory', 'networks.graphology'],
    requires: ['evolution.embodied', 'evolution.lineages', 'exploration.ground-level'],
    after: ['evolution.embodied-yuka'],
    initialize,
    step,
    render,
    save,
    load,
    getState,
    getCommunities: () => [...communities.values()].map(serializeCommunity),
    getRoutes: () => [...routes.values()].map(route => ({ ...route })),
    getLanguages: () => [...languages.values()].map(language => ({ ...language, lexicon: { ...language.lexicon }, grammar: { ...language.grammar } })),
    getCultures: () => [...cultures.values()].map(culture => ({ ...culture, norms: { ...culture.norms }, traditions: { ...culture.traditions } })),
    getHistory: () => events.slice(),
    destroy,
  };
  return api;
}

async function loadGraphology() {
  for (const source of GRAPH_SOURCES) {
    try {
      const module = await import(/* @vite-ignore */ source);
      const candidate = module.default?.default || module.default || module.Graph || module.UndirectedGraph;
      if (typeof candidate === 'function') return candidate;
    } catch (error) {
      console.warn(`Graphology source unavailable: ${source}`, error);
    }
  }
  return null;
}

function createNetwork(GraphCtor) {
  const graph = GraphCtor ? new GraphCtor({ type: 'undirected', multi: false, allowSelfLoops: false }) : new FallbackGraph();
  return {
    graph,
    mergeNode(id, attributes) {
      if (!graph.hasNode(id)) graph.addNode(id, attributes);
      else for (const [key, value] of Object.entries(attributes)) graph.setNodeAttribute(id, key, value);
    },
    mergeEdge(source, target, attributes) {
      if (!graph.hasNode(source) || !graph.hasNode(target)) return;
      const existing = graph.edge(source, target);
      if (existing) for (const [key, value] of Object.entries(attributes)) graph.setEdgeAttribute(existing, key, value);
      else graph.addEdge(source, target, attributes);
    },
    dropNode(id) { if (graph.hasNode(id)) graph.dropNode(id); },
    nodes() { return graph.nodes(); },
    clear() { graph.clear(); },
  };
}

class FallbackGraph {
  constructor() { this.nodeMap = new Map(); this.edgeMap = new Map(); }
  hasNode(id) { return this.nodeMap.has(id); }
  addNode(id, attrs = {}) { this.nodeMap.set(id, { ...attrs }); }
  setNodeAttribute(id, key, value) { this.nodeMap.get(id)[key] = value; }
  nodes() { return [...this.nodeMap.keys()]; }
  dropNode(id) { this.nodeMap.delete(id); for (const [key, edge] of this.edgeMap) if (edge.source === id || edge.target === id) this.edgeMap.delete(key); }
  edge(a, b) { const id = edgeId(a, b); return this.edgeMap.has(id) ? id : null; }
  addEdge(a, b, attrs = {}) { const id = edgeId(a, b); this.edgeMap.set(id, { source: a, target: b, attrs: { ...attrs } }); return id; }
  setEdgeAttribute(id, key, value) { const edge = this.edgeMap.get(id); if (edge) edge.attrs[key] = value; }
  clear() { this.nodeMap.clear(); this.edgeMap.clear(); }
}

function createHistoryUI(mobile) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'HISTORY';
  button.setAttribute('aria-expanded', 'false');
  button.style.cssText = 'position:fixed;left:max(12px,env(safe-area-inset-left));bottom:max(12px,env(safe-area-inset-bottom));z-index:26;padding:9px 12px;border:1px solid rgba(155,232,211,.36);border-radius:999px;background:rgba(3,12,15,.78);color:#caffef;font:700 11px/1 ui-monospace,monospace;letter-spacing:.12em;backdrop-filter:blur(9px)';
  const panel = document.createElement('aside');
  panel.hidden = true;
  panel.style.cssText = `position:fixed;left:max(12px,env(safe-area-inset-left));bottom:56px;z-index:25;width:min(${mobile ? 'calc(100vw - 24px)' : '410px'},calc(100vw - 24px));max-height:min(68vh,680px);overflow:auto;padding:14px;border:1px solid rgba(155,232,211,.24);border-radius:15px;background:rgba(2,9,12,.91);color:#dcfff3;box-shadow:0 16px 54px rgba(0,0,0,.36);backdrop-filter:blur(14px);font:12px/1.45 system-ui,sans-serif`;
  panel.innerHTML = '<header style="display:flex;justify-content:space-between;gap:12px;align-items:start;margin-bottom:10px"><div><strong style="display:block;font:800 13px/1.1 ui-monospace,monospace;letter-spacing:.08em;color:#93ebce">PLANETARY HISTORY</strong><span data-summary style="color:rgba(220,255,243,.66)"></span></div><button type="button" data-close style="border:0;background:transparent;color:#dffff3;font-size:18px">×</button></header><section data-stats style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:10px"></section><strong style="color:#9be8d3">Recent history</strong><div data-events></div><strong style="display:block;margin-top:12px;color:#9be8d3">Living languages & polities</strong><div data-lineages></div>';
  document.body.append(button, panel);
  const toggle = value => { const open = value ?? panel.hidden; panel.hidden = !open; button.setAttribute('aria-expanded', String(open)); };
  button.addEventListener('click', () => toggle());
  panel.querySelector('[data-close]').addEventListener('click', () => toggle(false));
  return { button, panel, summary: panel.querySelector('[data-summary]'), stats: panel.querySelector('[data-stats]'), events: panel.querySelector('[data-events]'), lineages: panel.querySelector('[data-lineages]'), lastUpdate: -Infinity, destroy() { button.remove(); panel.remove(); } };
}

function updateHistoryUI(ui, state, events, communities, languages, polities) {
  ui.button.hidden = state.communities === 0 && state.historyEvents === 0;
  ui.summary.textContent = `${state.population} inhabitants across ${state.communities} communities`;
  const stats = [['Languages', state.languages], ['Polities', state.polities], ['Inventions', state.technologies], ['Routes', state.routes], ['Migrations', state.migrations], ['Ruins', state.archaeologicalSites]];
  ui.stats.replaceChildren(...stats.map(([label, value]) => {
    const element = document.createElement('div');
    element.style.cssText = 'padding:7px;border-radius:9px;background:rgba(151,232,209,.07);text-align:center';
    const strong = document.createElement('strong'); strong.textContent = value; strong.style.cssText = 'display:block;color:#f0fff9';
    const small = document.createElement('small'); small.textContent = label; small.style.cssText = 'color:rgba(220,255,243,.58)';
    element.append(strong, small); return element;
  }));
  ui.events.replaceChildren(...events.slice(0, 12).map(event => {
    const article = document.createElement('article'); article.style.cssText = 'padding:8px 0;border-bottom:1px solid rgba(155,232,211,.1)';
    const title = document.createElement('strong'); title.textContent = event.title; title.style.cssText = 'display:block;color:#effff9';
    const description = document.createElement('span'); description.textContent = event.description; description.style.cssText = 'color:rgba(220,255,243,.68)';
    article.append(title, description); return article;
  }));
  const rows = [
    ...[...languages.values()].filter(language => language.extinctAt == null).slice(0, 5).map(language => `${language.name} · ${language.speakers} speakers · ${Math.round(language.complexity * 100)} complexity`),
    ...[...polities.values()].filter(polity => polity.dissolvedAt == null).slice(0, 4).map(polity => `${polity.name} · ${polity.members.length} settlements · ${polity.population} population`),
    ...[...communities.values()].filter(community => community.status !== 'abandoned').slice(0, 5).map(community => `${community.name} · ${community.status} · ${community.technologies.size} technologies`),
  ];
  ui.lineages.replaceChildren(...rows.map(text => { const row = document.createElement('div'); row.textContent = text; row.style.cssText = 'padding:5px 0;color:rgba(220,255,243,.7);border-bottom:1px solid rgba(155,232,211,.07)'; return row; }));
}

function sampleEnvironment(world, x, y) {
  const base = samplePlanet(x, y, world.width, world.height);
  const hydro = sampleHydrology(x, y, world.width, world.height);
  return {
    temperature: base.temperature,
    rainfall: base.rainfall,
    elevation: base.elevation,
    land: base.land,
    waterAccess: clamp(hydro.river * 0.55 + hydro.lake * 0.7 + hydro.delta * 0.48 + base.rainfall * 0.2, 0, 1),
    plantAccess: clamp(base.rainfall * 0.54 + base.temperature * 0.18 + hydro.river * 0.22 - (base.biome === 'desert' ? 0.3 : 0), 0, 1),
    preyAccess: clamp(0.35 + base.rainfall * 0.25 + base.temperature * 0.12, 0, 1),
    materials: clamp(base.elevation * 0.42 + hydro.erosion * 0.32 + (base.biome === 'mountain' ? 0.32 : 0.08), 0, 1),
    climateStress: clamp(Math.abs(base.temperature - 0.56) * 0.8 + (1 - base.rainfall) * 0.2, 0, 1),
  };
}

function meanTraits(members) {
  return {
    intelligence: mean(members.map(m => m.genome.intelligence)), dexterity: mean(members.map(m => m.genome.dexterity)), construction: mean(members.map(m => m.genome.construction)),
    communication: mean(members.map(m => m.genome.communication)), memory: mean(members.map(m => m.genome.memory)), social: mean(members.map(m => m.genome.social)),
    aggression: mean(members.map(m => m.genome.aggression)), innovation: mean(members.map(m => m.biases.innovation)), conformity: mean(members.map(m => m.biases.conformity)), trust: mean(members.map(m => m.biases.trust)),
  };
}
function initialLexicon(rng) { return Object.fromEntries(['food', 'water', 'danger', 'home', 'kin'].map(concept => [concept, generateWord(rng, concept)])); }
function generateWord(rng, salt = '') { const c = ['k', 't', 'm', 'n', 's', 'r', 'l', 'p', 'v', 'h', 'g', 'd']; const v = ['a', 'e', 'i', 'o', 'u', 'ai', 'au']; let word = ''; const count = 1 + Math.floor(rng() * 3); for (let i = 0; i < count; i++) { word += c[(Math.floor(rng() * c.length) + hashString(salt) + i) % c.length] + v[Math.floor(rng() * v.length)]; if (rng() < 0.18) word += c[Math.floor(rng() * c.length)]; } return word; }
function mutateWord(word, rng, amount) { if (!word || rng() > amount) return word; const sounds = 'aeiouktsmnrplvhgd'; const i = Math.floor(rng() * word.length); if (rng() < 0.33 && word.length > 2) return word.slice(0, i) + word.slice(i + 1); if (rng() < 0.66) return word.slice(0, i) + sounds[Math.floor(rng() * sounds.length)] + word.slice(i + 1); return word.slice(0, i) + sounds[Math.floor(rng() * sounds.length)] + word.slice(i); }
function mutateLexicon(lexicon, rng, amount) { return Object.fromEntries(Object.entries(lexicon || {}).map(([concept, word]) => [concept, mutateWord(word, rng, amount)])); }
function mutateNorms(norms, rng, amount) { return Object.fromEntries(Object.entries(norms).map(([key, value]) => [key, clamp(value + (rng() - 0.5) * amount * 2, 0, 1)])); }
function blendLanguages(a, b, amount, rng) { if (!a || !b || amount <= 0) return; for (const concept of CONCEPTS) { if (rng() < amount && a.lexicon[concept]) b.lexicon[concept] = mutateWord(a.lexicon[concept], rng, 0.03); if (rng() < amount && b.lexicon[concept]) a.lexicon[concept] = mutateWord(b.lexicon[concept], rng, 0.03); } }
function lexicalSimilarity(a, b) { if (!a || !b) return 0; if (a.id === b.id) return 1; let shared = 0; let compared = 0; for (const concept of CONCEPTS) { if (!a.lexicon[concept] || !b.lexicon[concept]) continue; compared++; if (a.lexicon[concept] === b.lexicon[concept]) shared++; else if (a.lexicon[concept][0] === b.lexicon[concept][0]) shared += 0.35; } return compared ? shared / compared : a.familyId === b.familyId ? 0.35 : 0.08; }
function normSimilarity(a, b) { if (!a || !b) return 0; const keys = ['cooperation', 'sharing', 'hierarchy', 'exogamy']; return clamp(1 - mean(keys.map(key => Math.abs((a.norms[key] || 0) - (b.norms[key] || 0)))), 0, 1); }
function techPrerequisitesMet(id, community) { const tech = TECH.find(item => item.id === id); return !tech || tech.req.every(req => community.technologies.has(req)); }
function resourceComplementarity(a, b) { return clamp((Math.abs(a.environment.plantAccess - b.environment.plantAccess) + Math.abs(a.environment.materials - b.environment.materials) + Math.abs(a.water - b.water)) / 2.2, 0.08, 1); }
function strongestSkill(mind) { return [...mind.skills.entries()].sort((a, b) => b[1] - a[1])[0] || null; }
function leadershipScore(mind, culture) { return mind.prestige * 0.4 + mind.genome.communication * 0.23 + mind.genome.intelligence * 0.22 + culture.norms.hierarchy * mind.genome.aggression * 0.15; }
function settlementName(id, language) { return `Hearth ${language.name.split(' ').slice(-1)[0]} ${String(id).split('-').pop()}`; }
function languageName(id, species) { return `Tongue ${String(species).replace(/[-_]/g, ' ').slice(0, 10)} ${id.split('-').pop()}`; }
function cultureName(id, species) { return `Tradition ${String(species).replace(/[-_]/g, ' ').slice(0, 10)} ${id.split('-').pop()}`; }
function polityName(id, community) { return `League ${community.name.split(' ').slice(-1)[0]} ${id.split('-').pop()}`; }
function communityNode(c) { return { x: c.x, y: c.y, population: c.population, languageId: c.languageId, cultureId: c.cultureId, polityId: c.polityId, status: c.status }; }
function routeAttributes(r) { return { kind: r.kind, trust: r.trust, hostility: r.hostility, flow: r.flow, migration: r.migration, knowledge: r.knowledge }; }
function serializeCommunity(c) { return { ...c, members: [...c.members], technologies: [...c.technologies], buildings: [...c.buildings], inventions: [...c.inventions], history: [...c.history], roles: { ...c.roles }, environment: { ...c.environment } }; }
function serializeMind(m) { return { creatureId: m.creatureId, languageId: m.languageId, cultureId: m.cultureId, prestige: m.prestige, biases: { ...m.biases }, associations: [...m.associations], lexicon: [...m.lexicon], skills: [...m.skills], episodes: m.episodes.slice(-36), status: m.status }; }
function weightedChoice(items, rng) { const total = items.reduce((sum, item) => sum + Math.max(0, item[1]), 0); let roll = rng() * total; for (const [value, weight] of items) { roll -= Math.max(0, weight); if (roll <= 0) return value; } return items[0]?.[0] || 'food'; }
function mostCommon(values) { if (!values.length) return null; const counts = new Map(); for (const value of values) counts.set(value, (counts.get(value) || 0) + 1); return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]; }
function edgeId(a, b) { return [a, b].sort().join('::'); }
function distance2(a, b, width, height) { const dx = shortest((b.x || 0) - (a.x || 0), width); const dy = shortest((b.y || 0) - (a.y || 0), height); return dx * dx + dy * dy; }
function shortest(delta, period) { if (delta > period * 0.5) return delta - period; if (delta < -period * 0.5) return delta + period; return delta; }
function mean(values) { const valid = values.filter(Number.isFinite); return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0; }
function hashString(text) { let hash = 2166136261; for (const char of String(text)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); } return hash >>> 0; }
function mulberry32(seed) { let value = seed >>> 0; return () => { value += 0x6D2B79F5; let result = value; result = Math.imul(result ^ result >>> 15, result | 1); result ^= result + Math.imul(result ^ result >>> 7, result | 61); return ((result ^ result >>> 14) >>> 0) / 4294967296; }; }
const wrap = (value, max) => ((value % max) + max) % max;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
