import { Application } from 'pixi.js';

// The overview is drawn before a visitor has interacted with the planet. Keep
// that first frame inside a modest pixel budget; a forced 4K backing canvas
// made otherwise capable machines stutter while the world was still opening.
const STARTUP_LONG_EDGE = 2560;
const STARTUP_PIXEL_BUDGET = 1920 * 1080;
const MAX_STARTUP_RESOLUTION = 1.25;

function chooseUltraHdResolution(width, height) {
  const logicalWidth = Math.max(1, Number(width) || 1);
  const logicalHeight = Math.max(1, Number(height) || 1);
  const longEdge = Math.max(logicalWidth, logicalHeight);
  const longEdgeScale = STARTUP_LONG_EDGE / longEdge;
  const pixelBudgetScale = Math.sqrt(STARTUP_PIXEL_BUDGET / (logicalWidth * logicalHeight));
  const resolution = Math.max(1, Math.min(MAX_STARTUP_RESOLUTION, longEdgeScale, pixelBudgetScale));

  return {
    logicalWidth,
    logicalHeight,
    resolution,
    physicalWidth: Math.max(1, Math.round(logicalWidth * resolution)),
    physicalHeight: Math.max(1, Math.round(logicalHeight * resolution)),
  };
}

if (!Application.prototype.__realityHighResolutionPatched) {
  const originalInit = Application.prototype.init;

  Application.prototype.init = function realityAdaptiveStartupInit(options = {}) {
    const target = chooseUltraHdResolution(options.width, options.height);
    const upgraded = {
      ...options,
      width: target.logicalWidth,
      height: target.logicalHeight,
      antialias: false,
      resolution: target.resolution,
      autoDensity: false,
      preference: 'webgl',
    };

    document.documentElement.dataset.requestedRenderResolution = `${target.physicalWidth}x${target.physicalHeight}`;
    document.documentElement.dataset.internalResolutionScale = target.resolution.toFixed(3);
    document.documentElement.dataset.renderQuality = 'adaptive-startup';

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
  if (canvas) {
    canvas.style.imageRendering = 'auto';
    canvas.dataset.adaptiveResolution = 'true';
  }

  document.documentElement.dataset.renderResolution = canvas ? `${canvas.width}x${canvas.height}` : 'unknown';
}

document.addEventListener('DOMContentLoaded', finishHighResolutionPresentation, { once: true });
