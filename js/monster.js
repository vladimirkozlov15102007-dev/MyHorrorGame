// Adaptive Monster AI.
//
// Architecture: Finite State Machine + Blackboard (persistent memory).
// States: PATROL, INVESTIGATE, CHASE, AMBUSH, SEARCH_HIDING, STUNNED.
//
// Adaptation (via blackboard.learn):
//   hideScore        — how often player hides → more locker checks, more ambushes
//   flashScore       — how often flashlight is on → better reaction to light, larger detect range when it shines
//   sprintScore      — how often player sprints → faster reaction to footsteps, faster chase
//
// Senses:
//   - Sight: cone in front, blocked by walls (raycast over collider AABBs)
//   - Hearing: player.state.noise (scaled by sprintScore)
//   - Light: player's flashlight direction intersecting monster's vicinity (scaled by flashScore)
//
// Path movement: A* via level.pathfinder.

import * as THREE from "three";
import { Audio } from "./audio.js";
import { CELL } from "./level.js";

const SIGHT_DIST = 14;
const SIGHT_FOV = Math.PI * 0.55;   // ~100 degrees
const HEAR_BASE = 10;               // max hearing radius at full noise
const LIGHT_BASE = 18;              // flashlight "ping" distance
const CATCH_DIST = 1.1;

export class Monster {
  constructor(scene, level, player) {
    this.scene = scene;
    this.level = level;
    this.player = player;

    // Root
    this.root = new THREE.Group();
    this.root.position.set(level.monsterSpawn.x, 0, level.monsterSpawn.z);
    scene.add(this.root);

    this._buildMesh();

    // Movement
    this.vel = new THREE.Vector3();
    this.lookYaw = 0;
    this.path = [];
    this.pathIndex = 0;
    this._pathCooldown = 0;
    this._pathTarget = new THREE.Vector3();

    // FSM
    this.state = "PATROL";
    this.stateTimer = 0;
    this.globalTimer = 0;

    // Animation timers
    this._walkPhase = 0;
    this._limbSwing = 0;

    // Blackboard (persistent memory)
    this.bb = {
      lastSeenPos: null,       // THREE.Vector3 or null
      lastSeenTime: -999,
      lastNoisePos: null,
      lastNoiseTime: -999,
      lastLightPingPos: null,
      lastLightPingTime: -999,
      patrolTarget: null,
      // Adaptation counters (clamped 0..1 after normalization)
      hideScore: 0.0,
      flashScore: 0.0,
      sprintScore: 0.0,
      // Ambush: where to go and stand still
      ambushPos: null,
      ambushUntil: 0,
      // Anti-spam
      lastGrowl: -999,
      // When player is hidden, decay knowledge unless we saw them enter
      witnessedHide: false,
    };

    // Precompute wall segments for line-of-sight checks (cells of type '#')
    // We'll use AABB raytest via level.colliders (blocksVision=true).

    // footstep audio spacing
    this._footTimer = 0;

    // Alert level 0..1 for music/HUD
    this.alertLevel = 0;

    // kill callback set by main
    this.onCatch = null;
  }

