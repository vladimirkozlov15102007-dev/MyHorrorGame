// Throwable items system — distraction mechanic.
//
// Types: "bottle" (glass, breaks), "pipe" (metal rod), "nut" (small bolt),
//        "can" (tin can), "rebar" (iron piece).
//
// Flow:
//   1) Items spawn as world pickups from level.throwablesSpawns.
//   2) Player presses E near one → it becomes "held" (stored as player.state.held).
//   3) Player holds LMB → aims (slight camera sway); release → throw with
//      force proportional to hold time (0.3s..1.4s clamp → 6..16 m/s).
//   4) Projectile flies under gravity. First wall/floor hit spawns an
//      impact event at the hit position (distraction) and either bounces
//      (pipe/can/nut/rebar) or shatters (bottle).
//   5) Monster reads distraction events to investigate (see monster.js).
//
// Collisions use the same AABB wall colliders + floor plane at y=0.

import * as THREE from "three";
import { Audio } from "./audio.js";

const GRAVITY = -14.0;

export const THROWABLE_DEFS = {
  bottle: { color: 0x2a5a3a, emissive: 0x061a10, mass: 0.4, bounce: 0.0, breaks: true,  label: "BOTTLE" },
  pipe:   { color: 0x555555, emissive: 0x000000, mass: 1.2, bounce: 0.35, breaks: false, label: "METAL PIPE" },
  nut:    { color: 0x707070, emissive: 0x000000, mass: 0.1, bounce: 0.4,  breaks: false, label: "NUT/BOLT" },
  can:    { color: 0x9a7a3a, emissive: 0x000000, mass: 0.2, bounce: 0.55, breaks: false, label: "TIN CAN" },
  rebar:  { color: 0x5a3a20, emissive: 0x000000, mass: 1.5, bounce: 0.2,  breaks: false, label: "REBAR" },
};

function buildMesh(kind) {
  const def = THROWABLE_DEFS[kind] || THROWABLE_DEFS.bottle;
  const g = new THREE.Group();
  if (kind === "bottle") {
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.055, 0.22, 10),
      new THREE.MeshStandardMaterial({
        color: def.color, roughness: 0.25, metalness: 0.1,
        transparent: true, opacity: 0.75
      })
    );
    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.04, 0.08, 8),
      new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.3, transparent: true, opacity: 0.8 })
    );
    neck.position.y = 0.13;
    g.add(body); g.add(neck);
  } else if (kind === "pipe") {
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 0.6, 10),
      new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.55, metalness: 0.7 })
    );
    body.rotation.z = Math.PI / 2;
    g.add(body);
  } else if (kind === "nut") {
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 0.04, 6),
      new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.6, metalness: 0.7 })
    );
    g.add(body);
  } else if (kind === "can") {
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.045, 0.12, 12),
      new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.45, metalness: 0.6 })
    );
    g.add(body);
  } else if (kind === "rebar") {
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.55, 8),
      new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.85, metalness: 0.3 })
    );
    body.rotation.z = Math.PI / 2;
    g.add(body);
  }
  // faint halo so player can spot items in the dark
  const halo = new THREE.PointLight(0xffd699, 0.2, 1.6, 2.2);
  g.add(halo);
  return g;
}

export class ThrowableSystem {
  constructor(scene, level, player) {
    this.scene = scene;
    this.level = level;
    this.player = player;
    this.items = [];       // world pickups
    this.projectiles = []; // flying items
    this.distractionEvents = []; // consumed by monster AI
    this.time = 0;
    this._spawnItems();
  }

  _spawnItems() {
    const root = this.level.group;
    for (const sp of this.level.throwablesSpawns) {
      const mesh = buildMesh(sp.kind);
      mesh.position.set(sp.x, sp.y, sp.z);
      mesh.rotation.y = Math.random() * Math.PI * 2;
      root.add(mesh);
      this.items.push({
        kind: sp.kind,
        mesh,
        pos: mesh.position,
        baseY: sp.y,
        phase: Math.random() * Math.PI * 2,
        collected: false,
      });
    }
  }

  // Called each frame with player position; returns the nearest interactable
  // item (within range) for the interaction prompt.
  nearestItem(pos, range = 2.2) {
    let best = null, bestD = range;
    for (const it of this.items) {
      if (it.collected) continue;
      const d = it.pos.distanceTo(pos);
      if (d < bestD) { bestD = d; best = it; }
    }
    return best;
  }

  pickup(item) {
    if (!item || item.collected) return false;
    item.collected = true;
    this.level.group.remove(item.mesh);
    Audio.throwablePickup();
    return true;
  }

  // Spawn a projectile from origin with a given velocity (Vector3).
  spawn(origin, velocity, kind) {
    const mesh = buildMesh(kind);
    mesh.position.copy(origin);
    this.scene.add(mesh);
    Audio.throwSwoosh();
    this.projectiles.push({
      mesh,
      pos: mesh.position,
      vel: velocity.clone(),
      kind,
      age: 0,
      dead: false,
      bouncesLeft: 2,
    });
  }

