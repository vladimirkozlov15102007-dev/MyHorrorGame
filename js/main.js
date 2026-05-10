// Old Amber Factory — tactical survival-horror in Three.js.
//
// Controls (per user spec):
//   WASD       — move
//   Shift      — sprint
//   Ctrl       — crouch
//   Space      — jump
//   E          — interact
//   LMB        — fire pistol
//   RMB        — aim down sights
//   R          — reload

import * as THREE from "three";
import { Audio } from "./audio.js";
import { buildLevel } from "./level.js";
import { Player } from "./player.js";
import { Weapon } from "./weapon.js";
import { SkeletonManager } from "./skeleton.js";
import { ArrowSystem } from "./arrow.js";
import { ThrowableSystem } from "./throwable.js";
import { CCTV } from "./cctv.js";
import { InteractionSystem } from "./interactive.js";
import { UI } from "./ui.js";

// --------- Three.js setup ---------
const canvas = document.getElementById("canvas");
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: true, powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x87a8c4, 1);   // sunny sky
renderer.shadowMap.enabled = false;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87a8c4);
scene.fog = new THREE.FogExp2(0xcddae0, 0.008);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 300);
scene.add(camera);   // so viewmodel parented to camera renders even if camera is detached

window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

// --------- World, player, systems ---------
const level = buildLevel(scene);
const player = new Player(camera, level);
player.attachToScene(scene);

const throwables = new ThrowableSystem(scene, level, player);
const arrows = new ArrowSystem(scene, level, player);
const skeletons = new SkeletonManager(scene, level, player, arrows);
const weapon = new Weapon(scene, camera, player, level, skeletons);
const cctv = new CCTV(scene, level);
const ui = new UI();
const interaction = new InteractionSystem(level, player, ui, throwables, cctv, skeletons);

// --------- Game state ---------
const game = {
  running: false,
  escaped: false,
  dead: false,
  pointerLocked: false,
  truckDriveTimer: 0,
};

// --------- Hit marker wiring ---------
weapon.onHit = (part, killed) => {
  ui.showHitMarker(killed);
};

// --------- Input ---------
const keys = new Set();
const canvasEl = document.getElementById("canvas");

document.addEventListener("keydown", (e) => {
  if (!game.running) return;
  const k = e.code;
  if (keys.has(k)) return;   // ignore autorepeat
  keys.add(k);

  if (k === "KeyE") {
    player.input.interact = true;
    player.input.interactHeld = true;
  } else if (k === "Space") {
    player.input.jumpPressed = true;
    player.tryJump();
    e.preventDefault();
  } else if (k === "ShiftLeft" || k === "ShiftRight") {
    player.input.sprint = true;
  } else if (k === "ControlLeft" || k === "ControlRight" || k === "KeyC") {
    player.input.crouch = true;
    e.preventDefault();
  } else if (k === "KeyR") {
    player.input.reloadPressed = true;
  }
});

document.addEventListener("keyup", (e) => {
  const k = e.code;
  keys.delete(k);
  if (k === "KeyE") player.input.interactHeld = false;
  else if (k === "ShiftLeft" || k === "ShiftRight") player.input.sprint = false;
  else if (k === "ControlLeft" || k === "ControlRight" || k === "KeyC") player.input.crouch = false;
});

document.addEventListener("mousemove", (e) => {
  if (!game.pointerLocked || !game.running) return;
  player.onMouseMove(e.movementX || 0, e.movementY || 0);
});

document.addEventListener("mousedown", (e) => {
  if (!game.running || !game.pointerLocked) return;
  if (e.button === 0) player.input.lmb = true;
  else if (e.button === 2) player.input.rmb = true;
});
document.addEventListener("mouseup", (e) => {
  if (e.button === 0) player.input.lmb = false;
  else if (e.button === 2) player.input.rmb = false;
});
document.addEventListener("contextmenu", (e) => {
  if (game.running) e.preventDefault();
});

