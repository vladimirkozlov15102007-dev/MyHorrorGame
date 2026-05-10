// Old Amber Factory — tactical survival horror shooter (Three.js).
//
// Orchestrates:
//   * Renderer + postfx pipeline (bloom, vignette, chroma, grading)
//   * Level (procedural factory + outdoor yard)
//   * Player (FPS, HP 100, WASD + Shift sprint + Ctrl crouch + Jump + E)
//   * Pistol weapon (LMB fire, RMB aim, R reload, hitscan damage zones)
//   * 10 skeleton archers with adaptive AI + group coordination + arrows
//   * Throwables (legacy distraction mechanic kept — use E to pick, Q to drop)
//   * CCTV security terminal
//   * Yellow truck escape sequence (after all skeletons are dead)
//
// Win condition: all 10 skeletons are dead AND the player starts the truck.
// Players can reach the truck early, but the engine stays silent until
// every skeleton is down.

import * as THREE from "three";
import { Audio } from "./audio.js";
import { buildLevel } from "./level.js";
import { Player } from "./player.js";
import { ThrowableSystem } from "./throwable.js";
import { CCTV } from "./cctv.js";
import { InteractionSystem } from "./interactive.js";
import { UI } from "./ui.js";
import { FXManager } from "./fx.js";
import { Weapon } from "./weapon.js";
import { ArrowSystem } from "./arrow.js";
import { Skeleton, SkeletonGroup } from "./skeleton.js";
import { PostFX } from "./postfx.js";

// --------- Three.js setup ---------
const canvas = document.getElementById("canvas");
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x101622, 1);
renderer.shadowMap.enabled = false;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  72, window.innerWidth / window.innerHeight, 0.05, 300
);
// Weapon viewmodel is a child of camera, so camera itself must be in scene
// for the model matrices to update.
scene.add(camera);

// Post-processing
const postfx = new PostFX(renderer);
postfx.setSize(window.innerWidth, window.innerHeight);

function onResize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  postfx.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener("resize", onResize);

// --------- Level + systems ---------
const level = buildLevel(scene);
const fx = new FXManager(scene);
const player = new Player(camera, level);

const throwables = new ThrowableSystem(scene, level, player);
const arrows = new ArrowSystem(scene, level, player, fx);
const weapon = new Weapon(camera, scene, fx);
weapon.setEnvColliders(level.colliders);

const cctv = new CCTV(scene, level);
const ui = new UI();
const interaction = new InteractionSystem(level, player, ui, throwables, cctv);

// --------- Skeletons ---------
const skelGroup = new SkeletonGroup(level, player);
const skeletons = [];
const spawns = level.skeletonSpawns.slice(0, 10);
while (spawns.length < 10) spawns.push({ x: 0, y: 0, z: 0 });
for (let i = 0; i < 10; i++) {
  const s = new Skeleton(i, scene, level, player, skelGroup, arrows, fx);
  s.setSpawn(spawns[i].x, spawns[i].z);
  skeletons.push(s);
  skelGroup.add(s);
}
weapon.setTargets(skeletons);

// Weapon callbacks
weapon.onHit = (target, damage, hit) => {
  if (target && target.takeDamage) {
    target.takeDamage(damage, {
      dir: new THREE.Vector3().subVectors(hit.point, camera.position).normalize(),
      zone: hit.zone,
      point: hit.point,
    });
    player.state.hitsLanded = (player.state.hitsLanded || 0) + 1;
    // show hitmarker briefly
    ui.showHitmarker(hit.zone);
  }
};
weapon.onShotFired = (origin, dir) => {
  player.state.shotsFired = (player.state.shotsFired || 0) + 1;
  // Shots are loud — broadcast a noise event to the skeleton group
  if (skelGroup.reportNoise) skelGroup.reportNoise(origin.clone());
  // Flash damageFlash very briefly? Not on our own shot — skip
};

