// Old Amber Factory — browser horror game, Three.js.
//
// Entry point: sets up renderer, wires input, runs the game loop.

import * as THREE from "three";
import { Audio } from "./audio.js";
import { buildLevel } from "./level.js";
import { Player } from "./player.js";
import { Monster } from "./monster.js";
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
renderer.setClearColor(0x090b10, 1);
renderer.shadowMap.enabled = false;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
// level sets scene.fog; we default here in case:
scene.fog = new THREE.FogExp2(0x0a0e14, 0.025);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 260);

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
const cctv = new CCTV(scene, level);
const ui = new UI();
const interaction = new InteractionSystem(level, player, ui, throwables, cctv);
const monster = new Monster(scene, level, player, throwables);

// --------- Game state ---------
const game = {
  running: false,
  escaped: false,
  dead: false,
  pointerLocked: false,
  truckDriveTimer: 0,
};

// --------- Input ---------
const keys = new Set();
const canvasEl = document.getElementById("canvas");

document.addEventListener("keydown", (e) => {
  if (!game.running) return;
  const k = e.code;
  keys.add(k);
  if (k === "KeyE") {
    player.input.interact = true;
    player.input.interactHeld = true;
  } else if (k === "KeyX") {
    player.toggleSprint();
  } else if (k === "KeyQ") {
    player.dropHeld(throwables, level);
  } else if (k === "ShiftLeft" || k === "ShiftRight") {
    player.input.binocHeld = true;
  } else if (k === "ControlLeft" || k === "ControlRight" || k === "KeyC") {
    player.input.crouch = true;
  }
});
document.addEventListener("keyup", (e) => {
  const k = e.code;
  keys.delete(k);
  if (k === "KeyE") player.input.interactHeld = false;
  else if (k === "ShiftLeft" || k === "ShiftRight") player.input.binocHeld = false;
  else if (k === "ControlLeft" || k === "ControlRight" || k === "KeyC") player.input.crouch = false;
});

document.addEventListener("mousemove", (e) => {
  if (!game.pointerLocked || !game.running) return;
  player.onMouseMove(e.movementX || 0, e.movementY || 0);
});

// Mouse buttons for throwing
document.addEventListener("mousedown", (e) => {
  if (!game.running || !game.pointerLocked) return;
  if (e.button === 0) {
    player.input.lmbHeld = true;
    player.beginAim();
  }
});
document.addEventListener("mouseup", (e) => {
  if (!game.running) return;
  if (e.button === 0) {
    player.input.lmbHeld = false;
    if (player.state.aiming) player.endAimAndThrow(throwables);
  }
});

// Wheel for binocular zoom
document.addEventListener("wheel", (e) => {
  if (!game.running) return;
  if (!player.state.binocularsOn) return;
  player.onMouseWheel(e.deltaY);
  e.preventDefault();
}, { passive: false });

canvasEl.addEventListener("click", () => {
  if (game.running && !game.pointerLocked) {
    // If CCTV overlay is active, pointer-lock isn't needed for aim since player is immobile,
    // but we still want mouselook for the world behind. Keep pointer lock on canvas.
    canvasEl.requestPointerLock();
  }
});
document.addEventListener("pointerlockchange", () => {
  game.pointerLocked = document.pointerLockElement === canvasEl;
});

// --------- Start / death / win handlers ---------
function startGame() {
  // Player reset
  player.setPosition(level.playerSpawn.x, 1.68, level.playerSpawn.z);
  player.yaw = 0; player.pitch = 0;
  player.state.health = 1.0;
  player.state.stamina = 1.0;
  player.state.binocularsOn = false;
  player.state.binocZoom = 2.0;
  player.state.crouched = false;
  player.state.sprinting = false;
  player.state.hidden = false;
  player.state.hiddenIn = null;
  player.state.dead = false;
  player.state.held = null;
  player.state.aiming = false;
  player.state.aimPower = 0;
  player.state.usingCCTV = false;
  player.state.timesHidden = 0;
  player.state.binocularsSeconds = 0;
  player.state.sprintingSeconds = 0;
  player.state.throwsMade = 0;
  player.input.sprint = false;
  player.input.crouch = false;
  player.input.binocHeld = false;
  player.input.lmbHeld = false;

  // Monster reset
  monster.setSpawn(level.monsterSpawn.x, level.monsterSpawn.z);
  monster.reset();

  // Truck reset
  if (level.truck) level.truck.started = false;
  interaction.truckState = {
    active: false, step: 0, progress: 0, started: false, promptTimer: 0,
  };

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
  ui.flashMessage("Ты очнулся... он уже ищет.", 3.5);

  canvasEl.requestPointerLock();
}

