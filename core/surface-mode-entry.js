import './pointer-lock-compat.js';
// Install the Three.js capture hooks before the surface renderer creates its
// scene, then attach only the presentation layers needed by the live world.
// The explicit Aug 21 query keys force browsers to load the repaired Surface
// flora/ecology graph even when an older Pages module graph is still cached.
import './surface-light-hook-v36.js?v=20260821-v88';
import './surface-water-stability-v38b.js?v=20260821-v88';
import './surface-water-repair-v85.js?v=20260821-v88';
import './surface-radar-weather-v84.js?v=20260821-v88';
import './surface-mode-sphere-controller-v33.js?v=20260821-v88';
// Convert the ecological population slots into rooted hierarchical plants
// before the fauna fallback gets a chance to polish the legacy animal mesh.
import './surface-flora-v78.js?v=20260821-v88';
import './surface-fauna-polish-v87.js?v=20260821-v88';
import './surface-desktop-gamepad-controls-v87.js?v=20260821-v88';
import './surface-cpu-relief.js';
import './surface-mode-dblclick-bridge.js';
import './presentation-invariant-compat.js';

// v33 intentionally lazy-loads its visual bundle after Surface Mode is entered.
// Import the same bundle with a v88 key at that exact moment so Pages/browser
// caches cannot strand a visitor on the previous native-fauna presentation.
let v88VisualsRequested = false;
function requestV88Visuals() {
  if (v88VisualsRequested || document.documentElement.dataset.surfaceMode !== 'active') return;
  v88VisualsRequested = true;
  import('./surface-visual-layers.js?v=20260821-v88').catch(error => {
    v88VisualsRequested = false;
    console.warn('[Surface Mode] v88 ecology visuals could not start.', error);
  });
}
const surfaceModeObserver = new MutationObserver(requestV88Visuals);
surfaceModeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-surface-mode'] });
requestV88Visuals();

document.documentElement.dataset.surfaceModeEntry = 'v88-flora-ecology-mouse-gamepad';