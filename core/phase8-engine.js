const XSTATE_SOURCES = [
  'https://cdn.jsdelivr.net/npm/xstate@5.32.5/+esm',
  'https://esm.sh/xstate@5.32.5',
];

const COMMODITIES = ['food', 'timber', 'ore', 'metal', 'tools', 'medicine', 'energy', 'machines'];
const INSTITUTION_STATES = ['informal', 'council', 'administration', 'federal', 'reform', 'crisis', 'revolution', 'collapsed'];
const DISCOVERIES = [
  ['measurement', [], 0.34, ['literacy', 'knowledge', 'research']],
  ['mathematics', ['measurement'], 0.42, ['literacy', 'knowledge', 'research']],
  ['medicine', ['measurement'], 0.44, ['disease', 'knowledge', 'health']],
  ['navigation', ['measurement'], 0.48, ['trade', 'knowledge', 'transport']],
  ['mechanics', ['mathematics'], 0.52, ['industry', 'materials', 'research']],
  ['steam-engines', ['mechanics'], 0.58, ['industry', 'energy', 'materials']],
  ['electricity', ['mathematics', 'mechanics'], 0.64, ['experiments', 'industry', 'research']],
  ['communications', ['electricity'], 0.68, ['literacy', 'infrastructure', 'research']],
  ['computation', ['communications', 'mathematics'], 0.72, ['research', 'industry', 'knowledge']],
  ['automation', ['computation', 'steam-engines'], 0.76, ['industry', 'energy', 'capital']],
  ['astronomy', ['measurement', 'mathematics'], 0.58, ['research', 'literacy', 'stability']],
  ['rocketry', ['astronomy', 'mechanics', 'steam-engines'], 0.79, ['industry', 'energy', 'research']],
  ['orbital-flight', ['rocketry', 'computation'], 0.84, ['industry', 'capital', 'stability']],
  ['satellites', ['orbital-flight', 'communications'], 0.86, ['research', 'capital', 'infrastructure']],
  ['space-stations', ['satellites', 'automation'], 0.9, ['industry', 'energy', 'capital']],
  ['interplanetary-probes', ['orbital-flight', 'navigation'], 0.89, ['research', 'capital', 'stability']],
  ['offworld-colonies', ['space-stations', 'interplanetary-probes'], 0.94, ['industry', 'energy', 'foodSecurity']],
  ['interstellar-attempts', ['offworld-colonies', 'automation'], 0.975, ['research', 'energy', 'capital']],
];

