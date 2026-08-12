import { createSumerianCivilizationSimulation } from './sumerian-civilization-social-v2.js';
import { createSumerianSocialExplorer } from './sumerian-social-explorer.js';

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

function readSeed() {
  const requested = new URLSearchParams(location.search).get('seed');
  return String(requested || 'sumer-emergent-001').trim().slice(0, 96) || 'sumer-emergent-001';
}

export function createSumerianCivilizationRuntime({
  canvas = document.getElementById('sumerCanvas'),
  seed = readSeed(),
} = {}) {
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Sumer runtime requires #sumerCanvas.');
  const context = canvas.getContext('2d');
  const simulation = createSumerianCivilizationSimulation({ seed });
  const ui = {
    year: document.getElementById('sumerYear'),
    period: document.getElementById('sumerPeriod'),
    population: document.getElementById('sumerPopulation'),
    grain: document.getElementById('sumerGrain'),
    hegemon: document.getElementById('sumerHegemon'),
    river: document.getElementById('sumerRiver'),
    selected: document.getElementById('sumerSelected'),
    cityBody: document.getElementById('sumerCityBody'),
    eventLog: document.getElementById('sumerEventLog'),
    play: document.getElementById('sumerPlay'),
    step1: document.getElementById('sumerStep1'),
    step10: document.getElementById('sumerStep10'),
    step50: document.getElementById('sumerStep50'),
    speed: document.getElementById('sumerSpeed'),
    reset: document.getElementById('sumerReset'),
  };

  const explorer = createSumerianSocialExplorer({
    simulation,
    canvas: document.getElementById('sumerSocialCanvas'),
    breadcrumb: document.getElementById('sumerExplorerBreadcrumb'),
    detail: document.getElementById('sumerExplorerDetail'),
    backButton: document.getElementById('sumerExplorerBack'),
  });

  let running = false;
  let speed = 12;
  let accumulator = 0;
  let previousTime = 0;
  let selectedCityId = 'uruk';
  let cachedSnapshot = simulation.snapshot();

  function riverCoordinates(y) {
    return {
      euphrates: 0.40 + Math.sin(y * 5.1 + 0.4) * 0.055 + y * 0.025,
      tigris: 0.73 - Math.sin(y * 4.2 + 0.8) * 0.045 - y * 0.015,
    };
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(320, Math.round(rect.width * ratio));
    const height = Math.max(360, Math.round(rect.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function drawRiver(which, width, height) {
    context.beginPath();
    for (let step = 0; step <= 90; step += 1) {
      const y = step / 90;
      const river = riverCoordinates(y)[which];
      const px = river * width;
      const py = y * height;
      if (step === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    }
    context.lineWidth = Math.max(2, width * 0.006);
    context.strokeStyle = 'rgba(43, 119, 154, 0.76)';
    context.stroke();
    context.lineWidth = Math.max(1, width * 0.0024);
    context.strokeStyle = 'rgba(181, 225, 232, 0.82)';
    context.stroke();
  }

  function fieldColor(field) {
    const productive = clamp(field.fertility * (0.55 + field.moisture * 0.35) * (1 - field.salinity * 0.65), 0, 1);
    const hue = 35 + productive * 48;
    const saturation = 34 + productive * 24;
    const lightness = 66 - productive * 18 + field.salinity * 8;
    return `hsl(${hue} ${saturation}% ${lightness}%)`;
  }

  function socialLine(city) {
    const social = city.social;
    const urban = city.urban;
    if (!social) return 'social layer unavailable';
    const jobs = social.occupations || {};
    return `${social.households.toLocaleString()} households · ${urban?.wards || 0} wards · ${urban?.corridors || 0} corridors · farmers ${(jobs.farmer || 0).toLocaleString()} · scribes ${(jobs.scribe || 0).toLocaleString()}`;
  }

  function draw() {
    resizeCanvas();
    const snapshot = cachedSnapshot;
    const width = canvas.width;
    const height = canvas.height;
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#d8c49a';
    context.fillRect(0, 0, width, height);

    const cellWidth = width / snapshot.plain.columns;
    const cellHeight = height / snapshot.plain.rows;
    for (const field of snapshot.plain.fields) {
      const x = Math.floor(field.x * width - cellWidth / 2);
      const y = Math.floor(field.y * height - cellHeight / 2);
      context.fillStyle = fieldColor(field);
      context.globalAlpha = 0.74;
      context.fillRect(x, y, Math.ceil(cellWidth + 1), Math.ceil(cellHeight + 1));
    }
    context.globalAlpha = 1;

    drawRiver('euphrates', width, height);
    drawRiver('tigris', width, height);

    const cityMap = new Map(snapshot.cities.map(city => [city.id, city]));
    for (const city of snapshot.cities) {
      const x = city.x * width;
      const y = city.y * height;
      const radius = clamp(4 + Math.sqrt(city.population) * 0.075, 6, 24) * (window.devicePixelRatio || 1);
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fillStyle = city.id === selectedCityId ? '#5a2d1e' : '#6f4c2a';
      context.fill();
      context.lineWidth = city.id === snapshot.politics.hegemonId ? Math.max(3, radius * 0.22) : Math.max(1, radius * 0.10);
      context.strokeStyle = city.id === snapshot.politics.hegemonId ? '#e0b348' : 'rgba(255,255,255,0.72)';
      context.stroke();
      context.font = `${Math.max(11, Math.round(width * 0.015))}px system-ui, sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'bottom';
      context.fillStyle = '#24170f';
      context.fillText(city.name, x, y - radius - 4);
    }

    const selected = cityMap.get(selectedCityId);
    if (selected) {
      context.textAlign = 'left';
      context.textBaseline = 'top';
      context.font = `${Math.max(11, Math.round(width * 0.013))}px ui-monospace, monospace`;
      const lines = [
        `${selected.name} · ${Math.round(selected.population).toLocaleString()} explicit persons`,
        socialLine(selected),
        `food ${(selected.foodRatio * 100).toFixed(0)}% · reserve ${selected.foodYears.toFixed(2)} y`,
        `canal ${(selected.canalHealth * 100).toFixed(0)}% · salinity ${(selected.meanSalinity * 100).toFixed(1)}%`,
        `admin ${(selected.administration * 100).toFixed(0)}% · records ${Math.round(selected.records)}`,
      ];
      const boxWidth = Math.min(width * 0.72, 680 * (window.devicePixelRatio || 1));
      const lineHeight = Math.max(18, height * 0.026);
      const boxHeight = lines.length * lineHeight + 18;
      context.fillStyle = 'rgba(250,245,230,0.88)';
      context.fillRect(10, height - boxHeight - 10, boxWidth, boxHeight);
      context.fillStyle = '#24170f';
      lines.forEach((line, index) => context.fillText(line, 18, height - boxHeight + index * lineHeight));
    }
  }

  function formatNumber(value) {
    const rounded = Math.round(value);
    return rounded >= 1000000 ? `${(rounded / 1000000).toFixed(2)}m` : rounded.toLocaleString();
  }

  function updateInterface() {
    cachedSnapshot = simulation.snapshot();
    const snapshot = cachedSnapshot;
    if (ui.year) ui.year.textContent = `${Math.round(snapshot.yearBCE)} BCE`;
    if (ui.period) ui.period.textContent = snapshot.referencePeriod;
    if (ui.population) ui.population.textContent = formatNumber(snapshot.totals.population);
    if (ui.grain) ui.grain.textContent = formatNumber(snapshot.totals.grain);
    if (ui.hegemon) ui.hegemon.textContent = snapshot.politics.hegemonName || 'none';
    if (ui.river) ui.river.textContent = `${(snapshot.climate.riverPulse * 100).toFixed(0)}%`;
    if (ui.play) ui.play.textContent = running ? 'Pause' : 'Run';

    const selected = snapshot.cities.find(city => city.id === selectedCityId) || snapshot.cities[0];
    if (selected) {
      selectedCityId = selected.id;
      simulation.observeCity(selected.id);
      explorer.setCity(selected.id);
      if (ui.selected) {
        const jobs = selected.social?.occupations || {};
        const urban = selected.urban || {};
        ui.selected.innerHTML = `<strong>${selected.name}</strong><br>Population ${Math.round(selected.population).toLocaleString()} · households ${(selected.social?.households || 0).toLocaleString()} · wards ${(urban.wards || 0).toLocaleString()} · corridors ${(urban.corridors || 0).toLocaleString()}<br>farmers ${(jobs.farmer || 0).toLocaleString()} · canal workers ${(jobs['canal-worker'] || 0).toLocaleString()} · potters ${(jobs.potter || 0).toLocaleString()} · merchants ${(jobs.merchant || 0).toLocaleString()} · scribes ${(jobs.scribe || 0).toLocaleString()} · priests ${(jobs.priest || 0).toLocaleString()} · soldiers ${(jobs.soldier || 0).toLocaleString()}<br>food ${(selected.foodRatio * 100).toFixed(0)}% · canal ${(selected.canalHealth * 100).toFixed(0)}% · salinity ${(selected.meanSalinity * 100).toFixed(1)}% · administration ${(selected.administration * 100).toFixed(0)}%`;
      }
    }

    if (ui.cityBody) {
      ui.cityBody.innerHTML = snapshot.cities
        .slice()
        .sort((a, b) => b.population - a.population)
        .map(city => `<tr data-city="${city.id}"><td>${city.name}${city.id === snapshot.politics.hegemonId ? ' ★' : ''}</td><td>${Math.round(city.population).toLocaleString()}</td><td>${city.foodYears.toFixed(2)}</td><td>${(city.canalHealth * 100).toFixed(0)}%</td><td>${(city.meanSalinity * 100).toFixed(1)}%</td></tr>`)
        .join('');
      for (const row of ui.cityBody.querySelectorAll('tr[data-city]')) {
        row.addEventListener('click', () => {
          selectedCityId = row.dataset.city;
          updateInterface();
        });
      }
    }

    if (ui.eventLog) {
      const aggregate = snapshot.transactions.recent.slice(-12);
      const social = snapshot.social?.transactions?.recent?.slice(-7) || [];
      const urban = snapshot.urban?.transactions?.recent?.slice(-7) || [];
      const recent = aggregate.concat(social, urban).sort((a, b) => b.tick - a.tick || b.sequence - a.sequence).slice(0, 20);
      ui.eventLog.innerHTML = recent.map(record => {
        const cityId = record.payload.cityId || record.payload.fromCityId || record.payload.attackerId || record.payload.previousCityId;
        const city = snapshot.cities.find(item => item.id === cityId);
        const label = city ? `${city.name}: ` : '';
        return `<li><span>${record.payload.yearBCE ?? snapshot.yearBCE} BCE</span> ${label}${record.type}</li>`;
      }).join('') || '<li>No transactions yet.</li>';
    }
    draw();
  }

  function advance(years) {
    simulation.advance(years);
    if (simulation.state.yearBCE <= simulation.state.endBCE) running = false;
    updateInterface();
  }

  function selectFromCanvas(event) {
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    let best = null;
    let bestDistance = Infinity;
    for (const city of cachedSnapshot.cities) {
      const d = Math.hypot(city.x - x, city.y - y);
      if (d < bestDistance) {
        bestDistance = d;
        best = city;
      }
    }
    if (best && bestDistance < 0.08) {
      selectedCityId = best.id;
      updateInterface();
    }
  }

  function reset() {
    const url = new URL(location.href);
    url.searchParams.set('seed', seed);
    location.href = url.toString();
  }

  ui.play?.addEventListener('click', () => { running = !running; previousTime = 0; updateInterface(); });
  ui.step1?.addEventListener('click', () => advance(1));
  ui.step10?.addEventListener('click', () => advance(10));
  ui.step50?.addEventListener('click', () => advance(50));
  ui.speed?.addEventListener('change', () => { speed = clamp(Number(ui.speed.value) || 12, 1, 300); });
  ui.reset?.addEventListener('click', reset);
  canvas.addEventListener('click', selectFromCanvas);
  window.addEventListener('resize', draw);

  function frame(timestamp) {
    requestAnimationFrame(frame);
    if (!running) return;
    if (!previousTime) previousTime = timestamp;
    const elapsedSeconds = Math.min(0.25, (timestamp - previousTime) / 1000);
    previousTime = timestamp;
    accumulator += elapsedSeconds * speed;
    if (accumulator >= 1) {
      const years = Math.min(25, Math.floor(accumulator));
      accumulator -= years;
      advance(years);
    }
  }

  updateInterface();
  requestAnimationFrame(frame);

  return {
    simulation,
    explorer,
    getSnapshot: () => simulation.snapshot(),
    advance,
    setRunning(value) { running = Boolean(value); previousTime = 0; updateInterface(); },
    selectCity(cityId) { selectedCityId = cityId; updateInterface(); return explorer.getState(); },
    getCitySocialDetail: cityId => simulation.getCitySocialDetail(cityId),
    getCityUrbanDetail: cityId => simulation.getCityUrbanDetail(cityId),
    observeWard: (wardId, observerId) => simulation.observeWard(wardId, observerId),
    observeCorridor: (corridorId, observerId) => simulation.observeCorridor(corridorId, observerId),
    observeCompound: (householdId, observerId) => simulation.observeCompound(householdId, observerId),
    observeHousehold: (householdId, observerId) => simulation.observeHousehold(householdId, observerId),
    observePerson: (personId, observerId) => simulation.observePerson(personId, observerId),
    getExplorerState: () => explorer.getState(),
    openWard: wardId => explorer.openWard(wardId),
    openCorridor: corridorId => explorer.openCorridor(corridorId),
    openCompound: householdId => explorer.openCompound(householdId),
    openHousehold: householdId => explorer.openHousehold(householdId),
    openPerson: personId => explorer.openPerson(personId),
    explorerBack: () => explorer.back(),
  };
}
