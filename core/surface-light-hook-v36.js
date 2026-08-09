import * as THREE from 'three';

(() => {
  if (window.realitySandboxSurfaceLightHookV36?.installed) return;

  const state = {
    scene: null,
    sun: null,
    hemisphere: null,
    renderer: null,
    camera: null,
    sceneCaptures: 0,
    renderCaptures: 0,
  };

  const nativeSceneAdd = THREE.Scene.prototype.add;
  THREE.Scene.prototype.add = function captureSurfaceLights(...objects) {
    for (const object of objects) {
      if (
        object?.isHemisphereLight &&
        Math.abs(Number(object.intensity) - 1.8) < 0.08
      ) {
        state.scene = this;
        state.hemisphere = object;
        state.sceneCaptures++;
      }
      if (
        object?.isDirectionalLight &&
        Math.abs(Number(object.intensity) - 2.35) < 0.08 &&
        object.color?.getHex?.() === 0xfff0d2
      ) {
        state.scene = this;
        state.sun = object;
        state.sceneCaptures++;
      }
    }
    return nativeSceneAdd.apply(this, objects);
  };

  const nativeRender = THREE.WebGLRenderer.prototype.render;
  THREE.WebGLRenderer.prototype.render = function captureSurfaceRenderer(scene, camera) {
    if (scene === state.scene && state.sun && state.hemisphere) {
      state.renderer = this;
      state.camera = camera;
      state.renderCaptures++;
    }
    return nativeRender.call(this, scene, camera);
  };

  const api = {
    installed: true,
    getObjects: () => state,
    getStats: () => ({
      installed: true,
      sceneCaptured: Boolean(state.scene),
      sunCaptured: Boolean(state.sun),
      hemisphereCaptured: Boolean(state.hemisphere),
      rendererCaptured: Boolean(state.renderer),
      cameraCaptured: Boolean(state.camera),
      sceneCaptures: state.sceneCaptures,
      renderCaptures: state.renderCaptures,
      strategy: 'capture-existing-proven-v35-three-lights',
    }),
  };

  window.realitySandboxSurfaceLightHookV36 = api;
  document.documentElement.dataset.surfaceLightHookV36 = 'installed';

  const previousDiagnostics = window.realitySandboxPresentationDiagnostics;
  window.realitySandboxPresentationDiagnostics = () => ({
    ...(typeof previousDiagnostics === 'function' ? previousDiagnostics() : {}),
    surfaceLightHookV36: api.getStats(),
  });
})();

