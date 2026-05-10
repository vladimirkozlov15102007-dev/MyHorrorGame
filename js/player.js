// Player controller.
//
// Controls (as specified):
//   WASD                  — move
//   LeftShift  (hold)     — binoculars ACTIVE while held; wheel zooms 1x..8x;
//                           player is slower, hearing dampened.
//   LeftCtrl              — crouch (quiet)
//   X                     — sprint toggle (we use X because LShift is used for
//                           binoculars per spec "зажатием Shift").
//   E                     — interact / hide / pick up / exit locker
//   LMB (hold+release)    — aim + throw held item (power scales with hold time)
//   Q                     — drop held throwable
//   Wheel up/down         — binocular zoom (only when binoculars active)
//   Mouse                 — look
//
// No flashlight. Level has ambient + lamp lighting.
//
// Public state fields read by AI / HUD / audio:
//   health, stamina, hidden, hiddenIn, keyCount, dead
//   binocularsOn (true while Shift held + not hidden)
//   binocZoom (1..8)
//   crouched, sprinting
//   held: { kind } | null
//   aiming: bool, aimPower: 0..1
//   noise, noisePos (current-frame)
//   adaptive counters: timesHidden, binocularsSeconds, sprintingSeconds, throwsMade, distractionNoiseTotal

import * as THREE from "three";
import { Audio } from "./audio.js";

