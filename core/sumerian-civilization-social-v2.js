import { createTransactionJournal } from '../packages/multiscale-reality-kernel/src/index.js';
import { createSumerianCivilizationSimulation as createAggregateSimulation } from './sumerian-civilization-model.js';
import { createSumerianSocialLayer } from './sumerian-social-layer.js';
import { createSumerianUrbanLayer } from './sumerian-urban-layer.js';

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

export const SUMER_SOCIAL_TRANSACTION_TYPES = Object.freeze({
  BIRTH: 'BIRTH',
  DEATH: 'DEATH',
  WORK: 'WORK',
  HOUSEHOLD: 'HOUSEHOLD',
});

export const SUMER_URBAN_TRANSACTION_TYPES = Object.freeze({
  WARD: 'WARD',
  CORRIDOR: 'CORRIDOR',
  SETTLE: 'SETTLE',
  RELOCATE: 'RELOCATE',
});

export function createSumerianCivilizationSimulation(options = {}) {
  const base = createAggregateSimulation(options);
  const socialTransactions = createTransactionJournal({
    types: SUMER_SOCIAL_TRANSACTION_TYPES,
    historyLimit: 512,
    getTick: () => base.state.yearIndex,
  });
  const urbanTransactions = createTransactionJournal({
    types: SUMER_URBAN_TRANSACTION_TYPES,
    historyLimit: 512,
    getTick: () => base.state.yearIndex,
  });

  const social = createSumerianSocialLayer({
    seed: `social:${base.seed}`,
    cities: base.cities,
    state: base.state,
    kernel: base.kernel,
    transact: (type, payload, result) => socialTransactions.transact(type, {
      yearBCE: base.state.yearBCE,
      ...payload,
    }, result),
    transactionTypes: SUMER_SOCIAL_TRANSACTION_TYPES,
  });

  const urban = createSumerianUrbanLayer({
    seed: `urban:${base.seed}`,
    cities: base.cities,
    state: base.state,
    kernel: base.kernel,
    social,
    transact: (type, payload, result) => urbanTransactions.transact(type, {
      yearBCE: base.state.yearBCE,
      ...payload,
    }, result),
    transactionTypes: SUMER_URBAN_TRANSACTION_TYPES,
  });

  function influenceCityFromPeople(city) {
    const summary = social.summary(city.id);
    const adults = Math.max(1, summary.adults);
    const occupations = summary.occupations;
    const specialistCraft = (occupations.potter || 0) + (occupations.herder || 0) * 0.35 + (occupations.merchant || 0) * 0.25;
    const craftShare = specialistCraft / adults;
    const scribeShare = (occupations.scribe || 0) / adults;
    const soldierShare = (occupations.soldier || 0) / adults;
    const canalShare = (occupations['canal-worker'] || 0) / adults;

    // Social organization remains the calibrated upward coupling. Urban v4 is
    // causal for placement and local access/needs, but does not yet alter the
    // aggregate economy so adding spatial structure cannot silently recalibrate
    // the 1500-year civilization trajectory.
    city.craftCapacity = clamp(city.craftCapacity * 0.997 + clamp(craftShare * 1.7, 0.04, 0.55) * 0.003, 0.04, 0.82);
    city.administration = clamp(city.administration + (scribeShare - 0.035) * 0.00045, 0, 1);
    city.military = clamp(city.military * 0.998 + clamp(soldierShare * 2.2, 0.03, 0.72) * 0.002, 0.03, 0.78);
    city.canalHealth = clamp(city.canalHealth + (canalShare - 0.08) * 0.00016, 0.20, 0.98);
  }

  function processAggregateMigrationAndConflict(tick) {
    const recent = base.transactions.snapshot().recent.filter(record => record.tick === tick);
    for (const record of recent) {
      if (record.type === 'MIGRATE') {
        const requested = Math.max(0, Math.round(record.result.peopleMoved || 0));
        if (requested > 0 && record.payload.fromCityId && record.payload.toCityId) {
          social.migrateHouseholds(record.payload.fromCityId, record.payload.toCityId, requested);
        }
      } else if (record.type === 'RAID') {
        const casualties = Math.max(0, Math.round(record.result.casualties || 0));
        if (!casualties) continue;
        const attackerId = record.payload.attackerId;
        const defenderId = record.payload.defenderId;
        const winnerId = record.payload.winnerId;
        const loserId = winnerId === attackerId ? defenderId : attackerId;
        if (loserId) social.killMany(loserId, casualties, 'raid');
      }
    }
  }

  const detachBefore = base.transactions.beforeStep(() => {
    social.beginYear();
    for (const city of base.cities) influenceCityFromPeople(city);
  }, 50);

  const detachAfter = base.transactions.afterStep(() => {
    // The aggregate model has already advanced yearIndex. Process people who
    // crossed the adulthood boundary during that year before any operation
    // computes their class from the new clock value.
    social.beginYear();
    const completedTick = Math.max(0, base.state.yearIndex - 1);
    processAggregateMigrationAndConflict(completedTick);
    for (const city of base.cities) {
      const reconciled = social.reconcileNaturalPopulation(city.id, city.population, {
        foodRatio: city.foodRatio,
        climateStress: base.state.climateStress,
      });
      city.population = reconciled.population;
      city.foodYears = (city.grain + city.institutionalGrain) / Math.max(1, city.population * 0.82);
    }
    social.assertConsistent();
    urban.reconcile();
  }, -50);

  const baseSnapshot = base.snapshot.bind(base);

  function snapshot() {
    const aggregate = baseSnapshot();
    const socialSnapshot = social.snapshot();
    const urbanSnapshot = urban.snapshot();
    return {
      ...aggregate,
      version: 3,
      socialModel: 'explicit-households-event-driven-people',
      urbanModel: 'persistent-ward-corridor-compound',
      cities: aggregate.cities.map(city => ({
        ...city,
        social: social.summary(city.id),
        urban: urban.summary(city.id),
      })),
      social: {
        ...socialSnapshot,
        transactions: socialTransactions.snapshot(),
      },
      urban: {
        ...urbanSnapshot,
        transactions: urbanTransactions.snapshot(),
      },
    };
  }

  function getCitySocialDetail(cityId) {
    const detail = social.cityDetail(cityId);
    const city = base.cities.find(item => item.id === cityId);
    if (!city) return detail;
    const householdMembers = new Map(detail.households.map(household => [household.id, household.memberIds]));
    const foodSecurity = clamp(city.foodRatio || 0, 0, 1);
    const civicSecurity = clamp(0.36 + (city.military || 0) * 0.34 + (city.canalHealth || 0) * 0.16 - (base.state.climateStress || 0) * 0.18, 0, 1);
    const institutionalAccess = clamp((city.administration || 0) * 0.55 + (city.templeComplexity || 0) * 0.45, 0, 1);
    const households = detail.households.map(household => ({
      ...household,
      urban: urban.householdContext(household.id),
    }));
    return {
      ...detail,
      households,
      people: detail.people.map(person => {
        const household = householdMembers.get(person.householdId) || [];
        const socialTies = [...new Set([...person.parentIds, ...household.filter(id => id !== person.id)])];
        const householdSupport = clamp((household.length - 1) / 6, 0, 1);
        const local = urban.householdContext(person.householdId);
        const ward = local?.ward;
        return {
          ...person,
          urban: local,
          needs: {
            nutrition: clamp(foodSecurity * 0.72 + (ward?.foodAccess ?? foodSecurity) * 0.28, 0, 1),
            security: clamp(civicSecurity * 0.72 + (ward?.security ?? civicSecurity) * 0.28, 0, 1),
            householdSupport,
            institutionalAccess: clamp(institutionalAccess * 0.68 + (ward?.institutionalAccess ?? institutionalAccess) * 0.32, 0, 1),
            marketAccess: clamp(ward?.marketAccess ?? 0.5, 0, 1),
            canalAccess: clamp(ward?.canalAccess ?? city.canalHealth ?? 0.5, 0, 1),
          },
          socialTies,
        };
      }),
    };
  }

  function getCityUrbanDetail(cityId) {
    return urban.cityDetail(cityId);
  }

  function observeWard(wardId, observerId = 'sumer-ward-viewer') {
    return urban.observeWard(wardId, observerId);
  }

  function observeCorridor(corridorId, observerId = 'sumer-corridor-viewer') {
    return urban.observeCorridor(corridorId, observerId);
  }

  function observeCompound(householdId, observerId = 'sumer-compound-viewer') {
    return urban.observeCompound(householdId, observerId);
  }

  function observeHousehold(householdId, observerId = 'sumer-household-viewer') {
    urban.ensureHouseholdPath(householdId);
    social.observeHousehold(householdId, observerId);
    urban.ensureHouseholdPath(householdId);
    return base.kernel.requestResolution({
      observerId,
      nodeId: `household:${householdId}`,
      spatialScale: 35,
      temporalScale: 1,
    });
  }

  function observePerson(personId, observerId = 'sumer-person-viewer') {
    const person = social.people.get(personId);
    if (!person?.alive) throw new Error(`Unknown living Sumer person: ${personId}`);
    urban.ensureHouseholdPath(person.householdId);
    social.observePerson(personId, observerId);
    urban.ensureHouseholdPath(person.householdId);
    return base.kernel.requestResolution({
      observerId,
      nodeId: `person:${personId}`,
      spatialScale: 1.7,
      temporalScale: 0.25,
    });
  }

  function destroySocialLayer() {
    detachBefore();
    detachAfter();
    socialTransactions.destroy();
    urbanTransactions.destroy();
  }

  social.assertConsistent();
  urban.assertConsistent();

  return {
    ...base,
    version: 3,
    social,
    urban,
    socialTransactions,
    urbanTransactions,
    snapshot,
    getCitySocialDetail,
    getCityUrbanDetail,
    observeWard,
    observeCorridor,
    observeCompound,
    observeHousehold,
    observePerson,
    destroySocialLayer,
  };
}
