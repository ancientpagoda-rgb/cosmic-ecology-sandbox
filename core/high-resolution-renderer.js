import { Application } from 'pixi.js';

const INTERNAL_RESOLUTION_SCALE = 2;

if (!Application.prototype.__realityHighResolutionPatched) {
  const originalInit = Application.prototype.init;

  Application.prototype.init = function realityHighResolutionInit(options = {}) {
    const width = Number(options.width) || 1;
    const height = Number(options.height) || 1;
    const upgraded = {
      ...options,
      width: Math.max(1, Math.round(width * INTERNAL_RESOLUTION_SCALE)),
      height: Math.max(1, Math.round(height * INTERNAL_RESOLUTION_SCALE)),
      antialias: true,
      resolution: 1,
    };
    return originalInit.call(this, upgraded);
  };

  Application.prototype.__realityHighResolutionPatched = true;
}

async function finishHighResolutionPresentation() {
  try {
    await window.realitySandboxReady;
  } catch {
    return;
  }

  const canvas = document.getElementById('lofiLivingCanvas');
  if (canvas) canvas.style.imageRendering = 'auto';

  document.documentElement.dataset.internalResolutionScale = String(INTERNAL_RESOLUTION_SCALE);
  document.documentElement.dataset.renderResolution = canvas ? `${canvas.width}x${canvas.height}` : 'unknown';
}

document.addEventListener('DOMContentLoaded', finishHighResolutionPresentation, { once: true });