export function createPhase8Engine(world, civilization, orbitalSystem, groundLevel, options = {}) {
  const mobile = options.mobile ?? matchMedia('(max-width: 720px), (pointer: coarse)').matches;
  const rng = mulberry32(options.seed ?? 0xA8E2026);
  const institutions = new Map();
  const economies = new Map();
  const sciences = new Map();
  const cities = new Map();
  const pathogens = new Map();
  const outbreaks = new Map();
  const transports = new Map();
  const missions = new Map();
  const events = [];
  const restored = {
    institutions: new Map(), economies: new Map(), sciences: new Map(), cities: new Map(),
  };
  let XState = null;
  let elapsed = 0;
  let institutionClock = 0;
  let economyClock = 0;
  let scienceClock = 0;
  let diseaseClock = 0;
  let cityClock = 0;
  let spaceClock = 0;
  let nextPathogen = 1;
  let nextMission = 1;
  let nextEvent = 1;
  let destroyed = false;
  const hud = createHud();

  async function initialize({ provideCapability }) {
    XState = await loadXState();
    provideCapability('institutions.statecharts', api);
    provideCapability('economy.production', api);
    provideCapability('science.discovery', api);
    provideCapability('health.epidemiology', api);
    provideCapability('cities.infrastructure', api);
    provideCapability('spaceflight.emergent', api);
  }

  function step(dt) {
    if (destroyed) return;
    elapsed += Math.max(0, dt);
    institutionClock += dt;
    economyClock += dt;
    scienceClock += dt;
    diseaseClock += dt;
    cityClock += dt;
    spaceClock += dt;
    synchronize();

    if (institutionClock >= (mobile ? 3 : 1.8)) {
      institutionCycle(institutionClock);
      institutionClock = 0;
    }
    if (economyClock >= (mobile ? 1.5 : 0.9)) {
      economyCycle(economyClock);
      economyClock = 0;
    }
    if (scienceClock >= (mobile ? 2.8 : 1.65)) {
      scienceCycle(scienceClock);
      scienceClock = 0;
    }
    if (diseaseClock >= (mobile ? 1.6 : 0.95)) {
      diseaseCycle(diseaseClock);
      diseaseClock = 0;
    }
    if (cityClock >= (mobile ? 3.4 : 2.1)) {
      cityCycle(cityClock);
      cityClock = 0;
    }
    if (spaceClock >= (mobile ? 5 : 3)) {
      transportAndSpaceCycle(spaceClock);
      spaceClock = 0;
    }
  }

  function synchronize() {
    const active = new Set();
    for (const community of civilization.getCommunities?.() || []) {
      active.add(community.id);
      if (!institutions.has(community.id)) institutions.set(community.id, makeInstitution(community));
      if (!economies.has(community.id)) economies.set(community.id, makeEconomy(community));
      if (!sciences.has(community.id)) sciences.set(community.id, makeScience(community));
      if (!cities.has(community.id)) cities.set(community.id, makeCity(community));
      const city = cities.get(community.id);
      city.x = community.x;
      city.y = community.y;
      city.population = community.population;
      city.status = community.status;
      for (const record of [institutions.get(community.id), economies.get(community.id), sciences.get(community.id), city]) record.inactive = false;
    }
    for (const map of [institutions, economies, sciences, cities]) {
      for (const [id, record] of map) if (!active.has(id)) record.inactive = true;
    }
  }

  function makeInstitution(community) {
    const prior = take(restored.institutions, community.id);
    const record = {
      id: community.id,
      state: prior?.state || 'informal',
      legitimacy: prior?.legitimacy ?? clamp(community.stability * 0.55 + 0.2, 0, 1),
      trust: prior?.trust ?? clamp(community.stability * 0.6 + community.trade * 0.08, 0, 1),
      corruption: prior?.corruption ?? 0.05,
      factionalism: prior?.factionalism ?? 0.12,
      coercion: prior?.coercion ?? 0.05,
      taxRate: prior?.taxRate ?? 0.04,
      publicServices: prior?.publicServices ?? 0.06,
      researchSupport: prior?.researchSupport ?? 0,
      healthSupport: prior?.healthSupport ?? 0,
      military: prior?.military ?? 0,
      legalCapacity: prior?.legalCapacity ?? 0,
      administrativeCapacity: prior?.administrativeCapacity ?? 0,
      reforms: prior?.reforms || 0,
      revolutions: prior?.revolutions || 0,
      factions: prior?.factions || makeFactions(community),
      actor: null,
      inactive: false,
    };
    record.actor = makeInstitutionActor(record.state);
    return record;
  }

  function makeInstitutionActor(initial) {
    if (!XState?.createMachine || !XState?.createActor) return null;
    try {
      const machine = XState.createMachine({
        id: 'institution',
        initial: INSTITUTION_STATES.includes(initial) ? initial : 'informal',
        states: {
          informal: { on: { ORGANIZE: 'council', CRISIS: 'crisis', COLLAPSE: 'collapsed' } },
          council: { on: { ADMINISTER: 'administration', FEDERATE: 'federal', REFORM: 'reform', CRISIS: 'crisis', REVOLT: 'revolution', COLLAPSE: 'collapsed' } },
          administration: { on: { FEDERATE: 'federal', REFORM: 'reform', CRISIS: 'crisis', REVOLT: 'revolution', COLLAPSE: 'collapsed' } },
          federal: { on: { REFORM: 'reform', CRISIS: 'crisis', REVOLT: 'revolution', COLLAPSE: 'collapsed' } },
          reform: { on: { STABILIZE: 'administration', FEDERATE: 'federal', FAIL: 'crisis', COLLAPSE: 'collapsed' } },
          crisis: { on: { REFORM: 'reform', REVOLT: 'revolution', RECOVER: 'council', COLLAPSE: 'collapsed' } },
          revolution: { on: { STABILIZE: 'council', AUTHORITARIAN: 'administration', COLLAPSE: 'collapsed' } },
          collapsed: { on: { RECOVER: 'informal' } },
        },
      });
      const actor = XState.createActor(machine);
      actor.start();
      if (initial !== 'informal') actor.send({ type: pathToState(initial) });
      return actor;
    } catch (error) {
      console.warn('XState actor fallback enabled.', error);
      return null;
    }
  }

  function makeEconomy(community) {
    const prior = take(restored.economies, community.id);
    return {
      id: community.id,
      inventory: { food: community.food || 0.4, timber: 0.2, ore: 0.12, metal: 0, tools: 0.05, medicine: 0, energy: 0.1, machines: 0, ...(prior?.inventory || {}) },
      prices: { ...Object.fromEntries(COMMODITIES.map(item => [item, 1])), ...(prior?.prices || {}) },
      output: prior?.output ?? 0.1,
      capital: prior?.capital ?? 0.08,
      wages: prior?.wages ?? 1,
      unemployment: prior?.unemployment ?? 0.08,
      inequality: prior?.inequality ?? 0.18,
      wealth: prior?.wealth ?? Math.max(0.1, community.population * 0.04),
      taxRevenue: prior?.taxRevenue ?? 0,
      publicWorks: prior?.publicWorks ?? 0,
      debt: prior?.debt ?? 0,
      crisis: prior?.crisis || null,
      tradeShock: prior?.tradeShock ?? 0,
      labor: prior?.labor || {},
      inactive: false,
    };
  }

  function makeScience(community) {
    const prior = take(restored.sciences, community.id);
    return {
      id: community.id,
      discoveries: new Set(prior?.discoveries || []),
      knowledge: prior?.knowledge ?? community.knowledge ?? 0.08,
      experiments: prior?.experiments ?? 0,
      failures: prior?.failures ?? 0,
      observations: prior?.observations ?? 0.04,
      literacy: prior?.literacy ?? (community.technologies?.includes('writing') ? 0.35 : 0.05),
      medicine: prior?.medicine ?? 0,
      engineering: prior?.engineering ?? 0,
      astronomy: prior?.astronomy ?? 0,
      inactive: false,
    };
  }

  function makeCity(community) {
    const prior = take(restored.cities, community.id);
    return {
      id: community.id,
      x: community.x,
      y: community.y,
      population: community.population,
      status: community.status,
      urbanization: prior?.urbanization ?? clamp(community.population / 30, 0.02, 0.5),
      infrastructure: prior?.infrastructure ?? 0.05,
      housing: prior?.housing ?? 0.2,
      sanitation: prior?.sanitation ?? 0,
      defenses: prior?.defenses ?? 0,
      port: prior?.port ?? 0,
      airport: prior?.airport ?? 0,
      powerGrid: prior?.powerGrid ?? 0,
      districts: prior?.districts || ['residential', 'market'],
      archaeologicalLayers: prior?.archaeologicalLayers || [],
      pollution: prior?.pollution ?? 0,
      emissions: prior?.emissions ?? 0,
      deforestation: prior?.deforestation ?? 0,
      soilLoss: prior?.soilLoss ?? 0,
      conservation: prior?.conservation ?? 0,
      disasterRisk: prior?.disasterRisk ?? 0.08,
      inactive: false,
    };
  }

  function institutionCycle(dt) {
    const communities = communityMap();
    for (const [id, institution] of institutions) {
      const community = communities.get(id);
      if (!community || community.status === 'abandoned') continue;
      const economy = economies.get(id);
      const science = sciences.get(id);
      const scarcity = clamp(1 - economy.inventory.food, 0, 1);
      const disease = outbreakPressure(id);
      const conflict = mean(routesFor(id).map(route => route.kind === 'conflict' ? route.hostility || 0.5 : 0));
      const complexity = clamp(community.population / 40 * 0.35 + science.literacy * 0.22 + community.trade * 0.15 + community.technologies.length * 0.025, 0, 1.5);
      institution.trust = clamp(institution.trust + dt * (community.stability * 0.008 + institution.publicServices * 0.012 - institution.corruption * 0.014 - scarcity * 0.009 - disease * 0.006), 0, 1);
      institution.legitimacy = clamp(institution.legitimacy + dt * (institution.trust * 0.008 + institution.legalCapacity * 0.004 - institution.coercion * 0.005 - institution.factionalism * 0.007), 0, 1);
      institution.corruption = clamp(institution.corruption + dt * (institution.administrativeCapacity * 0.002 + institution.taxRate * 0.004 - institution.legalCapacity * 0.006), 0, 1);
      institution.factionalism = clamp(institution.factionalism + dt * (scarcity * 0.008 + conflict * 0.012 + economy.inequality * 0.006 - institution.trust * 0.005), 0, 1);
      institution.administrativeCapacity = clamp(institution.administrativeCapacity + dt * (science.literacy * 0.005 + complexity * 0.003 + economy.capital * 0.0008), 0, 1);
      institution.legalCapacity = clamp(institution.legalCapacity + dt * (science.literacy * institution.trust * 0.004 - institution.corruption * 0.002), 0, 1);
      institution.researchSupport = clamp(institution.researchSupport + dt * (science.knowledge * institution.trust * 0.0015 - scarcity * 0.002), 0, 1);
      institution.healthSupport = clamp(institution.healthSupport + dt * (disease * 0.007 + science.medicine * 0.002 - institution.corruption * 0.002), 0, 1);
      institution.military = clamp(institution.military + dt * (conflict * 0.01 + institution.coercion * 0.002 - institution.trust * 0.001), 0, 1);
      institution.taxRate = clamp(institution.taxRate + dt * ((institution.publicServices + institution.military + institution.researchSupport) * 0.0015 - institution.legitimacy * 0.0005), 0.02, 0.42);
      institution.publicServices = clamp(institution.publicServices + dt * (economy.taxRevenue * 0.002 - institution.corruption * 0.003), 0, 1);

      const before = institutionState(institution);
      transitionInstitution(institution, chooseInstitutionEvent(institution, community, complexity, scarcity, conflict));
      institution.state = institutionState(institution);
      if (before !== institution.state) {
        if (institution.state === 'reform') institution.reforms++;
        if (institution.state === 'revolution') institution.revolutions++;
        record('Institutional transition', `${community.name} changed from ${before} to ${institution.state} through legitimacy, scarcity, knowledge, and faction pressure.`, 'institution', id);
      }
    }
  }

  function economyCycle(dt) {
    const communities = communityMap();
    for (const [id, economy] of economies) {
      const community = communities.get(id);
      if (!community || community.status === 'abandoned') continue;
      const institution = institutions.get(id);
      const science = sciences.get(id);
      const city = cities.get(id);
      const population = Math.max(1, community.population);
      const availableLabor = population * clamp(1 - outbreakPressure(id) * 0.45, 0.35, 1);
      const automation = science.discoveries.has('automation') ? 0.55 : 0;
      const metallurgy = community.technologies.includes('metallurgy') ? 0.5 : 0;
      const agriculture = community.technologies.includes('agriculture') ? 0.45 : 0;
      economy.labor = {
        agriculture: availableLabor * (0.26 + clamp(1 - economy.inventory.food, 0, 1) * 0.12),
        extraction: availableLabor * (0.12 + economy.capital * 0.002),
        manufacturing: availableLabor * (0.08 + metallurgy * 0.12 + automation * 0.08),
        services: availableLabor * (0.1 + city.urbanization * 0.18),
        research: availableLabor * clamp(institution.researchSupport * 0.12 + science.literacy * 0.04, 0.01, 0.18),
        health: availableLabor * clamp(institution.healthSupport * 0.1 + outbreakPressure(id) * 0.08, 0.01, 0.16),
      };
      economy.unemployment = clamp(1 - Object.values(economy.labor).reduce((sum, value) => sum + value, 0) / Math.max(0.01, availableLabor), 0, 0.65);
      const environmental = clamp(1 - city.soilLoss * 0.5 - city.pollution * 0.15, 0.2, 1);
      const output = {
        food: economy.labor.agriculture * 0.025 * (1 + agriculture) * environmental,
        timber: economy.labor.extraction * 0.009 * (1 - city.deforestation * 0.55),
        ore: economy.labor.extraction * 0.007 * (1 + metallurgy * 0.35),
        metal: Math.min(economy.inventory.ore, economy.labor.manufacturing * 0.006 * (0.3 + metallurgy)),
        tools: Math.min(economy.inventory.metal + 0.01, economy.labor.manufacturing * 0.004 * (0.4 + metallurgy)),
        energy: economy.labor.manufacturing * 0.003 * (science.discoveries.has('electricity') ? 1.7 : science.discoveries.has('steam-engines') ? 0.8 : 0.2),
        machines: economy.labor.manufacturing * 0.0025 * (automation + (science.discoveries.has('steam-engines') ? 0.35 : 0)),
        medicine: economy.labor.health * 0.003 * (0.2 + science.medicine),
      };
      economy.inventory.food = clamp(economy.inventory.food + dt * (output.food - population * 0.012), 0, 20);
      economy.inventory.timber = clamp(economy.inventory.timber + dt * (output.timber - city.infrastructure * 0.004), 0, 20);
      economy.inventory.ore = clamp(economy.inventory.ore + dt * (output.ore - output.metal), 0, 20);
      economy.inventory.metal = clamp(economy.inventory.metal + dt * (output.metal - output.tools * 0.7), 0, 20);
      economy.inventory.tools = clamp(economy.inventory.tools + dt * (output.tools - population * 0.0008), 0, 20);
      economy.inventory.energy = clamp(economy.inventory.energy + dt * (output.energy - city.powerGrid * 0.01), 0, 30);
      economy.inventory.machines = clamp(economy.inventory.machines + dt * (output.machines - automation * 0.002), 0, 20);
      economy.inventory.medicine = clamp(economy.inventory.medicine + dt * (output.medicine - outbreakPressure(id) * population * 0.001), 0, 15);

      const demand = {
        food: population * 0.03, timber: city.infrastructure * 0.12, ore: economy.labor.manufacturing * 0.008,
        metal: city.infrastructure * 0.08, tools: population * 0.006, medicine: outbreakPressure(id) * population * 0.015,
        energy: city.powerGrid * 0.18 + economy.labor.manufacturing * 0.005, machines: automation * population * 0.004,
      };
      for (const commodity of COMMODITIES) {
        const scarcity = demand[commodity] / Math.max(0.02, economy.inventory[commodity]);
        economy.prices[commodity] = clamp(economy.prices[commodity] * 0.86 + scarcity * 0.14 + economy.tradeShock * 0.08, 0.12, 12);
      }
      economy.output = clamp(Object.values(output).reduce((sum, value) => sum + value, 0), 0, 100);
      economy.wages = clamp(economy.wages + dt * (economy.output / population * 0.02 - economy.unemployment * 0.015), 0.15, 8);
      economy.wealth = clamp(economy.wealth + dt * (economy.output * 0.08 + routeTrade(id) * 0.04 - population * 0.002), 0, 1000);
      economy.capital = clamp(economy.capital + dt * (economy.output * 0.018 + economy.wealth * 0.0004 - economy.debt * 0.001), 0, 100);
      economy.inequality = clamp(economy.inequality + dt * (economy.capital * 0.0006 + economy.unemployment * 0.008 - institution.publicServices * 0.008 - institution.taxRate * 0.004), 0.02, 0.95);
      economy.taxRevenue = economy.output * institution.taxRate * (1 - institution.corruption * 0.6);
      economy.publicWorks = clamp(economy.publicWorks + dt * (economy.taxRevenue * 0.025 - city.infrastructure * 0.002), 0, 10);
      economy.tradeShock *= 0.94;
      const crisis = economy.inventory.food < 0.08 && economy.prices.food > 4 ? 'famine' : economy.debt > economy.wealth * 1.4 + 2 ? 'debt-crisis' : economy.unemployment > 0.48 ? 'unemployment-crisis' : null;
      if (crisis && crisis !== economy.crisis) record('Economic crisis', `${community.name} entered a ${crisis} after production, price, and labor shocks.`, 'economy', id);
      economy.crisis = crisis;
    }
    tradeCycle(dt);
  }

  function tradeCycle(dt) {
    for (const route of civilization.getRoutes?.() || []) {
      if (!['trade', 'alliance'].includes(route.kind)) continue;
      const a = economies.get(route.from);
      const b = economies.get(route.to);
      if (!a || !b) continue;
      for (const commodity of COMMODITIES) {
        const difference = a.prices[commodity] - b.prices[commodity];
        if (Math.abs(difference) < 0.18) continue;
        const source = difference > 0 ? b : a;
        const target = source === a ? b : a;
        const amount = Math.min(source.inventory[commodity] * 0.04, Math.abs(difference) * (route.flow || 0.1) * dt * 0.02);
        source.inventory[commodity] = Math.max(0, source.inventory[commodity] - amount);
        target.inventory[commodity] += amount * (1 - transportCost(route));
        source.wealth += amount * target.prices[commodity] * 0.2;
        target.wealth = Math.max(0, target.wealth - amount * target.prices[commodity] * 0.18);
      }
    }
  }

  function scienceCycle(dt) {
    const communities = communityMap();
    for (const [id, science] of sciences) {
      const community = communities.get(id);
      if (!community || community.status === 'abandoned') continue;
      const institution = institutions.get(id);
      const economy = economies.get(id);
      science.literacy = clamp(science.literacy + dt * ((community.technologies.includes('writing') ? 0.004 : 0.0005) + institution.publicServices * 0.002), 0, 1);
      science.observations = clamp(science.observations + dt * (science.literacy * 0.004 + routeKnowledge(id) * 0.002), 0, 10);
      const experimentCapacity = (economy.labor.research || 0) * 0.01 + institution.researchSupport * 0.12 + science.literacy * 0.05;
      science.experiments += dt * experimentCapacity;
      science.knowledge = clamp(science.knowledge + dt * (experimentCapacity * 0.012 + science.observations * 0.0008 + routeKnowledge(id) * 0.004), 0, 10);
      if (rng() < dt * experimentCapacity * 0.025 && rng() > clamp(0.35 + science.knowledge * 0.04 + science.literacy * 0.2, 0.15, 0.9)) science.failures++;
      const factors = scienceFactors(id, community);
      for (const [discovery, prerequisites, threshold, keys] of DISCOVERIES) {
        if (science.discoveries.has(discovery) || !prerequisites.every(item => science.discoveries.has(item))) continue;
        const score = mean(keys.map(key => factors[key] || 0));
        if (score < threshold) continue;
        const probability = clamp((score - threshold + 0.025) * (science.experiments * 0.005 + science.knowledge * 0.012 + institution.researchSupport * 0.08) * dt, 0, 0.22);
        if (rng() > probability) continue;
        science.discoveries.add(discovery);
        if (discovery === 'medicine') science.medicine = Math.max(science.medicine, 0.35);
        if (['mechanics', 'steam-engines', 'electricity', 'automation'].includes(discovery)) science.engineering = clamp(science.engineering + 0.2, 0, 1);
        if (['astronomy', 'rocketry', 'orbital-flight'].includes(discovery)) science.astronomy = clamp(science.astronomy + 0.25, 0, 1);
        record('Scientific discovery', `${community.name} discovered ${discovery} through observation, experiments, failures, institutions, and exchange.`, 'science', id);
        break;
      }
      science.medicine = clamp(science.medicine + dt * (science.discoveries.has('medicine') ? institution.healthSupport * 0.003 + science.knowledge * 0.0005 : 0), 0, 1);
    }
  }

  function scienceFactors(id, community) {
    const science = sciences.get(id);
    const economy = economies.get(id);
    const city = cities.get(id);
    const institution = institutions.get(id);
    return {
      literacy: science.literacy,
      knowledge: clamp(science.knowledge / 4, 0, 1),
      research: clamp(institution.researchSupport + (economy.labor.research || 0) / Math.max(1, community.population), 0, 1),
      disease: outbreakPressure(id),
      health: institution.healthSupport,
      trade: clamp(community.trade / 2, 0, 1),
      transport: transportCapacity(id),
      industry: clamp(economy.output / 8, 0, 1),
      materials: clamp((economy.inventory.ore + economy.inventory.metal + economy.inventory.tools) / 6, 0, 1),
      energy: clamp(economy.inventory.energy / 8, 0, 1),
      experiments: clamp(science.experiments / 8, 0, 1),
      infrastructure: clamp(city.infrastructure, 0, 1),
      capital: clamp(economy.capital / 12, 0, 1),
      stability: community.stability,
      foodSecurity: clamp(economy.inventory.food / Math.max(0.2, community.population * 0.04), 0, 1),
    };
  }

  function diseaseCycle(dt) {
    const communities = communityMap();
    if (!pathogens.size && communities.size && rng() < dt * 0.002) createPathogen([...communities.keys()][Math.floor(rng() * communities.size)]);
    for (const [key, outbreak] of outbreaks) {
      const community = communities.get(outbreak.communityId);
      const pathogen = pathogens.get(outbreak.pathogenId);
      if (!community || !pathogen || community.status === 'abandoned') continue;
      const city = cities.get(community.id);
      const science = sciences.get(community.id);
      const institution = institutions.get(community.id);
      const economy = economies.get(community.id);
      const population = Math.max(1, community.population);
      const susceptible = clamp(1 - outbreak.immune / population, 0, 1);
      const density = clamp(population / Math.max(3, city.housing * 40 + 5), 0.2, 3);
      const sanitation = clamp(city.sanitation + institution.healthSupport * 0.3, 0, 1);
      const medicine = clamp(science.medicine + economy.inventory.medicine * 0.04, 0, 1);
      const quarantine = outbreak.quarantine ? 0.42 : 0;
      const newCases = Math.min(population - outbreak.infected, outbreak.infected * pathogen.transmission * density * susceptible * (1 - sanitation * 0.55 - quarantine) * dt * 0.06 + 0.005);
      const recoveries = outbreak.infected * (pathogen.recovery + medicine * 0.08) * dt;
      const deaths = outbreak.infected * pathogen.lethality * (1 - medicine * 0.65) * dt * 0.015;
      outbreak.infected = clamp(outbreak.infected + newCases - recoveries - deaths, 0, population);
      outbreak.recovered = clamp(outbreak.recovered + recoveries, 0, population);
      outbreak.immune = clamp(outbreak.immune + recoveries * pathogen.immunity, 0, population);
      outbreak.deaths += deaths;
      outbreak.quarantine = outbreak.infected / population > 0.18 && institution.legitimacy > 0.3 && institution.healthSupport > 0.18;
      economy.inventory.medicine = Math.max(0, economy.inventory.medicine - outbreak.infected * dt * 0.0008);
      if (outbreak.infected < 0.01) {
        outbreaks.delete(key);
        record('Outbreak ends', `${pathogen.name} subsided in ${community.name} after immunity, behavior, and health measures changed transmission.`, 'health', community.id);
      } else spreadDisease(outbreak, pathogen, dt);
    }
    if (communities.size && rng() < dt * (0.001 + (world.globals.civilizationPressure || 0) * 0.00003)) createPathogen([...communities.keys()][Math.floor(rng() * communities.size)]);
  }

  function createPathogen(communityId, overrides = {}) {
    if (!communityId) return null;
    const id = `pathogen-${nextPathogen++}`;
    const pathogen = {
      id,
      name: overrides.name || `Strain ${id.split('-').pop()}`,
      transmission: overrides.transmission ?? (0.16 + rng() * 0.35),
      lethality: overrides.lethality ?? (0.01 + rng() * 0.12),
      recovery: overrides.recovery ?? (0.025 + rng() * 0.08),
      immunity: overrides.immunity ?? (0.35 + rng() * 0.55),
      animalReservoir: overrides.animalReservoir ?? (rng() < 0.55),
      createdAt: elapsed,
    };
    pathogens.set(id, pathogen);
    outbreaks.set(`${communityId}:${id}`, { communityId, pathogenId: id, infected: 0.3, recovered: 0, immune: 0, deaths: 0, quarantine: false, startedAt: elapsed });
    record('Pathogen emerges', `${pathogen.name} entered ${communityName(communityId)} from mutation, density, trade, or an animal reservoir.`, 'health', communityId);
    return pathogen;
  }

  function spreadDisease(outbreak, pathogen, dt) {
    for (const route of routesFor(outbreak.communityId)) {
      const target = route.from === outbreak.communityId ? route.to : route.from;
      if (outbreaks.has(`${target}:${pathogen.id}`)) continue;
      const mode = transports.get(route.id)?.mode || 'land';
      const multiplier = mode === 'air' ? 1.8 : mode === 'sea' ? 1.25 : 1;
      if (rng() < dt * (route.flow || 0) * pathogen.transmission * multiplier * 0.004) {
        outbreaks.set(`${target}:${pathogen.id}`, { communityId: target, pathogenId: pathogen.id, infected: 0.08, recovered: 0, immune: 0, deaths: 0, quarantine: false, startedAt: elapsed });
        record('Disease spreads', `${pathogen.name} reached ${communityName(target)} through the transport network.`, 'health', target);
      }
    }
  }

  function cityCycle(dt) {
    const communities = communityMap();
    let emissions = 0;
    let pollution = 0;
    for (const [id, city] of cities) {
      const community = communities.get(id);
      if (!community || community.status === 'abandoned') continue;
      const economy = economies.get(id);
      const institution = institutions.get(id);
      const science = sciences.get(id);
      const populationPressure = clamp(community.population / 30, 0, 2);
      const industry = clamp(economy.output / 20 + (economy.labor.manufacturing || 0) / Math.max(1, community.population), 0, 2);
      city.urbanization = clamp(city.urbanization + dt * (populationPressure * 0.004 + economy.wealth * 0.00004 - city.pollution * 0.001), 0.02, 1.5);
      city.infrastructure = clamp(city.infrastructure + dt * (economy.publicWorks * 0.003 + economy.inventory.tools * 0.0008 + economy.inventory.machines * 0.0012 - city.disasterRisk * 0.001), 0, 1.5);
      city.housing = clamp(city.housing + dt * (city.infrastructure * 0.002 + economy.inventory.timber * 0.0008 - populationPressure * 0.0015), 0.05, 1.5);
      city.sanitation = clamp(city.sanitation + dt * ((science.discoveries.has('medicine') ? 0.0015 : 0) + institution.healthSupport * 0.003 + city.infrastructure * 0.001 - city.urbanization * 0.001), 0, 1);
      city.defenses = clamp(city.defenses + dt * (institution.military * economy.publicWorks * 0.002 - institution.trust * 0.0003), 0, 1);
      city.port = clamp(city.port + dt * (science.discoveries.has('navigation') && community.trade > 0.2 ? city.infrastructure * 0.0015 : 0), 0, 1);
      city.airport = clamp(city.airport + dt * (science.discoveries.has('automation') && science.discoveries.has('navigation') ? city.infrastructure * 0.0008 : 0), 0, 1);
      city.powerGrid = clamp(city.powerGrid + dt * (science.discoveries.has('electricity') ? economy.inventory.energy * 0.0008 + city.infrastructure * 0.001 : 0), 0, 1.2);
      city.pollution = clamp(city.pollution + dt * (industry * 0.004 + city.urbanization * 0.001 - city.conservation * 0.003), 0, 1.5);
      city.emissions = clamp(city.emissions + dt * (industry * (science.discoveries.has('steam-engines') ? 0.004 : 0.001) - city.conservation * 0.002), 0, 2);
      city.deforestation = clamp(city.deforestation + dt * ((economy.labor.extraction || 0) / Math.max(1, community.population) * 0.002 - city.conservation * 0.0015), 0, 1);
      city.soilLoss = clamp(city.soilLoss + dt * (city.deforestation * 0.0015 + populationPressure * 0.0008 - city.conservation * 0.001), 0, 1);
      city.conservation = clamp(city.conservation + dt * (city.pollution > 0.55 && institution.trust > 0.42 ? institution.publicServices * 0.0018 : 0), 0, 1);
      city.disasterRisk = clamp(0.06 + city.soilLoss * 0.25 + city.pollution * 0.12 + city.urbanization * 0.05 - city.infrastructure * 0.08, 0.02, 0.8);
      expandDistricts(city, science, economy);
      if (rng() < dt * city.disasterRisk * 0.0015) {
        const loss = clamp(0.04 + city.disasterRisk * 0.2, 0.04, 0.3);
        city.infrastructure = Math.max(0, city.infrastructure - loss);
        city.housing = Math.max(0.04, city.housing - loss * 0.7);
        economy.inventory.food *= 1 - loss * 0.6;
        city.archaeologicalLayers.push({ at: elapsed, type: 'disaster-layer', severity: loss });
        if (city.archaeologicalLayers.length > 30) city.archaeologicalLayers.shift();
        record('Urban disaster', `${community.name} accumulated a new archaeological layer after infrastructure and environmental risk combined.`, 'city', id);
      }
      emissions += city.emissions * community.population;
      pollution += city.pollution;
    }
    world.globals.industrialEmissions = clamp(emissions * 0.0002, 0, 2);
    world.globals.industrialPollution = clamp(pollution, 0, 25);
    world.globals.anthropogenicImpact = clamp((world.globals.anthropogenicImpact || 0) + world.globals.industrialEmissions * 0.002, 0, 1);
  }

  function transportAndSpaceCycle(dt) {
    for (const route of civilization.getRoutes?.() || []) {
      const a = cities.get(route.from);
      const b = cities.get(route.to);
      if (!a || !b) continue;
      let mode = 'land';
      if (a.port > 0.25 && b.port > 0.25) mode = 'sea';
      if (a.airport > 0.3 && b.airport > 0.3) mode = 'air';
      transports.set(route.id, { id: route.id, from: route.from, to: route.to, mode, capacity: clamp((route.flow || 0.1) * (mode === 'air' ? 1.7 : mode === 'sea' ? 1.35 : 1), 0, 3), updatedAt: elapsed });
    }
    const communities = communityMap();
    for (const [id, science] of sciences) {
      const community = communities.get(id);
      if (!community || community.status === 'abandoned') continue;
      const economy = economies.get(id);
      const institution = institutions.get(id);
      const city = cities.get(id);
      const type = availableMissionType(science.discoveries, id);
      if (!type) continue;
      const capability = clamp(science.knowledge * 0.08 + economy.capital * 0.015 + economy.inventory.energy * 0.025 + city.infrastructure * 0.15 + institution.legitimacy * 0.08, 0, 1.5);
      const cost = missionCost(type);
      if (capability < cost || economy.capital < cost * 3 || economy.inventory.energy < cost * 1.5) continue;
      if (rng() > dt * (capability - cost + 0.03) * 0.025) continue;
      economy.capital -= cost * 2.5;
      economy.inventory.energy = Math.max(0, economy.inventory.energy - cost * 1.2);
      launchMission(id, type, capability);
    }
    for (const mission of missions.values()) {
      if (mission.status !== 'active') continue;
      mission.progress += dt * (0.006 + mission.capability * 0.004);
      if (mission.progress < 1) continue;
      mission.success = rng() < clamp(0.45 + mission.capability * 0.35, 0.2, 0.94);
      mission.status = mission.success ? 'completed' : 'failed';
      record(mission.success ? 'Space mission succeeds' : 'Space mission fails', `${mission.type} mission ${mission.id} ${mission.success ? 'reached' : 'failed before reaching'} ${mission.targetName}.`, 'spaceflight', mission.communityId);
    }
  }

  function launchMission(communityId, type, capability) {
    const targets = (orbitalSystem.getBodies?.() || []).filter(body => body.id !== 'gaia' && body.id !== 'sun');
    const target = type === 'satellite' || type === 'station'
      ? { id: 'gaia-orbit', name: 'Gaia orbit' }
      : targets[Math.floor(rng() * Math.max(1, targets.length))] || { id: 'deep-space', name: 'deep space' };
    const id = `mission-${nextMission++}`;
    missions.set(id, { id, communityId, type, targetId: target.id, targetName: target.name, launchedAt: elapsed, progress: 0, capability, status: 'active', success: null });
    record('Space mission launches', `${communityName(communityId)} launched a ${type} mission toward ${target.name}.`, 'spaceflight', communityId);
  }

  function render(frame = {}) {
    const visible = Boolean(groundLevel.getState?.().active && getState().communities > 0);
    hud.element.hidden = !visible;
    if (!visible) return;
    const timestamp = frame.timestamp ?? performance.now();
    if (timestamp - hud.lastUpdate < 450) return;
    hud.lastUpdate = timestamp;
    const state = getState();
    hud.summary.textContent = `${state.institutions} institutions · ${state.discoveries} discoveries · ${state.outbreaks} outbreaks · ${state.activeMissions} active missions`;
    hud.detail.textContent = `${state.industrialCities} industrial cities · ${state.transportRoutes} routes · ${state.totalOutput.toFixed(1)} output · ${(state.emissions * 100).toFixed(1)} climate pressure`;
  }

  function getState() {
    const activeCities = [...cities.values()].filter(city => !city.inactive && city.status !== 'abandoned');
    return {
      elapsed,
      communities: activeCities.length,
      institutions: [...institutions.values()].filter(item => !item.inactive && item.state !== 'informal').length,
      institutionalStates: countBy([...institutions.values()].filter(item => !item.inactive), item => item.state),
      discoveries: new Set([...sciences.values()].flatMap(science => [...science.discoveries])).size,
      outbreaks: outbreaks.size,
      pathogens: pathogens.size,
      industrialCities: activeCities.filter(city => city.powerGrid > 0.15 || city.pollution > 0.2).length,
      transportRoutes: transports.size,
      missions: missions.size,
      activeMissions: [...missions.values()].filter(mission => mission.status === 'active').length,
      totalOutput: [...economies.values()].filter(item => !item.inactive).reduce((sum, item) => sum + item.output, 0),
      emissions: world.globals.industrialEmissions || 0,
      xstate: Boolean(XState),
      events: events.length,
    };
  }

  function getSnapshot() {
    return {
      state: getState(),
      institutions: [...institutions.values()].map(serializeInstitution),
      economies: [...economies.values()].map(serializeEconomy),
      sciences: [...sciences.values()].map(serializeScience),
      cities: [...cities.values()].map(item => ({ ...item })),
      pathogens: [...pathogens.values()], outbreaks: [...outbreaks.values()], transports: [...transports.values()], missions: [...missions.values()], events: events.slice(0, 120),
    };
  }

  function runInvariants() {
    const failures = [];
    const numeric = [
      ...[...institutions.values()].flatMap(item => [item.legitimacy, item.trust, item.corruption, item.factionalism]),
      ...[...economies.values()].flatMap(item => [item.output, item.capital, item.wealth, item.unemployment, ...Object.values(item.inventory), ...Object.values(item.prices)]),
      ...[...cities.values()].flatMap(item => [item.population, item.infrastructure, item.pollution, item.emissions]),
      ...[...outbreaks.values()].flatMap(item => [item.infected, item.recovered, item.immune, item.deaths]),
    ];
    if (numeric.some(value => !Number.isFinite(value))) failures.push('non-finite-numeric-state');
    for (const institution of institutions.values()) if (!INSTITUTION_STATES.includes(institution.state)) failures.push(`invalid-institution:${institution.id}`);
    for (const economy of economies.values()) {
      if (Object.values(economy.inventory).some(value => value < 0)) failures.push(`negative-inventory:${economy.id}`);
      if (Object.values(economy.prices).some(value => value <= 0)) failures.push(`invalid-price:${economy.id}`);
    }
    for (const outbreak of outbreaks.values()) if (!pathogens.has(outbreak.pathogenId)) failures.push(`orphan-outbreak:${outbreak.pathogenId}`);
    for (const mission of missions.values()) if (!['active', 'completed', 'failed'].includes(mission.status)) failures.push(`invalid-mission:${mission.id}`);
    return { ok: failures.length === 0, failures, checkedAt: elapsed };
  }

  function debugSeedScenario(kind = 'industrial') {
    const community = (civilization.getCommunities?.() || [])[0];
    if (!community) return { ok: false, reason: 'no-community' };
    synchronize();
    const id = community.id;
    const science = sciences.get(id);
    const economy = economies.get(id);
    const city = cities.get(id);
    const institution = institutions.get(id);
    if (['industrial', 'space'].includes(kind)) {
      for (const discovery of ['measurement', 'mathematics', 'mechanics', 'steam-engines', 'electricity', 'communications', 'computation', 'automation', 'astronomy', 'rocketry', 'orbital-flight', 'satellites']) science.discoveries.add(discovery);
      science.knowledge = Math.max(science.knowledge, 4);
      science.literacy = Math.max(science.literacy, 0.8);
      economy.capital = Math.max(economy.capital, 20);
      economy.inventory.energy = Math.max(economy.inventory.energy, 15);
      economy.inventory.machines = Math.max(economy.inventory.machines, 6);
      city.infrastructure = Math.max(city.infrastructure, 0.8);
      city.powerGrid = Math.max(city.powerGrid, 0.7);
      institution.researchSupport = Math.max(institution.researchSupport, 0.65);
      institution.legitimacy = Math.max(institution.legitimacy, 0.6);
    }
    if (kind === 'outbreak') createPathogen(id, { transmission: 0.55, lethality: 0.06 });
    if (kind === 'crisis') {
      economy.inventory.food = 0.02;
      economy.debt = economy.wealth * 2 + 4;
      institution.factionalism = 0.82;
      institution.legitimacy = 0.2;
    }
    return { ok: true, communityId: id, kind };
  }

  function forceDiscovery(communityId, discovery) {
    const science = sciences.get(communityId);
    if (!science || !DISCOVERIES.some(item => item[0] === discovery)) return false;
    science.discoveries.add(discovery);
    return true;
  }

  function save() {
    return {
      version: 1, elapsed, nextPathogen, nextMission, nextEvent,
      institutions: [...institutions.values()].map(serializeInstitution),
      economies: [...economies.values()].map(serializeEconomy),
      sciences: [...sciences.values()].map(serializeScience),
      cities: [...cities.values()].map(city => ({ ...city })),
      pathogens: [...pathogens.values()], outbreaks: [...outbreaks.values()], transports: [...transports.values()], missions: [...missions.values()], events: events.slice(0, 300),
    };
  }

  function load(state) {
    if (!state) return;
    elapsed = Math.max(0, state.elapsed || 0);
    nextPathogen = Math.max(1, state.nextPathogen || 1);
    nextMission = Math.max(1, state.nextMission || 1);
    nextEvent = Math.max(1, state.nextEvent || 1);
    for (const item of state.institutions || []) restored.institutions.set(item.id, item);
    for (const item of state.economies || []) restored.economies.set(item.id, item);
    for (const item of state.sciences || []) restored.sciences.set(item.id, item);
    for (const item of state.cities || []) restored.cities.set(item.id, item);
    for (const item of state.pathogens || []) pathogens.set(item.id, item);
    for (const item of state.outbreaks || []) outbreaks.set(`${item.communityId}:${item.pathogenId}`, item);
    for (const item of state.transports || []) transports.set(item.id, item);
    for (const item of state.missions || []) missions.set(item.id, item);
    events.push(...(state.events || []).slice(0, 300));
  }

  function destroy() {
    destroyed = true;
    for (const institution of institutions.values()) institution.actor?.stop?.();
    hud.element.remove();
  }

  function record(title, description, type, communityId) {
    const event = { id: `phase8-${nextEvent++}`, title, description, type, communityId, at: elapsed, tick: world.tick, date: new Date().toISOString() };
    events.unshift(event);
    if (events.length > 500) events.length = 500;
    window.dispatchEvent(new CustomEvent('phase8-history', { detail: event }));
  }

  function communityMap() { return new Map((civilization.getCommunities?.() || []).map(item => [item.id, item])); }
  function routesFor(id) { return (civilization.getRoutes?.() || []).filter(route => route.from === id || route.to === id); }
  function routeTrade(id) { return mean(routesFor(id).map(route => route.flow || 0)); }
  function routeKnowledge(id) { return mean(routesFor(id).map(route => route.knowledge || 0)); }
  function communityName(id) { return communityMap().get(id)?.name || id; }
  function outbreakPressure(id) { return clamp([...outbreaks.values()].filter(item => item.communityId === id).reduce((sum, item) => sum + item.infected, 0) / 20, 0, 1); }
  function transportCapacity(id) { return clamp(mean([...transports.values()].filter(item => item.from === id || item.to === id).map(item => item.capacity)), 0, 1); }
  function availableMissionType(discoveries, communityId) {
    const options = [
      ['interstellar', 'interstellar-attempts'], ['colony', 'offworld-colonies'], ['station', 'space-stations'], ['probe', 'interplanetary-probes'], ['satellite', 'satellites'],
    ];
    return options.find(([type, discovery]) => discoveries.has(discovery) && ![...missions.values()].some(mission => mission.communityId === communityId && mission.type === type && mission.status !== 'failed'))?.[0] || null;
  }

  const api = {
    id: 'civilization.phase8-institutions-industry-spaceflight',
    name: 'Institutions, Economies, Science, Industry, Health, Cities, and Spaceflight',
    version: '1.0.0',
    execution: 'browser-xstate-deterministic',
    source: 'XState 5.32.5 plus Reality Sandbox economic, epidemiological, industrial, urban, and mission simulation',
    license: 'MIT / project license',
    provides: ['institutions.statecharts', 'economy.production', 'science.discovery', 'health.epidemiology', 'cities.infrastructure', 'spaceflight.emergent'],
    requires: ['civilization.emergent', 'history.observatory', 'orbits.system'],
    after: ['civilization.emergent-graphology'],
    initialize, step, render, save, load, getState, getSnapshot, runInvariants,
    getInstitutions: () => [...institutions.values()].map(serializeInstitution),
    getEconomies: () => [...economies.values()].map(serializeEconomy),
    getSciences: () => [...sciences.values()].map(serializeScience),
    getCities: () => [...cities.values()].map(city => ({ ...city })),
    getOutbreaks: () => [...outbreaks.values()].map(item => ({ ...item })),
    getMissions: () => [...missions.values()].map(item => ({ ...item })),
    debugSeedScenario, forceDiscovery, createPathogen, destroy,
  };
  return api;
}

