// World state for M2: ECS-lite with Agent and Resource entities and physics integration.

import { createEcs } from './ecs.js';

export function createWorld(rng) {
  const width = 1200;
  const height = 720;

  const ecs = createEcs();

  const world = {
    tick: 0,
    width,
    height,
    ecs,
    regime: 'calm',
    camera: {
      zoom: 1,
      x: width * 0.5,
      y: height * 0.5,
    },
    globals: {
      fertility: 0.6,
      metabolism: 1.0,
      storminess: 0.0,
      reproductionThreshold: 1.6,
    },
  };

  // Spawn some initial agents and resources
  const AGENT_COUNT = 18;
  const PREDATOR_COUNT = 5;
  const APEX_COUNT = 2;
  const RESOURCE_COUNT = 70;

  function jitterParam(base, amt) {
    return base * (1 + (rng.float() - 0.5) * amt);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function makeAgent(x, y, baseHue = 200, parentDna) {
    const id = ecs.createEntity();
    ecs.components.position.set(id, { x, y });

    const dna = parentDna
      ? {
          speed: clamp(parentDna.speed + (rng.float() - 0.5) * 0.1, 0.6, 1.4),
          sense: clamp(parentDna.sense + (rng.float() - 0.5) * 0.1, 0.6, 1.4),
          metabolism: clamp(parentDna.metabolism + (rng.float() - 0.5) * 0.1, 0.6, 1.6),
          hueShift: clamp(parentDna.hueShift + rng.int(-4, 4), -60, 60),
        }
      : {
          speed: 0.8 + rng.float() * 0.4,
          sense: 0.8 + rng.float() * 0.4,
          metabolism: 0.8 + rng.float() * 0.4,
          hueShift: rng.int(-40, 40),
        };

    const speed = 40 * dna.speed;

    ecs.components.velocity.set(id, {
      vx: (rng.float() - 0.5) * speed,
      vy: (rng.float() - 0.5) * speed,
    });
    const evolvedScore = dna.speed + dna.sense + (2 - dna.metabolism);
    const evolved = evolvedScore > 3.5; // simple heuristic for "advanced" forms

    // Assign a simple "caste" based on DNA traits
    let caste = 'balanced';
    if (dna.sense > dna.speed && dna.sense > 1.1) caste = 'scout';
    else if (dna.speed > dna.sense && dna.speed > 1.1) caste = 'runner';
    else if (dna.metabolism < 0.9) caste = 'saver';

    ecs.components.agent.set(id, {
      colorHue: baseHue + dna.hueShift,
      energy: 1.0,
      age: 0,
      dna,
      evolved,
      caste,
    });
    return id;
  }

  function makePredator(x, y, parentDna) {
    const id = ecs.createEntity();
    ecs.components.position.set(id, { x, y });

    const dna = parentDna
      ? {
          speed:      clamp(parentDna.speed      + (rng.float() - 0.5) * 0.22, 0.45, 2.0),
          sense:      clamp(parentDna.sense      + (rng.float() - 0.5) * 0.22, 0.35, 2.1),
          metabolism: clamp(parentDna.metabolism + (rng.float() - 0.5) * 0.22, 0.4, 2.2),
          hueShift:   clamp(parentDna.hueShift   + rng.int(-8, 8), -80, 80),
        }
      : {
          speed:      0.6 + rng.float() * 0.9,      // 0.6–1.5
          sense:      0.6 + rng.float() * 0.9,      // 0.6–1.5
          metabolism: 0.6 + rng.float() * 1.0,      // 0.6–1.6
          hueShift:   rng.int(-45, 45),
        };

    const speed = 55 * dna.speed;

    ecs.components.velocity.set(id, {
      vx: (rng.float() - 0.5) * speed,
      vy: (rng.float() - 0.5) * speed,
    });
    ecs.components.predator.set(id, {
      colorHue: 5 + dna.hueShift,
      energy: 2.0,
      age: 0,
      dna,
    });
    return id;
  }

  function makeApex(x, y, parentDna) {
    const id = ecs.createEntity();
    ecs.components.position.set(id, { x, y });

    const dna = parentDna
      ? {
          speed: clamp(parentDna.speed + (rng.float() - 0.5) * 0.08, 0.5, 1.4),
          sense: clamp(parentDna.sense + (rng.float() - 0.5) * 0.08, 0.7, 1.8),
          metabolism: clamp(parentDna.metabolism + (rng.float() - 0.5) * 0.08, 0.5, 1.6),
          hueShift: clamp(parentDna.hueShift + rng.int(-3, 3), -30, 30),
        }
      : {
          speed: 0.8 + rng.float() * 0.3,
          sense: 1.1 + rng.float() * 0.4,
          metabolism: 0.8 + rng.float() * 0.3,
          hueShift: rng.int(-15, 15),
        };

    const speed = 35 * dna.speed;

    ecs.components.velocity.set(id, {
      vx: (rng.float() - 0.5) * speed,
      vy: (rng.float() - 0.5) * speed,
    });
    ecs.components.apex.set(id, {
      colorHue: 200 + dna.hueShift,
      energy: 3.0,
      age: 0,
      rest: 0,
      dna,
    });
    return id;
  }

  function makeResource(x, y, kind = 'plant') {
    const id = ecs.createEntity();
    ecs.components.position.set(id, { x, y });

    let dna = null;
    if (kind === 'plant') {
      // Per-plant "genetics" including pseudo-3D depth traits
      dna = {
        branchCount: 2 + rng.int(0, 4),                 // 2–6 primary arms
        branchAngle: 0.4 + rng.float() * 0.8,           // spread of branches
        curvature:  0.2 + rng.float() * 0.6,            // how much arms bend
        segmentLength: 10 + rng.float() * 12,           // base step length
        thickness: 0.6 + rng.float() * 0.8,             // line width factor
        depth: 0.2 + rng.float() * 0.7,                 // 0.2–0.9 depth layer
        lean: (rng.float() - 0.5) * 0.6,                // slight tilt left/right
      };
    }

    ecs.components.resource.set(id, {
      kind, // 'plant' or 'pod'
      amount: 1,
      regenTimer: rng.float() * 5,
      age: 0,
      cycles: 0, // growth cycles completed
      seedTimer: kind === 'pod' ? 10 + rng.float() * 12 : null,
      dna,
    });
    return id;
  }

  function makePlant(x, y) {
    return makeResource(x, y, 'plant');
  }

  function makeSeedPod(x, y) {
    return makeResource(x, y, 'pod');
  }

  function spawnApexBurst(x, y, baseHue, count, energy) {
    const { position, burst } = ecs.components;
    const particles = count || 8;
    const speedBase = 40 + energy * 12;
    for (let i = 0; i < particles; i++) {
      const id = ecs.createEntity();
      const angle = rng.float() * Math.PI * 2;
      const speed = speedBase * (0.6 + rng.float() * 0.8);
      position.set(id, { x, y });
      burst.set(id, {
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1.4 + rng.float() * 0.6,
        hue: baseHue,
      });
    }
  }

  function seedCreaturesAndResources() {
    for (let i = 0; i < AGENT_COUNT; i++) {
      makeAgent(rng.float() * width, rng.float() * height);
    }

    for (let i = 0; i < PREDATOR_COUNT; i++) {
      makePredator(rng.float() * width, rng.float() * height);
    }

    for (let i = 0; i < APEX_COUNT; i++) {
      makeApex(rng.float() * width, rng.float() * height);
    }

    for (let i = 0; i < RESOURCE_COUNT; i++) {
      const kind = rng.float() < 0.2 ? 'pod' : 'plant';
      makeResource(rng.float() * width, rng.float() * height, kind);
    }
  }

  seedCreaturesAndResources();

  function physicsSystem(dt) {
    const { position, velocity, burst } = ecs.components;
    const w = world.width;
    const h = world.height;

    for (const [id, vel] of velocity.entries()) {
      const pos = position.get(id);
      if (!pos) continue;
      pos.x += vel.vx * dt;
      pos.y += vel.vy * dt;

      // Wrap bounds
      if (pos.x < 0) pos.x += w;
      if (pos.x >= w) pos.x -= w;
      if (pos.y < 0) pos.y += h;
      if (pos.y >= h) pos.y -= h;
    }

    // Integrate burst particles and wrap them as well
    for (const [id, p] of burst.entries()) {
      const pos = position.get(id);
      if (!pos) continue;
      pos.x += p.vx * dt;
      pos.y += p.vy * dt;
      if (pos.x < 0) pos.x += w;
      if (pos.x >= w) pos.x -= w;
      if (pos.y < 0) pos.y += h;
      if (pos.y >= h) pos.y -= h;
    }
  }

  // Simple soft-body collisions: dynamic creatures gently push each other apart
  function collisionSystem(dt) {
    const { position, velocity, agent, predator, apex } = ecs.components;
    const entities = [];

    // Collect dynamic entities with an approximate radius
    for (const [id, ag] of agent.entries()) {
      const pos = position.get(id);
      const vel = velocity.get(id);
      if (!pos || !vel) continue;
      const energy = ag.energy ?? 1;
      const radius = 4 + energy * 2;
      entities.push({ id, pos, vel, radius });
    }
    for (const [id, pred] of predator.entries()) {
      const pos = position.get(id);
      const vel = velocity.get(id);
      if (!pos || !vel) continue;
      const energy = pred.energy ?? 1.5;
      const radius = 6 + energy * 2.5;
      entities.push({ id, pos, vel, radius });
    }
    for (const [id, ap] of apex.entries()) {
      const pos = position.get(id);
      const vel = velocity.get(id);
      if (!pos || !vel) continue;
      const energy = ap.energy ?? 3;
      const radius = 9 + energy * 2;
      entities.push({ id, pos, vel, radius });
    }

    const strength = 40; // how strongly overlaps push

    for (let i = 0; i < entities.length; i++) {
      const a = entities[i];
      for (let j = i + 1; j < entities.length; j++) {
        const b = entities[j];
        const dx = b.pos.x - a.pos.x;
        const dy = b.pos.y - a.pos.y;
        const dist2 = dx * dx + dy * dy;
        if (dist2 <= 0) continue;
        const minDist = a.radius + b.radius;
        if (dist2 >= minDist * minDist) continue;
        const dist = Math.sqrt(dist2) || 1;
        const overlap = (minDist - dist) / minDist;
        const nx = dx / dist;
        const ny = dy / dist;
        const impulse = strength * overlap;

        // Push velocities apart
        a.vel.vx -= nx * impulse * dt;
        a.vel.vy -= ny * impulse * dt;
        b.vel.vx += nx * impulse * dt;
        b.vel.vy += ny * impulse * dt;
      }
    }
  }

  // Steering: agents seek nearest resource and gently adjust velocity.
  function steeringSystem(dt) {
    const { position, velocity, agent, predator, apex, resource } = ecs.components;
    const avoidRadius = 18;

    // Build resource positions list once per tick
    const resourceList = [];
    for (const [id, res] of resource.entries()) {
      if (res.amount <= 0) continue;
      const pos = position.get(id);
      if (!pos) continue;
      resourceList.push({ id, pos });
    }

    for (const [id, ag] of agent.entries()) {
      const pos = position.get(id);
      const vel = velocity.get(id);
      if (!pos || !vel) continue;

      const dna = ag.dna || { speed: 1, sense: 1, metabolism: 1, hueShift: 0 };
      const seekRadius = 140 * dna.sense;

      let target = null;
      let targetDist2 = Infinity;

      for (const r of resourceList) {
        const dx = r.pos.x - pos.x;
        const dy = r.pos.y - pos.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < targetDist2 && d2 < seekRadius * seekRadius) {
          targetDist2 = d2;
          target = r.pos;
        }
      }

      // Seek resource
      if (target) {
        const dx = target.x - pos.x;
        const dy = target.y - pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const desiredSpeed = 40 * dna.speed;
        const desiredVx = (dx / dist) * desiredSpeed;
        const desiredVy = (dy / dist) * desiredSpeed;
        // Blend current velocity toward desired
        const blend = 0.8;
        vel.vx = vel.vx * blend + desiredVx * (1 - blend);
        vel.vy = vel.vy * blend + desiredVy * (1 - blend);
      }

      // Simple separation: avoid crowding other agents
      let ax = 0;
      let ay = 0;
      for (const [id2] of agent.entries()) {
        if (id2 === id) continue;
        const p2 = position.get(id2);
        if (!p2) continue;
        const dx = pos.x - p2.x;
        const dy = pos.y - p2.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > 0 && d2 < avoidRadius * avoidRadius) {
          const dist = Math.sqrt(d2) || 1;
          const strength = (avoidRadius - dist) / avoidRadius;
          ax += (dx / dist) * strength * 30;
          ay += (dy / dist) * strength * 30;
        }
      }
      vel.vx += ax * dt;
      vel.vy += ay * dt;
    }

    // Predators seek nearest agents
    const predatorSeekRadius = 200;
    for (const [id, pred] of predator.entries()) {
      const pos = position.get(id);
      const vel = velocity.get(id);
      if (!pos || !vel) continue;

      // Resting predators drift but do not aggressively seek
      if (pred.rest && pred.rest > 0) continue;

      const dna = pred.dna || { speed: 1, sense: 1, metabolism: 1, hueShift: 0 };
      const seekRadius = predatorSeekRadius * dna.sense;

      // Aggression index: how hard they commit to targets
      const aggression = Math.max(0.2, Math.min(1.4, dna.speed + dna.sense - dna.metabolism));

      let target = null;
      let targetDist2 = Infinity;
      for (const [aid] of agent.entries()) {
        const apos = position.get(aid);
        if (!apos) continue;
        const dx = apos.x - pos.x;
        const dy = apos.y - pos.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < targetDist2 && d2 < seekRadius * seekRadius) {
          targetDist2 = d2;
          target = apos;
        }
      }

      if (target) {
        const dx = target.x - pos.x;
        const dy = target.y - pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const desiredSpeed = 60 * dna.speed * (0.8 + aggression * 0.25);
        const desiredVx = (dx / dist) * desiredSpeed;
        const desiredVy = (dy / dist) * desiredSpeed;
        const blend = 0.65 + aggression * 0.1; // more aggressive → more steering override
        vel.vx = vel.vx * blend + desiredVx * (1 - blend);
        vel.vy = vel.vy * blend + desiredVy * (1 - blend);
      }
    }

    // Apex hunters seek predators only (top of chain)
    const apexSeekRadius = 260;
    for (const [id, ap] of apex.entries()) {
      const pos = position.get(id);
      const vel = velocity.get(id);
      if (!pos || !vel) continue;

      // Resting apex drift but do not aggressively seek
      if (ap.rest && ap.rest > 0) continue;

      const dna = ap.dna || { speed: 1, sense: 1, metabolism: 1, hueShift: 0 };
      const seekRadius = apexSeekRadius * dna.sense;

      let target = null;
      let targetDist2 = Infinity;
      for (const [pid] of predator.entries()) {
        const ppos = position.get(pid);
        if (!ppos) continue;
        const dx = ppos.x - pos.x;
        const dy = ppos.y - pos.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < targetDist2 && d2 < seekRadius * seekRadius) {
          targetDist2 = d2;
          target = ppos;
        }
      }

      if (target) {
        const dx = target.x - pos.x;
        const dy = target.y - pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const desiredSpeed = 55 * dna.speed; // more assertive hunters
        const desiredVx = (dx / dist) * desiredSpeed;
        const desiredVy = (dy / dist) * desiredSpeed;
        const blend = 0.8;
        vel.vx = vel.vx * blend + desiredVx * (1 - blend);
        vel.vy = vel.vy * blend + desiredVy * (1 - blend);
      }
    }

  }

  // Metabolism & eating: agents lose energy over time, gain by consuming resources.
  function metabolismSystem(dt) {
    const { position, agent, predator, apex, resource, burst } = ecs.components;
    const eatRadius = 10;
    const baseDrain = 0.03 * world.globals.metabolism; // per second, modulated by regime

    // Herbivores
    for (const [id, ag] of agent.entries()) {
      const dna = ag.dna || { speed: 1, sense: 1, metabolism: 1, hueShift: 0 };
      ag.energy -= baseDrain * dna.metabolism * dt;
      if (ag.energy < 0) ag.energy = 0;

      const pos = position.get(id);
      if (!pos) continue;

      for (const [rid, res] of resource.entries()) {
        if (res.amount <= 0) continue;
        const rpos = position.get(rid);
        if (!rpos) continue;
        const dx = rpos.x - pos.x;
        const dy = rpos.y - pos.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < eatRadius * eatRadius) {
          const bite = Math.min(0.6, res.amount);
          res.amount -= bite;
          ag.energy = Math.min(2.0, ag.energy + bite); // allow some over-fullness
        }
      }
    }

    // Predators eat agents
    const predEatRadius = 9;
    const predDrain = baseDrain * 1.9;
    for (const [pid, pred] of predator.entries()) {
      const dna = pred.dna || { speed: 1, sense: 1, metabolism: 1, hueShift: 0 };
      const aggression = Math.max(0.2, Math.min(1.4, dna.speed + dna.sense - dna.metabolism));

      // Rest timer after a successful hunt
      pred.rest = Math.max(0, (pred.rest || 0) - dt);

      // Only drain energy when not resting as much
      const restFactor = pred.rest > 0 ? 0.4 : 1.0;
      pred.energy -= predDrain * dna.metabolism * (0.7 + aggression * 0.4) * dt * restFactor;
      if (pred.energy < 0) pred.energy = 0;

      const ppos = position.get(pid);
      if (!ppos) continue;

      // Skip hunting if still resting from a previous kill
      if (pred.rest > 0) continue;

      for (const [aid, ag] of Array.from(agent.entries())) {
        const apos = position.get(aid);
        if (!apos) continue;
        const dx = apos.x - ppos.x;
        const dy = apos.y - ppos.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < predEatRadius * predEatRadius) {
          // Spawn small "absorption" particles from prey toward predator
          const particles = 4;
          const hue = pred.colorHue ?? 30;
          const baseSpeed = 70;
          for (let i = 0; i < particles; i++) {
            const id = ecs.createEntity();
            const posId = id;
            position.set(posId, { x: apos.x, y: apos.y });
            const vx = (ppos.x - apos.x) * (0.8 + rng.float() * 0.5);
            const vy = (ppos.y - apos.y) * (0.8 + rng.float() * 0.5);
            burst.set(id, {
              vx: vx * (baseSpeed / (Math.hypot(vx, vy) || 1)),
              vy: vy * (baseSpeed / (Math.hypot(vx, vy) || 1)),
              life: 0.5 + rng.float() * 0.3,
              hue,
            });
          }

          ecs.destroyEntity(aid);
          pred.energy = Math.min(3.5, pred.energy + 1.0);
          pred.rest = 4 + rng.float() * 3; // 4–7s rest after a kill
          break;
        }
      }
    }

    // Apex metabolism and eating predators
    const apexEatRadius = 12;
    const apexDrain = baseDrain * 1.1;
    for (const [aid, ap] of apex.entries()) {
      const dna = ap.dna || { speed: 1, sense: 1, metabolism: 1, hueShift: 0 };
      ap.rest = Math.max(0, (ap.rest || 0) - dt);
      ap.age = (ap.age || 0) + dt;

      const restFactor = ap.rest > 0 ? 0.3 : 1.0;
      ap.energy -= apexDrain * dna.metabolism * dt * restFactor;
      if (ap.energy < 0) ap.energy = 0;

      const apos = position.get(aid);
      if (!apos) continue;

      // Skip hunting while resting
      if (ap.rest > 0) continue;

      for (const [pid, pred] of Array.from(predator.entries())) {
        const ppos = position.get(pid);
        if (!ppos) continue;
        const dx = ppos.x - apos.x;
        const dy = ppos.y - apos.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < apexEatRadius * apexEatRadius) {
          ecs.destroyEntity(pid);
          ap.energy = Math.min(5.0, ap.energy + 1.5);

          // Occasionally burst when very full
          if (ap.energy > 3.5 && rng.float() < 0.45) {
            spawnApexBurst(apos.x, apos.y, ap.colorHue, 10, ap.energy);

            // Shockwave: push nearby creatures away
            const shockRadius = 160;
            const shockRadius2 = shockRadius * shockRadius;
            const maxImpulse = 120 + ap.energy * 40;
            const { velocity } = ecs.components;

            const pushEntity = (map) => {
              for (const [eid] of map.entries()) {
                if (eid === aid) continue;
                const pos = position.get(eid);
                const vel = velocity.get(eid);
                if (!pos || !vel) continue;
                const dx2 = pos.x - apos.x;
                const dy2 = pos.y - apos.y;
                const d2 = dx2 * dx2 + dy2 * dy2;
                if (d2 === 0 || d2 > shockRadius2) continue;
                const dist = Math.sqrt(d2) || 1;
                const falloff = 1 - dist / shockRadius;
                const impulse = maxImpulse * falloff;
                const nx = dx2 / dist;
                const ny = dy2 / dist;
                vel.vx += nx * impulse * dt;
                vel.vy += ny * impulse * dt;
              }
            };

            pushEntity(agent);
            pushEntity(predator);
            pushEntity(apex);

            // Apex "supernova": consume itself in the burst
            ecs.destroyEntity(aid);
            break;
          }

          ap.rest = 4 + rng.float() * 2; // 4–6s rest after eating a predator
          break;
        }
      }
    }
  }

  // Ecology: resources regrow over time when depleted and pods seed new plants.
  function ecologySystem(dt) {
    const { resource, position } = ecs.components;
    const fertility = world.globals.fertility;

    // Global pod count for limiting explosive growth
    let podCount = 0;
    for (const res of resource.values()) {
      if (res.kind === 'pod') podCount++;
    }

    const MAX_PODS = 80;          // soft global cap
    const MAX_POD_CYCLES = 3;     // per-pod explosion limit

    for (const [id, res] of resource.entries()) {
      // Age tracks time since last regrowth or spread attempt
      res.age = (res.age || 0) + dt;

      // --- Seed pod behavior ---
      // Seed pod explosion: when mature and still fairly full, within limits
      if (
        res.kind === 'pod' &&
        res.seedTimer != null &&
        res.age > res.seedTimer &&
        res.amount > 0.6 &&
        (res.cycles || 0) < MAX_POD_CYCLES &&
        podCount < MAX_PODS
      ) {
        const pos = position.get(id);
        if (pos) {
          const seeds = 4 + (id % 4); // 4–7 new plants
          const baseAngle = (id * 0.6) % (Math.PI * 2);
          const baseDist = 18 + res.amount * 10;

          for (let i = 0; i < seeds; i++) {
            const angle = baseAngle + (i * (Math.PI * 2 / seeds)) + (rng.float() - 0.5) * 0.3;
            const dist = baseDist * (0.7 + rng.float() * 0.6);
            let nx = pos.x + Math.cos(angle) * dist;
            let ny = pos.y + Math.sin(angle) * dist;

            // Wrap positions into world bounds
            if (nx < 0) nx += width;
            if (nx >= width) nx -= width;
            if (ny < 0) ny += height;
            if (ny >= height) ny -= height;

            // Seed pods create more pods, forming clustered groves
            makeSeedPod(nx, ny);
          }
        }
        // Pod partially depletes and starts a new seed timer; count a new cycle
        res.amount = 0.3;
        res.cycles = (res.cycles || 0) + 1;
        res.age = 0; // reset per-cycle animation
        res.seedTimer = 10 + rng.float() * 12;
        podCount++; // track new pod
      }

      // --- Default plant-style regeneration ---
      if (res.amount > 0.99) continue;
      res.regenTimer -= dt * (0.8 + fertility * 1.2);
      if (res.regenTimer <= 0) {
        res.amount = 1;
        res.regenTimer = 6 + Math.random() * 4; // slightly faster, staggered regrowth
        res.cycles = (res.cycles || 0) + 1;
        res.age = 0; // new visible growth cycle
      }
    }
  }

  // Reproduction & growth.
  function lifeCycleSystem(dt) {
    const { position, velocity, agent, predator, apex, burst } = ecs.components;

    // Herbivore lifecycle
    for (const [id, ag] of Array.from(agent.entries())) {
      // Age grows slowly over time
      ag.age = (ag.age || 0) + dt;

      // Clamp energy at zero but do not kill agents
      if (ag.energy <= 0) {
        ag.energy = 0;
      }

      // Reproduction
      if (ag.energy >= world.globals.reproductionThreshold && ag.age > 8) {
        const parentPos = position.get(id);
        const parentVel = velocity.get(id);
        if (!parentPos || !parentVel) continue;

        const jitter = () => (rng.float() - 0.5) * 8;
        const childId = makeAgent(
          parentPos.x + jitter(),
          parentPos.y + jitter(),
          ag.colorHue,
          ag.dna,
        );
        const childVel = velocity.get(childId);
        childVel.vx = parentVel.vx + jitter();
        childVel.vy = parentVel.vy + jitter();
        const childAgent = agent.get(childId);
        childAgent.energy = ag.energy * 0.5;

        ag.energy *= 0.5;
      }
    }

    // Predator lifecycle: age + reproduction + death when fully starved
    for (const [pid, pred] of Array.from(predator.entries())) {
      pred.age = (pred.age || 0) + dt;

      if (pred.energy >= 2.8 && pred.age > 10) {
        const pos = position.get(pid);
        const vel = velocity.get(pid);
        if (pos && vel) {
          const jitter = () => (rng.float() - 0.5) * 10;
          const childId = makePredator(
            pos.x + jitter(),
            pos.y + jitter(),
            pred.dna,
          );
          const childVel = velocity.get(childId);
          childVel.vx = vel.vx + jitter();
          childVel.vy = vel.vy + jitter();
          pred.energy *= 0.5;
        }
      }

      if (pred.energy <= 0) {
        ecs.destroyEntity(pid);
      }
    }

    // Apex lifecycle: reproduce more readily than predators + death when fully starved
    for (const [id, ap] of Array.from(apex.entries())) {
      if (ap.energy >= 3.2 && ap.age > 14) {
        const pos = position.get(id);
        const vel = velocity.get(id);
        if (pos && vel) {
          const jitter = () => (rng.float() - 0.5) * 12;
          const childId = makeApex(
            pos.x + jitter(),
            pos.y + jitter(),
            ap.dna,
          );
          const childVel = velocity.get(childId);
          childVel.vx = vel.vx + jitter();
          childVel.vy = vel.vy + jitter();
          ap.energy *= 0.55; // keep a bit more energy post-reproduction
        }
      }

      if (ap.energy <= 0) {
        ecs.destroyEntity(id);
      }
    }

    // Fade and clean up burst particles
    for (const [id, p] of Array.from(burst.entries())) {
      p.life -= dt;
      if (p.life <= 0) {
        ecs.destroyEntity(id);
      }
    }

    // No hard population cap: reproductionThreshold stays constant
    world.globals.reproductionThreshold = 1.6;
  }

  // Apply force fields (attractors/repulsors painted by user).
  function forceFieldSystem(dt) {
    const { position, velocity, forceField } = ecs.components;
    if (forceField.size === 0) return;
    for (const [fid, field] of forceField.entries()) {
      const fpos = position.get(fid);
      if (!fpos) continue;
      const radius2 = field.radius * field.radius;
      for (const [id, vel] of velocity.entries()) {
        const pos = position.get(id);
        if (!pos || pos === fpos) continue;
        const dx = fpos.x - pos.x;
        const dy = fpos.y - pos.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > radius2 || d2 === 0) continue;
        const dist = Math.sqrt(d2) || 1;
        const dir = field.strength >= 0 ? 1 : -1;
        const strength = (1 - dist / field.radius) * Math.abs(field.strength);
        const ax = (dx / dist) * dir * strength;
        const ay = (dy / dist) * dir * strength;
        vel.vx += ax * dt;
        vel.vy += ay * dt;
      }
    }
  }

  // Regime system: calm vs storm based on population & resource scarcity.
  function regimeSystem(dt) {
    const { agent, resource } = ecs.components;
    const pop = agent.size;
    let totalRes = 0;
    for (const r of resource.values()) totalRes += r.amount;
    const avgRes = resource.size ? totalRes / resource.size : 0;

    // Simple heuristic: low resources + high population increases storminess.
    const scarcity = avgRes < 0.5 ? (0.5 - avgRes) * 2 : 0;
    const pressure = pop / 80;
    const targetStorm = Math.max(0, Math.min(1, scarcity * 0.7 + pressure * 0.3));

    // Smooth toward target.
    world.globals.storminess += (targetStorm - world.globals.storminess) * 0.05;

    // Map storminess to metabolism and regime label.
    const s = world.globals.storminess;
    world.globals.metabolism = 1 + s * 1.5; // faster drain in storm
    world.regime = s > 0.55 ? 'storm' : 'calm';
  }

  function step(dt) {
    world.tick++;

    const { agent, predator, apex } = ecs.components;
    const livingCount = agent.size + predator.size + apex.size;

    // If all three creature types are gone, restart the ecosystem with slightly
    // mutated global parameters and a fresh seed of entities/resources.
    if (livingCount === 0) {
      // Nudge globals a bit to explore nearby regimes
      world.globals.fertility = Math.max(0.2, Math.min(1.2, jitterParam(world.globals.fertility, 0.35)));
      world.globals.metabolism = Math.max(0.4, Math.min(2.5, jitterParam(world.globals.metabolism, 0.4)));
      world.globals.reproductionThreshold = Math.max(1.1, Math.min(2.2, jitterParam(world.globals.reproductionThreshold, 0.25)));

      // Clear ECS state
      for (const id of Array.from(ecs.entities)) {
        ecs.destroyEntity(id);
      }

      // Reset tick and regime
      world.tick = 0;
      world.regime = 'calm';
      world.globals.storminess = 0;

      // Reseed
      seedCreaturesAndResources();

      // Early return so the new world doesn't also advance this frame
      return;
    }

    steeringSystem(dt);
    forceFieldSystem(dt);
    collisionSystem(dt);
    physicsSystem(dt);
    metabolismSystem(dt);
    ecologySystem(dt);
    lifeCycleSystem(dt);
    regimeSystem(dt);
  }

  // Paint/update force fields at a point with a given polarity.
  world.paintForceField = (point, polarity) => {
    const { position, forceField } = ecs.components;
    const radius = 80;
    const strength = polarity * 50; // positive = attract, negative = repel

    // Try to reuse a nearby field instead of spamming new ones
    let targetId = null;
    for (const [id, field] of forceField.entries()) {
      const pos = position.get(id);
      if (!pos) continue;
      const dx = pos.x - point.x;
      const dy = pos.y - point.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < (radius * 0.6) * (radius * 0.6)) {
        targetId = id;
        break;
      }
    }

    if (targetId == null) {
      targetId = ecs.createEntity();
      position.set(targetId, { x: point.x, y: point.y });
    } else {
      const pos = position.get(targetId);
      pos.x = point.x;
      pos.y = point.y;
    }

    forceField.set(targetId, { strength, radius });
  };

  world.step = step;
  return world;
}