// --------- Game state ---------
const game = {
  running: false,
  won: false,
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
  if (keys.has(k)) return;
  keys.add(k);
  if (k === "KeyE") {
    player.input.interact = true;
    player.input.interactHeld = true;
  } else if (k === "KeyR") {
    weapon.reload();
  } else if (k === "Space") {
    player.input.jump = true;
  } else if (k === "ShiftLeft" || k === "ShiftRight") {
    player.input.sprint = true;
  } else if (k === "ControlLeft" || k === "ControlRight" || k === "KeyC") {
    player.input.crouch = true;
  } else if (k === "KeyQ") {
    player.dropHeld(throwables, level);
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
  if (!game.running) return;
  if (!game.pointerLocked) {
    if (document.pointerLockElement !== canvasEl) canvasEl.requestPointerLock();
    return;
  }
  if (e.button === 0) {
    // LMB — fire / throw held item
    if (player.state.held) {
      player.beginAim && player.beginAim();
      player.input.lmbHeld = true;
    } else {
      player.input.lmbHeld = true;
      weapon.triggerDown();
    }
  } else if (e.button === 2) {
    // RMB — ADS
    player.input.rmbHeld = true;
    weapon.aim(true);
    player.setAiming(true);
  }
});
document.addEventListener("mouseup", (e) => {
  if (!game.running) return;
  if (e.button === 0) {
    if (player.state.held) {
      // throw via legacy throwable system
      if (player.endAimAndThrow) player.endAimAndThrow(throwables);
    }
    player.input.lmbHeld = false;
    weapon.triggerUp();
  } else if (e.button === 2) {
    player.input.rmbHeld = false;
    weapon.aim(false);
    player.setAiming(false);
  }
});
document.addEventListener("contextmenu", (e) => e.preventDefault());

canvasEl.addEventListener("click", () => {
  if (game.running && !game.pointerLocked) {
    canvasEl.requestPointerLock();
  }
});
document.addEventListener("pointerlockchange", () => {
  game.pointerLocked = document.pointerLockElement === canvasEl;
});

// --------- Start / death / win ---------
function startGame() {
  // Player reset
  player.setPosition(level.playerSpawn.x, 1.68, level.playerSpawn.z);
  player.yaw = 0; player.pitch = 0;
  player.state.health = 100;
  player.state.stamina = 1.0;
  player.state.crouched = false;
  player.state.sprinting = false;
  player.state.hidden = false;
  player.state.hiddenIn = null;
  player.state.dead = false;
  player.state.held = null;
  player.state.aiming = false;
  player.state.usingCCTV = false;
  player.state.timesHidden = 0;
  player.state.sprintingSeconds = 0;
  player.state.throwsMade = 0;
  player.state.shotsFired = 0;
  player.state.hitsLanded = 0;
  player.state.timeSpentStill = 0;
  player.state.damageDirs.length = 0;
  player.input.sprint = false;
  player.input.crouch = false;

  // Weapon reset
  weapon.magazine = 15;
  weapon.reserve = 60;
  weapon._reloading = false;
  weapon._recoil = 0;
  weapon._recoilPitch = 0;
  weapon._recoilYaw = 0;
  weapon.aiming = false;
  weapon.adsT = 0;

  // Skeletons reset
  for (let i = 0; i < skeletons.length; i++) {
    const sk = skeletons[i];
    // Recreate skeleton by resetting state (easier than rebuild)
    sk.alive = true;
    sk.hp = 100;
    sk.state = "PATROL";
    sk.stateTimer = 0;
    sk.bowDraw = 0;
    sk.staggerT = 0;
    sk.path = [];
    sk.pathIndex = 0;
    sk._ragdoll = null;
    sk.root.rotation.set(0, 0, 0);
    sk.root.position.set(spawns[i].x, 0, spawns[i].z);
    if (sk.pelvis) sk.pelvis.position.set(0, 0.95, 0);
    if (sk.eyeLight) sk.eyeLight.intensity = 0.22;
    if (sk.nockArrow) sk.nockArrow.visible = false;
  }
  skelGroup.blackboard.sharedPos = null;
  skelGroup.blackboard.sharedPosTime = -999;
  skelGroup.blackboard.groupAttackOn = false;

  // Truck reset
  if (level.truck) level.truck.started = false;
  interaction.truckState = {
    active: false, step: 0, progress: 0, started: false, promptTimer: 0,
  };

  // CCTV reset
  cctv.deactivate(false);

  // Arrows/FX reset (clear stuck arrows)
  for (const a of arrows._stuckArrows) scene.remove(a.obj);
  arrows._stuckArrows.length = 0;
  for (const a of arrows.arrows) scene.remove(a.mesh);
  arrows.arrows.length = 0;

  game.dead = false;
  game.won = false;
  game.truckDriveTimer = 0;
  game.running = true;

  ui.hideStart();
  ui.hideDeath();
  ui.hideWin();
  ui.hideJumpscare();

  Audio.init();
  Audio.resume();
  ui.flashMessage("Ты очнулся... 10 скелетов на заводе. Убей всех и уезжай.", 4.5);

  canvasEl.requestPointerLock();
}

