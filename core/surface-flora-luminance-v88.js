import * as THREE from 'three';

const BUILD = 'v88-readable-lineage-pigments';
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function liftInstanceColor(mesh, index) {
  const attribute = mesh.instanceColor;
  const array = attribute?.array;
  const base = index * 3;
  if (!array || base + 2 >= array.length) return;
  const r = array[base];
  const g = array[base + 1];
  const b = array[base + 2];
  const peak = Math.max(r, g, b, 0.001);
  if (peak >= 0.72) return;
  const lift = Math.min(3.2, 0.72 / peak);
  array[base] = clamp(r * lift * 0.90 + 0.10, 0, 1);
  array[base + 1] = clamp(g * lift * 0.90 + 0.10, 0, 1);
  array[base + 2] = clamp(b * lift * 0.90 + 0.10, 0, 1);
  attribute.needsUpdate = true;
}

function patchMesh(mesh) {
  if (!mesh?.isInstancedMesh || mesh.userData?.floraLuminanceV88) return false;
  const isLife = Boolean(
    mesh.userData?.floraV78 || mesh.userData?.faunaV87 ||
    /flora|fauna/i.test(mesh.name || '')
  );
  if (!isLife || typeof mesh.setColorAt !== 'function') return false;

  mesh.userData.floraLuminanceV88 = BUILD;
  mesh.material?.color?.setHex?.(0xffffff);
  if (mesh.material) {
    mesh.material.metalness = 0;
    mesh.material.roughness = Math.max(0.82, Number(mesh.material.roughness) || 0.82);
    mesh.material.needsUpdate = true;
  }

  const previousSetColorAt = mesh.setColorAt.bind(mesh);
  mesh.setColorAt = function readableLineageColor(index, color) {
    const result = previousSetColorAt(index, color);
    liftInstanceColor(this, index);
    return result;
  };

  for (let index = 0; index < Number(mesh.count || 0); index += 1) liftInstanceColor(mesh, index);
  return true;
}

async function install() {
  for (let attempt = 0; attempt < 360; attempt += 1) {
    const scene = window.realitySandboxSurfaceLightHookV36?.getObjects?.()?.scene;
    if (scene) {
      let patched = 0;
      const scan = () => scene.traverse(object => { if (patchMesh(object)) patched += 1; });
      scan();
      const timer = setInterval(scan, 350);
      window.realitySandboxSurfaceFloraLuminanceV88 = {
        installed: true,
        build: BUILD,
        getStats: () => ({ patched }),
        destroy: () => clearInterval(timer),
      };
      document.documentElement.dataset.surfaceFloraLuminanceV88 = BUILD;
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 35));
  }
  document.documentElement.dataset.surfaceFloraLuminanceV88 = 'unavailable';
}

install();
