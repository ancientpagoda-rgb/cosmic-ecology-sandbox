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
// The explicit classic fallback is the plant-focused diagnostic presentation.
// Keep its authoritative fauna-shaped instance slot conversion owned by the
// grounded flora hook; the public spherical renderer owns the readable animal
// presentation repaired by spherical-production-polish-v88.js.
import './surface-flora-v78.js?v=20260821-v88';
import './surface-desktop-gamepad-controls-v87.js?v=20260821-v88';
import './surface-cpu-relief.js';
import './surface-mode-dblclick-bridge.js';
import './presentation-invariant-compat.js';

document.documentElement.dataset.surfaceModeEntry = 'v88-flora-ecology-mouse-gamepad';