export function createOpenSpaceAdapter(options = {}) {
  const endpoint = options.endpoint || 'ws://127.0.0.1:4682';
  let socket = null;
  let status = 'disconnected';
  const listeners = new Set();
  const pending = [];

  function emit(detail = {}) {
    const snapshot = { status, endpoint, ...detail };
    for (const listener of listeners) listener(snapshot);
  }

  function connect() {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
    status = 'connecting';
    emit();
    try {
      socket = new WebSocket(endpoint);
      socket.addEventListener('open', () => {
        status = 'connected';
        emit();
        while (pending.length) socket.send(pending.shift());
      });
      socket.addEventListener('message', event => emit({ message: safeParse(event.data) }));
      socket.addEventListener('close', () => { status = 'disconnected'; emit(); });
      socket.addEventListener('error', () => { status = 'error'; emit({ error: 'OpenSpace bridge connection failed' }); });
    } catch (error) {
      status = 'error';
      emit({ error: error.message });
    }
  }

  function disconnect() {
    socket?.close();
    socket = null;
    status = 'disconnected';
    emit();
  }

  function send(type, payload = {}) {
    const message = JSON.stringify({ type, payload, source: 'reality-sandbox', version: 1 });
    if (socket?.readyState === WebSocket.OPEN) socket.send(message);
    else pending.push(message);
  }

  function syncKernel(kernelSnapshot) {
    send('reality.kernel.snapshot', kernelSnapshot);
  }

  function setCamera(camera) {
    send('reality.camera.set', camera);
  }

  function setTime(time) {
    send('reality.time.set', { time });
  }

  function exportOpenSpaceAsset(snapshot) {
    const object = snapshot?.objects?.find(item => item.type === 'planet') || snapshot?.objects?.[0];
    const identifier = sanitize(object?.id || 'RealitySandboxPlanet');
    const radius = object?.radius || 1;
    return `local asset = asset or {}\n\nasset.onInitialize(function()\n  openspace.addSceneGraphNode({\n    Identifier = \"${identifier}\",\n    Parent = \"SolarSystemBarycenter\",\n    Transform = { Translation = { Type = \"StaticTranslation\", Position = { 0, 0, 0 } } },\n    Renderable = { Type = \"RenderableSphere\", Radius = ${radius}, Segments = 128, Color = { 0.2, 0.55, 0.85 } },\n    GUI = { Name = \"Reality Sandbox Planet\", Path = \"Reality Sandbox\" }\n  })\nend)\n\nasset.onDeinitialize(function()\n  openspace.removeSceneGraphNode(\"${identifier}\")\nend)\n\nasset.export(\"${identifier}\")\n`;
  }

  return {
    connect,
    disconnect,
    send,
    syncKernel,
    setCamera,
    setTime,
    exportOpenSpaceAsset,
    subscribe(listener) { listeners.add(listener); listener({ status, endpoint }); return () => listeners.delete(listener); },
    getStatus: () => status,
    getEndpoint: () => endpoint,
  };
}

function safeParse(value) { try { return JSON.parse(value); } catch { return value; } }
function sanitize(value) { return String(value).replace(/[^a-zA-Z0-9_]/g, '_'); }
