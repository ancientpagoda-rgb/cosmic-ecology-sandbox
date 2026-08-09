const SOFTWARE_RENDERER_RE = /(swiftshader|llvmpipe|softpipe|software|mesa offscreen|lavapipe)/i;

async function waitForGpuCanvas() {
  for (let attempt = 0; attempt < 300; attempt++) {
    const canvas = document.getElementById('surfaceGpuCanvas');
    const gpu = window.realitySandboxSurfaceGpu;
    if (canvas && gpu?.installed) return { canvas, gpu };
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  return null;
}

function readBackend(canvas) {
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  if (!gl) {
    return {
      context: 'none',
      vendor: 'unknown',
      renderer: 'unknown',
      version: 'unknown',
      shadingLanguageVersion: 'unknown',
      softwareRendererLikely: true,
      hardwareAccelerationLikely: false,
    };
  }

  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const vendor = debug
    ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)
    : gl.getParameter(gl.VENDOR);
  const renderer = debug
    ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
    : gl.getParameter(gl.RENDERER);
  const text = `${vendor || ''} ${renderer || ''}`;
  const softwareRendererLikely = SOFTWARE_RENDERER_RE.test(text);
  const isWebGl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;

  return {
    context: isWebGl2 ? 'webgl2' : 'webgl1',
    vendor: String(vendor || 'unknown'),
    renderer: String(renderer || 'unknown'),
    version: String(gl.getParameter(gl.VERSION) || 'unknown'),
    shadingLanguageVersion: String(gl.getParameter(gl.SHADING_LANGUAGE_VERSION) || 'unknown'),
    softwareRendererLikely,
    hardwareAccelerationLikely: !softwareRendererLikely,
  };
}

function install({ canvas }) {
  if (window.realitySandboxSurfaceGpuBackend?.installed) return;

  let backend = readBackend(canvas);
  const refresh = () => {
    backend = readBackend(canvas);
    document.documentElement.dataset.surfaceGpuBackend = backend.renderer;
    document.documentElement.dataset.surfaceGpuHardware = backend.hardwareAccelerationLikely ? 'likely' : 'unlikely';
    return backend;
  };

  canvas.addEventListener('webglcontextrestored', refresh, { passive: true });

  const api = {
    installed: true,
    refresh,
    getStats: () => ({ ...backend }),
  };

  window.realitySandboxSurfaceGpuBackend = api;
  refresh();

  const previousDiagnostics = window.realitySandboxPresentationDiagnostics;
  window.realitySandboxPresentationDiagnostics = () => ({
    ...(typeof previousDiagnostics === 'function' ? previousDiagnostics() : {}),
    surfaceGpuBackend: api.getStats(),
  });
}

async function boot() {
  const state = await waitForGpuCanvas();
  if (!state) {
    document.documentElement.dataset.surfaceGpuBackend = 'unavailable';
    return;
  }
  install(state);
}

boot();

