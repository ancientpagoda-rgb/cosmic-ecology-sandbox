import { Application } from 'pixi.js';

const UHD_LONG_EDGE = 3840;
const UHD_PIXEL_BUDGET = 3840 * 2160;
const BASE_LOGICAL_LONG_EDGE = 420;

function fitUltraHd(width, height) {
  const sourceWidth = Math.max(1, Number(width) || 1);
  const sourceHeight = Math.max(1, Number(height) || 1);
  const longEdge = Math.max(sourceWidth, sourceHeight);
  let scale = UHD_LONG_EDGE / longEdge;

  let upgradedWidth = Math.max(1, Math.round(sourceWidth * scale));
  let upgradedHeight = Math.max(1, Math.round(sourceHeight * scale));
  const pixels = upgradedWidth * upgradedHeight;

  if (pixels > UHD_PIXEL_BUDGET) {
    const budgetScale = Math.sqrt(UHD_PIXEL_BUDGET / pixels);
    upgradedWidth = Math.max(1, Math.round(upgradedWidth * budgetScale));
    upgradedHeight = Math.max(1, Math.round(upgradedHeight * budgetScale));
    scale *= budgetScale;
  }

  return {
    width: upgradedWidth,
    height: upgradedHeight,
    scale,
  };
}

if (!Application.prototype.__realityHighResolutionPatched) {
  const originalInit = Application.prototype.init;

  Application.prototype.init = function realityUltraHdInit(options = {}) {
    const target = fitUltraHd(options.width, options.height);
    const upgraded = {
      ...options,
      width: target.width,
      height: target.height,
      antialias: true,
      resolution: 1,
      autoDensity: false,
      preference: 'webgl',
    };

    document.documentElement.dataset.requestedRenderResolution = `${target.width}x${target.height}`;
    document.documentElement.dataset.internalResolutionScale = target.scale.toFixed(3);
    document.documentElement.dataset.renderQuality = 'ultra-hd-4k';

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
  document.documentElement.dataset.baseLogicalLongEdge = String(BASE_LOGICAL_LONG_EDGE);
}

document.addEventListener('DOMContentLoaded', finishHighResolutionPresentation, { once: true });
