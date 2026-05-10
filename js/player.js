// Player controller for tactical survival-horror.
//
// Controls (per user spec):
//   WASD                  — move
//   Shift (hold)          — sprint (loud)
//   Ctrl                  — crouch (quiet, slower, smaller silhouette)
//   Space                 — jump
//   LMB                   — fire weapon
//   RMB (hold)            — aim down sights (ADS)
//   R                     — reload
//   E                     — interact
//
// Damage system (HP 100):
//   Head   = 30 dmg
//   Body   = 20 dmg
//   Legs   = 10 dmg
//
// Public state used by rest of systems:
//   hp (0..100), stamina (0..1), sprinting, crouched, onGround, vel
//   ads (true while RMB held), aimProgress (0..1 eased)
//   noise (0..1 per frame), noisePos
//   hidden, hiddenIn, usingCCTV, dead
//   adaptive counters: sprintingSeconds, crouchSeconds, shotsFired,
//     shotsHit, headshots, timesHidden, damageTakenTotal, distractionNoiseTotal

import * as THREE from "three";
import { Audio } from "./audio.js";

const PLAYER_RADIUS = 0.36;
const EYE_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.10;
const GRAVITY = -22.0;
const JUMP_V = 6.4;

export class Player {
  constructor(camera, level) {
    this.camera = camera;
    this.level = level;

    this.pos = new THREE.Vector3(level.playerSpawn.x, EYE_HEIGHT, level.playerSpawn.z);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;

    this.input = {
      forward: 0, right: 0,
      sprint: false,
      crouch: false,
      jumpPressed: false,
      lmb: false,
      rmb: false,
      reloadPressed: false,
      interact: false,
      interactHeld: false,
    };

    this.state = {
      hp: 100,
      stamina: 1.0,
      onGround: true,
      yVel: 0,

      sprinting: false,
      crouched: false,

      ads: false,
      aimProgress: 0,

      hidden: false,
      hiddenIn: null,
      usingCCTV: false,
      dead: false,

      noise: 0,
      noisePos: new THREE.Vector3(),

      // Recoil accumulators (applied by weapon, decayed here)
      recoilPitch: 0,
      recoilYaw: 0,

      // Screen shake
      shake: 0,

      // Directional damage (per-frame flags for UI) – set by takeDamage()
      dmgFromYaw: null,     // absolute world yaw the hit came from
      dmgTimer: 0,

      // Adaptive counters for AI
      sprintingSeconds: 0,
      crouchSeconds: 0,
      shotsFired: 0,
      shotsHit: 0,
      headshots: 0,
      timesHidden: 0,
      damageTakenTotal: 0,
      distractionNoiseTotal: 0,
      throwsMade: 0,
      binocularsSeconds: 0, // kept for music compat
    };

    this.sens = 0.0022;
    this._footTimer = 0;
    this._bobPhase = 0;
  }

  attachToScene(scene) {
    // reserved (no flashlight)
  }

