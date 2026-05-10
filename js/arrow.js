// Arrow projectiles fired by skeleton archers.
//
// Physics:
//   - Ballistic: integrated with gravity (-9.8 m/s^2 on Y)
//   - Travels ~28 m/s initial speed
//   - Stops on first collision:
//       - Player body sphere → applies damage based on hit Y (head/body/legs)
//       - World AABB wall / large prop → embeds (remains stuck in the wall
//         as a prop for a few seconds)
//       - Floor → sticks in the ground
//   - Penetration: if collider.kind is "pallet" or "fence" the arrow passes
//     through but slows.
//
// Damage to player:
//   - Head hit (y > player.pos.y - 0.05 at impact time): 30
//   - Body hit (y > player.pos.y - 0.70): 20
//   - Legs (below): 10

import * as THREE from "three";
import { Audio } from "./audio.js";

const GRAVITY = -9.8;
const PLAYER_BODY_RADIUS = 0.4;
const LIFE_FLY = 3.5;        // seconds before auto-despawn if it misses everything
const LIFE_STUCK = 10;       // seconds stuck arrows stay in the world
const MAX_RANGE = 90;

export class ArrowSystem {
  constructor(scene, level, player) {
    this.scene = scene;
    this.level = level;
    this.player = player;

    this.arrows = [];
    this._t = 0;
  }

  // Called by Skeleton._fireArrow()
  spawn(origin, velocity, ownerSkel) {
    const mesh = buildArrowMesh();
    mesh.position.copy(origin);
    // align arrow mesh to velocity
    alignToDirection(mesh, velocity.clone().normalize());
    this.scene.add(mesh);

    // Arrow whoosh
    Audio.arrowWhoosh();

    this.arrows.push({
      mesh,
      pos: mesh.position,
      vel: velocity.clone(),
      life: LIFE_FLY,
      state: "flying",     // flying | stuck
      stuckTimer: LIFE_STUCK,
      owner: ownerSkel,
      traveled: 0,
    });
  }

  update(dt) {
    this._t += dt;

    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i];
      if (a.state === "stuck") {
        a.stuckTimer -= dt;
        if (a.stuckTimer <= 0) {
          this.scene.remove(a.mesh);
          this.arrows.splice(i, 1);
        }
        continue;
      }

      // flying
      a.life -= dt;
      a.vel.y += GRAVITY * dt;

      const prev = a.pos.clone();
      const next = prev.clone().addScaledVector(a.vel, dt);
      const stepLen = next.distanceTo(prev);
      a.traveled += stepLen;

      // Hit player sphere? (use segment vs sphere)
      if (!this.player.state.dead && !this.player.state.hidden && !this.player.state.usingCCTV) {
        const hit = segmentVsSphere(prev, next,
          new THREE.Vector3(this.player.pos.x, this.player.pos.y - 0.6, this.player.pos.z),
          PLAYER_BODY_RADIUS + 0.12);
        if (hit) {
          // Determine part by impact y vs player eye height
          const impactY = hit.point.y;
          const eyeY = this.player.pos.y;     // eye ~ 1.72
          const shoulderY = eyeY - 0.35;       // approx top-of-body
          const waistY = eyeY - 1.0;           // approx waist
          let dmg = 20, part = "body";
          if (impactY > shoulderY)      { dmg = 30; part = "head"; }
          else if (impactY > waistY)    { dmg = 20; part = "body"; }
          else                          { dmg = 10; part = "legs"; }

          const sourcePos = a.owner ? a.owner.position.clone() : a.pos.clone();
          this.player.takeDamage(dmg, sourcePos);
          Audio.arrowImpactFlesh();
          // remove arrow
          this.scene.remove(a.mesh);
          this.arrows.splice(i, 1);
          continue;
        }
      }

      // Hit wall / prop AABB?
      let hitColl = null, bestT = Infinity, hitPoint = null;
      const rdx = a.vel.x, rdy = a.vel.y, rdz = a.vel.z;
      const segLen = Math.sqrt(rdx*rdx + rdy*rdy + rdz*rdz) * dt;
      if (segLen > 0.0001) {
        const dir = new THREE.Vector3(rdx, rdy, rdz).normalize();
        for (const c of this.level.colliders) {
          if (c.kind === "pallet") continue; // pass through
          if (c.kind === "fence") continue;
          const t = rayAABB3(prev, dir, c, segLen);
          if (t !== null && t < bestT) {
            bestT = t;
            hitColl = c;
            hitPoint = new THREE.Vector3(
              prev.x + dir.x * t,
              prev.y + dir.y * t,
              prev.z + dir.z * t
            );
          }
        }
      }
      if (hitColl) {
        // Stick in wall
        a.pos.copy(hitPoint);
        a.mesh.position.copy(hitPoint);
        a.state = "stuck";
        a.vel.set(0, 0, 0);
        Audio.arrowImpactMetal();
        continue;
      }

