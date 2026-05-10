// Pistol weapon system — MAK-9 (fictional 9x19 sidearm).
//
// Features:
//   - 12-round magazine, 48-round reserve
//   - Hitscan with raycast against skeleton body parts (head/body/legs)
//   - Realistic damage: head 30, body 20, legs 10 per shot
//   - Recoil (accumulates pitch up + random yaw kick)
//   - Muzzle flash (point light + flash mesh)
//   - Shell ejection (ragdoll-physics brass shells bouncing for a second)
//   - Procedural view model (slide, frame, grip) that sways/bobs and
//     lowers during sprint, raises to ADS on RMB
//   - Reload animation (drop magazine → insert → rack slide)
//   - Crosshair spread while moving / hip firing
//
// Public API:
//   new Weapon(scene, camera, player, level, skeletons)
//   update(dt, { lmb, rmb, reloadPressed })
//   fire()       // called internally; use via input each frame
//   startReload()
//   get magAmmo, reserveAmmo, isReloading, reloadProgress

import * as THREE from "three";
import { Audio } from "./audio.js";

const MAG_SIZE = 12;
const RESERVE_MAX = 48;
const FIRE_COOLDOWN = 0.18;     // seconds between shots
const RELOAD_TIME = 1.7;        // seconds
const MAX_RANGE = 120;

export class Weapon {
  constructor(scene, camera, player, level, skeletonManager) {
    this.scene = scene;
    this.camera = camera;
    this.player = player;
    this.level = level;
    this.skeletons = skeletonManager;     // set by main.js

    this.magAmmo = MAG_SIZE;
    this.reserveAmmo = RESERVE_MAX;
    this.cooldown = 0;
    this.isReloading = false;
    this.reloadTimer = 0;
    this.reloadProgress = 0;

    // LMB semi-auto: track rising edge
    this._lmbPrev = false;

    this._buildViewModel();
    this._buildMuzzleFlash();
    this._shells = [];
    this._tracers = [];

    // hit-marker callback set by main
    this.onHit = null;
    this.onKill = null;

    // state for animation poses
    this._viewPose = {
      x: 0.26, y: -0.22, z: -0.5,
      swayX: 0, swayY: 0,
      kickZ: 0,           // slide kick
      reloadPhase: 0,     // 0..1 for reload animation
    };
    this._lastYaw = player.yaw;
    this._lastPitch = player.pitch;
    this._walkBobPhase = 0;

    this._shotsThisFrame = [];
  }

  setSkeletonManager(mgr) {
    this.skeletons = mgr;
  }

