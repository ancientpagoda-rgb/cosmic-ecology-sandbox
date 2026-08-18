import './pointer-lock-compat.js';
// Install the Three.js capture hook before the surface renderer creates its
// scene, then attach only the plant presentation layers needed by the flora
// world. This keeps the current production controller authoritative without
// re-enabling the retired presentation bundle.
import './surface-light-hook-v36.js';
import './surface-mode-sphere-controller-v33.js';
import './surface-cpu-relief.js';
import './surface-mode-dblclick-bridge.js';
import './presentation-invariant-compat.js';
import './surface-flora-v78.js';