function die(text = "Длинные руки сомкнулись. Ты больше не увидишь неба.") {
  if (game.dead) return;
  game.dead = true;
  game.running = false;
  player.state.dead = true;
  Audio.monsterScreech();
  Audio.stinger();

  ui.showJumpscare();
  // deactivate CCTV if on
  if (cctv.isActive) cctv.deactivate(false);

  setTimeout(() => {
    ui.hideJumpscare();
    ui.showDeath(text);
    if (document.pointerLockElement) document.exitPointerLock();
  }, 1600);
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

monster.onCatch = () => die();

// --------- Adaptive counters ---------
let _wasHidden = false;

// --------- Main loop ---------
const clock = new THREE.Clock();

function animate() {
  const dt = Math.min(0.05, clock.getDelta());
  requestAnimationFrame(animate);

  if (game.running && !game.dead && !game.escaped) {
    // Read movement input
    player.input.forward = (keys.has("KeyW") ? 1 : 0) + (keys.has("KeyS") ? -1 : 0);
    player.input.right   = (keys.has("KeyD") ? 1 : 0) + (keys.has("KeyA") ? -1 : 0);

    // Track adaptive counters
    if (player.state.hidden && !_wasHidden) {
      player.state.timesHidden++;
    }
    _wasHidden = player.state.hidden;

    // Player update
    player.update(dt);

    // Flicker lamp lights
    for (const f of level.flickerLights) {
      const n = Math.sin(f.phase + performance.now() * 0.002) * 0.2
              + Math.sin(f.phase * 3 + performance.now() * 0.011) * 0.15
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

    // Hold-E for truck mini-game
    if (player.input.interactHeld && interaction.truckState.active && !interaction.truckState.started) {
      const t = level.truck;
      if (t && t.interactPos.distanceTo(player.pos) < 3.2) {
        interaction.holdInteract(dt);
      }
    }

    // Monster AI
    monster.update(dt);

    // CCTV update
    cctv.update(dt);
    // If player is on CCTV but it just turned off → release immobility
    if (player.state.usingCCTV && !cctv.isActive) {
      player.state.usingCCTV = false;
      ui.flashMessage("Монитор гаснет...");
    }

    // Truck drive-away victory cinematic
    if (interaction.truckState.started && level.truck) {
      const t = level.truck;
      game.truckDriveTimer += dt;
      const driveSpeed = Math.min(9, game.truckDriveTimer * 3);
      t.group.position.z += driveSpeed * dt;
      player.setPosition(t.group.position.x, 1.75, t.group.position.z - 1.1);
      player.yaw = Math.PI;

      // Spawn headlight spot lights on first frame
      if (!t._headLights) {
        t._headLights = [];
        for (const hp of t.headlights) {
          const l = new THREE.SpotLight(0xfff4c0, 3.5, 28, Math.PI / 6, 0.4, 1.0);
          l.position.set(hp.x, hp.y, hp.z);
          const tgt = new THREE.Object3D();
          tgt.position.set(hp.x, hp.y, hp.z + 12);
          scene.add(l); scene.add(tgt);
          l.target = tgt;
          t._headLights.push({ l, tgt, baseX: hp.x - t.group.position.x });
        }
      }
      for (const h of t._headLights) {
        h.l.position.set(
          t.group.position.x + h.baseX, 1.05,
          t.group.position.z + 1.55
        );
        h.tgt.position.set(
          t.group.position.x + h.baseX, 1.05,
          t.group.position.z + 12
        );
      }
      if (game.truckDriveTimer > 3.8) win();
    }

    // Audio heartbeat / dynamic music
    const mDist = monster.position.distanceTo(player.pos);
    Audio.tick(dt, {
      monsterDist: mDist,
      alert: monster.alertLevel,
      sprinting: player.state.sprinting,
      hiding: player.state.hidden,
      binoculars: player.state.binocularsOn,
      chasing: monster.state === "CHASE",
    });

    // HUD
    ui.update(dt, { player, monster, interaction, cctv });

    // Objective prompts
    if (!interaction.truckState.active) {
      ui.setObjective("добраться до ЖЁЛТОЙ МАШИНЫ в ангаре и уехать");
    } else if (!interaction.truckState.started) {
      ui.setObjective("завести двигатель — зажать [E]");
    } else {
      ui.setObjective("ГНАТЬ!");
    }
  }

  renderer.render(scene, camera);
}
animate();

ui.showStart();
