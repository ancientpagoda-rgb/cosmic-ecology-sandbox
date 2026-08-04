export function installUnifiedDebugExtension(debugApi, unifiedRuntime) {
  if (!debugApi || !unifiedRuntime || debugApi.unifiedRuntime) return debugApi;

  const originalSnapshot = debugApi.snapshot.bind(debugApi);
  const originalDiagnostics = debugApi.diagnostics.bind(debugApi);

  debugApi.snapshot = () => ({
    ...originalSnapshot(),
    unifiedRuntime: unifiedRuntime.getSnapshot(),
  });

  debugApi.diagnostics = () => {
    const base = originalDiagnostics();
    const unified = unifiedRuntime.runInvariants();
    const failures = [...(base.failures || []), ...(unified.failures || [])];
    return {
      ...base,
      ok: failures.length === 0,
      failures,
      unifiedRuntime: unified,
    };
  };

  debugApi.unifiedRuntime = unifiedRuntime;
  debugApi.seedUnifiedScenario = kind => unifiedRuntime.debugScenario(kind);
  debugApi.setUnifiedView = view => unifiedRuntime.setView(view);
  debugApi.startUnifiedAudio = () => unifiedRuntime.startAudio();
  debugApi.setUnifiedAudioMuted = muted => unifiedRuntime.setMuted(muted);
  debugApi.setUnifiedAudioVolume = volume => unifiedRuntime.setVolume(volume);
  debugApi.setUnifiedOrbitalBackend = backend => unifiedRuntime.setOrbitalBackend(backend);
  debugApi.getUnifiedState = () => unifiedRuntime.getSnapshot();

  window.dispatchEvent(new CustomEvent('reality-sandbox-unified-ready', { detail: unifiedRuntime }));
  return debugApi;
}