function die(text = "Стрела нашла цель. Фабрика поглотила тебя.") {
  if (game.dead) return;
  game.dead = true;
  game.running = false;
  player.state.dead = true;
  Audio.stinger();

  ui.showJumpscare();
  if (cctv.isActive) cctv.deactivate(false);

  setTimeout(() => {
    ui.hideJumpscare();
    ui.showDeath(text);
    if (document.pointerLockElement) document.exitPointerLock();
  }, 1200);
}

function win() {
  if (game.won) return;
  game.won = true;
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

  if (game.running && !game.dead && !game.won) {
    // Read movement input
    player.input.forward = (keys.has("KeyW") ? 1 : 0) + (keys.has("KeyS") ? -1 : 0);
    player.input.right   = (keys.has("KeyD") ? 1 : 0) + (keys.has("KeyA") ? -1 : 0);

    // Player update
    player.update(dt);

    // Weapon update (reads aim / trigger / reload states)
    weapon.update(dt, {
      moving: (Math.abs(player.input.forward) + Math.abs(player.input.right)) > 0,
      sprinting: player.state.sprinting,
      crouched: player.state.crouched,
    });
    // Apply recoil decayed from last shot to camera
    const rec = weapon.getCameraRecoil();
    if (rec.pitch !== 0 || rec.yaw !== 0) {
      // weapon already drives the pitch offset internally via lerped values,
      // but we want actual camera kick. Add it here with a tiny scalar.
    }

    // Flicker lamp lights (legacy)
    for (const f of level.flickerLights) {
      const n = Math.sin(f.phase + performance.now() * 0.002) * 0.2
              + Math.sin(f.phase * 3 + performance.now() * 0.011) * 0.15
              + (Math.random() < 0.003 ? -0.8 : 0);
      f.light.intensity = Math.max(0.1, f.base + n);
    }

    // Skeletons
    for (const sk of skeletons) sk.update(dt);

    // Group coordination
    skelGroup.update(dt, {
      timesHidden: player.state.timesHidden || 0,
      binocularsSeconds: player.state.binocularsSeconds || 0,
      sprintingSeconds: player.state.sprintingSeconds || 0,
      timeSpentStill: player.state.timeSpentStill || 0,
      shotsFired: player.state.shotsFired || 0,
      hitsLanded: player.state.hitsLanded || 0,
    });

    // Arrows
    arrows.update(dt);

    // Interaction + throwables
    interaction.update(dt, player.pos, player.getLookDir());
    if (player.input.interact) {
      player.input.interact = false;
      interaction.interact();
    }

    // Hold E for truck engine
    if (player.input.interactHeld && interaction.truckState.active
        && !interaction.truckState.started) {
      const t = level.truck;
      if (t && t.interactPos.distanceTo(player.pos) < 3.2) {
        // Only allow actual starting if all skeletons dead.
        if (skelGroup.allDead()) {
          interaction.holdInteract(dt);
        } else {
          // Dry cranks — no progress; tease the player
          if (Math.random() < dt * 2) {
            Audio.engineCrank();
            ui.flashMessage(`Двигатель молчит. Скелетов осталось: ${skelGroup.aliveCount()}`, 1.5);
          }
        }
      }
    }

    // CCTV
    cctv.update(dt);
    if (player.state.usingCCTV && !cctv.isActive) {
      player.state.usingCCTV = false;
      ui.flashMessage("Мониторы гаснут...");
    }

    // FX
    fx.update(dt, camera.position);

    // Truck drive-away cinematic
    if (interaction.truckState.started && level.truck) {
      const t = level.truck;
      game.truckDriveTimer += dt;
      const driveSpeed = Math.min(12, game.truckDriveTimer * 4);
      t.group.position.z += driveSpeed * dt;
      player.setPosition(t.group.position.x, 1.75, t.group.position.z - 1.1);
      player.yaw = Math.PI;

      if (!t._headLights) {
        t._headLights = [];
        for (const hp of t.headlights) {
          const l = new THREE.SpotLight(0xfff4c0, 4.5, 32, Math.PI / 5.5, 0.5, 1.0);
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
      if (game.truckDriveTimer > 4.5) win();
    }

    // Adaptive music — use nearest alive skeleton distance as "threat"
    const alive = skeletons.filter(s => s.alive);
    let nearest = 999;
    let chasing = false;
    for (const s of alive) {
      const d = s.position.distanceTo(player.pos);
      if (d < nearest) nearest = d;
      if (s.state === "COMBAT" || s.state === "GROUP_ATTACK" || s.state === "SUPPRESS") chasing = true;
    }
    Audio.tick(dt, {
      monsterDist: nearest,
      alert: chasing ? 1 : 0,
      sprinting: player.state.sprinting,
      hiding: player.state.hidden,
      binoculars: false,
      chasing,
    });

    // Post-FX uniforms: damage flash, exposure vs. combat
    postfx.uniforms.damageFlash.value *= Math.max(0, 1 - dt * 4);
    if (player._hurtFlash > 0.05 && !postfx._hurtPushed) {
      postfx.uniforms.damageFlash.value = Math.max(postfx.uniforms.damageFlash.value, Math.min(0.55, player._hurtFlash * 0.5));
    }
    // Low-health pulse
    const hpFrac = player.state.health / 100;
    if (hpFrac < 0.35) {
      const p = (1 - hpFrac) * 0.35;
      const osc = Math.sin(performance.now() * 0.006) * 0.5 + 0.5;
      postfx.uniforms.damageFlash.value = Math.max(postfx.uniforms.damageFlash.value, osc * p);
    }
    // Slight grain reduction when aiming (clearer shot)
    postfx.uniforms.grain.value = player.state.aiming ? 0.03 : 0.06;
    postfx.uniforms.chroma.value = player.state.aiming ? 0.0007 : 0.0017;

    // HUD
    ui.update(dt, { player, weapon, interaction, cctv, skeletons: skelGroup });

    // Objective
    const aliveCount = skelGroup.aliveCount();
    if (aliveCount > 0) {
      ui.setObjective(`УНИЧТОЖИТЬ СКЕЛЕТОВ: ${aliveCount} осталось — затем добраться до Жёлтой Машины`);
    } else if (!interaction.truckState.active) {
      ui.setObjective("ВСЕ МЕРТВЫ. Бегом к жёлтой машине");
    } else if (!interaction.truckState.started) {
      ui.setObjective("Заведи двигатель — зажать [E]");
    } else {
      ui.setObjective("ГНАТЬ!");
    }

    // Death check
    if (player.state.dead) die();
  }

  // Render via post-fx pipeline
  postfx.render(scene, camera);
}
animate();

ui.showStart();
