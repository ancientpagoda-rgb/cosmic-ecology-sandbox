const FORMATION_STAGES = [
  {
    id: 'accretion',
    title: 'Accretion',
    detail: 'Dust, ice, and rock collide and merge into a growing protoplanet.',
  },
  {
    id: 'magma',
    title: 'Magma ocean',
    detail: 'Impacts and compression melt the young world while hot material convects inside it.',
  },
  {
    id: 'core',
    title: 'Core differentiation',
    detail: 'Dense metals sink inward as lighter silicate mantle rises around the forming core.',
  },
  {
    id: 'crust',
    title: 'Crust and volcanism',
    detail: 'The surface begins to freeze into crust while volcanoes recycle heat and gases upward.',
  },
  {
    id: 'atmosphere',
    title: 'Atmosphere and outgassing',
    detail: 'Volcanic gases build an atmosphere as the cooling world begins a global water cycle.',
  },
  {
    id: 'ocean',
    title: 'Rain and oceans',
    detail: 'Long rains cool the surface and water collects into the lowest basins.',
  },
  {
    id: 'biosphere',
    title: 'Living world',
    detail: 'Vegetation spreads outward through suitable climates, followed by mobile animal ecosystems.',
  },
];

const DEFAULT_STAGE_MS = 820;
let activePromise = null;
let skipRequested = false;

