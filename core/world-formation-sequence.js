const FORMATION_STAGES = [
  {
    id: 'accretion',
    title: 'Accretion',
    detail: 'Dust, ice, and rock collapse into a growing protoplanet.',
  },
  {
    id: 'magma',
    title: 'Magma ocean',
    detail: 'Impacts and compression melt the young world.',
  },
  {
    id: 'core',
    title: 'Core differentiation',
    detail: 'Dense metals sink inward while lighter mantle material rises.',
  },
  {
    id: 'crust',
    title: 'Crust and oceans',
    detail: 'The surface cools, solid crust forms, and water collects in basins.',
  },
  {
    id: 'atmosphere',
    title: 'Atmosphere and weather',
    detail: 'A stable atmosphere develops and circulation begins moving heat and water.',
  },
  {
    id: 'biosphere',
    title: 'Living world',
    detail: 'Vegetation spreads into suitable climates and animal ecosystems emerge.',
  },
];

const DEFAULT_STAGE_MS = 720;
let activePromise = null;
let skipRequested = false;

function hashSeed(seed) {
  let hash = 2166136261;
  for (const character of String(seed || 'nysa')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seedVisuals(root, seed) {
  const hash = hashSeed(seed);
  const rockHue = 10 + (hash % 28);
  const oceanHue = 190 + ((hash >>> 5) % 26);
  const lifeHue = 88 + ((hash >>> 11) % 34);
  root.style.setProperty('--formation-rock-hue', String(rockHue));
  root.style.setProperty('--formation-ocean-hue', String(oceanHue));
  root.style.setProperty('--formation-life-hue', String(lifeHue));
  root.style.setProperty('--formation-tilt', `${-8 + ((hash >>> 17) % 17)}deg`);
}

function buildOverlay() {
  const existing = document.getElementById('worldFormationSequence');
  if (existing) return existing;

  const root = document.createElement('section');
  root.id = 'worldFormationSequence';
  root.className = 'world-formation';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'New world formation');
  root.innerHTML = `
    <div class="world-formation__space" aria-hidden="true">
      <div class="world-formation__dust"></div>
      <div class="world-formation__orbit"></div>
      <div class="world-formation__planet">
        <div class="world-formation__core"></div>
        <div class="world-formation__mantle"></div>
        <div class="world-formation__crust"></div>
        <div class="world-formation__ocean"></div>
        <div class="world-formation__life"></div>
        <div class="world-formation__clouds"></div>
        <div class="world-formation__atmosphere"></div>
      </div>
    </div>
    <div class="world-formation__copy">
      <p class="world-formation__eyebrow">Generating new world</p>
      <h2 data-formation-title>Accretion</h2>
      <p data-formation-detail></p>
      <div class="world-formation__progress" aria-hidden="true"><i data-formation-progress></i></div>
      <p class="world-formation__counter" data-formation-counter></p>
      <button type="button" data-formation-skip>Skip formation</button>
    </div>`;

  root.querySelector('[data-formation-skip]')?.addEventListener('click', () => {
    skipRequested = true;
  });

  document.body.append(root);
  return root;
}

function frame() {
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function setStage(root, stage, index) {
  for (const item of FORMATION_STAGES) root.classList.remove(`world-formation--${item.id}`);
  root.classList.add(`world-formation--${stage.id}`);
  root.dataset.stage = stage.id;
  root.querySelector('[data-formation-title]').textContent = stage.title;
  root.querySelector('[data-formation-detail]').textContent = stage.detail;
  root.querySelector('[data-formation-counter]').textContent = `Stage ${index + 1} of ${FORMATION_STAGES.length}`;
  root.querySelector('[data-formation-progress]').style.width = `${((index + 1) / FORMATION_STAGES.length) * 100}%`;
}

async function start(seed) {
  if (activePromise) return activePromise;

  activePromise = (async () => {
    skipRequested = false;
    const root = buildOverlay();
    seedVisuals(root, seed);
    root.hidden = false;
    root.classList.add('world-formation--active');
    document.documentElement.dataset.worldFormation = 'active';

    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const stageDuration = reducedMotion ? 140 : DEFAULT_STAGE_MS;

    await frame();

    for (let index = 0; index < FORMATION_STAGES.length; index += 1) {
      setStage(root, FORMATION_STAGES[index], index);
      await delay(stageDuration);
      if (skipRequested) break;
    }

    root.classList.add('world-formation--complete');
    root.querySelector('[data-formation-title]').textContent = 'World initialized';
    root.querySelector('[data-formation-detail]').textContent = 'Entering the live simulation.';
    root.querySelector('[data-formation-progress]').style.width = '100%';
    await delay(reducedMotion ? 80 : 360);
  })().finally(() => {
    delete document.documentElement.dataset.worldFormation;
    activePromise = null;
  });

  return activePromise;
}

window.realitySandboxWorldFormation = {
  stages: FORMATION_STAGES.map(stage => ({ ...stage })),
  start,
  skip() { skipRequested = true; },
};