  // ---------- build ----------
  _buildViewModel() {
    this.viewGroup = new THREE.Group();
    // Parented to camera so it follows view
    this.camera.add(this.viewGroup);

    // Slide + frame
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a1d, roughness: 0.4, metalness: 0.85
    });
    const slideMat = new THREE.MeshStandardMaterial({
      color: 0x222225, roughness: 0.35, metalness: 0.9
    });
    const gripMat = new THREE.MeshStandardMaterial({
      color: 0x141414, roughness: 0.85, metalness: 0.2
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: 0x3a2a14, roughness: 0.7, metalness: 0.3
    });

    // Slide (top)
    const slide = new THREE.Mesh(
      new THREE.BoxGeometry(0.055, 0.055, 0.20),
      slideMat
    );
    slide.position.set(0, 0.02, -0.03);
    this.viewGroup.add(slide);
    this.slide = slide;

    // Barrel hint (ejection port)
    const ejPort = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.01, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x080808 })
    );
    ejPort.position.set(0.015, 0.04, -0.04);
    this.viewGroup.add(ejPort);

    // Frame (middle)
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.04, 0.18),
      frameMat
    );
    frame.position.set(0, -0.03, -0.02);
    this.viewGroup.add(frame);

    // Grip
    const grip = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.12, 0.08),
      gripMat
    );
    grip.position.set(0, -0.11, 0.03);
    grip.rotation.x = 0.22;
    this.viewGroup.add(grip);

    // Grip checkering texture accent
    const gripAccent = new THREE.Mesh(
      new THREE.BoxGeometry(0.052, 0.10, 0.02),
      accentMat
    );
    gripAccent.position.set(0, -0.11, 0.065);
    gripAccent.rotation.x = 0.22;
    this.viewGroup.add(gripAccent);

    // Magazine (hangs below grip, moves during reload)
    const mag = new THREE.Mesh(
      new THREE.BoxGeometry(0.044, 0.08, 0.065),
      new THREE.MeshStandardMaterial({ color: 0x101010, roughness: 0.6, metalness: 0.4 })
    );
    mag.position.set(0, -0.19, 0.035);
    mag.rotation.x = 0.22;
    this.viewGroup.add(mag);
    this.magazine = mag;

    // Trigger + guard
    const guard = new THREE.Mesh(
      new THREE.TorusGeometry(0.022, 0.006, 6, 12, Math.PI),
      frameMat
    );
    guard.position.set(0, -0.06, -0.02);
    guard.rotation.x = Math.PI / 2;
    this.viewGroup.add(guard);

    // Front sight
    const sight = new THREE.Mesh(
      new THREE.BoxGeometry(0.01, 0.012, 0.012),
      new THREE.MeshStandardMaterial({ color: 0x0a0a0a })
    );
    sight.position.set(0, 0.05, -0.12);
    this.viewGroup.add(sight);
    // Rear sight
    const rsight = new THREE.Mesh(
      new THREE.BoxGeometry(0.03, 0.012, 0.012),
      new THREE.MeshStandardMaterial({ color: 0x0a0a0a })
    );
    rsight.position.set(0, 0.05, 0.06);
    this.viewGroup.add(rsight);

    // Barrel exit
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, 0.03, 8),
      new THREE.MeshStandardMaterial({ color: 0x080808, metalness: 1.0, roughness: 0.2 })
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.02, -0.14);
    this.viewGroup.add(barrel);

    // Position / scale the whole viewmodel to the right hand
    this.viewGroup.position.set(0.26, -0.22, -0.5);
    this.viewGroup.rotation.set(0, -0.05, 0);
  }

  _buildMuzzleFlash() {
    // Flash geometry (billboard plane) attached at barrel tip
    const flashGeo = new THREE.PlaneGeometry(0.18, 0.18);
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xfff0b0,
      transparent: true, opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.flash = new THREE.Mesh(flashGeo, flashMat);
    this.flash.position.set(0, 0.02, -0.18);
    this.viewGroup.add(this.flash);

    // Point light for muzzle flash illumination
    this.flashLight = new THREE.PointLight(0xffcc66, 0, 6, 2.0);
    this.flashLight.position.set(0, 0.02, -0.18);
    this.viewGroup.add(this.flashLight);

    this._flashTimer = 0;
  }

  // ---------- update ----------
  update(dt, input) {
    this.cooldown = Math.max(0, this.cooldown - dt);

    // Reload edge
    if (input.reloadPressed) this.startReload();

    // Reload progress
    if (this.isReloading) {
      this.reloadTimer -= dt;
      this.reloadProgress = 1 - (this.reloadTimer / RELOAD_TIME);
      this._applyReloadAnim();
      if (this.reloadTimer <= 0) this._finishReload();
    }

    // Fire on LMB rising edge OR auto-fire if we treat it as semi+hold (semi only)
    const lmb = input.lmb;
    if (lmb && !this._lmbPrev && !this.isReloading && this.cooldown <= 0) {
      this.fire();
    }
    // Dry click
    if (lmb && !this._lmbPrev && !this.isReloading && this.magAmmo <= 0) {
      Audio.pistolDryFire();
    }
    this._lmbPrev = lmb;

    // ADS & sprint positioning
    this._animateViewModel(dt);

    // Muzzle flash decay
    if (this._flashTimer > 0) {
      this._flashTimer = Math.max(0, this._flashTimer - dt);
      const t = this._flashTimer / 0.08;
      this.flash.material.opacity = t * 0.95;
      this.flash.scale.setScalar(0.6 + (1 - t) * 0.6);
      this.flash.rotation.z = Math.random() * Math.PI;
      this.flashLight.intensity = t * 3.5;
    }

    // Shell ejection physics
    this._updateShells(dt);
    // Tracer fades
    this._updateTracers(dt);
  }

  _applyReloadAnim() {
    // Phases: 0..0.25 drop mag; 0.25..0.55 insert mag; 0.55..0.85 rack slide; 0.85..1 settle
    const p = this.reloadProgress;
    let magY = -0.19, magZ = 0.035;
    let slideZ = -0.03;
    let rotX = 0;
    if (p < 0.25) {
      // drop — mag moves down
      const t = p / 0.25;
      magY = -0.19 - t * 0.12;
      rotX = -t * 0.4;
    } else if (p < 0.55) {
      // insert — new mag rises from below
      const t = (p - 0.25) / 0.30;
      magY = -0.31 + t * 0.12;
      rotX = -0.4 + t * 0.4;
    } else if (p < 0.85) {
      // rack slide — slide pulls back + returns
      const t = (p - 0.55) / 0.30;
      slideZ = -0.03 + Math.sin(t * Math.PI) * 0.08;
    }
    this.magazine.position.y = magY;
    this.viewGroup.rotation.x = rotX + (this.player.pitch * 0.0); // isolate
    this.slide.position.z = slideZ;
  }

  _animateViewModel(dt) {
    // Sway based on mouse delta (low-pass filtered)
    const dyaw = this.player.yaw - this._lastYaw;
    const dpitch = this.player.pitch - this._lastPitch;
    this._lastYaw = this.player.yaw;
    this._lastPitch = this.player.pitch;
    this._viewPose.swayX += (-dyaw * 0.6 - this._viewPose.swayX) * Math.min(1, dt * 8);
    this._viewPose.swayY += ( dpitch * 0.6 - this._viewPose.swayY) * Math.min(1, dt * 8);

    // Walk bob
    if (this.player.state.onGround
        && (Math.abs(this.player.input.forward) + Math.abs(this.player.input.right)) > 0.01) {
      this._walkBobPhase += dt * (this.player.state.sprinting ? 11 : this.player.state.crouched ? 5 : 8);
    }
    const bobAmt = this.player.state.sprinting ? 0.035 : this.player.state.crouched ? 0.012 : 0.018;
    const bobY = Math.abs(Math.sin(this._walkBobPhase)) * bobAmt * (this.player.state.ads ? 0.2 : 1);
    const bobX = Math.sin(this._walkBobPhase * 0.5) * bobAmt * 0.6 * (this.player.state.ads ? 0.2 : 1);

    // ADS blend
    const a = this.player.state.aimProgress;  // 0..1
    const hipX = 0.26, hipY = -0.22, hipZ = -0.5;
    const adsX = 0.0,  adsY = -0.035, adsZ = -0.22;

    // Sprint lowering
    const sprintLower = this.player.state.sprinting && !this.player.state.ads ? 1 : 0;
    let sx = hipX + (adsX - hipX) * a + this._viewPose.swayX + bobX;
    let sy = hipY + (adsY - hipY) * a + this._viewPose.swayY + bobY;
    let sz = hipZ + (adsZ - hipZ) * a;
    sy -= sprintLower * 0.08;
    sx += sprintLower * 0.05;

    // Slide kick decay
    this._viewPose.kickZ *= Math.pow(0.001, dt);

    this.viewGroup.position.x += (sx - this.viewGroup.position.x) * Math.min(1, dt * 14);
    this.viewGroup.position.y += (sy - this.viewGroup.position.y) * Math.min(1, dt * 14);
    this.viewGroup.position.z += (sz + this._viewPose.kickZ - this.viewGroup.position.z) * Math.min(1, dt * 14);

    // Yaw tilt when sprinting + no ADS
    const targetRotZ = sprintLower ? 0.35 : (this.player.state.ads ? 0 : -0.05);
    this.viewGroup.rotation.z += (targetRotZ - this.viewGroup.rotation.z) * Math.min(1, dt * 8);
  }

  // ---------- fire ----------
  fire() {
    if (this.magAmmo <= 0) {
      Audio.pistolDryFire();
      return;
    }
    this.magAmmo--;
    this.cooldown = FIRE_COOLDOWN;
    this.player.state.shotsFired++;

    // Muzzle flash
    this.flash.material.opacity = 1;
    this._flashTimer = 0.08;
    this.flashLight.intensity = 3.5;

    // Recoil
    const ads = this.player.state.ads;
    const kickP = ads ? 0.020 : 0.045;
    const kickY = ads ? 0.008 : 0.018;
    this.player.state.recoilPitch += kickP;
    this.player.state.recoilYaw += (Math.random() - 0.5) * kickY * 2;
    this.player.state.shake = Math.max(this.player.state.shake, ads ? 0.12 : 0.22);

    // Slide kick
    this._viewPose.kickZ = 0.06;

    // Eject shell
    this._ejectShell();

    // Audio
    Audio.pistolShot(ads);

    // Noise spike — gunshots are very loud; skeletons ALL hear a pistol shot
    // regardless of distance (flagged so AI can use it)
    this.player.state.noise = 1.0;
    this.player.state.noisePos.copy(this.player.pos);
    if (this.skeletons && this.skeletons.onGunshot) {
      this.skeletons.onGunshot(this.player.pos.clone());
    }

    // Hitscan ray
    this._raycast();
  }

  _raycast() {
    const origin = this.camera.getWorldPosition(new THREE.Vector3());
    const dir = this.player.getLookDir();
    // Small spread when not ADS or while moving
    const ads = this.player.state.ads;
    const moving = this.player.vel.lengthSq() > 0.5;
    let spread = 0.0;
    if (!ads) spread += 0.015;
    if (moving) spread += 0.010;
    if (this.player.state.sprinting) spread += 0.025;
    if (spread > 0) {
      const ex = (Math.random() - 0.5) * spread;
      const ey = (Math.random() - 0.5) * spread;
      dir.x += ex; dir.y += ey;
      dir.normalize();
    }

    // First: skeletons (hitboxes). Use managed per-part hitbox tests.
    let bestSkel = null, bestT = Infinity, bestPart = null, bestPoint = null;
    if (this.skeletons && this.skeletons.raycast) {
      const hit = this.skeletons.raycast(origin, dir, MAX_RANGE);
      if (hit) {
        bestSkel = hit.skel; bestT = hit.t; bestPart = hit.part; bestPoint = hit.point;
      }
    }

    // Then: world AABB colliders (walls) — so bullets stop at walls
    let wallT = Infinity, wallPoint = null, wallCollider = null;
    for (const c of this.level.colliders) {
      if (!c.blocksVision && c.kind !== "wall" && c.kind !== "rack" && c.kind !== "container"
          && c.kind !== "locker" && c.kind !== "desk" && c.kind !== "machine"
          && c.kind !== "crate" && c.kind !== "fence" && c.kind !== "truck") continue;
      const t = raySlabAABB(origin, dir, c);
      if (t !== null && t < wallT && t < MAX_RANGE) {
        wallT = t;
        wallCollider = c;
        wallPoint = new THREE.Vector3(
          origin.x + dir.x * t,
          origin.y + dir.y * t,
          origin.z + dir.z * t
        );
      }
    }

    // Decide what came first
    if (bestSkel && bestT < wallT) {
      // Skeleton hit
      const dmg = bestPart === "head" ? 30 : bestPart === "body" ? 20 : 10;
      this.skeletons.applyDamage(bestSkel, dmg, bestPart, bestPoint, dir);
      this.player.state.shotsHit++;
      if (bestPart === "head") this.player.state.headshots++;
      this._spawnTracer(origin, bestPoint);
      this._spawnBloodPuff(bestPoint);
      if (this.onHit) this.onHit(bestPart, bestSkel.hp <= 0);
    } else if (wallPoint) {
      // Wall impact
      this._spawnTracer(origin, wallPoint);
      this._spawnWallImpact(wallPoint, wallCollider);
      Audio.bulletImpactWall(0.5);
    } else {
      // Whiffed into the sky/void
      const end = new THREE.Vector3(
        origin.x + dir.x * MAX_RANGE,
        origin.y + dir.y * MAX_RANGE,
        origin.z + dir.z * MAX_RANGE
      );
      this._spawnTracer(origin, end);
    }
  }

  // ---------- reload ----------
  startReload() {
    if (this.isReloading) return;
    if (this.magAmmo >= MAG_SIZE) return;
    if (this.reserveAmmo <= 0) return;
    this.isReloading = true;
    this.reloadTimer = RELOAD_TIME;
    this.reloadProgress = 0;
    Audio.pistolReloadStart();
    setTimeout(() => { if (this.isReloading) Audio.pistolMagIn(); }, 650);
    setTimeout(() => { if (this.isReloading) Audio.pistolSlide(); }, 1250);
  }

  _finishReload() {
    const need = MAG_SIZE - this.magAmmo;
    const take = Math.min(need, this.reserveAmmo);
    this.magAmmo += take;
    this.reserveAmmo -= take;
    this.isReloading = false;
    this.reloadProgress = 0;
    this.magazine.position.y = -0.19;
    this.slide.position.z = -0.03;
    this.viewGroup.rotation.x = 0;
  }

  // ---------- shell ejection ----------
  _ejectShell() {
    // shell mesh
    const geo = new THREE.CylinderGeometry(0.012, 0.012, 0.028, 6);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xd4a54a, metalness: 0.9, roughness: 0.25
    });
    const shell = new THREE.Mesh(geo, mat);
    // position at ejection port (world space)
    const worldEj = new THREE.Vector3(0.015, 0.04, -0.04);
    this.viewGroup.localToWorld(worldEj);
    shell.position.copy(worldEj);

    this.scene.add(shell);

    // Velocity: up + right + forward from ejection port
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const v = new THREE.Vector3()
      .addScaledVector(right, 1.6 + Math.random() * 0.6)
      .addScaledVector(up, 2.0 + Math.random() * 0.6)
      .addScaledVector(fwd, -0.4 + Math.random() * 0.2);
    this._shells.push({
      mesh: shell,
      vel: v,
      life: 1.2,
      angvel: new THREE.Vector3(
        (Math.random() - 0.5) * 20,
        (Math.random() - 0.5) * 20,
        (Math.random() - 0.5) * 20
      ),
    });
  }

  _updateShells(dt) {
    for (let i = this._shells.length - 1; i >= 0; i--) {
      const s = this._shells[i];
      s.life -= dt;
      s.vel.y -= 14 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.rotation.x += s.angvel.x * dt;
      s.mesh.rotation.y += s.angvel.y * dt;
      s.mesh.rotation.z += s.angvel.z * dt;
      // Hit ground
      if (s.mesh.position.y <= 0.02) {
        s.mesh.position.y = 0.02;
        if (Math.abs(s.vel.y) > 0.5) {
          s.vel.y = -s.vel.y * 0.3;
          s.vel.x *= 0.55; s.vel.z *= 0.55;
          if (Math.random() < 0.5) Audio.shellTink();
        } else {
          s.vel.set(0, 0, 0);
        }
      }
      if (s.life <= 0) {
        this.scene.remove(s.mesh);
        this._shells.splice(i, 1);
      }
    }
  }

  // ---------- tracers ----------
  _spawnTracer(from, to) {
    const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
    const mat = new THREE.LineBasicMaterial({
      color: 0xffd48a, transparent: true, opacity: 0.85,
      depthWrite: false,
    });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this._tracers.push({ line, mat, life: 0.07 });
  }

  _updateTracers(dt) {
    for (let i = this._tracers.length - 1; i >= 0; i--) {
      const t = this._tracers[i];
      t.life -= dt;
      t.mat.opacity = Math.max(0, t.life / 0.07);
      if (t.life <= 0) {
        this.scene.remove(t.line);
        this._tracers.splice(i, 1);
      }
    }
  }

  _spawnWallImpact(point, collider) {
    // Small cloud of dust/debris particles
    for (let i = 0; i < 6; i++) {
      const s = 0.015 + Math.random() * 0.015;
      const p = new THREE.Mesh(
        new THREE.BoxGeometry(s, s, s),
        new THREE.MeshStandardMaterial({ color: 0x6a6a6a, roughness: 1 })
      );
      p.position.copy(point);
      this.scene.add(p);
      const v = new THREE.Vector3(
        (Math.random() - 0.5) * 4,
        Math.random() * 3 + 1,
        (Math.random() - 0.5) * 4
      );
      this._shells.push({ mesh: p, vel: v, life: 0.8,
        angvel: new THREE.Vector3(Math.random() * 10, Math.random() * 10, Math.random() * 10) });
    }
  }

  _spawnBloodPuff(point) {
    // Bone-dust puff for skeleton hits (not blood)
    for (let i = 0; i < 8; i++) {
      const s = 0.02 + Math.random() * 0.02;
      const p = new THREE.Mesh(
        new THREE.BoxGeometry(s, s, s),
        new THREE.MeshStandardMaterial({ color: 0xbababa, roughness: 0.9, transparent: true, opacity: 0.9 })
      );
      p.position.copy(point);
      this.scene.add(p);
      const v = new THREE.Vector3(
        (Math.random() - 0.5) * 3,
        Math.random() * 2 + 0.5,
        (Math.random() - 0.5) * 3
      );
      this._shells.push({ mesh: p, vel: v, life: 0.7,
        angvel: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8) });
    }
  }

  reset() {
    this.magAmmo = MAG_SIZE;
    this.reserveAmmo = RESERVE_MAX;
    this.cooldown = 0;
    this.isReloading = false;
    this.reloadTimer = 0;
    this.reloadProgress = 0;
    // clear shells/tracers
    for (const s of this._shells) this.scene.remove(s.mesh);
    for (const t of this._tracers) this.scene.remove(t.line);
    this._shells = [];
    this._tracers = [];
  }
}

