import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

export function createCreatureBody3D(genome, role, options = {}) {
  const mobile = Boolean(options.mobile);
  const root = new THREE.Group();
  root.name = `creature-${options.id || 'unknown'}`;
  root.userData.role = role;
  root.userData.species = genome.speciesId;

  const scale = 0.045 * genome.size;
  const hue = wrap(genome.hue + (role === 'predator' ? -18 : role === 'apex' ? 34 : 0), 360);
  const bodyColor = new THREE.Color(`hsl(${hue} 56% ${role === 'apex' ? 42 : 52}%)`);
  const accentColor = new THREE.Color(`hsl(${wrap(hue + 42, 360)} 70% 66%)`);
  const darkColor = bodyColor.clone().multiplyScalar(0.55);

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: bodyColor,
    roughness: 0.72,
    metalness: 0.02,
  });
  const accentMaterial = new THREE.MeshStandardMaterial({
    color: accentColor,
    roughness: 0.62,
    metalness: 0.03,
  });
  const darkMaterial = new THREE.MeshStandardMaterial({
    color: darkColor,
    roughness: 0.88,
    metalness: 0,
  });
  const signalMaterial = new THREE.MeshBasicMaterial({
    color: accentColor,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });

  const bodyLength = scale * (1.45 + genome.length * 0.72);
  const bodyHeight = scale * (0.58 + genome.depth * 0.42);
  const torso = new THREE.Mesh(
    new THREE.CapsuleGeometry(bodyHeight * 0.52, Math.max(0.001, bodyLength - bodyHeight), mobile ? 4 : 7, mobile ? 8 : 14),
    bodyMaterial,
  );
  torso.name = 'torso';
  torso.rotation.z = Math.PI * 0.5;
  torso.position.y = bodyHeight * 1.38;
  torso.castShadow = true;
  torso.receiveShadow = true;
  root.add(torso);

  const spine = new THREE.Group();
  spine.position.set(bodyLength * 0.46, bodyHeight * 1.52, 0);
  root.add(spine);

  const neckLength = scale * (0.3 + genome.neck * 0.62);
  const neck = cylinderBetween(neckLength, bodyHeight * 0.23, bodyMaterial, mobile ? 5 : 8);
  neck.position.y = neckLength * 0.45;
  neck.rotation.z = -0.26 - genome.tilt * 0.08;
  spine.add(neck);

  const head = new THREE.Group();
  head.name = 'head';
  head.position.set(neckLength * 0.2, neckLength * 0.94, 0);
  spine.add(head);

  const headRadius = scale * (0.32 + genome.head * 0.28);
  const skull = new THREE.Mesh(
    new THREE.SphereGeometry(headRadius, mobile ? 7 : 12, mobile ? 5 : 9),
    bodyMaterial,
  );
  skull.scale.set(1.25, 0.92, 0.88);
  skull.castShadow = true;
  head.add(skull);

  const snoutLength = scale * (0.18 + genome.sense * 0.13 + (role === 'agent' ? 0.06 : 0.16));
  const snout = new THREE.Mesh(
    new THREE.ConeGeometry(headRadius * 0.55, snoutLength, mobile ? 5 : 8),
    darkMaterial,
  );
  snout.rotation.z = -Math.PI * 0.5;
  snout.position.x = headRadius * 1.05;
  head.add(snout);

  const eyeGeometry = new THREE.SphereGeometry(headRadius * 0.12, 6, 4);
  const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0xeaffff });
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    eye.position.set(headRadius * 0.7, headRadius * 0.28, side * headRadius * 0.63);
    head.add(eye);
  }

  const displayGroup = new THREE.Group();
  displayGroup.position.set(0, headRadius * 0.72, 0);
  head.add(displayGroup);
  const displayCount = role === 'agent' ? (genome.display > 0.52 ? 2 : 0) : 2 + Math.floor(genome.display * 2);
  for (let index = 0; index < displayCount; index++) {
    const side = index % 2 ? -1 : 1;
    const horn = new THREE.Mesh(
      new THREE.ConeGeometry(scale * (0.07 + genome.display * 0.05), scale * (0.24 + genome.display * 0.3), 5),
      accentMaterial,
    );
    horn.position.set(-headRadius * 0.1 - Math.floor(index / 2) * scale * 0.08, 0, side * headRadius * 0.55);
    horn.rotation.z = side * (0.18 + genome.display * 0.22);
    displayGroup.add(horn);
  }

  const legs = [];
  const limbPairs = mobile ? Math.min(2, Math.max(1, Math.round(genome.limbPairs))) : Math.min(3, Math.max(1, Math.round(genome.limbPairs)));
  const legLength = scale * (0.58 + genome.legs * 0.54);
  for (let pair = 0; pair < limbPairs; pair++) {
    const forwardT = limbPairs === 1 ? 0 : pair / (limbPairs - 1);
    const x = THREE.MathUtils.lerp(-bodyLength * 0.34, bodyLength * 0.32, forwardT);
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.name = `leg-${pair}-${side > 0 ? 'r' : 'l'}`;
      pivot.position.set(x, bodyHeight * 1.28, side * bodyHeight * 0.44);
      root.add(pivot);

      const upper = cylinderBetween(legLength * 0.52, scale * 0.085, darkMaterial, mobile ? 4 : 7);
      upper.position.y = -legLength * 0.25;
      pivot.add(upper);

      const knee = new THREE.Group();
      knee.position.y = -legLength * 0.5;
      pivot.add(knee);
      const lower = cylinderBetween(legLength * 0.5, scale * 0.065, accentMaterial, mobile ? 4 : 7);
      lower.position.y = -legLength * 0.24;
      knee.add(lower);

      const foot = new THREE.Mesh(
        new THREE.SphereGeometry(scale * 0.11, 6, 4),
        darkMaterial,
      );
      foot.scale.set(1.55, 0.5, 0.78);
      foot.position.set(scale * 0.07, -legLength * 0.5, 0);
      knee.add(foot);
      legs.push({ pivot, knee, side, pair });
    }
  }

  const tailRoot = new THREE.Group();
  tailRoot.position.set(-bodyLength * 0.52, bodyHeight * 1.45, 0);
  root.add(tailRoot);
  const tailSegments = mobile ? 2 : 3 + Math.floor(genome.tail * 2);
  let parent = tailRoot;
  for (let index = 0; index < tailSegments; index++) {
    const length = scale * (0.28 + genome.tail * 0.22) * (1 - index * 0.09);
    const segment = new THREE.Mesh(
      new THREE.ConeGeometry(scale * (0.11 - index * 0.012), length, mobile ? 5 : 7),
      index % 2 ? darkMaterial : bodyMaterial,
    );
    segment.rotation.z = Math.PI * 0.5;
    segment.position.x = -length * 0.48;
    parent.add(segment);
    const joint = new THREE.Group();
    joint.position.x = -length * 0.9;
    parent.add(joint);
    parent = joint;
  }

  const signalRing = new THREE.Mesh(
    new THREE.TorusGeometry(bodyLength * 0.62, scale * 0.018, 4, mobile ? 16 : 28),
    signalMaterial,
  );
  signalRing.rotation.x = Math.PI * 0.5;
  signalRing.position.y = bodyHeight * 0.34;
  root.add(signalRing);

  const mixer = new THREE.AnimationMixer(root);
  const breathing = new THREE.AnimationClip('breathing', 1.2, [
    new THREE.VectorKeyframeTrack('torso.scale', [0, 0.6, 1.2], [1, 1, 1, 1.012, 1.026, 1.012, 1, 1, 1]),
  ]);
  const breathAction = mixer.clipAction(breathing);
  breathAction.play();

  let gait = Math.random() * Math.PI * 2;
  let lod = 0;

  function update(dt, state = {}) {
    const speed = THREE.MathUtils.clamp(state.speed || 0, 0, 1.5);
    const modeFactor = state.mode === 'flee' || state.mode === 'hunt' ? 1.35 : state.mode === 'rest' ? 0.18 : 1;
    gait += dt * (2.4 + speed * 8.5) * modeFactor;
    mixer.timeScale = 0.55 + Math.min(1.7, speed * 0.85);
    mixer.update(dt);

    const stride = Math.min(0.85, speed * 0.72) * modeFactor;
    for (let index = 0; index < legs.length; index++) {
      const leg = legs[index];
      const phase = gait + leg.pair * Math.PI * 0.6 + (leg.side > 0 ? Math.PI : 0);
      leg.pivot.rotation.z = Math.sin(phase) * stride * 0.54;
      leg.pivot.rotation.x = leg.side * 0.08;
      leg.knee.rotation.z = Math.max(-0.65, -0.25 - Math.cos(phase) * stride * 0.42);
    }

    torso.rotation.x = Math.sin(gait * 0.5) * speed * 0.035;
    spine.rotation.z = -0.12 + Math.sin(gait * 0.5 + 0.6) * speed * 0.05;
    head.rotation.z = Math.sin(gait * 0.45 + 1.2) * (0.05 + genome.curiosity * 0.1);
    head.rotation.y = Math.sin(gait * 0.22) * genome.curiosity * 0.18;
    tailRoot.rotation.y = Math.sin(gait * 0.7) * (0.22 + genome.tail * 0.2);
    tailRoot.rotation.z = Math.sin(gait * 0.4) * 0.08;

    const communication = THREE.MathUtils.clamp(state.communication || 0, 0, 1);
    signalMaterial.opacity = communication * (0.12 + 0.2 * (0.5 + Math.sin(gait * 0.65) * 0.5));
    signalRing.scale.setScalar(1 + communication * (0.25 + Math.sin(gait * 0.65) * 0.12));
    signalRing.visible = communication > 0.03 && lod === 0;

    const ageRatio = THREE.MathUtils.clamp(state.ageRatio || 0.5, 0.08, 1);
    root.scale.setScalar(THREE.MathUtils.lerp(0.58, 1, Math.min(1, ageRatio * 1.4)));
  }

  function setLod(nextLod) {
    lod = nextLod;
    displayGroup.visible = lod === 0;
    signalRing.visible = lod === 0 && signalMaterial.opacity > 0.03;
    for (const leg of legs) leg.knee.visible = lod < 2;
  }

  function dispose() {
    mixer.stopAllAction();
    root.traverse(object => {
      object.geometry?.dispose?.();
      if (Array.isArray(object.material)) object.material.forEach(material => material.dispose?.());
      else object.material?.dispose?.();
    });
  }

  return {
    root,
    mixer,
    update,
    setLod,
    dispose,
    height: bodyHeight * 2.25,
    radius: Math.max(bodyHeight * 0.48, scale * 0.18),
    forward: UP,
  };
}

function cylinderBetween(length, radius, material, segments) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.72, radius, length, segments),
    material,
  );
  mesh.castShadow = true;
  return mesh;
}

const wrap = (value, max) => ((value % max) + max) % max;
