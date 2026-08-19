// The richer v46e-style Surface Mode presentation is loaded only after a
// visitor enters the first-person view. Keeping this bundle separate from the
// world overview preserves quick startup while retaining the atmospheric
// lighting, weather, rivers, horizon, and celestial detail of the established
// Reality Sandbox surface renderer. The legacy sampled vegetation builder is
// intentionally omitted; v78's native instanced flora is the authoritative
// plant presentation and avoids thousands of background biome samples.
import './surface-wide-pitch-v46d.js';
import './surface-idle-scheduler-v34.js';
import './surface-light-hook-v36.js';
// Keep v38b's stable water mesh authoritative. The later v82 clipped-shore
// rewrite could rebuild already-stabilized water into broken wedges/gaps.
import './surface-water-stability-v38b.js';
import './surface-oss-consolidation-v40.js';
import './surface-flight-v38.js';
import './surface-rivers-v41.js';
import './surface-celestials-v38.js';
import './surface-solar-lighting-v36.js';
import './surface-flora-v78.js';
import './surface-horizon-v38.js';
import './surface-weather-v39.js';
import './surface-radar-weather-v84.js';
import './surface-large-planet-coverage-v43.js';
import './surface-gpu-backend-diagnostics.js';
import './surface-mobile-controls.js';

export const surfaceVisualLayers = 'v84-stable-water-radar-weather';