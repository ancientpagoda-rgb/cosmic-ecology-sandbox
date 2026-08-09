// The richer v46e-style Surface Mode presentation is loaded only after a
// visitor enters the first-person view. Keeping this bundle separate from the
// world overview preserves quick startup while retaining the atmospheric
// lighting, weather, vegetation, rivers, horizon, and celestial detail of the
// established Reality Sandbox surface renderer.
import './surface-wide-pitch-v46d.js';
import './surface-idle-scheduler-v34.js';
import './surface-light-hook-v36.js';
import './surface-water-stability-v38b.js';
import './surface-oss-consolidation-v40.js';
import './surface-flight-v38.js';
import './surface-rivers-v41.js';
import './surface-celestials-v38.js';
import './surface-solar-lighting-v36.js';
import './surface-vegetation-v38.js';
import './surface-horizon-v38.js';
import './surface-weather-v39.js';
import './surface-large-planet-coverage-v43.js';
import './surface-gpu-backend-diagnostics.js';
import './surface-mobile-controls.js';

export const surfaceVisualLayers = 'v46e-lazy';