function createHud() {
  const element = document.createElement('section');
  element.hidden = true;
  element.setAttribute('aria-live', 'polite');
  element.style.cssText = 'position:fixed;left:max(12px,env(safe-area-inset-left));top:max(12px,env(safe-area-inset-top));z-index:16;max-width:min(420px,calc(100vw - 24px));padding:10px 12px;border:1px solid rgba(133,190,255,.24);border-radius:12px;background:rgba(3,8,17,.72);backdrop-filter:blur(10px);color:#e4f2ff;font:600 11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.035em;pointer-events:none';
  element.innerHTML = '<strong style="display:block;margin-bottom:4px;color:#9ecbff">PHASE 8 · PLANETARY SYSTEMS</strong><span data-summary></span><small data-detail style="display:block;margin-top:4px;color:rgba(228,242,255,.68)"></small>';
  document.body.append(element);
  return { element, summary: element.querySelector('[data-summary]'), detail: element.querySelector('[data-detail]'), lastUpdate: -Infinity };
}

async function loadXState() {
  for (const source of XSTATE_SOURCES) {
    try {
      const module = await import(/* @vite-ignore */ source);
      if (module.createMachine && module.createActor) return module;
    } catch (error) {
      console.warn(`XState source unavailable: ${source}`, error);
    }
  }
  return null;
}