      // Floor?
      if (next.y <= 0.05) {
        next.y = 0.05;
        a.pos.copy(next);
        a.mesh.position.copy(next);
        a.state = "stuck";
        a.vel.set(0, 0, 0);
        Audio.arrowImpactWood();
        continue;
      }

      // continue flight
      a.pos.copy(next);
      a.mesh.position.copy(next);
      // Re-align arrow to current direction
      alignToDirection(a.mesh, a.vel.clone().normalize());

      if (a.life <= 0 || a.traveled > MAX_RANGE) {
        this.scene.remove(a.mesh);
        this.arrows.splice(i, 1);
      }
    }
  }

  reset() {
    for (const a of this.arrows) this.scene.remove(a.mesh);
    this.arrows = [];
  }
}

// --------- helpers ---------
function buildArrowMesh() {
  const g = new THREE.Group();
  // Shaft
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, 0.78, 6),
    new THREE.MeshStandardMaterial({ color: 0x2a1a0e, roughness: 0.9 })
  );
  shaft.rotation.x = Math.PI / 2;
  g.add(shaft);
  // Arrowhead (pyramidal)
  const head = new THREE.Mesh(
    new THREE.ConeGeometry(0.025, 0.08, 4),
    new THREE.MeshStandardMaterial({ color: 0x303030, metalness: 0.7, roughness: 0.3 })
  );
  head.rotation.x = -Math.PI / 2;
  head.position.z = -0.42;
  g.add(head);
  // Fletchings
  for (let i = 0; i < 3; i++) {
    const ang = (i / 3) * Math.PI * 2;
    const feather = new THREE.Mesh(
      new THREE.PlaneGeometry(0.06, 0.12),
      new THREE.MeshStandardMaterial({
        color: 0x7a3a2a, roughness: 1, side: THREE.DoubleSide
      })
    );
    feather.position.set(Math.cos(ang) * 0.014, Math.sin(ang) * 0.014, 0.34);
    feather.rotation.z = ang;
    g.add(feather);
  }
  return g;
}

function alignToDirection(mesh, dir) {
  // Arrow mesh is built with local -Z pointing forward (arrowhead at z=-0.42)
  const up = new THREE.Vector3(0, 1, 0);
  const target = new THREE.Vector3().copy(dir);
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, -1), target.normalize()
  );
  mesh.quaternion.copy(q);
}

function segmentVsSphere(p0, p1, center, radius) {
  const d = new THREE.Vector3().subVectors(p1, p0);
  const f = new THREE.Vector3().subVectors(p0, center);
  const a = d.dot(d);
  const b = 2 * f.dot(d);
  const c = f.dot(f) - radius * radius;
  let disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  disc = Math.sqrt(disc);
  const t1 = (-b - disc) / (2 * a);
  const t2 = (-b + disc) / (2 * a);
  const t = (t1 >= 0 && t1 <= 1) ? t1 : (t2 >= 0 && t2 <= 1) ? t2 : null;
  if (t === null) return null;
  return {
    t,
    point: new THREE.Vector3().copy(p0).addScaledVector(d, t),
  };
}

function rayAABB3(origin, dir, box, maxT) {
  const minY = 0, maxY = (box.maxY !== undefined) ? box.maxY : 8;
  let tmin = 0, tmax = maxT !== undefined ? maxT : Infinity;
  if (Math.abs(dir.x) < 1e-8) {
    if (origin.x < box.minX || origin.x > box.maxX) return null;
  } else {
    let t1 = (box.minX - origin.x) / dir.x, t2 = (box.maxX - origin.x) / dir.x;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (Math.abs(dir.z) < 1e-8) {
    if (origin.z < box.minZ || origin.z > box.maxZ) return null;
  } else {
    let t1 = (box.minZ - origin.z) / dir.z, t2 = (box.maxZ - origin.z) / dir.z;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (Math.abs(dir.y) < 1e-8) {
    if (origin.y < minY || origin.y > maxY) return null;
  } else {
    let t1 = (minY - origin.y) / dir.y, t2 = (maxY - origin.y) / dir.y;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin > 0 ? tmin : null;
}
