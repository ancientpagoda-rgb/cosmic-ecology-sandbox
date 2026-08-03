import '../reality-v6-3/app.js';

const REBOUND_URL = 'https://rebound.hanno-rein.de/c_examples_emscripten/high_order_symplectic/';
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForWorld() {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (window.realityV6?.viewer && window.realityV6?.simulation) return window.realityV6;
    await sleep(50);
  }
  throw new Error('The living world did not finish starting.');
}

function compactNumber(value) {
  if (value < 1_000) return Math.round(value).toLocaleString();
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)}k`;
  if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(2)}m`;
  return `${(value / 1_000_000_000).toFixed(2)}b`;
}

function formatYears(value) {
  if (value < 1_000) return `${Math.round(value).toLocaleString()} years`;
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)} thousand years`;
  return `${(value / 1_000_000).toFixed(2)} million years`;
}

try {
  const { viewer, simulation } = await waitForWorld();
  const enterButton = document.getElementById('enterSystem');
  const returnButton = document.getElementById('returnSurface');
  const reloadButton = document.getElementById('reloadRebound');
  const frame = document.getElementById('reboundFrame');
  const frameLoading = document.getElementById('reboundLoading');
  const systemStatus = document.getElementById('systemStatus');
  const surfaceSummary = document.getElementById('surfaceSummary');
  const worldSpeed = document.getElementById('speed');
  let systemActive = false;
  let storedWorldSpeed = Number(worldSpeed.value) || 0;
  let frameStarted = false;
  let lastSummary = 0;

  function loadRebound(force = false) {
    if (force) {
      frameStarted = false;
      frame.removeAttribute('src');
    }
    if (frameStarted) return;
    frameStarted = true;
    frameLoading.hidden = false;
    frame.src = `${REBOUND_URL}?reality-sandbox=${Date.now()}`;
  }

  frame.addEventListener('load', () => {
    frameLoading.hidden = true;
    systemStatus.textContent = 'REBOUND v5.1.1 · WebAssembly · high-order symplectic Solar System';
  });

  async function enterSystemView() {
    if (systemActive) return;
    systemActive = true;
    storedWorldSpeed = Number(worldSpeed.value) || 0;
    worldSpeed.value = '0';
    worldSpeed.dispatchEvent(new Event('input', { bubbles: true }));
    enterButton.disabled = true;
    systemStatus.textContent = 'Leaving the atmosphere…';

    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(18, 12, 56_000_000),
      duration: 1.15,
      complete() {
        document.body.classList.add('system-active');
        loadRebound();
        enterButton.disabled = false;
      },
      cancel() {
        document.body.classList.add('system-active');
        loadRebound();
        enterButton.disabled = false;
      },
    });
  }

  function returnToSurface() {
    if (!systemActive) return;
    systemActive = false;
    document.body.classList.remove('system-active');
    worldSpeed.value = String(storedWorldSpeed);
    worldSpeed.dispatchEvent(new Event('input', { bubbles: true }));
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(18, 12, 17_000_000),
      duration: 1.1,
    });
  }

  function updateSummary(now = performance.now()) {
    if (now - lastSummary < 750) return;
    lastSummary = now;
    const stats = simulation.stats();
    surfaceSummary.innerHTML = [
      `<strong>Living planet</strong>`,
      `${formatYears(stats.years)} old`,
      `${compactNumber(stats.population)} population`,
      `${stats.settlements} cities · ${stats.rivers} river links`,
      `${stats.forestPercent}% forest`,
    ].join('<br>');
  }

  enterButton.addEventListener('click', enterSystemView);
  returnButton.addEventListener('click', returnToSurface);
  reloadButton.addEventListener('click', () => loadRebound(true));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && systemActive) returnToSurface();
  });

  document.getElementById('openReboundStandalone').href = REBOUND_URL;

  function animate(now) {
    requestAnimationFrame(animate);
    updateSummary(now);
  }

  updateSummary();
  requestAnimationFrame(animate);
  window.realityV64 = {
    enterSystemView,
    returnToSurface,
    reloadRebound: () => loadRebound(true),
    reboundUrl: REBOUND_URL,
  };
} catch (error) {
  const status = document.getElementById('systemStatus');
  if (status) status.textContent = `System view failed to start: ${error.message}`;
  console.error(error);
}
