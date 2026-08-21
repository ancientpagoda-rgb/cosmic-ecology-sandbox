// Shared physical scale for the production spherical world.
// Keep the simulation grid and terrain relief unchanged while expanding the
// sphere itself. Values expressed in simulation-grid coordinates that represent
// a local physical distance are divided by PLANET_SCALE so their on-screen
// physical size remains stable on the broader planet.
export const BASE_PLANET_RADIUS = 220;
export const PLANET_SCALE = 10;
export const PLANET_RADIUS = BASE_PLANET_RADIUS * PLANET_SCALE;

export const BASE_LOCAL_PATCH_RADIUS_WORLD = 148;
export const LOCAL_PATCH_RADIUS_WORLD = BASE_LOCAL_PATCH_RADIUS_WORLD / PLANET_SCALE;
export const BASE_PATCH_MOVE_THRESHOLD = 18;
export const PATCH_MOVE_THRESHOLD = BASE_PATCH_MOVE_THRESHOLD / PLANET_SCALE;

export const BASE_WALK_SPEED = 8;
export const BASE_SPRINT_SPEED = 24;
export const WALK_SPEED = BASE_WALK_SPEED / PLANET_SCALE;
export const SPRINT_SPEED = BASE_SPRINT_SPEED / PLANET_SCALE;

export const CAMERA_NEAR = 0.1;
export const CAMERA_FAR = 120000;
export const STARFIELD_MIN_RADIUS = 2600 * PLANET_SCALE;
export const STARFIELD_SPAN = 3200 * PLANET_SCALE;
export const SUN_POSITION = [800 * PLANET_SCALE, 520 * PLANET_SCALE, 420 * PLANET_SCALE];
