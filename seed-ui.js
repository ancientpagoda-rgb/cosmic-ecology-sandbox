const DEFAULT_SEED = 'eidolon-living-planet-734221';

function normalizeSeed(value) {
  return String(value || '')
    .trim()
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .slice(0, 96);
}

function currentSeed() {
  return window.realitySandboxSeed?.seed
    || normalizeSeed(new URLSearchParams(location.search).get('seed'))
    || DEFAULT_SEED;
}

function worldUrl(seed) {
  const url = new URL(location.href);
  url.searchParams.set('seed', normalizeSeed(seed) || DEFAULT_SEED);
  url.hash = '';
  return url;
}

function randomSeed() {
  const values = new Uint32Array(3);
  if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(values);
  else {
    values[0] = Date.now() >>> 0;
    values[1] = Math.floor(Math.random() * 0xffffffff);
    values[2] = performance.now() >>> 0;
  }
  return `eidolon-${[...values].map(value => value.toString(36).padStart(7, '0')).join('-')}`;
}

function navigateToSeed(seed) {
  const normalized = normalizeSeed(seed);
  if (!normalized) return false;
  location.assign(worldUrl(normalized));
  return true;
}

async function copyWorldLink(seed, button, status) {
  const link = worldUrl(seed).toString();
  try {
    await navigator.clipboard.writeText(link);
  } catch {
    const area = document.createElement('textarea');
    area.value = link;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  const oldText = button.textContent;
  button.textContent = 'Copied';
  status.textContent = 'Seed link copied. It recreates this generated world.';
  setTimeout(() => {
    button.textContent = oldText;
    status.textContent = '';
  }, 1800);
}

async function formNewWorld(seed, controls, input, status) {
  const normalized = normalizeSeed(seed);
  if (!normalized) return false;

  input.value = normalized;
  status.textContent = 'Forming new world…';
  const interactive = [...controls.querySelectorAll('button, input')];
  for (const element of interactive) element.disabled = true;

  try {
    const formation = window.realitySandboxWorldFormation;
    if (formation?.start) await formation.start(normalized);
  } catch (error) {
    console.warn('World formation presentation failed; loading world directly.', error);
  }

  return navigateToSeed(normalized);
}

function installSeedControls() {
  const dashboard = document.querySelector('.planet-dashboard');
  if (!dashboard || dashboard.querySelector('[data-world-seed-controls]')) return Boolean(dashboard);

  const controls = document.createElement('form');
  controls.className = 'planet-world-controls';
  controls.dataset.worldSeedControls = '';
  controls.innerHTML = `
    <label class="planet-seed-field">
      <span>World seed</span>
      <input type="text" data-world-seed maxlength="96" autocomplete="off" spellcheck="false" aria-label="World seed">
    </label>
    <div class="planet-seed-actions">
      <button type="submit">Load</button>
      <button type="button" data-new-world>New World</button>
      <button type="button" data-copy-world>Copy Link</button>
      <a class="planet-origin-link" href="./origins.html">Trace origins</a>
    </div>
    <output class="planet-seed-status" data-seed-status aria-live="polite"></output>`;

  const help = dashboard.querySelector('.planet-help');
  dashboard.insertBefore(controls, help || null);

  const input = controls.querySelector('[data-world-seed]');
  const newButton = controls.querySelector('[data-new-world]');
  const copyButton = controls.querySelector('[data-copy-world]');
  const status = controls.querySelector('[data-seed-status]');
  input.value = currentSeed();

  controls.addEventListener('submit', event => {
    event.preventDefault();
    if (!navigateToSeed(input.value)) {
      status.textContent = 'Enter a seed first.';
      input.focus();
    }
  });

  newButton.addEventListener('click', () => {
    if (newButton.disabled) return;
    formNewWorld(randomSeed(), controls, input, status);
  });
  copyButton.addEventListener('click', () => copyWorldLink(input.value || currentSeed(), copyButton, status));
  return true;
}

function beginWatching() {
  if (installSeedControls()) return;
  const observer = new MutationObserver(() => {
    if (installSeedControls()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 15000);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', beginWatching, { once: true });
else beginWatching();
window.addEventListener('reality-sandbox-seed-ready', installSeedControls);