function chooseInstitutionEvent(i, community, complexity, scarcity, conflict) {
  const state = institutionState(i);
  if (community.status === 'abandoned' || i.legitimacy < 0.08) return 'COLLAPSE';
  if (state === 'collapsed' && community.status !== 'abandoned' && i.trust > 0.24) return 'RECOVER';
  if (i.factionalism > 0.72 && i.legitimacy < 0.35) return 'REVOLT';
  if (scarcity + conflict > 1.15 || i.trust < 0.2) return 'CRISIS';
  if (state === 'crisis' && i.trust > 0.42) return 'REFORM';
  if (state === 'revolution' && i.legitimacy > 0.28) return 'STABILIZE';
  if (state === 'reform' && i.trust > 0.5) return i.administrativeCapacity > 0.52 ? 'STABILIZE' : 'FEDERATE';
  if (state === 'informal' && complexity > 0.28 && i.trust > 0.25) return 'ORGANIZE';
  if (state === 'council' && i.administrativeCapacity > 0.38 && community.population > 8) return 'ADMINISTER';
  if (['council', 'administration'].includes(state) && community.polityId && i.trust > 0.55) return 'FEDERATE';
  if (i.corruption > 0.58 && i.legitimacy > 0.25) return 'REFORM';
  return null;
}