  _buildMesh() {
    // Tall, thin, dark creature.
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x0a0a0a, roughness: 1.0, metalness: 0.0, emissive: 0x050505
    });
    const limbMat = new THREE.MeshStandardMaterial({
      color: 0x080808, roughness: 1.0, metalness: 0.0
    });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
    const mouthMat = new THREE.MeshBasicMaterial({ color: 0x3a0000 });

    // Torso
    const torso = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.22, 1.1, 8),
      bodyMat
    );
    torso.position.y = 1.55;
    this.root.add(torso);

    // Head (elongated)
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 10, 10),
      bodyMat
    );
    head.scale.set(0.8, 1.3, 0.9);
    head.position.y = 2.3;
    this.root.add(head);
    this.head = head;

    // Glowing eyes
    for (const sx of [-0.08, 0.08]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), eyeMat);
      eye.position.set(sx, 2.33, 0.18);
      this.root.add(eye);
    }
    // Gaping mouth
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.05), mouthMat);
    mouth.position.set(0, 2.15, 0.18);
    this.root.add(mouth);

    // Neck
    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.1, 0.3, 8),
      bodyMat
    );
    neck.position.y = 2.05;
    this.root.add(neck);

    // Arms (very long)
    const armGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.6, 6);
    const armL = new THREE.Mesh(armGeo, limbMat);
    armL.position.set(-0.22, 1.25, 0);
    armL.rotation.z = 0.2;
    this.armL = armL; this.root.add(armL);
    const armR = new THREE.Mesh(armGeo, limbMat);
    armR.position.set(0.22, 1.25, 0);
    armR.rotation.z = -0.2;
    this.armR = armR; this.root.add(armR);

    // Legs (long, thin)
    const legGeo = new THREE.CylinderGeometry(0.07, 0.06, 1.3, 6);
    const legL = new THREE.Mesh(legGeo, limbMat);
    legL.position.set(-0.1, 0.65, 0);
    this.legL = legL; this.root.add(legL);
    const legR = new THREE.Mesh(legGeo, limbMat);
    legR.position.set(0.1, 0.65, 0);
    this.legR = legR; this.root.add(legR);

    // Faint halo of dread (dim red point light so you feel it nearby)
    this.aura = new THREE.PointLight(0x440000, 0.4, 3.2, 2.0);
    this.aura.position.y = 1.5;
    this.root.add(this.aura);
  }

  get position() {
    return this.root.position;
  }

  setSpawn(x, z) {
    this.root.position.set(x, 0, z);
  }

  // ===== Main update =====
  update(dt) {
    this.globalTimer += dt;
    this.stateTimer += dt;

    // Update blackboard from player adaptive counters (smooth normalization)
    // hidden count: every time player enters locker counts; normalize by +1 => fast curve
    this.bb.hideScore   = Math.min(1, this.player.state.timesHidden / 4);
    this.bb.flashScore  = Math.min(1, this.player.state.flashlightSeconds / 45);
    this.bb.sprintScore = Math.min(1, this.player.state.sprintingSeconds / 18);

    // === Sensing ===
    const sense = this._sense(dt);

    // === State transitions ===
    this._transition(sense);

    // === Execute current state ===
    switch (this.state) {
      case "PATROL":        this._doPatrol(dt); break;
      case "INVESTIGATE":   this._doInvestigate(dt); break;
      case "CHASE":         this._doChase(dt, sense); break;
      case "AMBUSH":        this._doAmbush(dt); break;
      case "SEARCH_HIDING": this._doSearchHiding(dt); break;
      case "STUNNED":       this._doStunned(dt); break;
    }

    // === Animation ===
    this._animate(dt);

    // === Alert level for HUD/audio ===
    const seeing = sense.canSee ? 1 : 0;
    const target = Math.max(
      seeing,
      this.state === "CHASE" ? 1.0 : 0,
      this.state === "AMBUSH" ? 0.8 : 0,
      this.state === "INVESTIGATE" ? 0.5 : 0,
      this.state === "SEARCH_HIDING" ? 0.55 : 0,
      0
    );
    this.alertLevel += (target - this.alertLevel) * Math.min(1, dt * 2.0);

    // === Check catch ===
    const dist = this.root.position.distanceTo(this.player.pos);
    if (!this.player.state.hidden && dist < CATCH_DIST) {
      if (this.onCatch) this.onCatch();
    }
    // If player is hiding AND monster is close AND we witnessed them or we reached SEARCH_HIDING, check locker
    if (this.player.state.hidden && this.player.state.hiddenIn) {
      const hideSpot = this.player.state.hiddenIn;
      const dLocker = this.root.position.distanceTo(new THREE.Vector3(hideSpot.x, 0, hideSpot.z));
      if (dLocker < 1.3 && this.state === "SEARCH_HIDING" && this.bb.witnessedHide) {
        if (this.onCatch) this.onCatch();
      }
    }
  }

  // ===== Sensing =====
  _sense(dt) {
    const mp = this.root.position;
    const pp = this.player.pos;
    const dx = pp.x - mp.x, dz = pp.z - mp.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    // Adaptive modifiers
    const hearMult = 1 + this.bb.sprintScore * 0.8;         // faster reaction to footsteps
    const lightMult = 1 + this.bb.flashScore * 0.9;         // longer light detect range

    let canSee = false;
    let heard = false;
    let lightPinged = false;

    // If player is hidden, sight/hearing effectively off unless monster was chasing close
    if (!this.player.state.hidden) {
      // --- Sight ---
      if (dist < SIGHT_DIST) {
        const forward = new THREE.Vector3(Math.sin(this.lookYaw), 0, Math.cos(this.lookYaw));
        const toP = new THREE.Vector3(dx, 0, dz).normalize();
        const dot = forward.dot(toP);
        const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
        const inFOV = angle < SIGHT_FOV * 0.5;
        if (inFOV && this._hasLineOfSight(mp, pp)) {
          // brighter if flashlight lights player area — easier to spot
          canSee = true;
        }
      }

      // --- Hearing (player noise ping) ---
      const noise = this.player.state.noise; // 0..1 this frame
      if (noise > 0) {
        const hearRadius = HEAR_BASE * hearMult * noise;
        if (dist < hearRadius) {
          heard = true;
          this.bb.lastNoisePos = this.player.state.noisePos.clone();
          this.bb.lastNoiseTime = this.globalTimer;
        }
      }

      // --- Light "ping" ---
      // If flashlight is on AND its cone sweeps towards the monster's area (or away from player in a way monster sees light bouncing)
      if (this.player.state.flashlightOn && !this.player.state.binocularsOn) {
        const lookDir = this.player.getLookDir();
        const toM = new THREE.Vector3().subVectors(mp, pp);
        const dToM = toM.length();
        if (dToM < LIGHT_BASE * lightMult) {
          toM.normalize();
          const align = lookDir.dot(toM);
          // if monster is in front of player (flashlight roughly pointed that way) → ping
          if (align > 0.55) {
            lightPinged = true;
            this.bb.lastLightPingPos = pp.clone();
            this.bb.lastLightPingTime = this.globalTimer;
          }
          // If player is looking AWAY from monster but monster is close — also notice "shine reflecting"
          else if (dToM < 6 && this.player.state.flashlightOn) {
            // subtle ping, weak priority — only if really close
            this.bb.lastLightPingPos = pp.clone();
            this.bb.lastLightPingTime = this.globalTimer;
          }
        }
      }
    } else {
      // Player hidden: witnessed hide only if we recently saw them hide
      // If chase was active and we lost sight very recently (<0.8s), consider we witnessed it
      if (this.state === "CHASE" && this.globalTimer - this.bb.lastSeenTime < 0.8) {
        this.bb.witnessedHide = true;
      }
    }

    if (canSee) {
      this.bb.lastSeenPos = pp.clone();
      this.bb.lastSeenTime = this.globalTimer;
    }

    return { canSee, heard, lightPinged, dist };
  }

  // AABB raycast over blocking colliders
  _hasLineOfSight(from, to) {
    const dx = to.x - from.x, dz = to.z - from.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.001) return true;
    const rayDx = dx / len, rayDz = dz / len;

    for (const c of this.level.colliders) {
      if (!c.blocksVision) continue;
      const t = raySegmentAABB(from.x, from.z, rayDx, rayDz, len, c);
      if (t !== null) return false;
    }
    return true;
  }

  // ===== State transitions =====
  _transition(sense) {
    const timeSinceSeen = this.globalTimer - this.bb.lastSeenTime;
    const timeSinceNoise = this.globalTimer - this.bb.lastNoiseTime;
    const timeSinceLight = this.globalTimer - this.bb.lastLightPingTime;

    // Top priorities
    if (sense.canSee) {
      this._setState("CHASE");
      // growl on re-acquire
      if (this.globalTimer - this.bb.lastGrowl > 4) {
        this.bb.lastGrowl = this.globalTimer;
        Audio.monsterGrowl(0.8);
      }
      return;
    }

    // If player just hid and we witnessed it → SEARCH_HIDING (monster checks lockers)
    if (this.player.state.hidden && this.bb.witnessedHide && this.state !== "SEARCH_HIDING") {
      this._setState("SEARCH_HIDING");
      return;
    }

    // Chase state → investigate last seen if we lost them recently
    if (this.state === "CHASE") {
      if (timeSinceSeen > 3.0) {
        // chase timeout — go investigate or ambush
        if (this.bb.hideScore > 0.35 && Math.random() < 0.35 + this.bb.hideScore * 0.3) {
          this._pickAmbushNear(this.bb.lastSeenPos || this.player.pos);
          this._setState("AMBUSH");
        } else {
          this._setState("INVESTIGATE");
        }
        return;
      }
      return; // stay chasing
    }

    // New light ping → investigate/chase direction
    if (timeSinceLight < 0.3) {
      this._setState("INVESTIGATE");
      this._pathCooldown = 0;
      return;
    }

    // New noise → investigate
    if (timeSinceNoise < 0.3) {
      this._setState("INVESTIGATE");
      this._pathCooldown = 0;
      return;
    }

    // If ambushing, exit when timer elapsed
    if (this.state === "AMBUSH") {
      if (this.globalTimer > this.bb.ambushUntil) {
        this._setState("PATROL");
      }
      return;
    }

    // If searching hiding spots and too much time passed
    if (this.state === "SEARCH_HIDING") {
      if (this.stateTimer > 12 || !this.player.state.hidden) {
        this.bb.witnessedHide = false;
        this._setState("PATROL");
      }
      return;
    }

    // Investigate — transition to patrol once we reached target
    if (this.state === "INVESTIGATE") {
      if (this.stateTimer > 8 || this._atPathEnd()) {
        this._setState("PATROL");
      }
      return;
    }
  }

  _setState(s) {
    if (this.state === s) return;
    this.state = s;
    this.stateTimer = 0;
    this.path = [];
    this.pathIndex = 0;
    this._pathCooldown = 0;
  }

  // ===== State behaviors =====

  _doPatrol(dt) {
    // Walk to a random walkable cell. Pick new target when reached.
    if (!this.bb.patrolTarget || this._atPathEnd()) {
      const cell = this.level.pathfinder.randomWalkable();
      const w = this.level.cellToWorld(cell.cx, cell.cy);
      this.bb.patrolTarget = new THREE.Vector3(w.x, 0, w.z);
      this._setPathTo(this.bb.patrolTarget);
    }
    this._followPath(dt, 1.5);
  }

  _doInvestigate(dt) {
    // Target = latest noise OR last light ping OR last seen
    const timeNoise = this.globalTimer - this.bb.lastNoiseTime;
    const timeLight = this.globalTimer - this.bb.lastLightPingTime;
    const timeSeen = this.globalTimer - this.bb.lastSeenTime;
    let target = this.bb.lastSeenPos;
    let best = timeSeen;
    if (this.bb.lastNoisePos && timeNoise < best) { target = this.bb.lastNoisePos; best = timeNoise; }
    if (this.bb.lastLightPingPos && timeLight < best) { target = this.bb.lastLightPingPos; best = timeLight; }
    if (!target) { this._setState("PATROL"); return; }

    if (!this.path.length || this._pathTarget.distanceTo(target) > 2.5) {
      this._setPathTo(target);
    }
    this._followPath(dt, 2.4);
  }

  _doChase(dt, sense) {
    const target = sense.canSee ? this.player.pos : (this.bb.lastSeenPos || this.player.pos);
    if (!this.path.length || this._pathCooldown <= 0 || this._pathTarget.distanceTo(target) > 2.0) {
      this._setPathTo(target);
      this._pathCooldown = 0.3;
    } else {
      this._pathCooldown -= dt;
    }
    const chaseSpeed = 4.2 + this.bb.sprintScore * 1.2; // adapt faster if player sprints
    this._followPath(dt, chaseSpeed);
  }

  _doAmbush(dt) {
    // Walk to ambush pos, then stand still looking around (shifting lookYaw occasionally)
    if (!this.bb.ambushPos) {
      this._setState("PATROL"); return;
    }
    const d = this.root.position.distanceTo(this.bb.ambushPos);
    if (d > 0.8 && !this._atPathEnd()) {
      if (!this.path.length) this._setPathTo(this.bb.ambushPos);
      this._followPath(dt, 2.2);
    } else {
      // stand still, slowly pan head
      this.vel.set(0, 0, 0);
      this.lookYaw += Math.sin(this.globalTimer * 0.6) * dt * 0.5;
      if (Math.random() < dt * 0.3) {
        Audio.monsterGrowl(0.35);
      }
    }
  }

  _doSearchHiding(dt) {
    // Find nearest locker, path to it
    if (!this.path.length || this._atPathEnd()) {
      // pick nearest UNCHECKED locker (use occupancy as hint if we remember it, otherwise pick closest)
      let best = null, bestD = Infinity;
      for (const spot of this.level.hideSpots) {
        const d = this.root.position.distanceTo(new THREE.Vector3(spot.x, 0, spot.z));
        if (d < bestD) { bestD = d; best = spot; }
      }
      if (best) {
        this._setPathTo(new THREE.Vector3(best.entryX, 0, best.entryZ));
      }
    }
    this._followPath(dt, 2.6 + this.bb.hideScore * 0.8);

    // sporadic growl
    if (Math.random() < dt * 0.25) {
      Audio.monsterGrowl(0.5);
    }
  }

  _doStunned(dt) {
    this.vel.set(0, 0, 0);
    if (this.stateTimer > 2.0) this._setState("PATROL");
  }

  // ===== Path follow =====

  _setPathTo(target) {
    this._pathTarget.copy(target);
    const mp = this.root.position;
    const wp = this.level.pathfinder.findWorld(
      mp.x, mp.z, target.x, target.z,
      this.level.worldToCell, this.level.cellToWorld
    );
    if (!wp || wp.length === 0) {
      this.path = [];
      this.pathIndex = 0;
      return;
    }
    // Skip first (current cell) to avoid backtrack
    this.path = wp.slice(1);
    this.pathIndex = 0;
  }

  _atPathEnd() {
    return !this.path.length || this.pathIndex >= this.path.length;
  }

  _followPath(dt, speed) {
    if (this._atPathEnd()) {
      this.vel.set(0, 0, 0);
      return;
    }
    const wp = this.path[this.pathIndex];
    const mp = this.root.position;
    const dx = wp.x - mp.x, dz = wp.z - mp.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < 0.4) {
      this.pathIndex++;
      return;
    }
    const nx = dx / d, nz = dz / d;
    const vx = nx * speed, vz = nz * speed;
    // Move (no collision step; path stays on walkable cells, but add a little AABB safety)
    const nextX = mp.x + vx * dt;
    const nextZ = mp.z + vz * dt;
    if (!this._collidesWalls(nextX, mp.z)) mp.x = nextX;
    if (!this._collidesWalls(mp.x, nextZ)) mp.z = nextZ;

    // Smooth-rotate to face velocity
    const targetYaw = Math.atan2(nx, nz);
    this.lookYaw = lerpAngle(this.lookYaw, targetYaw, Math.min(1, dt * 6));

    this.vel.set(vx, 0, vz);

    // Footstep sound occasionally
    this._footTimer -= dt;
    if (this._footTimer <= 0) {
      this._footTimer = 0.45 - Math.min(0.2, (speed - 1.5) * 0.05);
      const distToPlayer = this.player.pos.distanceTo(mp);
      const vol = Math.max(0, 1 - distToPlayer / 18);
      if (vol > 0.05) Audio.monsterFootstep(vol * 0.9);
    }
  }

  _pickAmbushNear(pos) {
    // Choose a point a few cells away from `pos` that is still walkable
    const cell = this.level.worldToCell(pos.x, pos.z);
    for (let tries = 0; tries < 30; tries++) {
      const dx = Math.floor(Math.random() * 7 - 3);
      const dy = Math.floor(Math.random() * 7 - 3);
      const cx = cell.cx + dx, cy = cell.cy + dy;
      if (this.level.pathfinder.isWalkable(cx, cy)) {
        const w = this.level.cellToWorld(cx, cy);
        this.bb.ambushPos = new THREE.Vector3(w.x, 0, w.z);
        this.bb.ambushUntil = this.globalTimer + 10 + this.bb.hideScore * 8;
        this._setPathTo(this.bb.ambushPos);
        return;
      }
    }
    this.bb.ambushPos = pos.clone();
    this.bb.ambushUntil = this.globalTimer + 8;
    this._setPathTo(this.bb.ambushPos);
  }

  _collidesWalls(x, z) {
    const r = 0.35;
    for (const c of this.level.colliders) {
      if (!c.blocksVision) continue; // only walls block monster
      if (x + r > c.minX && x - r < c.maxX &&
          z + r > c.minZ && z - r < c.maxZ) return true;
    }
    return false;
  }

  // ===== Animation =====
  _animate(dt) {
    const moving = this.vel.lengthSq() > 0.01;
    if (moving) {
      const speed = this.vel.length();
      this._walkPhase += dt * (speed * 2.2);
    }
    const s = Math.sin(this._walkPhase);
    const c = Math.cos(this._walkPhase);
    // Legs
    if (this.legL) this.legL.rotation.x = s * 0.7;
    if (this.legR) this.legR.rotation.x = -s * 0.7;
    // Arms counter-swing (long dangling)
    if (this.armL) this.armL.rotation.x = -s * 0.5 + 0.2;
    if (this.armR) this.armR.rotation.x = s * 0.5 + 0.2;
    // Head slight bob
    if (this.head) this.head.position.y = 2.3 + Math.abs(c) * 0.03;

    // Root rotation — mesh is built facing +Z (eyes/mouth are at z=+0.18),
    // sense forward vector uses (sin(yaw),0,cos(yaw)), so identity rotation aligns them.
    this.root.rotation.y = this.lookYaw;
  }
}

// --- Utilities ---

function lerpAngle(a, b, t) {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

function raySegmentAABB(ox, oz, dx, dz, maxT, box) {
  // Standard slab test in 2D (XZ plane)
  let tmin = 0;
  let tmax = maxT;
  if (Math.abs(dx) < 1e-8) {
    if (ox < box.minX || ox > box.maxX) return null;
  } else {
    let t1 = (box.minX - ox) / dx;
    let t2 = (box.maxX - ox) / dx;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (Math.abs(dz) < 1e-8) {
    if (oz < box.minZ || oz > box.maxZ) return null;
  } else {
    let t1 = (box.minZ - oz) / dz;
    let t2 = (box.maxZ - oz) / dz;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}