const PLAYER_RADIUS = 0.35;
const EYE_HEIGHT = 1.68;
const CROUCH_HEIGHT = 1.05;

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
      sprint: false,        // X toggled
      crouch: false,
      binocHeld: false,     // LShift held
      interact: false,
      interactHeld: false,
      lmbHeld: false,
      dropHeld: false,
    };

    this.state = {
      health: 1.0,
      stamina: 1.0,

      binocularsOn: false,
      binocZoom: 2.0,

      crouched: false,
      sprinting: false,

      hidden: false,
      hiddenIn: null,

      keyCount: 0,
      dead: false,

      held: null,                // { kind }
      aiming: false,
      aimPower: 0,

      noise: 0,                  // 0..1 this frame
      noisePos: new THREE.Vector3(),

      // adaptive counters
      timesHidden: 0,
      binocularsSeconds: 0,
      sprintingSeconds: 0,
      throwsMade: 0,
      distractionNoiseTotal: 0,

      // CCTV immobility
      usingCCTV: false,
    };

    this._footTimer = 0;
    this._aimStart = 0;

    this.sens = 0.0022;
  }

  attachToScene(scene) {
    // No flashlight — nothing to attach.
  }

  setPosition(x, y, z) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
  }

  onMouseMove(dx, dy) {
    if (this.state.dead) return;
    if (this.state.usingCCTV) return;   // player immobile while on CCTV
    const sens = this.state.binocularsOn ? this.sens / (this.state.binocZoom * 0.7) : this.sens;
    this.yaw -= dx * sens;
    this.pitch -= dy * sens;
    const lim = Math.PI / 2 - 0.01;
    if (this.pitch > lim) this.pitch = lim;
    if (this.pitch < -lim) this.pitch = -lim;
  }

  onMouseWheel(delta) {
    // wheel changes binocular zoom when active, between 1..8
    if (!this.state.binocularsOn) return;
    const step = delta > 0 ? -0.5 : 0.5;
    this.state.binocZoom = Math.max(1, Math.min(8, this.state.binocZoom + step));
    Audio.binocularZoom();
  }

  toggleSprint() {
    // X toggles sprint intent; only applies when stamina > 0 and moving
    this.input.sprint = !this.input.sprint;
  }

  dropHeld(throwableSystem, level) {
    if (!this.state.held) return;
    // spawn a small, slow projectile at player feet (gentle drop)
    const origin = new THREE.Vector3(this.pos.x, 0.6, this.pos.z);
    const dir = this.getLookDir();
    const vel = new THREE.Vector3(dir.x * 1.5, 0.5, dir.z * 1.5);
    throwableSystem.spawn(origin, vel, this.state.held.kind);
    this.state.held = null;
  }

  beginAim() {
    if (!this.state.held) return;
    if (this.state.hidden || this.state.usingCCTV || this.state.binocularsOn) return;
    this.state.aiming = true;
    this._aimStart = performance.now() / 1000;
  }

  endAimAndThrow(throwableSystem) {
    if (!this.state.aiming || !this.state.held) {
      this.state.aiming = false;
      return;
    }
    const now = performance.now() / 1000;
    const held = Math.max(0.08, Math.min(1.4, now - this._aimStart));
    // power curve
    const t = Math.min(1, (held - 0.08) / (1.4 - 0.08));
    const speed = 6 + t * 12;  // 6..18 m/s
    const dir = this.getLookDir();
    const origin = new THREE.Vector3(
      this.pos.x + dir.x * 0.4,
      this.pos.y - 0.1,
      this.pos.z + dir.z * 0.4
    );
    // give a small upward arc when aimed flat
    const up = 0.6 + Math.max(0, this.pitch) * 2;
    const vel = new THREE.Vector3(dir.x * speed, dir.y * speed + up, dir.z * speed);
    throwableSystem.spawn(origin, vel, this.state.held.kind);

    // release resource
    this.state.held = null;
    this.state.aiming = false;
    this.state.aimPower = 0;
    this.state.throwsMade += 1;

    // throwing itself is silent (your arm); the IMPACT is the noise.
    // BUT we add a tiny localized breath spike to the monster hear range briefly
    // by bumping noise for one frame.
    this.state.noise = Math.max(this.state.noise, 0.05);
    this.state.noisePos.copy(this.pos);
  }

  update(dt) {
    if (this.state.dead) return;

    // --- Hidden / CCTV immobile states ---
    if (this.state.hidden || this.state.usingCCTV) {
      this.state.stamina = Math.min(1.0, this.state.stamina + dt * 0.35);
      this.state.noise = 0;
      this._applyCamera(dt);
      return;
    }

    // --- Binoculars active while shift held (and not dead/hidden/CCTV) ---
    this.state.binocularsOn = this.input.binocHeld;
    if (this.state.binocularsOn) this.state.binocularsSeconds += dt;

    // --- Aim update power ---
    if (this.state.aiming && this.input.lmbHeld && this.state.held) {
      const now = performance.now() / 1000;
      const held = Math.min(1.4, now - this._aimStart);
      this.state.aimPower = Math.min(1, (held - 0.08) / (1.4 - 0.08));
    } else {
      this.state.aimPower = 0;
    }

    // --- Speed ---
    const wantSprint = this.input.sprint && this.state.stamina > 0.05
      && !this.state.binocularsOn && !this.state.aiming;
    const wantCrouch = this.input.crouch;
    this.state.sprinting = wantSprint && (Math.abs(this.input.forward) + Math.abs(this.input.right) > 0);
    this.state.crouched = wantCrouch;

    let speed = 3.3;                     // walk
    if (this.state.crouched) speed = 1.6;
    if (this.state.sprinting) speed = 5.8;
    if (this.state.binocularsOn) speed = 1.15;
    if (this.state.aiming) speed = Math.min(speed, 2.2);

    if (this.state.sprinting) {
      this.state.stamina = Math.max(0, this.state.stamina - dt * 0.28);
      this.state.sprintingSeconds += dt;
      if (this.state.stamina <= 0) this.input.sprint = false;
    } else {
      this.state.stamina = Math.min(1.0, this.state.stamina + dt * 0.22);
    }

    // Direction
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const moveDir = new THREE.Vector3()
      .addScaledVector(fwd, this.input.forward)
      .addScaledVector(right, this.input.right);
    if (moveDir.lengthSq() > 0) moveDir.normalize();

    this.vel.x = moveDir.x * speed;
    this.vel.z = moveDir.z * speed;

    this._moveWithCollision(dt);

    // Noise (for AI): sprint = 1.0, walk 0.45, crouch 0.1, aim/bino no change
    this.state.noise = 0;
    if (moveDir.lengthSq() > 0) {
      if (this.state.sprinting) this.state.noise = 1.0;
      else if (this.state.crouched) this.state.noise = 0.1;
      else this.state.noise = 0.45;
      this.state.noisePos.copy(this.pos);
    }

    // Footstep audio
    if (moveDir.lengthSq() > 0.01) {
      const stepInterval = this.state.sprinting ? 0.32 : (this.state.crouched ? 0.75 : 0.5);
      this._footTimer -= dt;
      if (this._footTimer <= 0) {
        this._footTimer = stepInterval;
        const intensity = this.state.sprinting ? 1.3 : (this.state.crouched ? 0.35 : 0.85);
        Audio.footstep(intensity);
      }
    } else {
      this._footTimer = 0.1;
    }

    this._applyCamera(dt);
  }

  _moveWithCollision(dt) {
    const colliders = this.level.colliders;
    const nextX = this.pos.x + this.vel.x * dt;
    if (!this._collides(nextX, this.pos.z, colliders)) {
      this.pos.x = nextX;
    } else {
      this.vel.x = 0;
    }
    const nextZ = this.pos.z + this.vel.z * dt;
    if (!this._collides(this.pos.x, nextZ, colliders)) {
      this.pos.z = nextZ;
    } else {
      this.vel.z = 0;
    }
  }

  _collides(x, z, colliders) {
    const r = PLAYER_RADIUS;
    for (const c of colliders) {
      if (c.kind === "pallet") continue; // passable
      if (x + r > c.minX && x - r < c.maxX &&
          z + r > c.minZ && z - r < c.maxZ) return true;
    }
    return false;
  }

  _applyCamera(dt) {
    const targetY = this.state.crouched ? CROUCH_HEIGHT : EYE_HEIGHT;
    this.pos.y += (targetY - this.pos.y) * Math.min(1, dt * 10);

    this.camera.position.copy(this.pos);

    // small aim sway when holding LMB
    let sway = new THREE.Vector2(0, 0);
    if (this.state.aiming) {
      const t = performance.now() / 1000;
      sway.x = Math.sin(t * 1.9) * 0.012 * (1 + this.state.aimPower * 0.5);
      sway.y = Math.cos(t * 2.3) * 0.008 * (1 + this.state.aimPower * 0.5);
    }

    const euler = new THREE.Euler(this.pitch + sway.y, this.yaw + sway.x, 0, "YXZ");
    this.camera.quaternion.setFromEuler(euler);

    // FOV: binoculars = 70 / zoom; default = 70.
    const wantFov = this.state.binocularsOn ? (70 / this.state.binocZoom) : 70;
    this.camera.fov += (wantFov - this.camera.fov) * Math.min(1, dt * 10);
    this.camera.updateProjectionMatrix();
  }

  getLookDir() {
    const v = new THREE.Vector3(0, 0, -1);
    const euler = new THREE.Euler(this.pitch, this.yaw, 0, "YXZ");
    v.applyEuler(euler);
    return v;
  }
}
