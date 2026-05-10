// First-person player controller for a tactical survival horror shooter.
//
// Controls (per spec):
//   WASD         — movement
//   Shift (hold) — sprint
//   Space        — jump
//   Ctrl / C     — crouch
//   E            — interact (pick up / hide / enter truck / CCTV)
//   LMB          — fire weapon
//   RMB (hold)   — aim down sights
//   R            — reload
//   Q            — drop held throwable
//   Mouse        — look
//
// Health = 100 HP.  Damage zones: head 30 / torso 20 / legs 10.
// Directional damage indicator: we expose `state.damageDirs` list consumed by UI.
// The controller exposes `takeDamage(amount, info)` used by arrows.
//
// Stamina drains when sprinting (0.28/s) and regens when walking/idle.

import * as THREE from "three";
import { Audio } from "./audio.js";

const PLAYER_RADIUS = 0.35;
const EYE_HEIGHT = 1.68;
const CROUCH_HEIGHT = 1.1;
const JUMP_SPEED = 5.1;
const GRAVITY = -16;
const MAX_HP = 100;

export class Player {
  constructor(camera, level) {
    this.camera = camera;
    this.level = level;

    this.pos = new THREE.Vector3(level.playerSpawn.x, EYE_HEIGHT, level.playerSpawn.z);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this._targetY = EYE_HEIGHT;
    this._grounded = true;
    this._velY = 0;

    // Input snapshot (updated by main.js each frame)
    this.input = {
      forward: 0, right: 0,
      sprint: false,
      crouch: false,
      jump: false,
      interact: false,         // edge-triggered single press
      interactHeld: false,
      lmbHeld: false,
      lmbPressed: false,       // edge
      rmbHeld: false,
      reload: false,           // edge
    };

    this.state = {
      health: MAX_HP,
      stamina: 1.0,

      crouched: false,
      sprinting: false,

      hidden: false,
      hiddenIn: null,

      dead: false,

      // Held throwable (optional secondary item, legacy from throwable system)
      held: null,

      // Adaptive metrics the AI reads
      timesHidden: 0,
      sprintingSeconds: 0,
      binocularsSeconds: 0,
      throwsMade: 0,
      shotsFired: 0,
      hitsLanded: 0,
      timeSpentStill: 0,

      // Noise / AI hint
      noise: 0,
      noisePos: new THREE.Vector3(),

      // Damage feedback for UI (directional arrows)
      damageDirs: [],   // { angle: radians (0=forward, CW), intensity: 0..1, life: s, age: s }

      // Legacy flags that remain used by other systems
      binocularsOn: false,
      binocZoom: 1,
      aiming: false,
      usingCCTV: false,
    };

    this.sens = 0.0022;
    this._footTimer = 0;
    this._stillTimer = 0;

    // Hurt effect: red vignette
    this._hurtFlash = 0;
  }

