const VERSION_ENDPOINT = './version.json';
const CHECK_TIMEOUT_MS = 5000;

function normalizeSha(value) {
  return String(value || '').trim().toLowerCase();
}

async function fetchCurrentDeployment() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const url = `${VERSION_ENDPOINT}?t=${Date.now()}`;
    const response = await fetch(url, {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
      },
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return normalizeSha(payload?.sha);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function verifyDeploymentFreshness() {
  const meta = document.querySelector('meta[name="reality-sandbox-deploy-sha"]');
  const loadedSha = normalizeSha(meta?.content);
  if (!loadedSha) return;

  document.documentElement.dataset.loadedDeploySha = loadedSha;
  const currentSha = await fetchCurrentDeployment();
  if (!currentSha) {
    document.documentElement.dataset.deploymentFreshness = 'unknown';
    return;
  }

  document.documentElement.dataset.currentDeploySha = currentSha;
  if (currentSha === loadedSha) {
    document.documentElement.dataset.deploymentFreshness = 'current';
    return;
  }

  document.documentElement.dataset.deploymentFreshness = 'stale';
  const guardKey = `reality-sandbox-refresh:${currentSha}`;
  if (sessionStorage.getItem(guardKey) === '1') return;
  sessionStorage.setItem(guardKey, '1');

  const url = new URL(location.href);
  url.searchParams.set('deploy', currentSha.slice(0, 12));
  url.searchParams.set('refresh', String(Date.now()));
  location.replace(url.href);
}

verifyDeploymentFreshness();