  // Consume accumulated distraction events (one call per frame from AI).
  popDistractions() {
    const evs = this.distractionEvents;
    this.distractionEvents = [];
    return evs;
  }

  update(dt, playerPos) {
    this.time += dt;

    // Float & rotate pickups
    for (const it of this.items) {
      if (it.collected) continue;
      it.mesh.rotation.y += dt * 1.0;
      it.mesh.position.y = it.baseY + Math.sin(this.time * 2 + it.phase) * 0.06;
    }

    // Projectile physics
    for (const p of this.projectiles) {
      if (p.dead) continue;
      p.age += dt;

      // integrate
      p.vel.y += GRAVITY * dt;
      const next = p.pos.clone().addScaledVector(p.vel, dt);

      // Collide against walls (AABB XZ) — only wall colliders (blocksVision true is a proxy)
      let hitWall = false;
      for (const c of this.level.colliders) {
        if (c.kind !== "wall" && c.kind !== "container" && c.kind !== "rack") continue;
        // XZ AABB test
        if (next.x > c.minX && next.x < c.maxX && next.z > c.minZ && next.z < c.maxZ) {
          // Determine incidence axis: use previous pos
          const fromX = p.pos.x, fromZ = p.pos.z;
          const insideX = fromX > c.minX && fromX < c.maxX;
          const insideZ = fromZ > c.minZ && fromZ < c.maxZ;
          if (!insideX) p.vel.x *= -(0.35 * (THROWABLE_DEFS[p.kind].bounce || 0));
          if (!insideZ) p.vel.z *= -(0.35 * (THROWABLE_DEFS[p.kind].bounce || 0));
          // Pull position back slightly to outside the box
          if (!insideX) {
            next.x = p.vel.x >= 0 ? c.minX - 0.05 : c.maxX + 0.05;
          }
          if (!insideZ) {
            next.z = p.vel.z >= 0 ? c.minZ - 0.05 : c.maxZ + 0.05;
          }
          hitWall = true;
          break;
        }
      }

      // Floor collision
      let hitFloor = false;
      if (next.y <= 0.05) {
        next.y = 0.05;
        if (Math.abs(p.vel.y) > 0.3) {
          p.vel.y = -p.vel.y * (THROWABLE_DEFS[p.kind].bounce || 0);
        } else {
          p.vel.y = 0;
        }
        // ground friction
        p.vel.x *= 0.55;
        p.vel.z *= 0.55;
        hitFloor = true;
      }

      p.pos.copy(next);
      p.mesh.position.copy(next);
      p.mesh.rotation.x += dt * 6.0;
      p.mesh.rotation.z += dt * 4.0;

      if (hitWall || hitFloor) {
        p.bouncesLeft--;
        this._impact(p, hitWall ? "wall" : "floor");
        const def = THROWABLE_DEFS[p.kind];
        if (def.breaks) {
          this._shatter(p);
          continue;
        }
        if (p.bouncesLeft <= 0 || (p.vel.lengthSq() < 0.6)) {
          // settle — final soft "tink"
          p.vel.set(0, 0, 0);
          // keep mesh as prop (won't despawn)
          p.dead = true;
        }
      }

      // safety: despawn after 14s
      if (p.age > 14) {
        this.scene.remove(p.mesh);
        p.dead = true;
      }
    }

    // prune
    this.projectiles = this.projectiles.filter(p => !p.dead || p.mesh.parent != null);
  }

  _impact(p, surface) {
    const def = THROWABLE_DEFS[p.kind];
    const speed = p.vel.length();
    const loudness = Math.min(1, speed / 12) * (def.breaks ? 1.0 : 0.75);
    if (loudness < 0.05 && surface === "floor") return;

    // audio
    if (def.breaks) {
      Audio.bottleBreak();
    } else if (p.kind === "pipe" || p.kind === "rebar") {
      Audio.metalClang(loudness);
    } else if (p.kind === "can") {
      Audio.canClink(loudness);
    } else {
      Audio.metalClang(loudness * 0.6);
    }

    // Emit distraction event for the monster AI
    this.distractionEvents.push({
      pos: p.pos.clone(),
      loudness,               // 0..1 how much noise
      time: this.time,
      kind: p.kind,
      isBreak: !!def.breaks,
    });
  }

  _shatter(p) {
    // mini particle burst
    const mat = new THREE.MeshStandardMaterial({
      color: 0x3a6a4a, transparent: true, opacity: 0.7
    });
    for (let i = 0; i < 8; i++) {
      const s = 0.02 + Math.random() * 0.03;
      const shard = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), mat);
      shard.position.copy(p.pos);
      this.scene.add(shard);
      const vx = (Math.random() - 0.5) * 3;
      const vy = Math.random() * 3 + 1;
      const vz = (Math.random() - 0.5) * 3;
      this.projectiles.push({
        mesh: shard,
        pos: shard.position,
        vel: new THREE.Vector3(vx, vy, vz),
        kind: "nut",   // inherit physics tuning
        age: 0, dead: false, bouncesLeft: 1,
      });
    }
    this.scene.remove(p.mesh);
    p.dead = true;
  }
}
