import { FRONTIER_SEASONS } from '../world.js';

const TICKS_PER_SEASON = 24;

export function runSeasonSystem(world) {
  const nextIndex = Math.floor(world.tick / TICKS_PER_SEASON) % FRONTIER_SEASONS.length;
  if (nextIndex === world.seasonIndex) return;
  world.seasonIndex = nextIndex;
  world.season = FRONTIER_SEASONS[nextIndex];
  if (nextIndex === 0) world.year += 1;
}
