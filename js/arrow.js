// Arrow projectile system for skeleton archers.
//
// Arrows are real 3D meshes with ballistic motion (gravity).
// They spawn from a bow's nock position with an initial velocity.
// On collision with player: apply zone-based damage (head/torso/legs).
// On collision with environment: the arrow "sticks" where it landed.

import * as THREE from "three";
import { Audio } from "./audio.js";

const GRAVITY = -12.0;
const ARROW_SPEED = 32.0;
const ARROW_MAX_AGE = 6.0;

// Damage to player (spec says the same model as for skeletons).
const DAMAGE = { head: 30, torso: 20, legs: 10, generic: 18 };

function buildArrowMesh() {
  const g = new THREE.Group();
  // Shaft
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.008, 0.008, 0.7, 6),
    new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.85 })
  );
  shaft.rotation.z = Math.PI / 2;
  g.add(shaft);
  // Arrowhead (black iron)
  const head = new THREE.Mesh(
    new THREE.ConeGeometry(0.02, 0.09, 6),
    new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.45, metalness: 0.85 })
  );
  head.rotation.z = -Math.PI / 2;
  head.position.x = 0.38;
  g.add(head);
  // Fletching (three feathers)
  const fMat = new THREE.MeshStandardMaterial({
    color: 0x6a2a2a, roughness: 0.9, side: THREE.DoubleSide,
  });
  for (let i = 0; i < 3; i++) {
    const fg = new THREE.PlaneGeometry(0.1, 0.045);
    const f = new THREE.Mesh(fg, fMat);
    f.rotation.y = Math.PI / 2;
    f.rotation.x = (i / 3) * Math.PI * 2;
    f.position.x = -0.32;
    g.add(f);
  }
  // Nock wrap
  const nock = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, 0.02, 6),
    new THREE.MeshStandardMaterial({ color: 0x0a0a0a })
  );
  nock.rotation.z = Math.PI / 2;
  nock.position.x = -0.38;
  g.add(nock);
  return g;
}

export class ArrowSystem {
  constructor(scene, level, player, fx) {
    this.scene = scene;
    this.level = level;
    this.player = player;
    this.fx = fx;
    this.arrows = [];
    // Persistent stuck arrows (decorative)
    this._stuckArrows = [];
  }

  // Shoot an arrow from origin toward targetPos with some accuracy noise.
  // accuracy 0..1 (1 = perfect)
  spawn(origin, targetPos, accuracy = 0.85) {
    const mesh = buildArrowMesh();
    mesh.position.copy(origin);
    this.scene.add(mesh);

    // Compute a ballistic solution: small upward correction for gravity over distance
    const dx = targetPos.x - origin.x;
    const dy = targetPos.y - origin.y;
    const dz = targetPos.z - origin.z;
    const horz = Math.sqrt(dx * dx + dz * dz);
    const v = ARROW_SPEED;
    // Time of flight with flat trajectory approximation
    const tFlat = horz / v;
    // Vertical velocity to hit target (ignoring drag): vy = dy/t - 0.5*g*t
    const vy = dy / Math.max(0.05, tFlat) - 0.5 * GRAVITY * tFlat;
    // Base velocity
    const vel = new THREE.Vector3(
      (dx / Math.max(0.01, horz)) * v,
      vy,
      (dz / Math.max(0.01, horz)) * v
    );

    // Accuracy noise — scaled by distance
    const spread = (1 - accuracy) * 0.55;
    vel.x += (Math.random() - 0.5) * spread * v;
    vel.y += (Math.random() - 0.5) * spread * v * 0.6;
    vel.z += (Math.random() - 0.5) * spread * v;

    // Orient mesh along velocity
    this._orient(mesh, vel);

    this.arrows.push({
      mesh,
      pos: mesh.position,
      vel,
      age: 0,
      dead: false,
      prev: origin.clone(),
    });

    Audio.bowRelease();
  }

