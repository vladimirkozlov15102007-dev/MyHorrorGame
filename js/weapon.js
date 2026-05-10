// Player's pistol — realistic feel for a browser shooter.
//
// Features:
//   * 3D viewmodel (slide, grip, barrel, trigger guard, front sight)
//   * Recoil kick (camera pitch + viewmodel punch)
//   * Procedural weapon sway (idle + movement) + breathing
//   * Aim-down-sights (RMB)  — smooth FOV + position lerp to in-front of camera
//   * Hip-fire vs. ADS spread
//   * Muzzle flash + light + smoke puff (via FXManager)
//   * Shell ejection (brass)
//   * Hitscan raycast with damage zones: head=30 / torso=20 / legs=10
//   * Wall penetration disabled by default (simple linear ray)
//   * Reload animation (15 round mag, ammo store)
//
// Usage from main.js:
//   weapon = new Weapon(camera, scene, fxManager);
//   weapon.update(dt, { moving, sprinting, crouched })
//   weapon.triggerDown() / triggerUp()
//   weapon.aim(true/false)
//   weapon.reload()
//   weapon.fire(targets) — called internally by triggerDown when auto/semi allow
//
// Damage model returned to main loop via callback `onHit(target, damage, hit)`.

import * as THREE from "three";
import { Audio } from "./audio.js";

const MAG_SIZE = 15;
const RESERVE_MAX = 75;
const FIRE_INTERVAL = 0.18;       // seconds between shots (semi-auto, rapid click)
const RELOAD_TIME = 2.0;
const BULLET_RANGE = 120;

// Damage by body zone.
const DAMAGE = { head: 30, torso: 20, legs: 10, arm: 14, generic: 20 };

export class Weapon {
  constructor(camera, scene, fx) {
    this.camera = camera;
    this.scene = scene;
    this.fx = fx;

    // Ammo state
    this.magazine = MAG_SIZE;
    this.reserve = 60;           // 4 mags + change
    this.maxReserve = RESERVE_MAX;

    // Firing state
    this._cooldown = 0;
    this._reloading = false;
    this._reloadT = 0;
    this._triggerHeld = false;
    this._firedThisPress = false;

    // Sway / recoil
    this._sway = new THREE.Vector2(0, 0);
    this._recoil = 0;          // current recoil amount (0..1)
    this._recoilPitch = 0;     // camera pitch offset
    this._recoilYaw = 0;       // camera yaw random kick
    this.viewKick = new THREE.Vector3();
    this.viewKickRot = new THREE.Vector3();

    // ADS
    this.aiming = false;
    this.adsT = 0;             // 0..1 aim-down-sights blend

    // Viewmodel
    this._buildViewmodel();

    // Callbacks
    this.onHit = null;         // (targetInfo, damage, hit) => void
    this.onShotFired = null;   // () => void (for noise propagation to AI)

    // For AI noise
    this.lastShotTime = -999;

    // Target list (set by main): array of { getHitTest(rayOrigin, rayDir) → {hit, zone, target, distance, point, normal} | null }
    this.targets = [];
  }