function transitionInstitution(record, event) {
  if (!event) return;
  if (record.actor) {
    record.actor.send({ type: event });
    return;
  }
  const transitions = {
    informal: { ORGANIZE: 'council', CRISIS: 'crisis', COLLAPSE: 'collapsed' },
    council: { ADMINISTER: 'administration', FEDERATE: 'federal', REFORM: 'reform', CRISIS: 'crisis', REVOLT: 'revolution', COLLAPSE: 'collapsed' },
    administration: { FEDERATE: 'federal', REFORM: 'reform', CRISIS: 'crisis', REVOLT: 'revolution', COLLAPSE: 'collapsed' },
    federal: { REFORM: 'reform', CRISIS: 'crisis', REVOLT: 'revolution', COLLAPSE: 'collapsed' },
    reform: { STABILIZE: 'administration', FEDERATE: 'federal', FAIL: 'crisis', COLLAPSE: 'collapsed' },
    crisis: { REFORM: 'reform', REVOLT: 'revolution', RECOVER: 'council', COLLAPSE: 'collapsed' },
    revolution: { STABILIZE: 'council', AUTHORITARIAN: 'administration', COLLAPSE: 'collapsed' },
    collapsed: { RECOVER: 'informal' },
  };
  record.state = transitions[record.state]?.[event] || record.state;
}

