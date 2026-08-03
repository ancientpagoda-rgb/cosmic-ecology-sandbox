import initGdalJs from 'gdal3.js';
import workerUrl from 'gdal3.js/dist/package/gdal3.js?url';
import dataUrl from 'gdal3.js/dist/package/gdal3WebAssembly.data?url';
import wasmUrl from 'gdal3.js/dist/package/gdal3WebAssembly.wasm?url';

export function createGdalAdapter() {
  let gdal = null;
  let loading = null;

  async function ensureLoaded() {
    if (gdal) return gdal;
    if (!loading) {
      loading = initGdalJs({
        paths: { js: workerUrl, data: dataUrl, wasm: wasmUrl },
        useWorker: true,
      }).then(instance => {
        gdal = instance;
        return instance;
      });
    }
    return loading;
  }

  return {
    id: 'gis.gdal',
    name: 'GDAL GIS Adapter',
    version: '2.8.1',
    execution: 'wasm-worker',
    source: 'gdal3.js / GDAL',
    license: 'MIT adapter; GDAL MIT/X-style and bundled third-party notices apply',
    provides: ['gis.raster', 'gis.vector', 'gis.projection'],

    initialize({ provideCapability }) {
      provideCapability('gis.raster', this);
      provideCapability('gis.vector', this);
      provideCapability('gis.projection', this);
    },

    async open(files) {
      const api = await ensureLoaded();
      return api.open(Array.from(files));
    },

    async translate(files, args = []) {
      const api = await ensureLoaded();
      return api.gdal_translate(Array.from(files), args);
    },

    async warp(files, args = []) {
      const api = await ensureLoaded();
      return api.gdalwarp(Array.from(files), args);
    },

    async convertVector(files, args = []) {
      const api = await ensureLoaded();
      return api.ogr2ogr(Array.from(files), args);
    },

    async rasterize(files, args = []) {
      const api = await ensureLoaded();
      return api.gdal_rasterize(Array.from(files), args);
    },

    async transform(points, sourceCrs, targetCrs) {
      const api = await ensureLoaded();
      const text = points.map(point => `${point[0]} ${point[1]}${point[2] == null ? '' : ` ${point[2]}`}`).join('\n');
      const input = new File([text], 'points.txt', { type: 'text/plain' });
      return api.gdaltransform([input], ['-s_srs', sourceCrs, '-t_srs', targetCrs]);
    },

    async getDriverSummary() {
      const api = await ensureLoaded();
      return {
        raster: Object.keys(api.drivers?.raster || {}),
        vector: Object.keys(api.drivers?.vector || {}),
      };
    },

    isLoaded() { return Boolean(gdal); },
  };
}
