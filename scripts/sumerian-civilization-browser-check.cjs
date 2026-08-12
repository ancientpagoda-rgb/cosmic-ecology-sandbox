const { chromium } = require('playwright');

const root = process.env.REALITY_BASE_URL || 'http://127.0.0.1:4173/';
const baseUrl = new URL('sumer.html?seed=sumer-browser-check', root).toString();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => Boolean(window.sumerianCivilizationReady && window.sumerianCivilization), null, { timeout: 120000 });
    await page.evaluate(() => window.sumerianCivilizationReady);

    const initial = await page.evaluate(() => window.sumerianCivilization.getSnapshot());
    assert(initial.mode === 'historically-constrained-emergent', `unexpected Sumer mode: ${initial.mode}`);
    assert(initial.exactHistoricalReplay === false, 'Sumer experiment must not claim exact historical replay');
    assert(initial.syntheticInitialPopulations === true, 'synthetic population boundary is missing');
    assert(initial.version === 2, `expected Sumer social v2, got ${initial.version}`);
    assert(initial.socialModel === 'explicit-households-event-driven-people', `unexpected social model: ${initial.socialModel}`);
    assert(initial.social?.exactPeople === true, 'browser Sumer runtime is not using exact people');
    assert(initial.social?.displayCap === null, 'browser Sumer runtime introduced a display cap');
    assert(initial.social.people === Math.round(initial.totals.population), `initial person ledger drift: ${initial.social.people} vs ${initial.totals.population}`);
    assert(initial.social.households > 5000, `unexpectedly few households: ${initial.social.households}`);
    assert(initial.yearBCE === 3500, `unexpected initial year ${initial.yearBCE}`);
    assert(initial.cities.length === 7, `expected seven initial city-state anchors, got ${initial.cities.length}`);
    assert(initial.kernel.nodes.length === 8, `unexpected initial kernel node count: ${initial.kernel.nodes.length}`);

    const after50 = await page.evaluate(() => {
      window.sumerianCivilization.advance(50);
      window.sumerianCivilization.selectCity('lagash');
      return window.sumerianCivilization.getSnapshot();
    });
    assert(after50.yearBCE === 3450, `50-year advance produced ${after50.yearBCE}`);
    for (const type of ['IRRIGATE', 'SOW', 'HARVEST', 'RATION', 'TAX', 'BUILD', 'RECORD']) {
      assert(after50.transactions.counts[type] > 0, `${type} missing from browser Sumer run`);
    }
    for (const type of ['BIRTH', 'DEATH', 'WORK']) {
      assert(after50.social.transactions.counts[type] > 0, `${type} missing from browser social run`);
    }
    assert(after50.kernel.observers.some(observer => observer.observerId === 'sumer-viewer'), 'city selection did not create kernel observer');
    assert(after50.totals.population > 0 && Number.isFinite(after50.totals.population), 'invalid population after 50 years');
    assert(after50.social.people === Math.round(after50.totals.population), 'social population drift after 50 years');
    const lagash = after50.cities.find(city => city.id === 'lagash');
    assert(lagash?.social?.households > 0, 'Lagash has no explicit households');
    assert(lagash.social.occupations.farmer > 0 && lagash.social.occupations.scribe > 0, 'Lagash occupations did not materialize');

    const micro = await page.evaluate(() => {
      const detail = window.sumerianCivilization.getCitySocialDetail('lagash');
      const household = detail.households.find(item => item.memberIds.length > 0);
      const personId = household?.memberIds?.[0];
      const householdObserver = household ? window.sumerianCivilization.observeHousehold(household.id, 'browser-household') : null;
      const personObserver = personId ? window.sumerianCivilization.observePerson(personId, 'browser-person') : null;
      return {
        people: detail.people.length,
        population: detail.population,
        households: detail.households.length,
        person: detail.people.find(item => item.id === personId) || null,
        householdObserver,
        personObserver,
      };
    });
    assert(micro.people === micro.population, `city detail did not expose every person: ${micro.people}/${micro.population}`);
    assert(micro.households > 0 && micro.person, 'household/person detail is missing');
    assert(Number.isFinite(micro.person.needs?.nutrition) && Number.isFinite(micro.person.needs?.security), 'person needs are missing or invalid');
    assert(Array.isArray(micro.person.socialTies), 'person social ties are missing');
    assert(micro.person.socialTies.every(id => typeof id === 'string'), 'person social ties contain invalid IDs');
    assert(String(micro.householdObserver?.resolvedNodeId || '').includes('household:'), 'household did not resolve through multiscale kernel');
    assert(String(micro.personObserver?.resolvedNodeId || '').includes('person:'), 'person did not resolve through multiscale kernel');

    const canvas = await page.locator('#sumerCanvas').boundingBox();
    assert(canvas && canvas.width > 500 && canvas.height > 300, `Sumer canvas did not render: ${JSON.stringify(canvas)}`);
    const selected = await page.locator('#sumerSelected').textContent();
    assert(/Lagash/i.test(selected || ''), `Lagash selection not reflected in UI: ${selected}`);
    assert(/households/i.test(selected || ''), `social household state is not visible in UI: ${selected}`);
    assert(/scribes/i.test(selected || ''), `occupation state is not visible in UI: ${selected}`);

    const after250 = await page.evaluate(() => {
      window.sumerianCivilization.advance(200);
      return window.sumerianCivilization.getSnapshot();
    });
    assert(after250.yearBCE === 3250, `250-year browser run produced ${after250.yearBCE}`);
    assert(after250.totals.population > 0 && after250.totals.population < 5_000_000, `population out of bounds: ${after250.totals.population}`);
    assert(after250.social.people === Math.round(after250.totals.population), 'social population drift after 250 years');
    assert(Number.isFinite(after250.totals.meanSalinity), 'mean salinity became invalid');
    assert(pageErrors.length === 0, `page errors: ${pageErrors.join(' | ')}`);

    console.log(JSON.stringify({
      ok: true,
      url: baseUrl,
      initialYearBCE: initial.yearBCE,
      finalYearBCE: after250.yearBCE,
      population: Math.round(after250.totals.population),
      explicitPeople: after250.social.people,
      households: after250.social.households,
      hegemon: after250.politics.hegemonName,
      transactionCounts: after250.transactions.counts,
      socialTransactionCounts: after250.social.transactions.counts,
    }, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});