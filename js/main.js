// The Yellow Truck — main loop.

import * as THREE from "three";
import { Audio } from "./audio.js";
import { buildLevel } from "./level.js";
import { Player } from "./player.js";
import { Monster } from "./monster.js";
import { InteractionSystem } from "./interactive.js";
import { UI } from "./ui.js";

// --------- Three.js setup ---------
const canvas = document.getElementById("canvas");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x050507, 1);
renderer.shadowMap.enabled = false;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x050507, 0.055);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 200);

window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

// --------- Build world ---------
const level = buildLevel(scene);
const player = new Player(camera, level);
player.attachToScene(scene);

const monster = new Monster(scene, level, player);
const ui = new UI();
const interaction = new InteractionSystem(level, player, ui);

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
  if (k === "KeyF") player.toggleFlashlight();
  else if (k === "KeyB") player.toggleBinoculars();
  else if (k === "KeyE") {
    player.input.interact = true;
    player.input.interactHeld = true;
  }
});
document.addEventListener("keyup", (e) => {
  const k = e.code;
  keys.delete(k);
  if (k === "KeyE") {
    player.input.interactHeld = false;
  }
});

document.addEventListener("mousemove", (e) => {
  if (!game.pointerLocked || !game.running) return;
  player.onMouseMove(e.movementX || 0, e.movementY || 0);
});

canvasEl.addEventListener("click", () => {
  if (game.running && !game.pointerLocked) {
    canvasEl.requestPointerLock();
  }
});

document.addEventListener("pointerlockchange", () => {
  game.pointerLocked = document.pointerLockElement === canvasEl;
});

// --------- Start / Retry / Win buttons ---------

function startGame() {
  // Reset player state
  player.setPosition(level.playerSpawn.x, 1.65, level.playerSpawn.z);
  player.yaw = 0; player.pitch = 0;
  player.state.health = 1.0;
  player.state.stamina = 1.0;
  player.state.battery = 1.0;
  player.state.flashlightOn = true;
  player.state.binocularsOn = false;
  player.state.keyCount = 0;
  player.state.dead = false;
  player.state.hidden = false;
  player.state.hiddenIn = null;
  player.state.timesHidden = 0;
  player.state.flashlightSeconds = 0;
  player.state.sprintingSeconds = 0;

  // Reset monster
  monster.setSpawn(level.monsterSpawn.x, level.monsterSpawn.z);
  monster.state = "PATROL";
  monster.stateTimer = 0;
  monster.bb.lastSeenPos = null;
  monster.bb.lastSeenTime = -999;
  monster.bb.lastNoisePos = null;
  monster.bb.lastNoiseTime = -999;
  monster.bb.lastLightPingPos = null;
  monster.bb.lastLightPingTime = -999;
  monster.bb.patrolTarget = null;
  monster.bb.ambushPos = null;
  monster.bb.ambushUntil = 0;
  monster.bb.witnessedHide = false;
  monster.bb.hideScore = 0;
  monster.bb.flashScore = 0;
  monster.bb.sprintScore = 0;

  // Reset pickups: remove any collected back to scene (regen)
  for (const item of [...level.pickups, ...level.keys]) {
    if (item.collected) {
      item.collected = false;
      level.group.add(item.mesh);
    }
  }

  // Reset truck
  if (level.truck) level.truck.started = false;
  interaction.truckState = { active: false, step: 0, progress: 0, started: false, promptTimer: 0 };

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
  ui.flashMessage("You woke up... you hear it breathing", 3.5);

  canvasEl.requestPointerLock();
}

