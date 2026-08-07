import { Graphics } from 'pixi.js';

const COARSE_TILE = 12;
const BASE_TILE = 3;
const originalRect = Graphics.prototype.rect;
const originalFill = Graphics.prototype.fill;

function interacting() {
  return document.getElementById('lofiLivingCanvas')?.dataset.dragging === 'true';
}

if (!Graphics.prototype.__realityInteractionFastPath) {
  Graphics.prototype.rect = function realityFastRect(x, y, width, height) {
    if (interacting() && width === BASE_TILE && height === BASE_TILE) {
      const gx = Math.round(x / BASE_TILE);
      const gy = Math.round(y / BASE_TILE);
      const stride = Math.max(1, Math.round(COARSE_TILE / BASE_TILE));
      if (gx % stride || gy % stride) {
        this.__realitySkipFill = true;
        return this;
      }
      this.__realitySkipFill = false;
      return originalRect.call(this, x, y, COARSE_TILE, COARSE_TILE);
    }

    this.__realitySkipFill = false;
    return originalRect.call(this, x, y, width, height);
  };

  Graphics.prototype.fill = function realityFastFill(...args) {
    if (this.__realitySkipFill) {
      this.__realitySkipFill = false;
      return this;
    }
    return originalFill.apply(this, args);
  };

  Graphics.prototype.__realityInteractionFastPath = true;
}
