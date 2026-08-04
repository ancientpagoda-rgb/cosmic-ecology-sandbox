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
const TECHNOLOGIES = [
  { id: 'fire', requires: [], threshold: 0.42, needs: ['intelligence', 'dexterity', 'scarcity'] },
  { id: 'storage', requires: [], threshold: 0.46, needs: ['construction', 'surplus', 'population'] },
  { id: 'crafting', requires: ['fire'], threshold: 0.52, needs: ['dexterity', 'knowledge', 'materials'] },
  { id: 'agriculture', requires: ['storage'], threshold: 0.58, needs: ['plantAccess', 'population', 'scarcity'] },
  { id: 'roads', requires: ['storage'], threshold: 0.61, needs: ['construction', 'trade', 'population'] },
  { id: 'irrigation', requires: ['agriculture'], threshold: 0.66, needs: ['waterAccess', 'construction', 'knowledge'] },
  { id: 'sanitation', requires: ['storage'], threshold: 0.65, needs: ['disease', 'waterAccess', 'knowledge'] },
  { id: 'transport', requires: ['crafting', 'roads'], threshold: 0.7, needs: ['trade', 'dexterity', 'knowledge'] },
  { id: 'writing', requires: ['storage'], threshold: 0.72, needs: ['language', 'knowledge', 'population'] },
  { id: 'metallurgy', requires: ['fire', 'crafting'], threshold: 0.78, needs: ['materials', 'fireMastery', 'knowledge'] },
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
  const culturalLineages = new Map();
  const languageFamilies = new Map();
  const savedCommunityQueue = [];
  let GraphCtor = null;
  let network = null;
  let visuals = null;
  let elapsed = 0;
  let cognitionClock = 0;
  let settlementClock = 0;
  let networkClock = 0;
  let environmentClock = 0;
  let uiClock = 0;
  let nextLanguageId = 1;
  let nextCultureId = 1;
  let nextPolityId = 1;
  let nextEventId = 1;
  let nextRouteId = 1;
  let nextInventionId = 1;
  let destroyed = false;

  const ui = createHistoryInterface(mobile);

  async function initialize({ provideCapability }) {
    GraphCtor = await loadGraphology();
    network = createNetwork(GraphCtor);
    visuals = createCivilizationVisuals(
      options.container || document.getElementById('world') || document.body,
      groundLevel,
      api,
      { mobile },
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
    settlementClock += dt;
    networkClock += dt;
    environmentClock += dt;
    uiClock += dt;

    synchronizeMinds();
    synchronizeCommunities();

    if (cognitionClock >= (mobile ? 1.1 : 0.72)) {
      const amount = cognitionClock;
      cognitionClock = 0;
      cognitionCycle(amount);
    }
    if (settlementClock >= (mobile ? 2.4 : 1.55)) {
      const amount = settlementClock;
      settlementClock = 0;
      settlementCycle(amount);
    }
    if (networkClock >= (mobile ? 4.8 : 3.2)) {
      const amount = networkClock;
      networkClock = 0;
      networkCycle(amount);
    }
    if (environmentClock >= 2.1) {
      const amount = environmentClock;
      environmentClock = 0;
      environmentalCycle(amount);
    }
  }

  function synchronizeMinds() {
    const seen = new Set();
    const cap = mobile ? 90 : 220;
    let count = 0;
    for (const role of ROLES) {
      for (const [entityId, component] of world.ecs.components[role].entries()) {
        if (count++ >= cap) break;
        const position = world.ecs.components.position.get(entityId);
        const genome = component.embodiment;
        if (!position || !genome) continue;
        seen.add(entityId);
        let mind = minds.get(entityId);
        if (!mind) {
          mind = createMind(entityId, role, component, genome, position);
          minds.set(entityId, mind);
        }
        mind.position = position;
        mind.genome = genome;
        mind.component = component;
        mind.speciesId = genome.speciesId || mind.speciesId;
        mind.age = genome.lifeAge || mind.age;
        mind.energy = component.energy || 0;
      }
    }
    for (const entityId of minds.keys()) {
      if (!seen.has(entityId)) minds.delete(entityId);
    }
  }

  function createMind(entityId, role, component, genome, position) {
    const biases = {
      imitation: clamp(genome.social * 0.45 + genome.memory * 0.3 + rng() * 0.18, 0, 1),
      innovation: clamp(genome.intelligence * 0.44 + genome.curiosity * 0.38 + rng() * 0.16, 0, 1),
      conformity: clamp(genome.social * 0.5 + (1 - genome.curiosity) * 0.24 + rng() * 0.15, 0, 1),
      trust: clamp(genome.social * 0.42 + genome.communication * 0.28 - genome.aggression * 0.18 + rng() * 0.18, 0, 1),
    };
    return {
      entityId,
      creatureId: component.creatureId || `entity-${entityId}`,
      role,
      speciesId: genome.speciesId || role,
      position,
      genome,
      component,
      age: genome.lifeAge || 0,
      energy: component.energy || 0,
      communityId: null,
      cultureId: null,
      languageId: null,
      biases,
      associations: new Map(),
      lexicon: new Map(),
      episodes: [],
      skills: new Map(),
      status: 'foraging',
      prestige: clamp(genome.display * 0.25 + genome.intelligence * 0.35 + genome.communication * 0.25, 0, 1),
    };
  }

  function synchronizeCommunities() {
    const structures = embodiedEvolution.getStructures?.() || [];
    const settlements = structures.filter(item => item.type === 'settlement');
    const seen = new Set();

    for (const structure of settlements) {
      seen.add(structure.id);
      let community = communities.get(structure.id);
      if (!community) {
        community = restoreCommunity(structure) || createCommunity(structure);
        communities.set(community.id, community);
        network.mergeNode(community.id, nodeAttributes(community));
        recordEvent('Settlement enters history', `${community.name} became a persistent spatial community of ${community.speciesId}.`, 'settlement', community.id);
      }
      community.x = structure.x;
      community.y = structure.y;
      community.phase6Population = structure.population || community.phase6Population || 0;
      community.phase6Progress = structure.progress || community.phase6Progress || 0;
      community.lastSeen = elapsed;
    }

    assignMindsToCommunities();
    for (const community of communities.values()) {
      if (!seen.has(community.id)) {
        community.abandonment += 0.03;
        if (community.abandonment > 1 && community.status !== 'abandoned') {
          community.status = 'abandoned';
          community.collapsedAt = elapsed;
          recordEvent('Settlement abandoned', `${community.name} lost its sustaining population and became an archaeological site.`, 'collapse', community.id);
        }
      } else {
        community.abandonment = Math.max(0, community.abandonment - 0.08);
        if (community.status === 'abandoned' && community.population >= 3 && community.food > 0.35) {
          community.status = 'recovering';
          community.recoveredAt = elapsed;
          recordEvent('Settlement recovered', `${community.name} was resettled after abandonment.`, 'recovery', community.id);
        }
      }
      network.mergeNode(community.id, nodeAttributes(community));
    }
  }

  function createCommunity(structure) {
    const species = (embodiedEvolution.getSpecies?.() || []).find(item => item.id === structure.speciesId);
    const language = createLanguage(structure.speciesId, structure.x, structure.y, null);
    const culture = createCulture(structure.speciesId, null);
    const environment = sampleEnvironment(structure.x, structure.y);
    const community = {
      id: structure.id,
      name: settlementName(structure.id, language),
      speciesId: structure.speciesId,
      x: structure.x,
      y: structure.y,
      foundedAt: elapsed,
      lastSeen: elapsed,
      collapsedAt: null,
      recoveredAt: null,
      status: 'growing',
      population: Math.max(1, structure.population || 1),
      phase6Population: structure.population || 0,
      phase6Progress: structure.progress || 0,
      members: [],
      languageId: language.id,
      cultureId: culture.id,
      polityId: null,
      leaderId: null,
      roles: {},
      technologies: new Set(),
      inventions: [],
      buildings: new Set(['hearth', 'shelter']),
      food: clamp(environment.plantAccess * 0.55 + environment.waterAccess * 0.2, 0.12, 0.8),
      storedFood: 0,
      materials: clamp(environment.materials, 0, 1),
      water: clamp(environment.waterAccess, 0, 1),
      disease: 0.04,
      stress: 0.12,
      stability: 0.48,
      knowledge: 0.08,
      trade: 0,
      conflict: 0,
      migration: 0,
      carryingCapacity: Math.max(3, structure.population || 3),
      surplus: 0,
      environmentalImpact: 0,
      climateImpact: 0,
      abandonment: 0,
      history: [],
      environment,
      languageComplexity: language.complexity,
      culturalDivergence: 0,
      generation: species?.meanGenome?.generation || 0,
    };
    return community;
  }

  function restoreCommunity(structure) {
    const index = savedCommunityQueue.findIndex(item => item.id === structure.id);
    if (index < 0) return null;
    const saved = savedCommunityQueue.splice(index, 1)[0];
    const language = saved.languageId && languages.get(saved.languageId)
      ? languages.get(saved.languageId)
      : createLanguage(structure.speciesId, structure.x, structure.y, null);
    const culture = saved.cultureId && cultures.get(saved.cultureId)
      ? cultures.get(saved.cultureId)
      : createCulture(structure.speciesId, null);
    return {
      ...saved,
      x: structure.x,
      y: structure.y,
      languageId: language.id,
      cultureId: culture.id,
      technologies: new Set(saved.technologies || []),
      buildings: new Set(saved.buildings || ['hearth', 'shelter']),
      members: [],
      roles: saved.roles || {},
      environment: sampleEnvironment(structure.x, structure.y),
    };
  }

  function assignMindsToCommunities() {
    for (const community of communities.values()) community.members = [];
    for (const mind of minds.values()) {
      let best = null;
      let bestDistance = 180 * 180;
      for (const community of communities.values()) {
        if (community.status === 'abandoned' || community.speciesId !== mind.speciesId) continue;
        const distance = torusDistance(mind.position, community, world.width, world.height);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = community;
        }
      }
      mind.communityId = best?.id || null;
      mind.languageId = best?.languageId || null;
      mind.cultureId = best?.cultureId || null;
      if (best) best.members.push(mind.entityId);
    }
    for (const community of communities.values()) {
      community.population = Math.max(community.members.length, Math.round(community.phase6Population || 0));
      community.generation = Math.max(0, ...community.members.map(id => minds.get(id)?.genome?.generation || 0));
    }
  }

  function cognitionCycle(dt) {
    const mindList = [...minds.values()];
    for (const mind of mindList) {
      const concept = experienceConcept(mind);
      learnAssociation(mind, concept, dt);
      updateSkill(mind, concept, dt);
      const partner = chooseLearningPartner(mind, mindList);
      if (partner) imitate(mind, partner, concept, dt);
      trimMind(mind);
    }
  }

  function experienceConcept(mind) {
    const environment = sampleEnvironment(mind.position.x, mind.position.y);
    if (mind.energy < 0.45) return 'food';
    if (environment.waterAccess < 0.16) return 'water';
    if (mind.role === 'agent' && nearbyRole(mind, ['predator', 'apex'], 115)) return 'danger';
    if (mind.role !== 'agent' && nearbyRole(mind, ['agent'], 145)) return 'animal';
    if (mind.communityId && rng() < 0.28) return rng() < 0.5 ? 'home' : 'kin';
    const weighted = [
      ['weather', 0.1 + environment.climateStress * 0.35],
      ['plant', 0.1 + environment.plantAccess * 0.3],
      ['stone', 0.08 + environment.materials * 0.2],
      ['wood', 0.08 + environment.plantAccess * 0.18],
      ['path', mind.communityId ? 0.18 : 0.04],
      ['trade', mind.communityId ? 0.12 : 0.01],
      ['future', mind.genome.intelligence * 0.08],
      ['past', mind.genome.memory * 0.08],
    ];
    return weightedChoice(weighted, rng);
  }

  function learnAssociation(mind, concept, dt) {
    const previous = mind.associations.get(concept) || 0;
    const learningRate = 0.025 + mind.genome.memory * 0.045 + mind.biases.innovation * 0.018;
    mind.associations.set(concept, clamp(previous + dt * learningRate, 0, 1));
    mind.episodes.push({ concept, at: elapsed, strength: mind.associations.get(concept) });
    if (!mind.lexicon.has(concept)) {
      const language = languages.get(mind.languageId);
      const communalWord = language?.lexicon?.[concept];
      if (communalWord && rng() < mind.biases.conformity * 0.7 + 0.15) mind.lexicon.set(concept, communalWord);
      else if (mind.biases.innovation > 0.55 && rng() < 0.04) mind.lexicon.set(concept, generateWord(rng, concept));
    }
  }

  function updateSkill(mind, concept, dt) {
    const mapping = {
      food: 'gathering', plant: 'gathering', stone: 'crafting', wood: 'construction',
      path: 'navigation', trade: 'exchange', danger: 'defense', animal: 'hunting',
      fire: 'firecraft', water: 'watercraft', future: 'planning', past: 'teaching',
    };
    const skill = mapping[concept];
    if (!skill) return;
    const previous = mind.skills.get(skill) || 0;
    mind.skills.set(skill, clamp(previous + dt * (0.008 + mind.genome.dexterity * 0.012 + mind.genome.intelligence * 0.008), 0, 1));
  }

  function chooseLearningPartner(mind, list) {
    let best = null;
    let bestScore = -Infinity;
    for (const candidate of list) {
      if (candidate.entityId === mind.entityId || candidate.speciesId !== mind.speciesId) continue;
      const distance = torusDistance(mind.position, candidate.position, world.width, world.height);
      if (distance > 95 * 95) continue;
      const sameCommunity = candidate.communityId && candidate.communityId === mind.communityId ? 0.3 : 0;
      const score = candidate.prestige * 0.42 + candidate.genome.communication * 0.3 + sameCommunity - Math.sqrt(distance) / 400 + rng() * 0.08;
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    return best;
  }

  function imitate(learner, teacher, concept, dt) {
    const probability = learner.biases.imitation * teacher.prestige * (0.4 + teacher.genome.communication * 0.6);
    if (rng() > probability * clamp(dt, 0, 1.5)) return;
    const teacherWord = teacher.lexicon.get(concept);
    if (teacherWord) learner.lexicon.set(concept, mutateWord(teacherWord, rng, learner.biases.innovation * 0.08));
    const teacherSkill = strongestSkill(teacher);
    if (teacherSkill) {
      const current = learner.skills.get(teacherSkill[0]) || 0;
      learner.skills.set(teacherSkill[0], clamp(current + teacherSkill[1] * 0.04, 0, 1));
    }
  }

  function settlementCycle(dt) {
    for (const community of communities.values()) {
      if (community.status === 'abandoned') continue;
      community.environment = sampleEnvironment(community.x, community.y);
      aggregateCommunityKnowledge(community, dt);
      evolveLanguage(community, dt);
      evolveCulture(community, dt);
      evolveEconomy(community, dt);
      attemptInventions(community, dt);
      assignCommunityRoles(community);
      chooseLeader(community);
      updateCommunityStatus(community, dt);
      network.mergeNode(community.id, nodeAttributes(community));
    }
  }

  function aggregateCommunityKnowledge(community, dt) {
    const members = community.members.map(id => minds.get(id)).filter(Boolean);
    const memory = average(members.map(mind => mind.genome.memory));
    const intelligence = average(members.map(mind => mind.genome.intelligence));
    const communication = average(members.map(mind => mind.genome.communication));
    const teaching = average(members.map(mind => mind.skills.get('teaching') || 0));
    const writing = community.technologies.has('writing') ? 0.35 : 0;
    const loss = members.length ? 0.0015 : 0.018;
    community.knowledge = clamp(
      community.knowledge + dt * (memory * intelligence * communication * 0.012 + teaching * 0.009 + writing * 0.012 - loss),
      0,
      2.5,
    );
  }

  function evolveLanguage(community, dt) {
    let language = languages.get(community.languageId);
    if (!language) {
      language = createLanguage(community.speciesId, community.x, community.y, null);
      community.languageId = language.id;
    }
    const members = community.members.map(id => minds.get(id)).filter(Boolean);
    const transmission = average(members.map(mind => mind.genome.communication * mind.genome.memory));
    const innovation = average(members.map(mind => mind.biases.innovation));
    const sharedConcepts = new Map();
    for (const mind of members) {
      for (const [concept, word] of mind.lexicon.entries()) {
        if (!sharedConcepts.has(concept)) sharedConcepts.set(concept, new Map());
        const words = sharedConcepts.get(concept);
        words.set(word, (words.get(word) || 0) + 1);
      }
    }
    for (const concept of CONCEPTS) {
      const variants = sharedConcepts.get(concept);
      if (variants?.size) {
        const winner = [...variants.entries()].sort((a, b) => b[1] - a[1])[0][0];
        if (rng() < transmission * 0.8 + 0.1) language.lexicon[concept] = winner;
      } else if (!language.lexicon[concept] && rng() < innovation * 0.04) {
        language.lexicon[concept] = generateWord(rng, concept);
      }
    }

    const knownMeanings = Object.keys(language.lexicon).length / CONCEPTS.length;
    const contact = routeContact(community.id);
    const isolation = clamp(1 - contact, 0, 1);
    language.complexity = clamp(
      language.complexity + dt * (transmission * knownMeanings * 0.012 + community.population * 0.0003 - isolation * 0.001),
      0.04,
      1.5,
    );
    language.grammar.marking = clamp(language.grammar.marking + dt * transmission * knownMeanings * 0.003, 0, 1);
    language.grammar.recursion = clamp(language.grammar.recursion + dt * community.knowledge * average(members.map(m => m.genome.intelligence)) * 0.0016, 0, 1);
    language.drift += dt * isolation * (0.004 + innovation * 0.004);
    language.speakers = community.population;
    language.centroidX = community.x;
    language.centroidY = community.y;
    community.languageComplexity = language.complexity;

    if (language.drift > 1 && community.population >= 3 && isolation > 0.45) {
      const child = branchLanguage(language, community);
      community.languageId = child.id;
      language.drift *= 0.28;
      recordEvent('Language branches', `${community.name} developed ${child.name}, a daughter language of ${language.name}.`, 'language', community.id);
    }

    for (const mind of members) {
      mind.languageId = community.languageId;
      for (const [concept, word] of Object.entries(languages.get(community.languageId)?.lexicon || {})) {
        if (rng() < mind.biases.conformity * 0.18 + mind.genome.communication * 0.08) mind.lexicon.set(concept, word);
      }
    }
  }

  function createLanguage(speciesId, x, y, parentId) {
    const parent = parentId ? languages.get(parentId) : null;
    const id = `lang-${nextLanguageId++}`;
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
      centroidX: x,
      centroidY: y,
      complexity: parent ? parent.complexity * 0.82 : 0.08,
      drift: 0,
      lexicon: parent ? mutateLexicon(parent.lexicon, rng, 0.12) : initialLexicon(rng),
      grammar: parent ? { ...parent.grammar } : { order: rng() < 0.5 ? 'SOV' : 'SVO', marking: 0.05, recursion: 0 },
    };
    languages.set(id, language);
    if (!languageFamilies.has(familyId)) languageFamilies.set(familyId, { id: familyId, rootLanguageId: id, languages: [] });
    languageFamilies.get(familyId).languages.push(id);
    return language;
  }

  function branchLanguage(parent, community) {
    const child = createLanguage(community.speciesId, community.x, community.y, parent.id);
    child.complexity = clamp(parent.complexity * (0.82 + rng() * 0.22), 0.05, 1.5);
    if (rng() < 0.24) child.grammar.order = ['SOV', 'SVO', 'VSO'][Math.floor(rng() * 3)];
    return child;
  }

  function evolveCulture(community, dt) {
    let culture = cultures.get(community.cultureId);
    if (!culture) {
      culture = createCulture(community.speciesId, null);
      community.cultureId = culture.id;
    }
    const members = community.members.map(id => minds.get(id)).filter(Boolean);
    const social = average(members.map(mind => mind.genome.social));
    const aggression = average(members.map(mind => mind.genome.aggression));
    const trust = average(members.map(mind => mind.biases.trust));
    const conformity = average(members.map(mind => mind.biases.conformity));
    const scarcity = clamp(1 - community.food, 0, 1);

    culture.norms.cooperation = clamp(culture.norms.cooperation + dt * (social * trust - aggression * scarcity * 0.45) * 0.008, 0, 1);
    culture.norms.sharing = clamp(culture.norms.sharing + dt * (social * scarcity * 0.5 + trust * 0.2) * 0.006, 0, 1);
    culture.norms.hierarchy = clamp(culture.norms.hierarchy + dt * (aggression * 0.25 + community.population / 80 - trust * 0.12) * 0.004, 0, 1);
    culture.norms.exogamy = clamp(culture.norms.exogamy + dt * (community.trade * 0.2 + 0.02 - conformity * 0.05) * 0.003, 0, 1);
    culture.traditionStrength = clamp(culture.traditionStrength + dt * conformity * community.knowledge * 0.002, 0, 1.5);
    culture.population = community.population;

    const divergence = routeContact(community.id) < 0.18 ? 0.006 : -0.002;
    community.culturalDivergence = clamp(community.culturalDivergence + dt * divergence, 0, 1.5);
    if (community.culturalDivergence > 1 && community.population >= 4) {
      const child = createCulture(community.speciesId, culture.id);
      child.norms = mutateNorms(culture.norms, rng, 0.15);
      community.cultureId = child.id;
      community.culturalDivergence *= 0.25;
      recordEvent('Culture branches', `${community.name} formed a distinct cultural lineage, ${child.name}.`, 'culture', community.id);
    }
  }

  function createCulture(speciesId, parentId) {
    const parent = parentId ? cultures.get(parentId) : null;
    const id = `culture-${nextCultureId++}`;
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

  function evolveEconomy(community, dt) {
    const tech = community.technologies;
    const env = community.environment;
    const roles = community.roles;
    const gatherers = roles.gatherer || Math.max(1, community.population * 0.32);
    const farmers = roles.farmer || 0;
    const hunters = roles.hunter || 0;
    const crafters = roles.crafter || 0;
    const traders = roles.trader || 0;
    const sanitation = tech.has('sanitation') ? 0.52 : 0;
    const irrigation = tech.has('irrigation') ? 0.42 : 0;
    const transport = tech.has('transport') ? 0.3 : 0;

    const wildFood = env.plantAccess * gatherers * 0.008 + env.preyAccess * hunters * 0.006;
    const farmFood = tech.has('agriculture') ? (env.plantAccess + env.waterAccess * 0.3 + irrigation) * farmers * 0.014 : 0;
    const consumption = community.population * (0.006 + community.disease * 0.0015);
    const production = wildFood + farmFood + transport * traders * 0.003;
    community.food = clamp(community.food + dt * (production - consumption), 0, 2.5);

    if (tech.has('storage')) {
      const transferable = Math.max(0, community.food - 0.72) * 0.18;
      community.food -= transferable;
      community.storedFood = clamp(community.storedFood + transferable - dt * 0.0018, 0, 4);
    } else {
      community.storedFood = Math.max(0, community.storedFood - dt * 0.008);
    }

    if (community.food < 0.3 && community.storedFood > 0) {
      const release = Math.min(community.storedFood, dt * 0.035);
      community.storedFood -= release;
      community.food += release;
    }

    community.materials = clamp(community.materials + dt * (env.materials * gatherers * 0.002 + crafters * 0.0018 - community.population * 0.0005), 0, 3);
    community.surplus = clamp(community.food + community.storedFood * 0.7 - 0.62, -1, 3);
    community.trade = clamp(community.trade * 0.98 + traders / Math.max(1, community.population) * 0.08 + routeTrade(community.id) * 0.1, 0, 2);
    community.disease = clamp(
      community.disease + dt * (community.population / Math.max(3, community.carryingCapacity) * 0.006 + community.trade * 0.0018 - sanitation * 0.008 - env.waterAccess * 0.001),
      0,
      1,
    );
    community.carryingCapacity = Math.max(3,
      3 + env.plantAccess * 10 + env.waterAccess * 7 + (tech.has('agriculture') ? 15 : 0) +
      (tech.has('storage') ? 7 : 0) + (tech.has('sanitation') ? 8 : 0) + (tech.has('transport') ? 5 : 0),
    );
    community.stress = clamp(
      (1 - clamp(community.food + community.storedFood * 0.4, 0, 1)) * 0.48 +
      community.disease * 0.32 + community.conflict * 0.28 +
      Math.max(0, community.population - community.carryingCapacity) / Math.max(3, community.carryingCapacity) * 0.35,
      0,
      1.5,
    );
  }

  function attemptInventions(community, dt) {
    const members = community.members.map(id => minds.get(id)).filter(Boolean);
    const meanTraits = {
      intelligence: average(members.map(mind => mind.genome.intelligence)),
      dexterity: average(members.map(mind => mind.genome.dexterity)),
      construction: average(members.map(mind => mind.genome.construction)),
      language: community.languageComplexity,
    };
    const context = {
      intelligence: meanTraits.intelligence,
      dexterity: meanTraits.dexterity,
      construction: meanTraits.construction,
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

    for (const technology of TECHNOLOGIES) {
      if (community.technologies.has(technology.id)) continue;
      if (!technology.requires.every(required => community.technologies.has(required))) continue;
      const score = average(technology.needs.map(need => context[need] || 0));
      if (score < technology.threshold) continue;
      const innovation = average(members.map(mind => mind.biases.innovation));
      const exchange = community.trade * 0.08 + routeKnowledge(community.id) * 0.12;
      const probability = clamp((score - technology.threshold + 0.04) * (innovation + community.knowledge * 0.35 + exchange) * dt * 0.16, 0, 0.28);
      if (rng() > probability) continue;
      discoverTechnology(community, technology.id, score);
      break;
    }
  }

  function discoverTechnology(community, technologyId, pressure) {
    community.technologies.add(technologyId);
    const invention = {
      id: `invention-${nextInventionId++}`,
      technologyId,
      communityId: community.id,
      cultureId: community.cultureId,
      languageId: community.languageId,
      inventedAt: elapsed,
      pressure,
    };
    inventions.set(invention.id, invention);
    community.inventions.push(invention.id);
    if (technologyId === 'storage') community.buildings.add('granary');
    if (technologyId === 'agriculture') community.buildings.add('field');
    if (technologyId === 'irrigation') community.buildings.add('canal');
    if (technologyId === 'sanitation') community.buildings.add('reservoir');
    if (technologyId === 'roads') community.buildings.add('road');
    if (technologyId === 'writing') community.buildings.add('archive');
    recordEvent('Technology emerges', `${community.name} developed ${technologyId} from ecological need, skill, materials, and accumulated knowledge.`, 'technology', community.id);
  }

  function assignCommunityRoles(community) {
    const tech = community.technologies;
    const population = community.population;
    const scarcity = clamp(1 - community.food, 0, 1);
    const roles = {
      gatherer: Math.max(1, Math.round(population * (0.28 + scarcity * 0.16))),
      hunter: Math.round(population * (community.environment.preyAccess * 0.12)),
      builder: Math.round(population * (tech.has('storage') ? 0.09 : 0.04)),
      teacher: Math.round(population * (community.languageComplexity * 0.07)),
      healer: Math.round(population * (community.disease * 0.08 + (tech.has('sanitation') ? 0.04 : 0))),
      farmer: tech.has('agriculture') ? Math.max(1, Math.round(population * 0.22)) : 0,
      crafter: tech.has('crafting') ? Math.max(1, Math.round(population * 0.11)) : 0,
      trader: community.trade > 0.15 ? Math.max(1, Math.round(population * 0.07)) : 0,
      recorder: tech.has('writing') ? Math.max(1, Math.round(population * 0.035)) : 0,
    };
    const assigned = Object.values(roles).reduce((sum, value) => sum + value, 0);
    if (assigned > population * 1.15) {
      const scale = population * 1.15 / assigned;
      for (const key of Object.keys(roles)) roles[key] = Math.round(roles[key] * scale);
    }
    community.roles = roles;
  }

  function chooseLeader(community) {
    const culture = cultures.get(community.cultureId);
    if (!culture || culture.norms.hierarchy < 0.35 || !community.members.length) {
      community.leaderId = null;
      return;
    }
    const candidates = community.members.map(id => minds.get(id)).filter(Boolean);
    candidates.sort((a, b) => leadershipScore(b, culture) - leadershipScore(a, culture));
    const leader = candidates[0];
    if (leader && leader.creatureId !== community.leaderId) {
      community.leaderId = leader.creatureId;
      if (rng() < 0.18) recordEvent('Leadership changes', `${leader.creatureId} became a recognized leader in ${community.name}.`, 'leadership', community.id);
    }
  }

  function updateCommunityStatus(community, dt) {
    community.stability = clamp(
      0.42 + community.food * 0.22 + community.storedFood * 0.08 + community.knowledge * 0.1 +
      (cultures.get(community.cultureId)?.norms.cooperation || 0) * 0.18 - community.stress * 0.38,
      0,
      1,
    );
    if (community.stress > 1.02 && community.stability < 0.22) community.abandonment += dt * 0.045;
    else community.abandonment = Math.max(0, community.abandonment - dt * 0.018);

    if (community.abandonment > 1 && community.status !== 'abandoned') {
      community.status = 'abandoned';
      community.collapsedAt = elapsed;
      recordEvent('Civilization collapse', `${community.name} collapsed after interacting shortages, disease, conflict, and population pressure.`, 'collapse', community.id);
    } else if (community.status !== 'abandoned') {
      community.status = community.stability > 0.72 ? 'flourishing' : community.stability > 0.4 ? 'stable' : 'stressed';
    }
  }

  function networkCycle(dt) {
    rebuildSettlementNetwork();
    updateRelations(dt);
    updatePolities();
    spreadKnowledgeAndLanguage(dt);
    moveMigrants(dt);
  }

  function rebuildSettlementNetwork() {
    const list = [...communities.values()].filter(community => community.status !== 'abandoned');
    const activeIds = new Set(list.map(item => item.id));
    for (const id of network.nodes()) {
      if (!activeIds.has(id)) network.dropNode(id);
    }
    for (const community of list) network.mergeNode(community.id, nodeAttributes(community));

    for (let index = 0; index < list.length; index++) {
      for (let second = index + 1; second < list.length; second++) {
        const a = list[index];
        const b = list[second];
        const distance = Math.sqrt(torusDistance(a, b, world.width, world.height));
        const roadBoost = a.technologies.has('roads') || b.technologies.has('roads') ? 1.55 : 1;
        const transportBoost = a.technologies.has('transport') || b.technologies.has('transport') ? 1.4 : 1;
        const range = (mobile ? 520 : 780) * roadBoost * transportBoost;
        if (distance > range) continue;
        const id = edgeId(a.id, b.id);
        const existing = routes.get(id) || {
          id: `route-${nextRouteId++}`,
          edgeId: id,
          from: a.id,
          to: b.id,
          kind: 'contact',
          trust: 0.28,
          hostility: 0.08,
          flow: 0,
          migration: 0,
          knowledge: 0,
          createdAt: elapsed,
          lastEventAt: -Infinity,
        };
        routes.set(id, existing);
        network.mergeEdge(a.id, b.id, routeAttributes(existing));
      }
    }

    for (const [id, route] of routes.entries()) {
      if (!network.hasEdge(route.from, route.to)) routes.delete(id);
    }
  }

  function updateRelations(dt) {
    for (const route of routes.values()) {
      const a = communities.get(route.from);
      const b = communities.get(route.to);
      if (!a || !b) continue;
      const languageSimilarity = compareLanguages(a.languageId, b.languageId);
      const cultureSimilarity = compareCultures(a.cultureId, b.cultureId);
      const complement = resourceComplementarity(a, b);
      const scarcity = (clamp(1 - a.food, 0, 1) + clamp(1 - b.food, 0, 1)) * 0.5;
      const territoriality = (cultureOf(a).norms.hierarchy + cultureOf(b).norms.hierarchy) * 0.25;
      const tradePotential = complement * (0.35 + languageSimilarity * 0.25 + route.trust * 0.35);

      route.flow = clamp(route.flow + dt * (tradePotential * 0.015 - route.hostility * 0.01), 0, 1.5);
      route.trust = clamp(route.trust + dt * (route.flow * 0.009 + cultureSimilarity * 0.003 - route.hostility * 0.012), 0, 1);
      route.hostility = clamp(route.hostility + dt * (scarcity * territoriality * 0.008 - route.flow * 0.006 - route.trust * 0.002), 0, 1);
      route.knowledge = clamp(route.knowledge + dt * route.flow * languageSimilarity * 0.012, 0, 1);
      route.migration = clamp((a.stress + b.stress) * 0.2 + route.flow * 0.1, 0, 1);

      if (route.hostility > 0.64 && route.trust < 0.24) route.kind = 'conflict';
      else if (route.trust > 0.68 && route.flow > 0.32) route.kind = 'alliance';
      else if (route.flow > 0.12) route.kind = 'trade';
      else route.kind = 'contact';

      a.trade = clamp(a.trade + route.flow * 0.015, 0, 2);
      b.trade = clamp(b.trade + route.flow * 0.015, 0, 2);
      a.conflict = clamp(a.conflict * 0.92 + (route.kind === 'conflict' ? route.hostility * 0.12 : 0), 0, 1);
      b.conflict = clamp(b.conflict * 0.92 + (route.kind === 'conflict' ? route.hostility * 0.12 : 0), 0, 1);

      if (route.kind === 'conflict' && elapsed - route.lastEventAt > 18 && rng() < 0.16) {
        route.lastEventAt = elapsed;
        resolveConflict(route, a, b);
      } else if (route.kind === 'alliance' && elapsed - route.lastEventAt > 24 && rng() < 0.12) {
        route.lastEventAt = elapsed;
        recordEvent('Alliance formed', `${a.name} and ${b.name} formalized an alliance through repeated exchange and growing trust.`, 'diplomacy', a.id);
      }
      network.mergeEdge(a.id, b.id, routeAttributes(route));
    }
  }

  function resolveConflict(route, a, b) {
    const strengthA = a.population * (0.4 + a.knowledge * 0.2 + (a.technologies.has('metallurgy') ? 0.35 : 0) + a.stability * 0.2);
    const strengthB = b.population * (0.4 + b.knowledge * 0.2 + (b.technologies.has('metallurgy') ? 0.35 : 0) + b.stability * 0.2);
    const probabilityA = strengthA / Math.max(0.001, strengthA + strengthB);
    const winner = rng() < probabilityA ? a : b;
    const loser = winner === a ? b : a;
    const loss = clamp(0.08 + route.hostility * 0.14 + rng() * 0.08, 0, 0.32);
    loser.food = Math.max(0, loser.food - loss);
    loser.storedFood = Math.max(0, loser.storedFood - loss * 0.7);
    loser.stress = clamp(loser.stress + loss * 0.9, 0, 1.5);
    winner.materials = clamp(winner.materials + loss * 0.4, 0, 3);
    route.hostility *= 0.76;
    route.trust *= 0.72;
    recordEvent('Raid and conflict', `${winner.name} prevailed in a conflict with ${loser.name}; resources shifted and both communities changed course.`, 'conflict', winner.id);
  }

  function updatePolities() {
    const allianceAdjacency = new Map();
    for (const community of communities.values()) allianceAdjacency.set(community.id, new Set());
    for (const route of routes.values()) {
      if (route.kind !== 'alliance' || route.trust < 0.67) continue;
      allianceAdjacency.get(route.from)?.add(route.to);
      allianceAdjacency.get(route.to)?.add(route.from);
    }

    const visited = new Set();
    const newPolities = new Map();
    for (const community of communities.values()) {
      if (visited.has(community.id) || community.status === 'abandoned') continue;
      const group = [];
      const queue = [community.id];
      while (queue.length) {
        const id = queue.shift();
        if (visited.has(id)) continue;
        visited.add(id);
        group.push(id);
        for (const neighbor of allianceAdjacency.get(id) || []) queue.push(neighbor);
      }
      if (group.length < 2) {
        community.polityId = null;
        continue;
      }
      const existingId = mostCommon(group.map(id => communities.get(id)?.polityId).filter(Boolean));
      const polityId = existingId || `polity-${nextPolityId++}`;
      const polity = polities.get(polityId) || {
        id: polityId,
        name: polityName(polityId, communities.get(group[0])),
        foundedAt: elapsed,
        dissolvedAt: null,
        members: [],
        population: 0,
        stability: 0,
      };
      polity.members = group;
      polity.population = group.reduce((sum, id) => sum + (communities.get(id)?.population || 0), 0);
      polity.stability = average(group.map(id => communities.get(id)?.stability || 0));
      newPolities.set(polityId, polity);
      for (const id of group) communities.get(id).polityId = polityId;
      if (!existingId) recordEvent('Federation emerges', `${polity.name} formed from ${group.length} allied settlements.`, 'federation', group[0]);
    }

    for (const [id, polity] of polities.entries()) {
      if (!newPolities.has(id) && polity.dissolvedAt == null) {
        polity.dissolvedAt = elapsed;
        recordEvent('Federation dissolves', `${polity.name} dissolved as its alliance network fragmented.`, 'collapse', polity.members[0]);
      }
    }
    for (const [id, polity] of newPolities) polities.set(id, polity);
  }

  function spreadKnowledgeAndLanguage(dt) {
    for (const route of routes.values()) {
      if (route.flow <= 0.08) continue;
      const a = communities.get(route.from);
      const b = communities.get(route.to);
      if (!a || !b) continue;
      const transfer = route.flow * route.trust * dt * 0.006;
      const meanKnowledge = (a.knowledge + b.knowledge) * 0.5;
      a.knowledge += (meanKnowledge - a.knowledge) * transfer;
      b.knowledge += (meanKnowledge - b.knowledge) * transfer;

      if (rng() < transfer * 0.2) {
        const source = rng() < 0.5 ? a : b;
        const target = source === a ? b : a;
        const technology = [...source.technologies].find(item => !target.technologies.has(item));
        if (technology && technologyTransferPossible(technology, target)) {
          target.technologies.add(technology);
          recordEvent('Technology diffuses', `${technology} spread from ${source.name} to ${target.name} through exchange.`, 'technology', target.id);
        }
      }

      blendLanguages(a.languageId, b.languageId, route.flow * dt * 0.0025);
    }
  }

  function moveMigrants(dt) {
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
      source.phase6Population = Math.max(1, source.phase6Population - amount);
      target.phase6Population += amount;
      source.migration += amount;
      target.migration += amount;
      migrations.push({ from: source.id, to: target.id, amount, at: elapsed, languageId: source.languageId, cultureId: source.cultureId });
      if (migrations.length > 180) migrations.splice(0, migrations.length - 180);
      recordEvent('Migration', `${amount} inhabitants moved from ${source.name} to ${target.name}, carrying language and traditions.`, 'migration', target.id);
    }
  }

  function environmentalCycle(dt) {
    let totalImpact = 0;
    for (const community of communities.values()) {
      if (community.status === 'abandoned') continue;
      const techIntensity = community.technologies.size / TECHNOLOGIES.length;
      const populationIntensity = clamp(community.population / 30, 0, 2);
      community.environmentalImpact = clamp(
        community.environmentalImpact + dt * (techIntensity * populationIntensity * 0.004 - community.stability * 0.0015),
        0,
        1.5,
      );
      community.climateImpact = community.technologies.has('metallurgy')
        ? community.environmentalImpact * community.population * 0.00018
        : community.environmentalImpact * community.population * 0.00004;
      totalImpact += community.climateImpact;

      supportNearbyPopulation(community, dt);
      cultivateEnvironment(community, dt);
      degradeEnvironment(community, dt);
    }
    world.globals.civilizationPressure = clamp([...communities.values()].reduce((sum, item) => sum + item.environmentalImpact, 0), 0, 25);
    world.globals.anthropogenicImpact = clamp(totalImpact, 0, 1);
  }

  function supportNearbyPopulation(community, dt) {
    const foodSupport = community.technologies.has('storage') ? community.storedFood * 0.002 : 0;
    const sanitation = community.technologies.has('sanitation') ? 0.003 : 0;
    for (const role of ROLES) {
      for (const [entityId, component] of world.ecs.components[role].entries()) {
        const position = world.ecs.components.position.get(entityId);
        if (!position || torusDistance(position, community, world.width, world.height) > 150 * 150) continue;
        if (component.embodiment?.speciesId === community.speciesId) {
          component.energy = Math.min(role === 'agent' ? 2 : role === 'predator' ? 3.5 : 5,
            (component.energy || 0) + dt * (foodSupport + sanitation),
          );
        } else if (community.environmentalImpact > 0.65) {
          component.energy = Math.max(0, (component.energy || 0) - dt * community.environmentalImpact * 0.0015);
        }
      }
    }
  }

  function cultivateEnvironment(community, dt) {
    if (!community.technologies.has('agriculture') || !world.makeResourceAt) return;
    const opportunity = community.food < 0.85 || community.population > community.carryingCapacity * 0.75;
    if (!opportunity || rng() > dt * (0.008 + community.knowledge * 0.005)) return;
    const angle = rng() * Math.PI * 2;
    const distance = 12 + rng() * 48;
    world.makeResourceAt(
      wrap(community.x + Math.cos(angle) * distance, world.width),
      clamp(community.y + Math.sin(angle) * distance, 0, world.height),
    );
  }

  function degradeEnvironment(community, dt) {
    if (community.environmentalImpact < 0.48) return;
    const radius = 110 + community.population * 2;
    let affected = 0;
    for (const [entityId, resource] of world.ecs.components.resource.entries()) {
      if (affected >= (mobile ? 2 : 5)) break;
      const position = world.ecs.components.position.get(entityId);
      if (!position || torusDistance(position, community, world.width, world.height) > radius * radius) continue;
      resource.amount = Math.max(0.08, resource.amount - dt * community.environmentalImpact * 0.008);
      affected++;
    }
  }

  function render(frame = {}) {
    visuals?.render(frame);
    const timestamp = frame.timestamp ?? performance.now();
    if (timestamp - ui.lastUpdate > 650 || uiClock > 1) {
      uiClock = 0;
      ui.lastUpdate = timestamp;
      updateHistoryInterface(ui, getState(), events, communities, languages, polities, inventions);
    }
  }

  function getCommunities() {
    return [...communities.values()].map(serializeCommunity);
  }

  function getRoutes() {
    return [...routes.values()].map(route => ({ ...route }));
  }

  function getLanguages() {
    return [...languages.values()].map(language => ({ ...language, lexicon: { ...language.lexicon }, grammar: { ...language.grammar } }));
  }

  function getCultures() {
    return [...cultures.values()].map(culture => ({ ...culture, norms: { ...culture.norms }, traditions: { ...culture.traditions } }));
  }

  function getHistory() {
    return events.slice();
  }

  function getState() {
    const activeCommunities = [...communities.values()].filter(item => item.status !== 'abandoned');
    return {
      elapsed,
      communities: activeCommunities.length,
      archaeologicalSites: communities.size - activeCommunities.length,
      languages: [...languages.values()].filter(language => language.extinctAt == null).length,
      languageFamilies: languageFamilies.size,
      cultures: cultures.size,
      polities: [...polities.values()].filter(polity => polity.dissolvedAt == null).length,
      routes: routes.size,
      technologies: inventions.size,
      migrations: migrations.length,
      population: activeCommunities.reduce((sum, community) => sum + community.population, 0),
      historyEvents: events.length,
      graphology: Boolean(GraphCtor),
    };
  }

  function save() {
    return {
      version: 1,
      elapsed,
      counters: { nextLanguageId, nextCultureId, nextPolityId, nextEventId, nextRouteId, nextInventionId },
      communities: [...communities.values()].map(serializeCommunity),
      languages: [...languages.values()],
      cultures: [...cultures.values()],
      polities: [...polities.values()],
      routes: [...routes.values()],
      inventions: [...inventions.values()],
      events: events.slice(-350),
      migrations: migrations.slice(-180),
      culturalLineages: [...culturalLineages.values()],
      languageFamilies: [...languageFamilies.values()],
      minds: [...minds.values()].slice(0, mobile ? 90 : 220).map(serializeMind),
    };
  }

  function load(state) {
    if (!state) return;
    elapsed = Math.max(0, state.elapsed || 0);
    const counters = state.counters || {};
    nextLanguageId = Math.max(1, counters.nextLanguageId || 1);
    nextCultureId = Math.max(1, counters.nextCultureId || 1);
    nextPolityId = Math.max(1, counters.nextPolityId || 1);
    nextEventId = Math.max(1, counters.nextEventId || 1);
    nextRouteId = Math.max(1, counters.nextRouteId || 1);
    nextInventionId = Math.max(1, counters.nextInventionId || 1);
    if (Array.isArray(state.languages)) for (const item of state.languages) languages.set(item.id, { ...item, lexicon: { ...(item.lexicon || {}) }, grammar: { ...(item.grammar || {}) } });
    if (Array.isArray(state.cultures)) for (const item of state.cultures) cultures.set(item.id, { ...item, norms: { ...(item.norms || {}) }, traditions: { ...(item.traditions || {}) } });
    if (Array.isArray(state.polities)) for (const item of state.polities) polities.set(item.id, { ...item, members: [...(item.members || [])] });
    if (Array.isArray(state.routes)) for (const item of state.routes) routes.set(item.edgeId || edgeId(item.from, item.to), { ...item });
    if (Array.isArray(state.inventions)) for (const item of state.inventions) inventions.set(item.id, { ...item });
    if (Array.isArray(state.events)) events.push(...state.events.slice(-350));
    if (Array.isArray(state.migrations)) migrations.push(...state.migrations.slice(-180));
    if (Array.isArray(state.culturalLineages)) for (const item of state.culturalLineages) culturalLineages.set(item.id, { ...item, children: [...(item.children || [])] });
    if (Array.isArray(state.languageFamilies)) for (const item of state.languageFamilies) languageFamilies.set(item.id, { ...item, languages: [...(item.languages || [])] });
    if (Array.isArray(state.communities)) savedCommunityQueue.push(...state.communities);
  }

  function destroy() {
    destroyed = true;
    visuals?.destroy?.();
    ui.destroy();
    communities.clear();
    languages.clear();
    cultures.clear();
    polities.clear();
    minds.clear();
    routes.clear();
    network?.clear?.();
  }

  const api = {
    id: 'civilization.emergent-graphology',
    name: 'Emergent Language, Culture, and Planetary Civilizations',
    version: '1.0.0',
    execution: 'browser-graphology-three',
    source: 'Graphology 0.26.0 plus Reality Sandbox cognitive, linguistic, technological, and historical simulation',
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
    getCommunities,
    getRoutes,
    getLanguages,
    getCultures,
    getHistory,
    destroy,
  };

  return api;

  function recordEvent(title, description, type, communityId) {
    const event = {
      id: `history-${nextEventId++}`,
      title,
      description,
      type,
      communityId: communityId || null,
      at: elapsed,
      tick: world.tick,
      date: new Date().toISOString(),
    };
    events.unshift(event);
    if (events.length > 500) events.length = 500;
    const community = communityId ? communities.get(communityId) : null;
    if (community) {
      community.history.unshift(event.id);
      if (community.history.length > 80) community.history.length = 80;
    }
    window.dispatchEvent(new CustomEvent('civilization-history', { detail: event }));
  }
}

async function loadGraphology() {
  let lastError;
  for (const source of GRAPH_SOURCES) {
    try {
      const module = await import(/* @vite-ignore */ source);
      const candidate = module.default?.default || module.default || module.Graph || module.UndirectedGraph;
      if (typeof candidate === 'function') return candidate;
    } catch (error) {
      lastError = error;
    }
  }
  console.warn('Graphology unavailable; using deterministic fallback graph.', lastError);
  return null;
}

function createNetwork(GraphCtor) {
  const graph = GraphCtor ? new GraphCtor({ type: 'undirected', multi: false, allowSelfLoops: false }) : new FallbackGraph();
  return {
    graph,
    mergeNode(id, attributes) {
      if (graph.hasNode(id)) {
        for (const [key, value] of Object.entries(attributes)) graph.setNodeAttribute(id, key, value);
      } else graph.addNode(id, attributes);
    },
    dropNode(id) { if (graph.hasNode(id)) graph.dropNode(id); },
    nodes() { return graph.nodes(); },
    mergeEdge(source, target, attributes) {
      if (!graph.hasNode(source) || !graph.hasNode(target)) return;
      const edge = graph.edge(source, target);
      if (edge) {
        for (const [key, value] of Object.entries(attributes)) graph.setEdgeAttribute(edge, key, value);
      } else graph.addEdge(source, target, attributes);
    },
    hasEdge(source, target) { return Boolean(graph.edge(source, target)); },
    clear() { graph.clear(); },
  };
}

class FallbackGraph {
  constructor() { this._nodes = new Map(); this._edges = new Map(); }
  hasNode(id) { return this._nodes.has(id); }
  addNode(id, attributes = {}) { this._nodes.set(id, { ...attributes }); }
  setNodeAttribute(id, key, value) { this._nodes.get(id)[key] = value; }
  nodes() { return [...this._nodes.keys()]; }
  dropNode(id) {
    this._nodes.delete(id);
    for (const [key, edge] of this._edges) if (edge.source === id || edge.target === id) this._edges.delete(key);
  }
  edge(source, target) { const key = edgeId(source, target); return this._edges.has(key) ? key : null; }
  addEdge(source, target, attributes = {}) { const key = edgeId(source, target); this._edges.set(key, { source, target, attributes: { ...attributes } }); return key; }
  setEdgeAttribute(edgeIdValue, key, value) { const edge = this._edges.get(edgeIdValue); if (edge) edge.attributes[key] = value; }
  clear() { this._nodes.clear(); this._edges.clear(); }
}

function createHistoryInterface(mobile) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'HISTORY';
  button.setAttribute('aria-expanded', 'false');
  button.style.cssText = 'position:fixed;left:max(12px,env(safe-area-inset-left));bottom:max(12px,env(safe-area-inset-bottom));z-index:26;padding:9px 12px;border:1px solid rgba(155,232,211,.36);border-radius:999px;background:rgba(3,12,15,.78);color:#caffef;font:700 11px/1 ui-monospace,monospace;letter-spacing:.12em;backdrop-filter:blur(9px)';

  const panel = document.createElement('aside');
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Planetary civilization history');
  panel.style.cssText = `position:fixed;left:max(12px,env(safe-area-inset-left));bottom:56px;z-index:25;width:min(${mobile ? 'calc(100vw - 24px)' : '410px'},calc(100vw - 24px));max-height:min(68vh,680px);overflow:auto;padding:14px;border:1px solid rgba(155,232,211,.24);border-radius:15px;background:rgba(2,9,12,.91);color:#dcfff3;box-shadow:0 16px 54px rgba(0,0,0,.36);backdrop-filter:blur(14px);font:12px/1.45 system-ui,sans-serif`;
  panel.innerHTML = `
    <header style="display:flex;justify-content:space-between;gap:12px;align-items:start;margin-bottom:10px">
      <div><strong style="display:block;font:800 13px/1.1 ui-monospace,monospace;letter-spacing:.08em;color:#93ebce">PLANETARY HISTORY</strong><span data-history-summary style="color:rgba(220,255,243,.66)"></span></div>
      <button type="button" data-history-close style="border:0;background:transparent;color:#dffff3;font-size:18px">×</button>
    </header>
    <section data-history-stats style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:10px"></section>
    <section><strong style="color:#9be8d3">Recent history</strong><div data-history-events></div></section>
    <section style="margin-top:12px"><strong style="color:#9be8d3">Living languages & polities</strong><div data-history-lineages></div></section>
  `;
  document.body.append(button, panel);
  const close = panel.querySelector('[data-history-close]');
  const toggle = force => {
    const open = force ?? panel.hidden;
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  };
  button.addEventListener('click', () => toggle());
  close.addEventListener('click', () => toggle(false));
  return {
    button,
    panel,
    summary: panel.querySelector('[data-history-summary]'),
    stats: panel.querySelector('[data-history-stats]'),
    eventList: panel.querySelector('[data-history-events]'),
    lineages: panel.querySelector('[data-history-lineages]'),
    lastUpdate: -Infinity,
    destroy() { button.remove(); panel.remove(); },
  };
}

