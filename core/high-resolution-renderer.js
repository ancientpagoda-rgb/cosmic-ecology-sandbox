import { Application } from 'pixi.js';

const UHD_LONG_EDGE = 3840;
const UHD_PIXEL_BUDGET = 3840 * 2160;

function chooseUltraHdResolution(width, height) {
  const logicalWidth = Math.max(1, Number(width) || 1);
  const logicalHeight = Math.max(1, Number(height) || 1);
  const longEdge = Math.max(logicalWidth, logicalHeight);
  const longEdgeScale = UHD_LONG_EDGE / longEdge;
  const pixelBudgetScale = Math.sqrt(UHD_PIXEL_BUDGET / (logicalWidth * logicalHeight));
  const resolution = Math.max(1, Math.min(longEdgeScale, pixelBudgetScale));

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

  Application.prototype.init = function realityUltraHdInit(options = {}) {
    const target = chooseUltraHdResolution(options.width, options.height);
    const upgraded = {
      ...options,
      width: target.logicalWidth,
      height: target.logicalHeight,
      antialias: true,
      resolution: target.resolution,
      autoDensity: false,
      preference: 'webgl',
    };

    document.documentElement.dataset.requestedRenderResolution = `${target.physicalWidth}x${target.physicalHeight}`;
    document.documentElement.dataset.internalResolutionScale = target.resolution.toFixed(3);
    document.documentElement.dataset.renderQuality = 'ultra-hd-4k-supersampled';

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
    canvas.dataset.ultraHd = 'true';
  }

  document.documentElement.dataset.renderResolution = canvas ? `${canvas.width}x${canvas.height}` : 'unknown';
}

document.addEventListener('DOMContentLoaded', finishHighResolutionPresentation, { once: true });