canvasEl.addEventListener("click", () => {
  if (game.running && !game.pointerLocked) canvasEl.requestPointerLock();
});
document.addEventListener("pointerlockchange", () => {
  game.pointerLocked = document.pointerLockElement === canvasEl;
});

// --------- Lifecycle ---------
function startGame() {
  // Player reset
  player.setPosition(level.playerSpawn.x, 1.72, level.playerSpawn.z);
  player.yaw = 0; player.pitch = 0;
  player.state.hp = 100;
  player.state.stamina = 1.0;
  player.state.dead = false;
  player.state.crouched = false;
  player.state.sprinting = false;
  player.state.ads = false;
  player.state.aimProgress = 0;
  player.state.hidden = false;
  player.state.hiddenIn = null;
  player.state.usingCCTV = false;
  player.state.held = null;
  player.state.shotsFired = 0;
  player.state.shotsHit = 0;
  player.state.headshots = 0;
  player.state.timesHidden = 0;
  player.state.damageTakenTotal = 0;
  player.state.sprintingSeconds = 0;
  player.state.crouchSeconds = 0;
  player.state.recoilPitch = 0;
  player.state.recoilYaw = 0;
  player.state.shake = 0;
  player.state.dmgFromYaw = null;
  player.state.dmgTimer = 0;
  player.input.sprint = false;
  player.input.crouch = false;
  player.input.lmb = false;
  player.input.rmb = false;

  // Skeletons reset + respawn
  skeletons.reset();
  skeletons.spawn();
  skeletons.onKilled = (skel) => {
    if (skeletons.alive <= 0) {
      ui.flashMessage("All hostiles down. Reach the truck.", 4.5);
    }
  };

  // Weapon reset
  weapon.reset();

  // Arrows reset
  arrows.reset();

  // Truck reset
  if (level.truck) level.truck.started = false;
  interaction.truckState = { active: false, step: 0, progress: 0, started: false, promptTimer: 0 };

  // CCTV reset
  cctv.deactivate(false);

  game.dead = false;
  game.escaped = false;
  game.truckDriveTimer = 0;
  game.running = true;

  ui.hideStart();
  ui.hideDeath();
  ui.hideWin();
  ui.hideJumpscare();

  Audio.init();
  Audio.resume();
  ui.flashMessage("Night-shift is over. Time to leave.", 3.5);

  canvasEl.requestPointerLock();
}

function die(text = "An arrow found its mark.") {
  if (game.dead) return;
  game.dead = true;
  game.running = false;
  player.state.dead = true;
  Audio.monsterScreech && Audio.monsterScreech();
  Audio.stinger && Audio.stinger();

  if (cctv.isActive) cctv.deactivate(false);

  setTimeout(() => {
    ui.showDeath(text);
    if (document.pointerLockElement) document.exitPointerLock();
  }, 1100);
}

function win() {
  if (game.escaped) return;
  game.escaped = true;
  game.running = false;
  ui.showWin();
  if (document.pointerLockElement) document.exitPointerLock();
}

document.getElementById("startBtn").addEventListener("click", startGame);
document.getElementById("retryBtn").addEventListener("click", startGame);
document.getElementById("winBtn").addEventListener("click", startGame);

// --------- Main loop ---------
const clock = new THREE.Clock();