function updateHistoryInterface(ui, state, events, communities, languages, polities, inventions) {
  ui.button.hidden = state.communities === 0 && state.historyEvents === 0;
  ui.summary.textContent = `${state.population} inhabitants across ${state.communities} communities`;
  const stats = [
    ['Languages', state.languages], ['Polities', state.polities], ['Inventions', state.technologies],
    ['Routes', state.routes], ['Migrations', state.migrations], ['Ruins', state.archaeologicalSites],
  ];
  ui.stats.replaceChildren(...stats.map(([label, value]) => {
    const item = document.createElement('div');
    item.style.cssText = 'padding:7px;border-radius:9px;background:rgba(151,232,209,.07);text-align:center';
    item.innerHTML = `<strong style="display:block;color:#f0fff9">${value}</strong><small style="color:rgba(220,255,243,.58)">${label}</small>`;
    return item;
  }));

  ui.eventList.replaceChildren(...events.slice(0, 12).map(event => {
    const item = document.createElement('article');
    item.style.cssText = 'padding:8px 0;border-bottom:1px solid rgba(155,232,211,.1)';
    const title = document.createElement('strong');
    title.textContent = event.title;
    title.style.cssText = 'display:block;color:#effff9';
    const description = document.createElement('span');
    description.textContent = event.description;
    description.style.cssText = 'color:rgba(220,255,243,.68)';
    item.append(title, description);
    return item;
  }));

  const livingLanguages = [...languages.values()].filter(item => item.extinctAt == null).slice(0, 5);
  const activePolities = [...polities.values()].filter(item => item.dissolvedAt == null).slice(0, 4);
  const activeCommunities = [...communities.values()].filter(item => item.status !== 'abandoned').slice(0, 5);
  const rows = [
    ...livingLanguages.map(item => `${item.name} · ${item.speakers} speakers · ${Math.round(item.complexity * 100)} complexity`),
    ...activePolities.map(item => `${item.name} · ${item.members.length} settlements · ${item.population} population`),
    ...activeCommunities.map(item => `${item.name} · ${item.status} · ${item.technologies.size} technologies`),
  ];
  ui.lineages.replaceChildren(...rows.map(text => {
    const row = document.createElement('div');
    row.textContent = text;
    row.style.cssText = 'padding:5px 0;color:rgba(220,255,243,.7);border-bottom:1px solid rgba(155,232,211,.07)';
    return row;
  }));
}

