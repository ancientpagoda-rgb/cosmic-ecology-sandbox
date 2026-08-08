(() => {
  const prototype = globalThis.HTMLCanvasElement?.prototype;
  const nativeRequestPointerLock = prototype?.requestPointerLock;
  if (!prototype || typeof nativeRequestPointerLock !== 'function' || nativeRequestPointerLock.__realityPromiseCompat) return;

  function realityRequestPointerLockCompat(...args) {
    try {
      const result = nativeRequestPointerLock.apply(this, args);
      return result && typeof result.then === 'function' ? result : Promise.resolve(result);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  realityRequestPointerLockCompat.__realityPromiseCompat = true;
  prototype.requestPointerLock = realityRequestPointerLockCompat;
})();