function hash32(text) {
  let hash = 2166136261;
  for (const character of String(text || 'nysa')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

function seededUnit(seed, salt, index = 0) {
  return hash32(`${seed}:${salt}:${index}`) / 4294967296;
}

function seedVisuals(root, seed) {
  const hash = hash32(seed);
  const rockHue = 10 + (hash % 28);
  const oceanHue = 190 + ((hash >>> 5) % 26);
  const lifeHue = 88 + ((hash >>> 11) % 34);
  root.style.setProperty('--formation-rock-hue', String(rockHue));
  root.style.setProperty('--formation-ocean-hue', String(oceanHue));
  root.style.setProperty('--formation-life-hue', String(lifeHue));
  root.style.setProperty('--formation-tilt', `${-8 + ((hash >>> 17) % 17)}deg`);
}

function installPhysicalEffectStyles() {
  if (document.getElementById('worldFormationPhysicalStyles')) return;
  const style = document.createElement('style');
  style.id = 'worldFormationPhysicalStyles';
  style.textContent = `
    .world-formation__impact-field {
      position:absolute; inset:0; pointer-events:none; z-index:30; opacity:0; transition:opacity .25s ease;
    }
    .world-formation__impact {
      position:absolute; left:var(--x); top:var(--y); width:5px; height:5px; border-radius:50%;
      background:#ffd38a; box-shadow:0 0 9px #ff8b38, -9px -4px 11px rgba(255,162,80,.34);
      opacity:0; transform:translate(var(--from-x),var(--from-y)) scale(.45);
      animation:worldFormationImpact var(--duration) cubic-bezier(.18,.62,.24,1) var(--delay) infinite;
    }
    .world-formation__impact::after {
      content:''; position:absolute; inset:-8px; border:1px solid rgba(255,183,100,.62); border-radius:50%;
      transform:scale(.15); opacity:0;
      animation:worldFormationShock var(--duration) ease-out var(--delay) infinite;
    }
    .world-formation--accretion .world-formation__impact-field { opacity:1; }

    .world-formation__convection { position:absolute; inset:9%; z-index:6; border-radius:50%; overflow:hidden; opacity:0; pointer-events:none; }
    .world-formation__convection i {
      position:absolute; left:var(--x); top:var(--y); width:var(--size); height:calc(var(--size) * .48); border-radius:50%;
      background:radial-gradient(ellipse,rgba(255,218,91,.78),rgba(255,102,35,.34) 46%,transparent 72%);
      filter:blur(2px); animation:worldFormationConvection var(--speed) ease-in-out var(--delay) infinite alternate;
    }
    .world-formation--magma .world-formation__convection,
    .world-formation--core .world-formation__convection { opacity:1; }

    .world-formation__volcanism { position:absolute; inset:0; z-index:13; opacity:0; pointer-events:none; transition:opacity .3s ease; }
    .world-formation__volcano {
      position:absolute; left:var(--x); top:var(--y); width:8px; height:15px; transform:translate(-50%,-50%) rotate(var(--rotate));
      clip-path:polygon(50% 0,100% 100%,0 100%); background:linear-gradient(to bottom,#ffc25e 0 12%,#7c3824 25% 100%);
      filter:drop-shadow(0 0 3px rgba(255,107,40,.75));
    }
    .world-formation__volcano::after {
      content:''; position:absolute; left:50%; top:-10px; width:10px; height:14px; border-radius:50%;
      background:radial-gradient(circle,rgba(205,198,186,.7),rgba(119,111,105,.15) 65%,transparent 72%);
      transform:translateX(-50%) scale(.45); animation:worldFormationPlume .72s ease-out var(--delay) infinite;
    }
    .world-formation--crust .world-formation__volcanism,
    .world-formation--atmosphere .world-formation__volcanism { opacity:1; }
    .world-formation--ocean .world-formation__volcanism { opacity:.38; }

    .world-formation__rain { position:absolute; inset:0; overflow:hidden; border-radius:50%; z-index:16; opacity:0; transition:opacity .28s ease; pointer-events:none; }
    .world-formation__raindrop {
      position:absolute; left:var(--x); top:var(--y); width:1px; height:var(--length); border-radius:2px;
      background:rgba(156,216,239,.82); transform:rotate(9deg); animation:worldFormationRain var(--speed) linear var(--delay) infinite;
    }
    .world-formation--atmosphere .world-formation__rain { opacity:.24; }
    .world-formation--ocean .world-formation__rain { opacity:1; }
    .world-formation--biosphere .world-formation__rain { opacity:.18; }

    .world-formation__ocean { transform:scale(.45); filter:saturate(.8); transition:opacity .52s ease,transform .8s ease,filter .8s ease; }
    .world-formation--crust .world-formation__ocean { opacity:.08; transform:scale(.38); }
    .world-formation--atmosphere .world-formation__ocean { opacity:.22; transform:scale(.58); }
    .world-formation--ocean .world-formation__ocean,
    .world-formation--biosphere .world-formation__ocean,
    .world-formation--complete .world-formation__ocean { opacity:.9; transform:scale(1); filter:saturate(1.12); }

    .world-formation__life-spread { position:absolute; inset:0; overflow:hidden; border-radius:50%; z-index:17; opacity:0; pointer-events:none; }
    .world-formation__life-bloom {
      position:absolute; left:var(--x); top:var(--y); width:var(--size); height:var(--size); border-radius:50%;
      background:radial-gradient(circle,hsla(var(--formation-life-hue) 66% 46%/.9),hsla(var(--formation-life-hue) 52% 34%/.62) 48%,transparent 72%);
      transform:translate(-50%,-50%) scale(.02); opacity:0;
    }
    .world-formation--biosphere .world-formation__life-spread,
    .world-formation--complete .world-formation__life-spread { opacity:1; }
    .world-formation--biosphere .world-formation__life-bloom,
    .world-formation--complete .world-formation__life-bloom {
      animation:worldFormationLifeSpread 1.35s cubic-bezier(.15,.65,.2,1) var(--delay) forwards;
    }

    .world-formation__animals { position:absolute; inset:0; overflow:hidden; border-radius:50%; z-index:19; opacity:0; pointer-events:none; transition:opacity .4s ease .32s; }
    .world-formation__animal {
      position:absolute; left:var(--x); top:var(--y); width:8px; height:3px; border-radius:70% 45% 55% 60%;
      background:rgba(237,222,184,.92); box-shadow:-3px 2px 0 -1px rgba(237,222,184,.78),3px 2px 0 -1px rgba(237,222,184,.72);
      transform:translate(-50%,-50%) rotate(var(--heading)); animation:worldFormationAnimalWalk 1.5s ease-in-out var(--delay) infinite alternate;
    }
    .world-formation--biosphere .world-formation__animals,
    .world-formation--complete .world-formation__animals { opacity:1; }

    .world-formation--ocean .world-formation__planet,
    .world-formation--atmosphere .world-formation__planet { opacity:1; transform:rotate(var(--formation-tilt)) scale(1); }
    .world-formation--ocean .world-formation__crust,
    .world-formation--ocean .world-formation__atmosphere { opacity:1; clip-path:none; }
    .world-formation--ocean .world-formation__clouds { opacity:.94; }
    .world-formation--ocean .world-formation__core { opacity:.7; }
    .world-formation--ocean .world-formation__mantle { opacity:.86; }

    @keyframes worldFormationImpact {
      0% { opacity:0; transform:translate(var(--from-x),var(--from-y)) scale(.35); }
      18% { opacity:1; }
      67% { opacity:1; transform:translate(0,0) scale(.85); }
      72%,100% { opacity:0; transform:translate(0,0) scale(1.8); }
    }
    @keyframes worldFormationShock {
      0%,62% { opacity:0; transform:scale(.12); }
      70% { opacity:.9; }
      100% { opacity:0; transform:scale(3.1); }
    }
    @keyframes worldFormationConvection {
      from { transform:translate(-22%,-18%) rotate(-8deg) scale(.82); }
      to { transform:translate(24%,20%) rotate(13deg) scale(1.22); }
    }
    @keyframes worldFormationPlume {
      0% { opacity:0; transform:translate(-50%,4px) scale(.35); }
      35% { opacity:.75; }
      100% { opacity:0; transform:translate(-50%,-18px) scale(1.6); }
    }
    @keyframes worldFormationRain {
      from { transform:translateY(-18px) rotate(9deg); opacity:0; }
      14% { opacity:1; }
      to { transform:translateY(78px) rotate(9deg); opacity:0; }
    }
    @keyframes worldFormationLifeSpread {
      0% { transform:translate(-50%,-50%) scale(.02); opacity:0; }
      18% { opacity:.86; }
      100% { transform:translate(-50%,-50%) scale(1); opacity:.82; }
    }
    @keyframes worldFormationAnimalWalk {
      from { transform:translate(-55%,-50%) rotate(var(--heading)); }
      to { transform:translate(55%,-50%) rotate(var(--heading)); }
    }
  `;
  document.head.append(style);
}

function appendSeededEffects(root, seed) {
  const impactField = root.querySelector('[data-formation-impacts]');
  const convection = root.querySelector('[data-formation-convection]');
  const volcanism = root.querySelector('[data-formation-volcanism]');
  const rain = root.querySelector('[data-formation-rain]');
  const life = root.querySelector('[data-formation-life-spread]');
  const animals = root.querySelector('[data-formation-animals]');

  const fill = (container, count, className, configure) => {
    container.replaceChildren();
    for (let index = 0; index < count; index += 1) {
      const item = document.createElement('i');
      item.className = className;
      configure(item, index);
      container.append(item);
    }
  };

  fill(impactField, 16, 'world-formation__impact', (item, index) => {
    const angle = seededUnit(seed, 'impact-angle', index) * Math.PI * 2;
    const distance = 95 + seededUnit(seed, 'impact-distance', index) * 135;
    item.style.setProperty('--x', `${18 + seededUnit(seed, 'impact-x', index) * 64}%`);
    item.style.setProperty('--y', `${17 + seededUnit(seed, 'impact-y', index) * 66}%`);
    item.style.setProperty('--from-x', `${Math.cos(angle) * distance}px`);
    item.style.setProperty('--from-y', `${Math.sin(angle) * distance}px`);
    item.style.setProperty('--delay', `${seededUnit(seed, 'impact-delay', index) * 1.05}s`);
    item.style.setProperty('--duration', `${0.62 + seededUnit(seed, 'impact-duration', index) * 0.55}s`);
  });

  fill(convection, 7, 'world-formation__convection-cell', (item, index) => {
    item.style.setProperty('--x', `${8 + seededUnit(seed, 'conv-x', index) * 70}%`);
    item.style.setProperty('--y', `${10 + seededUnit(seed, 'conv-y', index) * 70}%`);
    item.style.setProperty('--size', `${38 + seededUnit(seed, 'conv-size', index) * 42}%`);
    item.style.setProperty('--delay', `${seededUnit(seed, 'conv-delay', index) * -1.6}s`);
    item.style.setProperty('--speed', `${1.2 + seededUnit(seed, 'conv-speed', index) * 1.1}s`);
  });

  fill(volcanism, 5, 'world-formation__volcano', (item, index) => {
    item.style.setProperty('--x', `${22 + seededUnit(seed, 'volcano-x', index) * 56}%`);
    item.style.setProperty('--y', `${25 + seededUnit(seed, 'volcano-y', index) * 52}%`);
    item.style.setProperty('--rotate', `${-14 + seededUnit(seed, 'volcano-rot', index) * 28}deg`);
    item.style.setProperty('--delay', `${seededUnit(seed, 'volcano-delay', index) * -0.7}s`);
  });

  fill(rain, 28, 'world-formation__raindrop', (item, index) => {
    item.style.setProperty('--x', `${12 + seededUnit(seed, 'rain-x', index) * 76}%`);
    item.style.setProperty('--y', `${5 + seededUnit(seed, 'rain-y', index) * 44}%`);
    item.style.setProperty('--length', `${7 + seededUnit(seed, 'rain-length', index) * 9}px`);
    item.style.setProperty('--delay', `${seededUnit(seed, 'rain-delay', index) * -0.8}s`);
    item.style.setProperty('--speed', `${0.38 + seededUnit(seed, 'rain-speed', index) * 0.36}s`);
  });

  fill(life, 10, 'world-formation__life-bloom', (item, index) => {
    item.style.setProperty('--x', `${20 + seededUnit(seed, 'life-x', index) * 60}%`);
    item.style.setProperty('--y', `${20 + seededUnit(seed, 'life-y', index) * 60}%`);
    item.style.setProperty('--size', `${28 + seededUnit(seed, 'life-size', index) * 48}%`);
    item.style.setProperty('--delay', `${index * 0.09 + seededUnit(seed, 'life-delay', index) * 0.18}s`);
  });

  fill(animals, 7, 'world-formation__animal', (item, index) => {
    item.style.setProperty('--x', `${26 + seededUnit(seed, 'animal-x', index) * 48}%`);
    item.style.setProperty('--y', `${30 + seededUnit(seed, 'animal-y', index) * 44}%`);
    item.style.setProperty('--heading', `${-28 + seededUnit(seed, 'animal-heading', index) * 56}deg`);
    item.style.setProperty('--delay', `${seededUnit(seed, 'animal-delay', index) * -1.3}s`);
  });
}

function buildOverlay() {
  const existing = document.getElementById('worldFormationSequence');
  if (existing) return existing;

  installPhysicalEffectStyles();

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
      <div class="world-formation__impact-field" data-formation-impacts></div>
      <div class="world-formation__planet">
        <div class="world-formation__core"></div>
        <div class="world-formation__mantle"></div>
        <div class="world-formation__convection" data-formation-convection></div>
        <div class="world-formation__crust"></div>
        <div class="world-formation__ocean"></div>
        <div class="world-formation__life"></div>
        <div class="world-formation__volcanism" data-formation-volcanism></div>
        <div class="world-formation__clouds"></div>
        <div class="world-formation__rain" data-formation-rain></div>
        <div class="world-formation__life-spread" data-formation-life-spread></div>
        <div class="world-formation__animals" data-formation-animals></div>
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
    appendSeededEffects(root, seed);
    root.hidden = false;
    root.classList.remove('world-formation--complete');
    root.classList.add('world-formation--active');
    document.documentElement.dataset.worldFormation = 'active';

    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const stageDuration = reducedMotion ? 150 : DEFAULT_STAGE_MS;

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
    await delay(reducedMotion ? 80 : 420);
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