function sampleEnvironment(x, y) {
  const width = 8192;
  const height = 4096;
  const base = samplePlanet(x, y, width, height);
  const hydro = sampleHydrology(x, y, width, height);
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

function initialLexicon(rng) {
  const lexicon = {};
  for (const concept of ['food', 'water', 'danger', 'home', 'kin']) lexicon[concept] = generateWord(rng, concept);
  return lexicon;
}

function generateWord(rng, salt = '') {
  const consonants = ['k', 't', 'm', 'n', 's', 'r', 'l', 'p', 'v', 'h', 'g', 'd'];
  const vowels = ['a', 'e', 'i', 'o', 'u', 'ai', 'au'];
  const syllables = 1 + Math.floor(rng() * 3);
  let word = '';
  for (let index = 0; index < syllables; index++) {
    const offset = (hashString(salt) + index) % consonants.length;
    word += consonants[(Math.floor(rng() * consonants.length) + offset) % consonants.length];
    word += vowels[Math.floor(rng() * vowels.length)];
    if (rng() < 0.18) word += consonants[Math.floor(rng() * consonants.length)];
  }
  return word;
}

function mutateWord(word, rng, amount) {
  if (rng() > amount || !word) return word;
  const sounds = 'aeiouktsmnrplvhgd';
  const index = Math.floor(rng() * word.length);
  if (rng() < 0.33 && word.length > 2) return word.slice(0, index) + word.slice(index + 1);
  if (rng() < 0.66) return word.slice(0, index) + sounds[Math.floor(rng() * sounds.length)] + word.slice(index + 1);
  return word.slice(0, index) + sounds[Math.floor(rng() * sounds.length)] + word.slice(index);
}

function mutateLexicon(lexicon, rng, amount) {
  return Object.fromEntries(Object.entries(lexicon || {}).map(([concept, word]) => [concept, mutateWord(word, rng, amount)]));
}

function mutateNorms(norms, rng, amount) {
  return Object.fromEntries(Object.entries(norms).map(([key, value]) => [key, clamp(value + (rng() - 0.5) * amount * 2, 0, 1)]));
}

function compareLanguages(aId, bId) {
  if (!aId || !bId) return 0;
  if (aId === bId) return 1;
  return String(aId).split('-')[1] === String(bId).split('-')[1] ? 0.45 : 0.18;
}

function compareCultures(aId, bId) {
  if (!aId || !bId) return 0;
  if (aId === bId) return 1;
  return 0.25;
}

function blendLanguages() {}
function technologyTransferPossible() { return true; }
function routeContact() { return 0.2; }
function routeTrade() { return 0.1; }
function routeKnowledge() { return 0.08; }
function resourceComplementarity(a, b) {
  return clamp((Math.abs(a.environment.plantAccess - b.environment.plantAccess) + Math.abs(a.environment.materials - b.environment.materials) + Math.abs(a.water - b.water)) / 2.2, 0.08, 1);
}
function cultureOf(community) {
  return { norms: { hierarchy: community.conflict || 0, cooperation: community.stability || 0.4 } };
}

function createNodeName(prefix, id, speciesId) {
  return `${prefix} ${String(speciesId || id).replace(/[-_]/g, ' ').slice(0, 13)} ${String(id).split('-').pop()}`;
}
function settlementName(id, language) { return createNodeName('Hearth', id, language?.name); }
function languageName(id, speciesId) { return createNodeName('Tongue', id, speciesId); }
function cultureName(id, speciesId) { return createNodeName('Tradition', id, speciesId); }
function polityName(id, community) { return createNodeName('League', id, community?.name); }

function nodeAttributes(community) {
  return { x: community.x, y: community.y, population: community.population, languageId: community.languageId, cultureId: community.cultureId, polityId: community.polityId, status: community.status };
}
function routeAttributes(route) { return { kind: route.kind, trust: route.trust, hostility: route.hostility, flow: route.flow, migration: route.migration, knowledge: route.knowledge }; }
function edgeId(a, b) { return [a, b].sort().join('::'); }

function serializeCommunity(community) {
  return { ...community, members: [...community.members], technologies: [...community.technologies], buildings: [...community.buildings], environment: { ...community.environment }, roles: { ...community.roles }, history: [...community.history], inventions: [...community.inventions] };
}
function serializeMind(mind) {
  return { entityId: mind.entityId, creatureId: mind.creatureId, role: mind.role, speciesId: mind.speciesId, communityId: mind.communityId, cultureId: mind.cultureId, languageId: mind.languageId, biases: { ...mind.biases }, associations: [...mind.associations], lexicon: [...mind.lexicon], episodes: mind.episodes.slice(-30), skills: [...mind.skills], status: mind.status, prestige: mind.prestige };
}

function nearbyRole() { return false; }
function strongestSkill(mind) { return [...mind.skills.entries()].sort((a, b) => b[1] - a[1])[0] || null; }
function leadershipScore(mind, culture) { return mind.prestige * 0.4 + mind.genome.communication * 0.23 + mind.genome.intelligence * 0.22 + culture.norms.hierarchy * mind.genome.aggression * 0.15; }
function trimMind(mind) { if (mind.episodes.length > 36) mind.episodes.splice(0, mind.episodes.length - 36); if (mind.associations.size > 28) mind.associations.delete([...mind.associations.keys()][0]); }
function weightedChoice(items, rng) { const total = items.reduce((sum, item) => sum + Math.max(0, item[1]), 0); let roll = rng() * total; for (const [value, weight] of items) { roll -= Math.max(0, weight); if (roll <= 0) return value; } return items[0]?.[0] || 'food'; }
function mostCommon(values) { if (!values.length) return null; const counts = new Map(); for (const value of values) counts.set(value, (counts.get(value) || 0) + 1); return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]; }
function average(values) { const finite = values.filter(Number.isFinite); return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : 0; }
function torusDistance(a, b, width, height) { const bx = b.x ?? b.centroidX ?? 0; const by = b.y ?? b.centroidY ?? 0; const dx = shortest(bx - a.x, width); const dy = shortest(by - a.y, height); return dx * dx + dy * dy; }
function shortest(delta, period) { if (delta > period * 0.5) return delta - period; if (delta < -period * 0.5) return delta + period; return delta; }
function hashString(text) { let hash = 2166136261; for (let index = 0; index < String(text).length; index++) { hash ^= String(text).charCodeAt(index); hash = Math.imul(hash, 16777619); } return hash >>> 0; }
function mulberry32(seed) { let value = seed >>> 0; return () => { value += 0x6D2B79F5; let result = value; result = Math.imul(result ^ result >>> 15, result | 1); result ^= result + Math.imul(result ^ result >>> 7, result | 61); return ((result ^ result >>> 14) >>> 0) / 4294967296; }; }
const wrap = (value, max) => ((value % max) + max) % max;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
