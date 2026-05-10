// Player controller: movement, collision (AABB), flashlight, binoculars,
// stats (battery, stamina), noise emission.

import * as THREE from "three";
import { Audio } from "./audio.js";

const PLAYER_RADIUS = 0.35;
const EYE_HEIGHT = 1.65;
const CROUCH_HEIGHT = 1.05;

export class Player {
  constructor(camera, level) {
    this.camera = camera;
    this.level = level;

    // Position & movement
    this.pos = new THREE.Vector3(level.playerSpawn.x, EYE_HEIGHT, level.playerSpawn.z);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;

    this.input = {
      forward: 0, right: 0,
      sprint: false, crouch: false,
      interact: false, interactHeld: false,
    };

    this.state = {
      health: 1.0,
      stamina: 1.0,
      battery: 1.0,
      flashlightOn: true,
      binocularsOn: false,
      crouched: false,
      sprinting: false,
      hidden: false,
      hiddenIn: null,
      keyCount: 0,
      dead: false,
      // Noise emitted this frame (0..1), consumed by monster AI
      noise: 0,
      noisePos: new THREE.Vector3(),
      // Counters for adaptive AI
      timesHidden: 0,
      flashlightSeconds: 0,
      sprintingSeconds: 0,
    };

    // Flashlight (SpotLight)
    this.flashlight = new THREE.SpotLight(0xfff0d0, 2.4, 22, Math.PI / 7, 0.35, 1.2);
    this.flashlight.position.copy(this.pos);
    this.flashTarget = new THREE.Object3D();
    this.flashlight.target = this.flashTarget;
    // Note: parenting to camera is tempting but we manage manually for clean ray use
    this.flashOnBaseIntensity = 2.4;

    // Footstep timing
    this._footTimer = 0;

    // Mouse sensitivity
    this.sens = 0.0022;
  }

  attachToScene(scene) {
    scene.add(this.flashlight);
    scene.add(this.flashTarget);
  }

  setPosition(x, y, z) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
  }

  onMouseMove(dx, dy) {
    if (this.state.dead) return;
    this.yaw -= dx * this.sens;
    this.pitch -= dy * this.sens;
    const lim = Math.PI / 2 - 0.01;
    if (this.pitch > lim) this.pitch = lim;
    if (this.pitch < -lim) this.pitch = -lim;
  }

  toggleFlashlight() {
    if (this.state.binocularsOn) return; // can't while using binoculars
    if (this.state.battery <= 0 && !this.state.flashlightOn) return;
    this.state.flashlightOn = !this.state.flashlightOn;
    Audio.flashlightClick();
  }

  toggleBinoculars() {
    if (this.state.hidden) return;
    this.state.binocularsOn = !this.state.binocularsOn;
    Audio.binocularClick();
    // disable flashlight while binoculars
    if (this.state.binocularsOn) this.state.flashlightOn = false;
  }

  update(dt) {
    if (this.state.dead) return;

    // --- Hidden state: no movement ---
    if (this.state.hidden) {
      this.state.stamina = Math.min(1.0, this.state.stamina + dt * 0.35);
      this._applyCamera(dt);
      this.state.noise = 0;
      // Flashlight off while in locker
      this._updateFlashlightPose(dt, false);
      return;
    }

    // --- Determine speed ---
    const wantSprint = this.input.sprint && this.state.stamina > 0.05 && !this.state.binocularsOn;
    const wantCrouch = this.input.crouch;
    this.state.sprinting = wantSprint && (Math.abs(this.input.forward) + Math.abs(this.input.right) > 0);
    this.state.crouched = wantCrouch;

    let speed = 3.2;                       // walk
    if (this.state.crouched) speed = 1.6;  // crouch
    if (this.state.sprinting) speed = 5.6; // run
    if (this.state.binocularsOn) speed = 1.2; // binoculars slow

    // Stamina
    if (this.state.sprinting) {
      this.state.stamina = Math.max(0, this.state.stamina - dt * 0.28);
      this.state.sprintingSeconds += dt;
    } else {
      this.state.stamina = Math.min(1.0, this.state.stamina + dt * 0.22);
    }

    // Direction vectors (horizontal)
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const moveDir = new THREE.Vector3()
      .addScaledVector(fwd, this.input.forward)
      .addScaledVector(right, this.input.right);
    if (moveDir.lengthSq() > 0) moveDir.normalize();

    this.vel.x = moveDir.x * speed;
    this.vel.z = moveDir.z * speed;

    // Apply with collision (axis-separated)
    this._moveWithCollision(dt);

    // Flashlight battery drain
    if (this.state.flashlightOn) {
      this.state.battery = Math.max(0, this.state.battery - dt * 0.012); // ~83s
      this.state.flashlightSeconds += dt;
      if (this.state.battery <= 0) {
        this.state.flashlightOn = false;
      }
    }

    // Noise emission (for AI)
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
        const intensity = this.state.sprinting ? 1.2 : (this.state.crouched ? 0.35 : 0.8);
        Audio.footstep(intensity);
      }
    } else {
      this._footTimer = 0.1;
    }

    this._applyCamera(dt);
    this._updateFlashlightPose(dt, true);
  }

  _moveWithCollision(dt) {
    const colliders = this.level.colliders;

    // X axis
    const nextX = this.pos.x + this.vel.x * dt;
    if (!this._collides(nextX, this.pos.z, colliders)) {
      this.pos.x = nextX;
    } else {
      // slide: try small separation
      this.vel.x = 0;
    }
    // Z axis
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
      if (x + r > c.minX && x - r < c.maxX &&
          z + r > c.minZ && z - r < c.maxZ) return true;
    }
    return false;
  }

  _applyCamera(dt) {
    const targetY = this.state.crouched ? CROUCH_HEIGHT : EYE_HEIGHT;
    // smooth
    this.pos.y += (targetY - this.pos.y) * Math.min(1, dt * 10);

    this.camera.position.copy(this.pos);
    // yaw/pitch to quaternion
    const euler = new THREE.Euler(this.pitch, this.yaw, 0, "YXZ");
    this.camera.quaternion.setFromEuler(euler);

    // Binocular zoom via fov
    const wantFov = this.state.binocularsOn ? 22 : 70;
    this.camera.fov += (wantFov - this.camera.fov) * Math.min(1, dt * 8);
    this.camera.updateProjectionMatrix();
  }

  _updateFlashlightPose(dt, visible) {
    const on = visible && this.state.flashlightOn && !this.state.hidden;
    this.flashlight.intensity = on ? this.flashOnBaseIntensity : 0.0;
    if (!on) return;
    // Position slightly in front of camera so its own cone doesn't clip walls behind the player
    const dir = this.getLookDir();
    const offset = new THREE.Vector3(
      -Math.cos(this.yaw) * 0.15, // slight right hand
      -0.1,
      Math.sin(this.yaw) * 0.15
    );
    this.flashlight.position.set(
      this.pos.x + offset.x,
      this.pos.y + offset.y,
      this.pos.z + offset.z
    );
    this.flashTarget.position.set(
      this.pos.x + dir.x * 6,
      this.pos.y + dir.y * 6,
      this.pos.z + dir.z * 6
    );
  }

  getLookDir() {
    const v = new THREE.Vector3(0, 0, -1);
    const euler = new THREE.Euler(this.pitch, this.yaw, 0, "YXZ");
    v.applyEuler(euler);
    return v;
  }
}
