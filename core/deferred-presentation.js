// The public experience deliberately has one renderer and one interaction
// stack. Earlier experiments dynamically attached alternate presentation,
// caching, and UI layers after startup. Even when deferred, they kept legacy
// chunks in the Pages artifact and could compete with the live experience.
//
// The experiment files remain in the repository for local Vite review, but
// production no longer imports them. Keeping this tiny marker makes the choice
// inspectable in diagnostics without spending work or bytes at runtime.
async function markDeferredPresentationDisabled() {
  try {
    await window.realitySandboxReady;
  } catch {
    document.documentElement.dataset.deferredPresentation = 'runtime-rejected';
    return;
  }
  document.documentElement.dataset.deferredPresentation = 'disabled';
}

markDeferredPresentationDisabled();