function animate() {
  const dt = Math.min(0.05, clock.getDelta());
  requestAnimationFrame(animate);

  if (game.running && !game.dead && !game.escaped) {
    // Movement input
    player.input.forward = (keys.has("KeyW") ? 1 : 0) + (keys.has("KeyS") ? -1 : 0);
    player.input.right   = (keys.has("KeyD") ? 1 : 0) + (keys.has("KeyA") ? -1 : 0);

    // Player update
    player.update(dt);

    // Weapon update (reads LMB/RMB/reload + cooldown)
    weapon.update(dt, {
      lmb: player.input.lmb,
      rmb: player.input.rmb,
      reloadPressed: player.input.reloadPressed,
    });
    player.input.reloadPressed = false;

    // Death check from taking arrow damage
    if (player.state.dead && !game.dead) {
      die("An arrow found its mark.");
    }

    // Arrow projectiles (may damage player)
    arrows.update(dt);

    // Skeletons AI + animation
    skeletons.update(dt);

    // Throwables (still usable for distractions, but not required)
    throwables.update(dt, player.pos);

    // Flicker lamp lights (indoor atmospheric)
    for (const f of level.flickerLights) {
      const n = Math.sin(f.phase + performance.now() * 0.002) * 0.18
              + Math.sin(f.phase * 3 + performance.now() * 0.011) * 0.12
              + (Math.random() < 0.003 ? -0.8 : 0);
      f.light.intensity = Math.max(0.1, f.base + n);
    }

    // Interaction focus
    interaction.update(dt, player.pos, player.getLookDir());

    // Single-press interact (E)
    if (player.input.interact) {
      player.input.interact = false;
      interaction.interact();
    }

    // Hold-E for truck mini-game (only when all skeletons dead)
    if (player.input.interactHeld && interaction.truckState.active
        && !interaction.truckState.started) {
      const t = level.truck;
      if (t && t.interactPos.distanceTo(player.pos) < 3.2) {
        interaction.holdInteract(dt);
      }
    }

    // CCTV update (optional)
    cctv.update(dt);
    if (player.state.usingCCTV && !cctv.isActive) {
      player.state.usingCCTV = false;
      ui.flashMessage("Monitor off");
    }

    // Truck drive-away victory cinematic
    if (interaction.truckState.started && level.truck) {
      const t = level.truck;
      game.truckDriveTimer += dt;
      const driveSpeed = Math.min(10, game.truckDriveTimer * 3);
      t.group.position.z += driveSpeed * dt;
      player.setPosition(t.group.position.x, 1.78, t.group.position.z - 1.1);
      player.yaw = Math.PI;

      if (!t._headLights) {
        t._headLights = [];
        for (const hp of t.headlights) {
          const l = new THREE.SpotLight(0xfff4c0, 2.5, 30, Math.PI / 6, 0.4, 1.0);
          l.position.set(hp.x, hp.y, hp.z);
          const tgt = new THREE.Object3D();
          tgt.position.set(hp.x, hp.y, hp.z + 12);
          scene.add(l); scene.add(tgt);
          l.target = tgt;
          t._headLights.push({ l, tgt, baseX: hp.x - t.group.position.x });
        }
      }
      for (const h of t._headLights) {
        h.l.position.set(t.group.position.x + h.baseX, 1.05, t.group.position.z + 1.55);
        h.tgt.position.set(t.group.position.x + h.baseX, 1.05, t.group.position.z + 12);
      }
      if (game.truckDriveTimer > 3.8) win();
    }

    // Audio tick — adapt music to threat proximity
    let mDist = 999;
    for (const s of skeletons.skeletons) {
      if (s.dead) continue;
      const d = s.position.distanceTo(player.pos);
      if (d < mDist) mDist = d;
    }
    const alert = skeletons.anyAlerted() ? 1 : 0;
    const combat = skeletons.anyInCombat();
    Audio.tick(dt, {
      monsterDist: mDist,
      alert,
      sprinting: player.state.sprinting,
      hiding: player.state.hidden,
      binoculars: false,
      chasing: combat,
    });

    // HUD
    ui.update(dt, { player, skeletons, weapon, interaction, cctv });

    // Objective
    if (skeletons.alive > 0) {
      ui.setObjective(`eliminate ${skeletons.alive} skeleton${skeletons.alive!==1?"s":""}, then reach the yellow truck`);
    } else if (!interaction.truckState.active) {
      ui.setObjective("the yard is clear — reach the YELLOW TRUCK");
    } else if (!interaction.truckState.started) {
      ui.setObjective("start the engine — HOLD [E]");
    } else {
      ui.setObjective("drive!");
    }
  }

  renderer.render(scene, camera);
}
animate();

ui.showStart();