function die(text = "The long arms close around you. You never saw the sky again.") {
  if (game.dead) return;
  game.dead = true;
  game.running = false;
  player.state.dead = true;
  Audio.monsterScreech();
  Audio.stinger();

  ui.showJumpscare();

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

// --------- Track adaptive counters ---------
let _wasHidden = false;
let _lastFlashOn = false;

// --------- Main loop ---------
const clock = new THREE.Clock();

function animate() {
  const dt = Math.min(0.05, clock.getDelta());
  requestAnimationFrame(animate);

  if (game.running && !game.dead && !game.escaped) {
    // Read movement input
    player.input.forward = (keys.has("KeyW") ? 1 : 0) + (keys.has("KeyS") ? -1 : 0);
    player.input.right   = (keys.has("KeyD") ? 1 : 0) + (keys.has("KeyA") ? -1 : 0);
    player.input.sprint  = keys.has("ShiftLeft") || keys.has("ShiftRight");
    player.input.crouch  = keys.has("ControlLeft") || keys.has("ControlRight") || keys.has("KeyC");

    // Track adaptive counters
    if (player.state.hidden && !_wasHidden) {
      player.state.timesHidden++;
    }
    _wasHidden = player.state.hidden;

    // Update systems
    player.update(dt);

    // Flicker lights
    for (const f of level.flickerLights) {
      const n = Math.sin(f.phase + performance.now() * 0.002) * 0.2
              + Math.sin(f.phase * 3 + performance.now() * 0.011) * 0.15
              + (Math.random() < 0.003 ? -0.7 : 0);
      f.light.intensity = Math.max(0.1, f.base + n);
    }

    // Interaction focus
    interaction.update(dt, player.pos, player.getLookDir());

    // E-interaction dispatch
    if (player.input.interact) {
      player.input.interact = false;
      interaction.interact();
    }
    // Hold-E drives the truck mini-game
    if (player.input.interactHeld && interaction.truckState.active && !interaction.truckState.started) {
      const t = level.truck;
      if (t && t.interactPos.distanceTo(player.pos) < 3.0) {
        interaction.holdInteract(dt);
      }
    }

    // Monster AI
    monster.update(dt);

    // Truck won → drive out animation
    if (interaction.truckState.started && level.truck) {
      // Drive forward (in +Z direction of truck model) and fade
      const t = level.truck;
      game.truckDriveTimer += dt;
      const driveSpeed = Math.min(8, game.truckDriveTimer * 3);
      t.group.position.z += driveSpeed * dt;
      // move camera with truck cab
      player.setPosition(t.group.position.x, 1.7, t.group.position.z - 1.0);
      player.yaw = Math.PI; // face forward (+Z)
      // attach headlights real lights on first frame
      if (!t._headLights) {
        t._headLights = [];
        for (const hp of t.headlights) {
          const l = new THREE.SpotLight(0xfff4c0, 3.2, 22, Math.PI / 6, 0.4, 1.0);
          l.position.set(hp.x, hp.y, hp.z);
          const tgt = new THREE.Object3D();
          tgt.position.set(hp.x, hp.y, hp.z + 10);
          scene.add(l); scene.add(tgt);
          l.target = tgt;
          t._headLights.push({ l, tgt });
        }
      }
      for (const h of t._headLights) {
        h.l.position.z = t.group.position.z + 1.35;
        h.l.position.x = t.group.position.x + (h.l.position.x > t.group.position.x ? 0.7 : -0.7);
        h.tgt.position.z = t.group.position.z + 11;
      }
      if (game.truckDriveTimer > 3.5) {
        win();
      }
    }

    // Audio: heartbeat/breath reactive
    const mDist = monster.position.distanceTo(player.pos);
    Audio.tick(dt, {
      monsterDist: mDist,
      alert: monster.alertLevel,
      sprinting: player.state.sprinting,
      hiding: player.state.hidden,
      binoculars: player.state.binocularsOn,
    });

    // HUD
    ui.update(dt, { player, monster, interaction });

    // Objective text updates
    if (!interaction.truckState.active) {
      if (player.state.keyCount < 3) {
        ui.setObjective(`find truck keys (${player.state.keyCount}/3), then reach the YELLOW TRUCK`);
      } else {
        ui.setObjective("reach the YELLOW TRUCK in the garage and start it");
      }
    } else if (!interaction.truckState.started) {
      ui.setObjective("start the truck — hold [E]");
    } else {
      ui.setObjective("DRIVE!");
    }
  }

  renderer.render(scene, camera);
}
animate();

// Show start screen
ui.showStart();