  _buildViewmodel() {
    const group = new THREE.Group();
    group.name = "pistol-viewmodel";
    // slight initial pose (hip fire)
    group.position.set(0.22, -0.24, -0.42);
    group.rotation.set(0.02, -0.04, 0.0);

    const steel = new THREE.MeshStandardMaterial({
      color: 0x1e1f22, roughness: 0.35, metalness: 0.85,
      emissive: 0x020202, emissiveIntensity: 0.2,
    });
    const plastic = new THREE.MeshStandardMaterial({
      color: 0x141414, roughness: 0.85, metalness: 0.05,
    });
    const dark = new THREE.MeshStandardMaterial({
      color: 0x0a0a0a, roughness: 0.7, metalness: 0.6,
    });
    const grip = new THREE.MeshStandardMaterial({
      color: 0x1a1a1a, roughness: 0.95, metalness: 0.05,
    });

    // Slide (top body of pistol)
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.065, 0.22), steel);
    slide.position.set(0, 0.0, -0.02);
    group.add(slide);
    this.slide = slide;

    // Slide serrations (two grooves at back)
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.02, 0.008), dark);
      g.position.set(0, 0.025, 0.05 + i * 0.012);
      group.add(g);
    }

    // Frame (body under slide)
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.045, 0.2), plastic);
    frame.position.set(0, -0.055, -0.015);
    group.add(frame);

    // Trigger guard (simple loop)
    const tguard = new THREE.Mesh(
      new THREE.TorusGeometry(0.028, 0.007, 6, 14, Math.PI),
      plastic
    );
    tguard.rotation.x = Math.PI / 2;
    tguard.position.set(0, -0.095, 0.015);
    group.add(tguard);

    const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.03, 0.01), dark);
    trigger.position.set(0, -0.09, 0.025);
    group.add(trigger);
    this.trigger = trigger;

    // Grip (angled)
    const gripMesh = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.14, 0.07), grip);
    gripMesh.position.set(0, -0.155, 0.04);
    gripMesh.rotation.x = -0.3;
    group.add(gripMesh);
    // grip texture lines
    for (let i = 0; i < 5; i++) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.003, 0.07), dark);
      l.position.set(0, -0.195 + i * 0.018, 0.04);
      l.rotation.x = -0.3;
      group.add(l);
    }

    // Magazine (visible at the bottom)
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.06), dark);
    mag.position.set(0, -0.23, 0.05);
    mag.rotation.x = -0.3;
    group.add(mag);
    this.mag = mag;

    // Barrel (hidden inside, only muzzle visible)
    const muzzleRing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.022, 0.015, 12),
      dark
    );
    muzzleRing.rotation.x = Math.PI / 2;
    muzzleRing.position.set(0, 0.0, -0.14);
    group.add(muzzleRing);

    // Front sight post
    const fsight = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.008, 0.008), dark);
    fsight.position.set(0, 0.042, -0.13);
    group.add(fsight);

    // Rear sight
    const rsight = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.01, 0.015), dark);
    rsight.position.set(0, 0.04, 0.08);
    group.add(rsight);
    const rnotch = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.012, 0.016), new THREE.MeshBasicMaterial({ color: 0x000 }));
    rnotch.position.set(0, 0.042, 0.08);
    group.add(rnotch);

    // Ejection port (visible cutout, emissive when firing)
    const port = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.008, 0.045),
      new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.9, emissive: 0x000 })
    );
    port.position.set(0.028, 0.02, -0.01);
    group.add(port);
    this.ejectPort = port;

    // Save muzzle local pos (world will be computed at fire time)
    this._muzzleLocal = new THREE.Vector3(0, 0.0, -0.15);
    this._portLocal   = new THREE.Vector3(0.035, 0.02, -0.01);

    // Attach to camera so it moves with the head
    this.group = group;
    this.camera.add(group);

    // Default position records (for ADS lerp)
    this._hipPos = group.position.clone();
    this._hipRot = group.rotation.clone();
    this._adsPos = new THREE.Vector3(0, -0.09, -0.22);
    this._adsRot = new THREE.Euler(0, 0, 0);

    // Slide animation state
    this._slideOffset = 0;
  }

  // ===== public controls =====
  triggerDown() {
    if (this._reloading) return;
    this._triggerHeld = true;
    this._firedThisPress = false;
  }
  triggerUp() {
    this._triggerHeld = false;
  }
  aim(on) {
    this.aiming = !!on && !this._reloading;
  }
  reload() {
    if (this._reloading) return;
    if (this.magazine >= MAG_SIZE) return;
    if (this.reserve <= 0) return;
    this._reloading = true;
    this._reloadT = RELOAD_TIME;
    Audio.pistolReload();
  }

  canShoot() {
    return !this._reloading && this._cooldown <= 0 && this.magazine > 0;
  }

  // Main update
  update(dt, ctx = {}) {
    // cooldown
    this._cooldown = Math.max(0, this._cooldown - dt);

    // reload timing
    if (this._reloading) {
      this._reloadT -= dt;
      if (this._reloadT <= 0) {
        const need = MAG_SIZE - this.magazine;
        const give = Math.min(need, this.reserve);
        this.magazine += give;
        this.reserve -= give;
        this._reloading = false;
      }
    }

    // ADS blend
    const targetAds = this.aiming && !this._reloading ? 1 : 0;
    this.adsT += (targetAds - this.adsT) * Math.min(1, dt * 9);

    // Semi-auto fire: one shot per trigger press by default, but allow rapid clicks.
    // If you want full auto hold, uncomment the hold path.
    if (this._triggerHeld && !this._firedThisPress && this.canShoot()) {
      this._firedThisPress = true;
      this._cooldown = FIRE_INTERVAL;
      this._fire();
    }

    // Recoil decay
    this._recoil = Math.max(0, this._recoil - dt * 4.5);
    this._recoilPitch += (-this._recoilPitch) * Math.min(1, dt * 8);
    this._recoilYaw   += (-this._recoilYaw)   * Math.min(1, dt * 8);
    // viewmodel kick decay
    this.viewKick.lerp(new THREE.Vector3(), Math.min(1, dt * 10));
    this.viewKickRot.lerp(new THREE.Vector3(), Math.min(1, dt * 10));
    // slide animation decay (after shot)
    this._slideOffset = Math.max(0, this._slideOffset - dt * 1.2);
    if (this.slide) this.slide.position.z = -0.02 + this._slideOffset * 0.05;

    // Sway (idle breath + movement)
    const t = performance.now() / 1000;
    const movingMult = ctx.moving ? 1.8 : 1.0;
    const sprintMult = ctx.sprinting ? 2.2 : 1.0;
    const adsMult = 1 - this.adsT * 0.7; // steadier when aiming
    this._sway.x += (Math.sin(t * 1.6) * 0.015 * movingMult * adsMult - this._sway.x) * Math.min(1, dt * 4);
    this._sway.y += (Math.cos(t * 2.1) * 0.010 * movingMult * adsMult - this._sway.y) * Math.min(1, dt * 4);

    // Update viewmodel transform
    const hipPos = this._hipPos;
    const adsPos = this._adsPos;
    const px = hipPos.x + (adsPos.x - hipPos.x) * this.adsT + this._sway.x + this.viewKick.x;
    const py = hipPos.y + (adsPos.y - hipPos.y) * this.adsT + this._sway.y * 0.5 + this.viewKick.y
      - (ctx.sprinting ? 0.03 : 0);
    const pz = hipPos.z + (adsPos.z - hipPos.z) * this.adsT + this.viewKick.z
      + (ctx.sprinting ? 0.02 : 0);
    this.group.position.set(px, py, pz);

    // Rotation (sprint lowers, ADS centers)
    const rx = this._sway.y * 0.3 + this.viewKickRot.x + (ctx.sprinting ? 0.35 : 0);
    const ry = this._sway.x * 0.3 + this.viewKickRot.y + (ctx.sprinting ? 0.25 : 0);
    const rz = this._hipRot.z * (1 - this.adsT) + this.viewKickRot.z;
    this.group.rotation.set(rx, ry, rz);

    // Reload pose — drop the gun
    if (this._reloading) {
      const p = 1 - (this._reloadT / RELOAD_TIME);
      const drop = Math.sin(p * Math.PI) * 0.12;
      this.group.position.y -= drop;
      this.group.rotation.x += Math.sin(p * Math.PI) * 0.4;
      this.group.rotation.z += Math.sin(p * Math.PI) * 0.3;
      // magazine drop
      if (this.mag) this.mag.position.y = -0.23 - Math.sin(p * Math.PI) * 0.1;
    } else {
      if (this.mag) this.mag.position.y = -0.23;
    }

    // trigger pull
    if (this.trigger) {
      const pulled = (this._cooldown > 0.05) ? 0.007 : 0;
      this.trigger.position.z = 0.025 - pulled;
    }
  }

  // Camera offsets (main.js reads these to add to player's camera look)
  getCameraRecoil() {
    return { pitch: this._recoilPitch, yaw: this._recoilYaw };
  }
  // Called by main after consuming
  consumeCameraRecoil() {
    // we return absolute values; main will apply incrementally
  }

  getCrosshairSpread() {
    // Spread grows with recoil, hip-fire, sprinting
    const base = this.aiming ? 0.006 : 0.04;
    return base + this._recoil * 0.06;
  }

  _getMuzzleWorld() {
    const v = this._muzzleLocal.clone();
    this.group.updateMatrixWorld(true);
    v.applyMatrix4(this.group.matrixWorld);
    return v;
  }
  _getPortWorld() {
    const v = this._portLocal.clone();
    this.group.updateMatrixWorld(true);
    v.applyMatrix4(this.group.matrixWorld);
    return v;
  }

  // Called internally when trigger pulled
  _fire() {
    this.magazine--;
    this.lastShotTime = performance.now() / 1000;

    // World-space firing origin & direction from CAMERA (so hip-fire is still accurate toward crosshair)
    const origin = new THREE.Vector3();
    this.camera.getWorldPosition(origin);
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);

    // Spread
    const spread = this.getCrosshairSpread();
    dir.x += (Math.random() - 0.5) * spread;
    dir.y += (Math.random() - 0.5) * spread;
    dir.z += (Math.random() - 0.5) * spread;
    dir.normalize();

    // FX at the muzzle (world)
    const muzzleW = this._getMuzzleWorld();
    // side direction: right of camera
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    this.fx.muzzleFlash(muzzleW, dir, 1.0 + Math.random() * 0.2);
    // eject shell at port
    const portW = this._getPortWorld();
    this.fx.ejectShell(portW, dir, right);
    // slide back
    this._slideOffset = 1.0;

    // Audio
    Audio.pistolShot(1.0);

    // Apply recoil to camera
    this._recoil = Math.min(1, this._recoil + 0.45);
    this._recoilPitch += 0.03 + Math.random() * 0.02;
    this._recoilYaw += (Math.random() - 0.5) * 0.018;

    // Viewmodel kick
    this.viewKick.z += 0.055;
    this.viewKick.y += 0.02;
    this.viewKickRot.x -= 0.25;
    this.viewKickRot.z += (Math.random() - 0.5) * 0.12;

    // Raycast against targets + colliders
    const hit = this._rayTrace(origin, dir);
    if (hit) {
      if (hit.kind === "target") {
        if (this.onHit) this.onHit(hit.target, hit.damage, hit);
      } else if (hit.kind === "wall" || hit.kind === "metal" || hit.kind === "concrete") {
        if (hit.surfaceKind === "metal") this.fx.bulletImpactMetal(hit.point, hit.normal);
        else this.fx.bulletImpactConcrete(hit.point, hit.normal);
      }
    }

    // Notify listeners (AI noise, UI)
    if (this.onShotFired) this.onShotFired(origin, dir);
  }

  // Ray traces against targets (skeletons) and environment colliders.
  // Returns { kind, target?, damage?, zone?, point, normal, distance } or null.
  _rayTrace(origin, dir) {
    let nearest = null;
    let nearestDist = BULLET_RANGE;

    // Targets (skeletons): each has getHitTest that returns bone-level info
    for (const tgt of this.targets) {
      if (!tgt.alive) continue;
      const info = tgt.rayTest ? tgt.rayTest(origin, dir, nearestDist) : null;
      if (info && info.distance < nearestDist) {
        const damage = DAMAGE[info.zone] ?? DAMAGE.generic;
        nearest = {
          kind: "target",
          target: tgt,
          damage,
          zone: info.zone,
          point: info.point.clone(),
          normal: info.normal ? info.normal.clone() : new THREE.Vector3(0, 0, -1),
          distance: info.distance,
        };
        nearestDist = info.distance;
      }
    }

    // Environment: use the level colliders (AABB). Nearest ray–AABB intersection.
    if (this._envColliders) {
      for (const c of this._envColliders) {
        if (c.kind === "pallet" || c.kind === "fence") continue;
        const t = rayAABB(origin, dir, c);
        if (t !== null && t < nearestDist) {
          nearestDist = t;
          const point = origin.clone().addScaledVector(dir, t);
          // Determine normal from which face was hit
          const normal = aabbNormal(point, c);
          // Decide surface type
          let surf = "concrete";
          if (c.kind === "machine" || c.kind === "container" || c.kind === "conveyor"
              || c.kind === "cctv" || c.kind === "truck" || c.kind === "rack" || c.kind === "locker") {
            surf = "metal";
          }
          nearest = {
            kind: "wall", surfaceKind: surf,
            point, normal, distance: t,
          };
        }
      }
    }

    // Floor / ground
    if (dir.y < 0) {
      const t = -origin.y / dir.y;
      if (t > 0 && t < nearestDist) {
        nearestDist = t;
        const point = origin.clone().addScaledVector(dir, t);
        nearest = {
          kind: "wall", surfaceKind: "concrete",
          point, normal: new THREE.Vector3(0, 1, 0), distance: t,
        };
      }
    }

    return nearest;
  }

  setEnvColliders(colliders) {
    this._envColliders = colliders;
  }
  setTargets(arr) {
    this.targets = arr;
  }
}

// ===== helpers =====
function rayAABB(origin, dir, box) {
  let tmin = 0.001, tmax = 1e9;
  for (const axis of ["x", "z", "y"]) {
    let mn, mx;
    if (axis === "y") {
      mn = 0; mx = 4;  // rough wall height; sufficient for bullet impacts
    } else if (axis === "x") {
      mn = box.minX; mx = box.maxX;
    } else {
      mn = box.minZ; mx = box.maxZ;
    }
    const o = origin[axis], d = dir[axis];
    if (Math.abs(d) < 1e-8) {
      if (o < mn || o > mx) return null;
    } else {
      let t1 = (mn - o) / d, t2 = (mx - o) / d;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}
function aabbNormal(point, box) {
  // Find closest face
  const eps = 0.02;
  if (Math.abs(point.x - box.minX) < eps) return new THREE.Vector3(-1, 0, 0);
  if (Math.abs(point.x - box.maxX) < eps) return new THREE.Vector3(1, 0, 0);
  if (Math.abs(point.z - box.minZ) < eps) return new THREE.Vector3(0, 0, -1);
  if (Math.abs(point.z - box.maxZ) < eps) return new THREE.Vector3(0, 0, 1);
  return new THREE.Vector3(0, 1, 0);
}
