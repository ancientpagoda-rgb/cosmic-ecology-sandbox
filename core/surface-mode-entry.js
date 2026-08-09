import './pointer-lock-compat.js';
// The original project’s production surface stack: a lightweight controller,
// cached CPU reads, and a view-priority WebGL terrain renderer. Keeping these
// separate prevents simulation work from leaking into the display frame.
import './surface-mode-sphere-controller-v33.js';
import './surface-cpu-relief.js';
import './surface-terrain-water-sphere-gpu-v37.js';
import './surface-mode-dblclick-bridge.js';
import './presentation-invariant-compat.js';