function institutionState(record) { return String(record.actor?.getSnapshot?.().value || record.state || 'informal'); }
function pathToState(state) { return { council: 'ORGANIZE', administration: 'ADMINISTER', federal: 'FEDERATE', reform: 'REFORM', crisis: 'CRISIS', revolution: 'REVOLT', collapsed: 'COLLAPSE' }[state] || 'ORGANIZE'; }
function makeFactions(community) { return [{ id: 'provisioners', support: 0.32 + Math.min(0.2, community.population / 100) }, { id: 'traditionalists', support: 0.25 }, { id: 'innovators', support: 0.18 + community.knowledge * 0.08 }, { id: 'guards', support: 0.12 + community.conflict * 0.15 }]; }
function transportCost(route) { return clamp(0.04 + (route.kind === 'conflict' ? 0.28 : 0), 0.02, 0.65); }
function expandDistricts(city, science, economy) { const add = value => { if (!city.districts.includes(value)) city.districts.push(value); }; if (city.urbanization > 0.22) add('workshops'); if (economy.output > 2) add('industrial'); if (science.literacy > 0.35) add('administrative'); if (science.discoveries.has('medicine')) add('medical'); if (science.discoveries.has('electricity')) add('utility'); if (science.discoveries.has('communications')) add('communications'); if (city.port > 0.2) add('port'); if (city.airport > 0.2) add('airfield'); }
function missionCost(type) { return { satellite: 0.45, station: 0.62, probe: 0.7, colony: 0.86, interstellar: 0.97 }[type] || 0.6; }
function take(map, id) { const value = map.get(id); if (value) map.delete(id); return value; }
function serializeInstitution(item) { const { actor, ...rest } = item; return { ...rest, state: institutionState(item) }; }
function serializeEconomy(item) { return { ...item, inventory: { ...item.inventory }, prices: { ...item.prices }, labor: { ...item.labor } }; }
function serializeScience(item) { return { ...item, discoveries: [...item.discoveries] }; }
function countBy(items, selector) { const result = {}; for (const item of items) { const key = selector(item); result[key] = (result[key] || 0) + 1; } return result; }
function mean(values) { const finite = values.filter(Number.isFinite); return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : 0; }
function mulberry32(seed) { let value = seed >>> 0; return () => { value += 0x6D2B79F5; let result = value; result = Math.imul(result ^ result >>> 15, result | 1); result ^= result + Math.imul(result ^ result >>> 7, result | 61); return ((result ^ result >>> 14) >>> 0) / 4294967296; }; }
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
