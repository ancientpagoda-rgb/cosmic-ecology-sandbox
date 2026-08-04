import '../reality-v6-8/bootstrap.js';

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const badge = document.querySelector('.badge');
const loading = document.getElementById('loading');
const buildStatus = document.getElementById('systemBuildStatus');

async function waitForPresentation() {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (
      globalThis.realityV6?.viewer &&
      globalThis.realityV61?.weather &&
      globalThis.realityV65?.coupling &&
      globalThis.realityV68?.presentation
    ) return globalThis.realityV68;
    await sleep(100);
  }
  throw new Error('The V6.8 PixiJS world did not become ready for Howler.js.');
}

function showFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[Reality V6.9 Howler.js]', error);
  const inspect = document.getElementById('inspect');
  if (inspect) inspect.textContent = `The visual simulation is running; audio failed: ${message}`;
  for (const id of ['audioStatus', 'audioStatusSystem']) {
    const element = document.getElementById(id);
    if (element) element.textContent = `Audio unavailable · ${message}`;
  }
}

try {
  await waitForPresentation();
  if (badge) badge.textContent = 'ENGINE V6.9 · HOWLER.JS GENERATIVE SOUNDSCAPE';
  if (buildStatus) buildStatus.textContent = 'PixiJS ready · preparing optional deterministic audio controls…';
  const { createHowlerSoundscape } = await import('./soundscape.js');
  const soundscape = await createHowlerSoundscape();
  if (loading?.isConnected) loading.remove();
  if (buildStatus) buildStatus.textContent = 'Howler.js 2.2.4 · audio unlocks on user input · Three.js and REBOUND remain on demand';
  const inspect = document.getElementById('inspect');
  if (inspect) inspect.textContent = 'Click Sound start for deterministic weather, settlement, tide, seasonal, impact, orbital, and travel audio.';
  globalThis.realityV69 = {
    soundscape,
    start: () => soundscape.start(),
    mute: (muted = true) => soundscape.setMuted(muted),
    setVolume: (volume) => soundscape.setVolume(volume),
  };
} catch (error) {
  showFailure(error);
}