// ---------- math helper ----------
// Slab-based ray/AABB (3D). Treats collider as vertical extrusion of its XZ
// AABB from y=0 to y=6 so raycasts cleanly stop at walls.
function raySlabAABB(origin, dir, box) {
  const minY = 0, maxY = (box.maxY !== undefined) ? box.maxY : 8;
  const minX = box.minX, maxX = box.maxX;
  const minZ = box.minZ, maxZ = box.maxZ;
  let tmin = 0, tmax = Infinity;
  // X
  if (Math.abs(dir.x) < 1e-8) {
    if (origin.x < minX || origin.x > maxX) return null;
  } else {
    let t1 = (minX - origin.x) / dir.x;
    let t2 = (maxX - origin.x) / dir.x;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  // Z
  if (Math.abs(dir.z) < 1e-8) {
    if (origin.z < minZ || origin.z > maxZ) return null;
  } else {
    let t1 = (minZ - origin.z) / dir.z;
    let t2 = (maxZ - origin.z) / dir.z;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  // Y
  if (Math.abs(dir.y) < 1e-8) {
    if (origin.y < minY || origin.y > maxY) return null;
  } else {
    let t1 = (minY - origin.y) / dir.y;
    let t2 = (maxY - origin.y) / dir.y;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin > 0 ? tmin : null;
}
