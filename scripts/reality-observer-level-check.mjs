import assert from 'node:assert/strict';
import { getCameraResolutionLevel, getInspectorResolutionLevel } from '../core/reality-observer-bridge.js';

assert.equal(getCameraResolutionLevel(1), 'planet');
assert.equal(getCameraResolutionLevel(1.25), 'planet');
assert.equal(getCameraResolutionLevel(1.26), 'region');
assert.equal(getCameraResolutionLevel(3.5), 'patch');
assert.equal(getCameraResolutionLevel(7.99), 'patch');
assert.equal(getCameraResolutionLevel(8), 'entity');
assert.equal(getCameraResolutionLevel(12), 'entity');

assert.equal(getInspectorResolutionLevel(1), 'region');
assert.equal(getInspectorResolutionLevel(1.26), 'patch');
assert.equal(getInspectorResolutionLevel(7.99), 'patch');
assert.equal(getInspectorResolutionLevel(8), 'entity');

console.log(JSON.stringify({
  ok: true,
  camera: { overview: 'planet', regional: 'region', close: 'patch', maximum: 'entity' },
  inspector: { overview: 'region', close: 'patch', maximum: 'entity' },
}, null, 2));