  setPosition(x, y, z) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.state.yVel = 0;
    this.state.onGround = true;
  }

  onMouseMove(dx, dy) {
    if (this.state.dead) return;
    if (this.state.usingCCTV) return;
    const adsMult = this.state.ads ? 0.45 : 1.0;
    const sens = this.sens * adsMult;
    this.yaw -= dx * sens;
    this.pitch -= dy * sens;
    const lim = Math.PI / 2 - 0.01;
    if (this.pitch > lim) this.pitch = lim;
    if (this.pitch < -lim) this.pitch = -lim;
  }

  // ====== Damage ======
  takeDamage(amount, sourceWorldPos = null) {
    if (this.state.dead) return;
    this.state.hp = Math.max(0, this.state.hp - amount);
    this.state.damageTakenTotal += amount;
    this.state.shake = Math.max(this.state.shake, Math.min(0.8, 0.2 + amount / 50));
    Audio.playerHurt(Math.min(1, amount / 30));
    if (sourceWorldPos) {
      // Compute relative angle from player's forward direction to the source,
      // measured clockwise (matches CSS rotation: 0 = front, 90 = right, 180 = behind, 270 = left).
      const dx = sourceWorldPos.x - this.pos.x;
      const dz = sourceWorldPos.z - this.pos.z;
      // Player forward (x,z) = (-sin yaw, -cos yaw); right = (cos yaw, -sin yaw)
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      const rx =  Math.cos(this.yaw), rz = -Math.sin(this.yaw);
      const fwdDot   = fx * dx + fz * dz;
      const rightDot = rx * dx + rz * dz;
      // Angle in radians: 0 = front, +pi/2 = right, pi = behind, -pi/2 = left.
      // UI expects "CSS rotation" degrees where 0 = up/forward, 90 = right,
      // 180 = behind, 270 = left — which matches the math above directly.
      this.state.dmgFromYaw = Math.atan2(rightDot, fwdDot);
      this.state.dmgTimer = 1.0;
    }
    if (this.state.hp <= 0) {
      this.state.dead = true;
    }
  }

  heal(amount) {
    if (this.state.dead) return;
    this.state.hp = Math.min(100, this.state.hp + amount);
  }

  tryJump() {
    if (this.state.dead || this.state.hidden || this.state.usingCCTV) return;
    if (this.state.onGround && this.state.stamina > 0.12) {
      this.state.yVel = JUMP_V;
      this.state.onGround = false;
      this.state.stamina = Math.max(0, this.state.stamina - 0.12);
      // jump produces a noise spike
      this.state.noise = Math.max(this.state.noise, 0.6);
      this.state.noisePos.copy(this.pos);
      Audio.jump();
    }
  }

  update(dt) {
    if (this.state.dead) {
      // fade camera down
      this.pos.y += (0.55 - this.pos.y) * Math.min(1, dt * 2.5);
      this.camera.position.copy(this.pos);
      const euler = new THREE.Euler(
        Math.min(0.1, this.pitch) - dt * 0.1,
        this.yaw, 0.3, "YXZ"
      );
      this.camera.quaternion.setFromEuler(euler);
      return;
    }

    // Hidden / CCTV immobile states
    if (this.state.hidden || this.state.usingCCTV) {
      this.state.stamina = Math.min(1.0, this.state.stamina + dt * 0.35);
      this.state.noise = 0;
      this._applyCamera(dt);
      this._decayIndicators(dt);
      return;
    }

    // ADS interpolation
    const adsTarget = (this.input.rmb && !this.state.sprinting) ? 1 : 0;
    this.state.ads = adsTarget > 0.5;
    this.state.aimProgress += (adsTarget - this.state.aimProgress) * Math.min(1, dt * 10);

    // Speed + sprint/crouch
    const wantSprint = this.input.sprint && !this.state.ads && this.state.stamina > 0.05;
    const moving = (Math.abs(this.input.forward) + Math.abs(this.input.right)) > 0.01;
    this.state.sprinting = wantSprint && moving;
    this.state.crouched = this.input.crouch;

    let speed = 4.2;                     // walk
    if (this.state.crouched) speed = 1.9;
    if (this.state.sprinting) speed = 6.7;
    if (this.state.ads) speed = Math.min(speed, 2.6);

    if (this.state.sprinting) {
      this.state.stamina = Math.max(0, this.state.stamina - dt * 0.22);
      this.state.sprintingSeconds += dt;
      if (this.state.stamina <= 0) this.input.sprint = false;
    } else {
      this.state.stamina = Math.min(1.0, this.state.stamina + dt * 0.26);
    }
    if (this.state.crouched) this.state.crouchSeconds += dt;

    // Horizontal direction from yaw
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const moveDir = new THREE.Vector3()
      .addScaledVector(fwd, this.input.forward)
      .addScaledVector(right, this.input.right);
    if (moveDir.lengthSq() > 0) moveDir.normalize();

    this.vel.x = moveDir.x * speed;
    this.vel.z = moveDir.z * speed;

    // Gravity / jump
    if (!this.state.onGround) {
      this.state.yVel += GRAVITY * dt;
    }

    this._moveWithCollision(dt);

    // Ground check — simple flat floor at y=0; eye height baseline
    const floorEye = this.state.crouched ? CROUCH_HEIGHT : EYE_HEIGHT;
    if (this.pos.y <= floorEye) {
      if (!this.state.onGround) {
        Audio.land(0.55);
        this.state.shake = Math.max(this.state.shake, 0.15);
      }
      this.pos.y = floorEye;
      this.state.yVel = 0;
      this.state.onGround = true;
    } else {
      this.state.onGround = false;
    }

    // Noise: sprint=1.0, walk=0.45, crouch=0.08
    this.state.noise = 0;
    if (moving) {
      if (this.state.sprinting) this.state.noise = 1.0;
      else if (this.state.crouched) this.state.noise = 0.08;
      else this.state.noise = 0.45;
      this.state.noisePos.copy(this.pos);
    }

    // Footsteps
    if (moving && this.state.onGround) {
      const stepInterval = this.state.sprinting ? 0.30 : (this.state.crouched ? 0.75 : 0.48);
      this._footTimer -= dt;
      if (this._footTimer <= 0) {
        this._footTimer = stepInterval;
        const intensity = this.state.sprinting ? 1.3 : (this.state.crouched ? 0.3 : 0.85);
        Audio.footstep(intensity);
      }
    } else {
      this._footTimer = 0.1;
    }

    // View bob
    if (moving && this.state.onGround) {
      this._bobPhase += dt * (this.state.sprinting ? 11 : this.state.crouched ? 5 : 8);
    }

    // Recoil decay (applied by weapon.fire)
    this.state.recoilPitch *= Math.pow(0.003, dt);
    this.state.recoilYaw *= Math.pow(0.003, dt);
    this.state.shake *= Math.pow(0.0015, dt);

    this._applyCamera(dt);
    this._decayIndicators(dt);
  }

  _decayIndicators(dt) {
    if (this.state.dmgTimer > 0) {
      this.state.dmgTimer = Math.max(0, this.state.dmgTimer - dt);
      if (this.state.dmgTimer <= 0) this.state.dmgFromYaw = null;
    }
  }

  _moveWithCollision(dt) {
    const colliders = this.level.colliders;
    const r = PLAYER_RADIUS;

    // X axis
    const nextX = this.pos.x + this.vel.x * dt;
    if (!this._collides(nextX, this.pos.z, colliders, r)) {
      this.pos.x = nextX;
    } else {
      this.vel.x = 0;
    }
    // Z axis
    const nextZ = this.pos.z + this.vel.z * dt;
    if (!this._collides(this.pos.x, nextZ, colliders, r)) {
      this.pos.z = nextZ;
    } else {
      this.vel.z = 0;
    }
    // Y (gravity)
    this.pos.y += this.state.yVel * dt;
  }

  _collides(x, z, colliders, r) {
    for (const c of colliders) {
      if (c.kind === "pallet") continue;
      if (x + r > c.minX && x - r < c.maxX &&
          z + r > c.minZ && z - r < c.maxZ) return true;
    }
    return false;
  }

  _applyCamera(dt) {
    const targetY = this.state.crouched ? CROUCH_HEIGHT : EYE_HEIGHT;
    // Smooth y only when on ground (in air we keep physical y)
    if (this.state.onGround) {
      this.pos.y += (targetY - this.pos.y) * Math.min(1, dt * 10);
    }

    // Copy to camera with bob + shake
    const cam = this.camera;
    cam.position.copy(this.pos);

    // View bob (horizontal & vertical swing)
    const bobAmpY = this.state.sprinting ? 0.06 : 0.035;
    const bobAmpX = this.state.sprinting ? 0.05 : 0.02;
    const bobY = Math.abs(Math.sin(this._bobPhase)) * bobAmpY * (this.state.ads ? 0.25 : 1);
    const bobX = Math.sin(this._bobPhase * 0.5) * bobAmpX * (this.state.ads ? 0.2 : 1);
    cam.position.y += bobY;
    cam.position.x += Math.cos(this.yaw) * bobX;
    cam.position.z -= Math.sin(this.yaw) * bobX;

    // Shake
    if (this.state.shake > 0.002) {
      const sh = this.state.shake;
      cam.position.x += (Math.random() - 0.5) * sh * 0.15;
      cam.position.y += (Math.random() - 0.5) * sh * 0.15;
      cam.position.z += (Math.random() - 0.5) * sh * 0.15;
    }

    // Orientation with recoil applied
    const euler = new THREE.Euler(
      this.pitch + this.state.recoilPitch,
      this.yaw + this.state.recoilYaw,
      0,
      "YXZ"
    );
    cam.quaternion.setFromEuler(euler);

    // FOV: ADS → 50, hip → 75, sprint bump → 78
    let wantFov = 75;
    if (this.state.ads) wantFov = 50;
    else if (this.state.sprinting) wantFov = 78;
    cam.fov += (wantFov - cam.fov) * Math.min(1, dt * 11);
    cam.updateProjectionMatrix();
  }

  // Direction the camera is actually looking (including recoil)
  getLookDir() {
    const v = new THREE.Vector3(0, 0, -1);
    const euler = new THREE.Euler(
      this.pitch + this.state.recoilPitch,
      this.yaw + this.state.recoilYaw,
      0, "YXZ"
    );
    v.applyEuler(euler);
    return v;
  }

  // Pure aim direction (no recoil) — for smoother arrow-intercept logic
  getAimDir() {
    const v = new THREE.Vector3(0, 0, -1);
    const euler = new THREE.Euler(this.pitch, this.yaw, 0, "YXZ");
    v.applyEuler(euler);
    return v;
  }
}
