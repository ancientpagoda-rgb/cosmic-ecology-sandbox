// The richer Surface Mode presentation is loaded only after a visitor enters
// the first-person view. Keeping this bundle separate from the world overview
// preserves quick startup while retaining atmospheric lighting, weather,
// rivers, horizon, celestial detail, and layered procedural flora.
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
import './surface-horizon-v38.js';
import './surface-weather-v39.js';
import './surface-radar-weather-v84.js';
import './surface-large-planet-coverage-v43.js';
// Biome-driven trees/shrubs provide the middle and upper vegetation tiers;
// v88 adds ground cover, readable plant materials, contact shadows, and cheap
// near-field soil/rock/moisture detail without raising distant terrain LOD.
import './surface-vegetation-v38.js?v=20260821-v88';
import './surface-ecology-polish-v88.js?v=20260821-v88';
import './surface-gpu-backend-diagnostics.js';
import './surface-mobile-controls.js';

export const surfaceVisualLayers = 'v88-layered-procedural-ecology';