import './pointer-lock-compat.js';
// Install the Three.js capture hook before the surface renderer creates its
// scene, then attach only the plant presentation layers needed by the flora
// world. The explicit Aug 19 query keys force browsers to load the repaired
// Surface hooks even when an older module graph is still cached.
import './surface-light-hook-v36.js?v=20260819-v85';
import './surface-water-stability-v38b.js?v=20260819-v85';
import './surface-water-repair-v85.js?v=20260819-v85';
import './surface-radar-weather-v84.js?v=20260819-v85';
import './surface-mode-sphere-controller-v33.js?v=20260819-v85';
import './surface-cpu-relief.js';
import './surface-mode-dblclick-bridge.js';
import './presentation-invariant-compat.js';
import './surface-flora-v78.js';

document.documentElement.dataset.surfaceModeEntry = 'v85-water-radar-cache-refresh';