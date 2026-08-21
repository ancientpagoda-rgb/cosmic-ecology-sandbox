import './pointer-lock-compat.js';
// Install the Three.js capture hooks before the surface renderer creates its
// scene, then attach only the presentation layers needed by the live world.
// The explicit Aug 21 query keys force browsers to load the repaired Surface
// controls/fauna graph even when an older Pages module graph is still cached.
import './surface-light-hook-v36.js?v=20260821-v87';
import './surface-water-stability-v38b.js?v=20260821-v87';
import './surface-water-repair-v85.js?v=20260821-v87';
import './surface-radar-weather-v84.js?v=20260821-v87';
import './surface-mode-sphere-controller-v33.js?v=20260821-v87';
import './surface-fauna-polish-v87.js?v=20260821-v87';
import './surface-desktop-gamepad-controls-v87.js?v=20260821-v87';
import './surface-cpu-relief.js';
import './surface-mode-dblclick-bridge.js';
import './presentation-invariant-compat.js';

document.documentElement.dataset.surfaceModeEntry = 'v87-fauna-mouse-gamepad';