import { createTransactionJournal } from '../packages/multiscale-reality-kernel/src/index.js';
import { createSumerianCivilizationSimulation as createAggregateSimulation } from './sumerian-civilization-model.js';
import { createSumerianSocialLayer } from './sumerian-social-layer.js';

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

export const SUMER_SOCIAL_TRANSACTION_TYPES = Object.freeze({
  BIRTH: 'BIRTH',
  DEATH: 'DEATH',
  WORK: 'WORK',
  HOUSEHOLD: 'HOUSEHOLD',
});

export function createSumerianCivilizationSimulation(options = {}) {
  const base = createAggregateSimulation(options);
  const socialTransactions = createTransactionJournal({
    types: SUMER_SOCIAL_TRANSACTION_TYPES,
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

  function influenceCityFromPeople(city) {
    const summary = social.summary(city.id);
    const adults = Math.max(1, summary.adults);
    const occupations = summary.occupations;
    const specialistCraft = (occupations.potter || 0) + (occupations.herder || 0) * 0.35 + (occupations.merchant || 0) * 0.25;
    const craftShare = specialistCraft / adults;
    const scribeShare = (occupations.scribe || 0) / adults;
    const soldierShare = (occupations.soldier || 0) / adults;
    const canalShare = (occupations['canal-worker'] || 0) / adults;

    // Social organization is deliberately a modest upward coupling in v2 so
    // household detail can affect the calibrated city system without replacing
    // its agricultural/economic equations in one step.
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
  }, -50);

  const baseSnapshot = base.snapshot.bind(base);

  function snapshot() {
    const aggregate = baseSnapshot();
    const socialSnapshot = social.snapshot();
    return {
      ...aggregate,
      version: 2,
      socialModel: 'explicit-households-event-driven-people',
      cities: aggregate.cities.map(city => ({
        ...city,
        social: social.summary(city.id),
      })),
      social: {
        ...socialSnapshot,
        transactions: socialTransactions.snapshot(),
      },
    };
  }

  function getCitySocialDetail(cityId) {
    return social.cityDetail(cityId);
  }

  function observeHousehold(householdId, observerId = 'sumer-household-viewer') {
    return social.observeHousehold(householdId, observerId);
  }

  function observePerson(personId, observerId = 'sumer-person-viewer') {
    return social.observePerson(personId, observerId);
  }

  function destroySocialLayer() {
    detachBefore();
    detachAfter();
    socialTransactions.destroy();
  }

  social.assertConsistent();

  return {
    ...base,
    version: 2,
    social,
    socialTransactions,
    snapshot,
    getCitySocialDetail,
    observeHousehold,
    observePerson,
    destroySocialLayer,
  };
}