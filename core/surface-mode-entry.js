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

document.documentElement.dataset.surfaceModeEntry = 'v88-flora-ecology-mouse-gamepad';