  _orient(mesh, vel) {
    // Our shaft is along +X, so we need to rotate so +X faces velocity dir
    const v = vel.clone().normalize();
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), v);
    mesh.quaternion.copy(q);
  }

  update(dt) {
    const playerRadius = 0.35;
    const playerHeight = this.player.state.crouched ? 1.05 : 1.65;

    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i];
      if (a.dead) {
        this.arrows.splice(i, 1);
        continue;
      }
      a.age += dt;
      if (a.age > ARROW_MAX_AGE) {
        this.scene.remove(a.mesh);
        a.dead = true;
        continue;
      }

      a.prev.copy(a.pos);
      a.vel.y += GRAVITY * dt;
      a.pos.addScaledVector(a.vel, dt);
      a.mesh.position.copy(a.pos);
      this._orient(a.mesh, a.vel);

      // Check player collision (capsule approximation)
      if (!this.player.state.dead && !this.player.state.hidden) {
        const ppos = this.player.pos;
        // approximate player capsule: vertical cylinder (feet at 0, head at playerHeight)
        const hit = segmentVsCapsule(a.prev, a.pos, ppos, playerHeight, playerRadius);
        if (hit) {
          // Determine zone
          let zone = "torso";
          const y = hit.point.y;
          if (y > playerHeight - 0.25) zone = "head";
          else if (y < 0.5) zone = "legs";
          const dmg = DAMAGE[zone] ?? DAMAGE.generic;
          // Direction of hit
          const dir = a.vel.clone().normalize();
          if (this.player.takeDamage) {
            this.player.takeDamage(dmg, { source: "arrow", dir, zone, point: hit.point });
          }
          // small blood puff
          this.fx.bloodBurst(hit.point, dir.clone().negate(), 0.6, false);
          this.scene.remove(a.mesh);
          a.dead = true;
          Audio.arrowHitFlesh();
          continue;
        }
      }

      // Environment collision: AABB colliders (walls, crates, machines, racks, containers, truck)
      let hitEnv = false;
      for (const c of this.level.colliders) {
        if (c.kind === "pallet" || c.kind === "fence") continue;
        if (a.pos.x > c.minX && a.pos.x < c.maxX && a.pos.z > c.minZ && a.pos.z < c.maxZ) {
          hitEnv = true;
          // stick arrow at the intersection on the box surface
          // crude but effective: nudge back to outside
          const eps = 0.02;
          // choose axis with greatest penetration reversal
          const dxMin = Math.abs(a.pos.x - c.minX);
          const dxMax = Math.abs(a.pos.x - c.maxX);
          const dzMin = Math.abs(a.pos.z - c.minZ);
          const dzMax = Math.abs(a.pos.z - c.maxZ);
          const m = Math.min(dxMin, dxMax, dzMin, dzMax);
          if (m === dxMin) a.pos.x = c.minX - eps;
          else if (m === dxMax) a.pos.x = c.maxX + eps;
          else if (m === dzMin) a.pos.z = c.minZ - eps;
          else a.pos.z = c.maxZ + eps;
          break;
        }
      }
      if (!hitEnv && a.pos.y <= 0.02) {
        hitEnv = true;
        a.pos.y = 0.02;
      }

      if (hitEnv) {
        Audio.arrowStick();
        a.mesh.position.copy(a.pos);
        // Keep arrow stuck
        this._stuckArrows.push({ obj: a.mesh, born: performance.now() / 1000 });
        a.dead = true;

        // Occasional small dust effect
        if (Math.random() < 0.4) {
          this.fx.bulletImpactConcrete(a.pos, new THREE.Vector3(0, 1, 0));
        }

        // Cull old stuck arrows to avoid pileup
        if (this._stuckArrows.length > 60) {
          const old = this._stuckArrows.shift();
          this.scene.remove(old.obj);
        }
      }
    }
  }
}

// Segment vs vertical capsule test.
// p0, p1: ray endpoints in this frame
// cpos: capsule base (y=0), height: capsule height, r: radius
// Returns { point } if hit.
function segmentVsCapsule(p0, p1, cpos, height, r) {
  // Capsule axis: from (cpos.x, 0, cpos.z) to (cpos.x, height, cpos.z)
  // Simplified: test closest point between segment and axis in XZ plane;
  // check y-range.
  const ab = new THREE.Vector3().subVectors(p1, p0);
  // Horizontal distance check:
  // Sample a few points along the segment and find min distance to (cpos.x, cpos.z)
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const px = p0.x + ab.x * t;
    const py = p0.y + ab.y * t;
    const pz = p0.z + ab.z * t;
    const dx = px - cpos.x;
    const dz = pz - cpos.z;
    const horz = dx * dx + dz * dz;
    if (horz < r * r) {
      if (py >= 0 && py <= height + 0.1) {
        return { point: new THREE.Vector3(px, py, pz) };
      }
    }
  }
  return null;
}