  setPosition(x, y, z) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this._velY = 0;
  }

  // Called by main.js each mouse move event.
  onMouseMove(dx, dy) {
    if (this.state.dead) return;
    if (this.state.usingCCTV) return;
    // ADS reduces mouse sensitivity for stability
    const adsMul = this.state.aiming ? 0.45 : 1;
    const sens = this.sens * adsMul;
    this.yaw -= dx * sens;
    this.pitch -= dy * sens;
    const lim = Math.PI / 2 - 0.01;
    if (this.pitch > lim) this.pitch = lim;
    if (this.pitch < -lim) this.pitch = -lim;
  }

  getLookDir() {
    const v = new THREE.Vector3(0, 0, -1);
    v.applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, "YXZ"));
    return v;
  }

  // Add camera recoil offsets (pitch up, small yaw kick). Called by weapon.
  addRecoil(pitchKick, yawKick) {
    this.pitch += pitchKick;
    this.yaw += yawKick;
    const lim = Math.PI / 2 - 0.01;
    if (this.pitch > lim) this.pitch = lim;
    if (this.pitch < -lim) this.pitch = -lim;
  }

  // Take damage with direction for HUD indicators.
  // info = { source, dir (Vector3 incoming direction), zone, point }
  takeDamage(amount, info = {}) {
    if (this.state.dead) return;
    this.state.health = Math.max(0, this.state.health - amount);
    this._hurtFlash = Math.min(1, this._hurtFlash + amount / 50);

    // Compute angle of incoming damage relative to player yaw.
    if (info.dir) {
      // 'dir' is travel direction of the arrow; attacker is opposite
      const incoming = info.dir.clone().negate();
      const relYaw = Math.atan2(
        // rotate incoming dir by -yaw
        incoming.x * Math.cos(this.yaw) - incoming.z * Math.sin(this.yaw),
        -(incoming.x * Math.sin(this.yaw) + incoming.z * Math.cos(this.yaw))
      );
      this.state.damageDirs.push({
        angle: relYaw,
        intensity: Math.min(1, amount / 30),
        life: 1.4,
        age: 0,
      });
    } else {
      this.state.damageDirs.push({
        angle: 0, intensity: Math.min(1, amount / 30), life: 1.4, age: 0,
      });
    }

    Audio.playerHurt(Math.min(1, amount / 30));
    if (this.state.health <= 0) {
      this.state.dead = true;
    }
  }

  dropHeld(throwableSystem, level) {
    if (!this.state.held) return;
    const origin = new THREE.Vector3(this.pos.x, this.pos.y - 0.4, this.pos.z);
    const dir = this.getLookDir();
    const vel = new THREE.Vector3(dir.x * 1.5, 0.5, dir.z * 1.5);
    throwableSystem.spawn(origin, vel, this.state.held.kind);
    this.state.held = null;
  }

  update(dt) {
    if (this.state.dead) return;

    // Decay damage indicators
    for (let i = this.state.damageDirs.length - 1; i >= 0; i--) {
      const d = this.state.damageDirs[i];
      d.age += dt;
      if (d.age > d.life) this.state.damageDirs.splice(i, 1);
    }
    // Decay hurt flash
    this._hurtFlash = Math.max(0, this._hurtFlash - dt * 1.2);

    // If hidden or using CCTV, no movement
    if (this.state.hidden || this.state.usingCCTV) {
      this.state.stamina = Math.min(1.0, this.state.stamina + dt * 0.35);
      this.state.noise = 0;
      this._applyCamera(dt);
      return;
    }

    // Speed plan
    const wantSprint = this.input.sprint && this.state.stamina > 0.05
      && !this.state.aiming;
    this.state.crouched = this.input.crouch;
    this.state.sprinting = wantSprint
      && (Math.abs(this.input.forward) + Math.abs(this.input.right) > 0);

    let speed = 3.3;
    if (this.state.crouched) speed = 1.8;
    if (this.state.sprinting) speed = 5.9;
    if (this.state.aiming) speed = Math.min(speed, 2.1);

    if (this.state.sprinting) {
      this.state.stamina = Math.max(0, this.state.stamina - dt * 0.28);
      this.state.sprintingSeconds += dt;
      if (this.state.stamina <= 0) {
        this.input.sprint = false;
        this.state.sprinting = false;
      }
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

    // Vertical (jump + gravity). Eye reference height handled via _targetY.
    const eye = this.state.crouched ? CROUCH_HEIGHT : EYE_HEIGHT;
    this._targetY = eye;
    if (this._grounded && this.input.jump && !this.state.crouched) {
      this._velY = JUMP_SPEED;
      this._grounded = false;
      Audio.footstep(1.0);
    }
    this._velY += GRAVITY * dt;

    // XZ collision
    this._moveXZ(dt);

    // Y integration (simple: floor at eye height)
    this.pos.y += this._velY * dt;
    if (this.pos.y <= this._targetY) {
      this.pos.y = this._targetY;
      this._velY = 0;
      this._grounded = true;
    }

    // Movement stats
    if (moveDir.lengthSq() > 0.01) {
      this._stillTimer = 0;
      const stepInterval = this.state.sprinting ? 0.32 : (this.state.crouched ? 0.74 : 0.48);
      this._footTimer -= dt;
      if (this._footTimer <= 0) {
        this._footTimer = stepInterval;
        const intensity = this.state.sprinting ? 1.3 : (this.state.crouched ? 0.32 : 0.85);
        Audio.footstep(intensity);
      }
      // Noise
      if (this.state.sprinting) this.state.noise = 1.0;
      else if (this.state.crouched) this.state.noise = 0.1;
      else this.state.noise = 0.45;
      this.state.noisePos.copy(this.pos);
    } else {
      this._footTimer = 0.1;
      this.state.noise = 0;
      this._stillTimer += dt;
      this.state.timeSpentStill += dt;
    }

    this.input.jump = false;

    this._applyCamera(dt);
  }

  _moveXZ(dt) {
    const colliders = this.level.colliders;
    const nx = this.pos.x + this.vel.x * dt;
    if (!this._collides(nx, this.pos.z, colliders)) this.pos.x = nx;
    else this.vel.x = 0;
    const nz = this.pos.z + this.vel.z * dt;
    if (!this._collides(this.pos.x, nz, colliders)) this.pos.z = nz;
    else this.vel.z = 0;
  }

  _collides(x, z, colliders) {
    const r = PLAYER_RADIUS;
    for (const c of colliders) {
      if (c.kind === "pallet") continue;
      if (x + r > c.minX && x - r < c.maxX
          && z + r > c.minZ && z - r < c.maxZ) return true;
    }
    return false;
  }

  _applyCamera(dt) {
    this.camera.position.copy(this.pos);
    // head bob
    let bobX = 0, bobY = 0;
    if (this.state.sprinting) {
      const t = performance.now() / 1000;
      bobX = Math.sin(t * 9) * 0.015;
      bobY = Math.abs(Math.cos(t * 9)) * 0.02;
    } else if (Math.abs(this.vel.x) + Math.abs(this.vel.z) > 0.1) {
      const t = performance.now() / 1000;
      bobX = Math.sin(t * 5) * 0.006;
      bobY = Math.abs(Math.cos(t * 5)) * 0.008;
    }

    const euler = new THREE.Euler(this.pitch + bobY * 0.2, this.yaw + bobX * 0.1, 0, "YXZ");
    this.camera.quaternion.setFromEuler(euler);
    this.camera.position.y = this.pos.y + bobY;

    // FOV for ADS
    const wantFov = this.state.aiming ? 55 : 72;
    this.camera.fov += (wantFov - this.camera.fov) * Math.min(1, dt * 10);
    this.camera.updateProjectionMatrix();
  }

  // Called on ADS toggle (from main)
  setAiming(on) {
    this.state.aiming = on && !this.state.hidden && !this.state.usingCCTV;
  }
}
