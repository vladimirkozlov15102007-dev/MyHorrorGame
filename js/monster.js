// Adaptive Monster AI — advanced FSM + blackboard.
//
// States: PATROL, INVESTIGATE, CHASE, AMBUSH, SEARCH_HIDING, STALK, STUNNED.
//
// Blackboard memory:
//   lastSeenPos / lastSeenTime
//   lastNoisePos / lastNoiseTime
//   lastDistractionPos / lastDistractionTime / lastDistractionWasBreak
//   witnessedHide (monster saw player enter a locker)
//   adaptationScores: hideScore, binocScore, sprintScore, distractionScore
//     - hideScore:   how much the player hides in lockers → more locker checks
//     - binocScore:  how often the player stands still using binoculars →
//                    monster more likely to AMBUSH and flank quietly
//     - sprintScore: how often the player sprints → faster chase, longer hear
//     - distractionScore: how often the player throws items → the monster
//                    reduces the time spent investigating a distraction and
//                    occasionally *ignores* small sounds (learns it's a trick)
//
// Senses (light was removed since no flashlight):
//   - Sight: cone in front blocked by walls (AABB raycast)
//   - Hearing: player noise + distraction events from throwable system
//   - Binocular-vulnerability: if player is using binoculars and monster is
//     in front of them → no bonus (they see better). But if player is NOT
//     looking at monster while using binoculars, monster gets a ~20%
//     faster approach when flanking (because player is deaf + slow).
//
// Catch: < CATCH_DIST (1.1m) triggers scream + kill.

import * as THREE from "three";
import { Audio } from "./audio.js";

const SIGHT_DIST = 17;
const SIGHT_FOV = Math.PI * 0.58;   // ~104°
const HEAR_BASE = 12;
const CATCH_DIST = 1.15;
const DISTRACTION_HEAR_RADIUS = 28;

export class Monster {
  constructor(scene, level, player, throwableSystem) {
    this.scene = scene;
    this.level = level;
    this.player = player;
    this.throwables = throwableSystem;

    this.root = new THREE.Group();
    this.root.position.set(level.monsterSpawn.x, 0, level.monsterSpawn.z);
    scene.add(this.root);

    this._buildMesh();

    // Movement / path
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
    this._stateLog = "";

    // Animation
    this._walkPhase = 0;

    // Blackboard
    this.bb = {
      lastSeenPos: null, lastSeenTime: -999,
      lastNoisePos: null, lastNoiseTime: -999,
      lastDistractionPos: null, lastDistractionTime: -999,
      lastDistractionWasBreak: false,
      patrolTarget: null,
      ambushPos: null, ambushUntil: 0,
      lastGrowl: -999,
      witnessedHide: false,
      lastSearchedLocker: null,

      // Adaptation
      hideScore: 0,
      binocScore: 0,
      sprintScore: 0,
      distractionScore: 0,

      // Remember lockers that have been searched in this session
      searchedLockers: new Set(),
    };

    this._footTimer = 0;
    this.alertLevel = 0;

    this.onCatch = null;
  }

  _buildMesh() {
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x050505, roughness: 1.0, metalness: 0.0, emissive: 0x030303
    });
    const limbMat = new THREE.MeshStandardMaterial({
      color: 0x050505, roughness: 1.0, metalness: 0.0
    });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff3030 });
    const mouthMat = new THREE.MeshBasicMaterial({ color: 0x2a0000 });

    // Torso — taller, thinner
    const torso = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.22, 1.3, 10),
      bodyMat
    );
    torso.position.y = 1.75;
    this.root.add(torso);

    // Shoulder hump
    const hump = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 10, 10),
      bodyMat
    );
    hump.scale.set(1.0, 0.6, 0.9);
    hump.position.y = 2.35;
    this.root.add(hump);

    // Neck
    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.1, 0.35, 8),
      bodyMat
    );
    neck.position.y = 2.55;
    this.root.add(neck);

    // Head (elongated)
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 12, 12),
      bodyMat
    );
    head.scale.set(0.75, 1.4, 0.95);
    head.position.y = 2.85;
    head.position.z = 0.05;
    this.root.add(head);
    this.head = head;

    // Glowing eyes (emissive)
    for (const sx of [-0.08, 0.08]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.038, 8, 8), eyeMat);
      eye.position.set(sx, 2.88, 0.22);
      this.root.add(eye);
    }
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.11, 0.06), mouthMat);
    mouth.position.set(0, 2.68, 0.23);
    this.root.add(mouth);

    // Long arms
    const armGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.9, 6);
    const armL = new THREE.Mesh(armGeo, limbMat);
    armL.position.set(-0.24, 1.4, 0);
    armL.rotation.z = 0.15;
    this.armL = armL; this.root.add(armL);
    const armR = new THREE.Mesh(armGeo, limbMat);
    armR.position.set(0.24, 1.4, 0);
    armR.rotation.z = -0.15;
    this.armR = armR; this.root.add(armR);

    // Long fingers on each hand (small cluster)
    for (const sx of [-0.24, 0.24]) {
      for (let i = 0; i < 4; i++) {
        const f = new THREE.Mesh(
          new THREE.CylinderGeometry(0.012, 0.012, 0.28, 4),
          limbMat
        );
        f.position.set(sx + (i - 1.5) * 0.025, 0.35, 0.02);
        this.root.add(f);
      }
    }

    // Long legs
    const legGeo = new THREE.CylinderGeometry(0.07, 0.06, 1.45, 6);
    const legL = new THREE.Mesh(legGeo, limbMat);
    legL.position.set(-0.1, 0.72, 0);
    this.legL = legL; this.root.add(legL);
    const legR = new THREE.Mesh(legGeo, limbMat);
    legR.position.set(0.1, 0.72, 0);
    this.legR = legR; this.root.add(legR);

    // Aura
    this.aura = new THREE.PointLight(0x330000, 0.35, 3.8, 2.0);
    this.aura.position.y = 1.5;
    this.root.add(this.aura);
  }

  get position() { return this.root.position; }

  setSpawn(x, z) {
    this.root.position.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.path = [];
    this.pathIndex = 0;
  }

  reset() {
    this.state = "PATROL"; this.stateTimer = 0;
    this.bb.lastSeenPos = null; this.bb.lastSeenTime = -999;
    this.bb.lastNoisePos = null; this.bb.lastNoiseTime = -999;
    this.bb.lastDistractionPos = null; this.bb.lastDistractionTime = -999;
    this.bb.patrolTarget = null;
    this.bb.ambushPos = null; this.bb.ambushUntil = 0;
    this.bb.witnessedHide = false;
    this.bb.searchedLockers = new Set();
    this.bb.hideScore = 0; this.bb.binocScore = 0;
    this.bb.sprintScore = 0; this.bb.distractionScore = 0;
    this.alertLevel = 0;
  }

  update(dt) {
    this.globalTimer += dt;
    this.stateTimer += dt;

    // Normalize adaptation counters
    this.bb.hideScore        = Math.min(1, this.player.state.timesHidden / 4);
    this.bb.binocScore       = Math.min(1, this.player.state.binocularsSeconds / 30);
    this.bb.sprintScore      = Math.min(1, this.player.state.sprintingSeconds / 18);
    this.bb.distractionScore = Math.min(1, this.player.state.throwsMade / 5);

    // Read distraction events from throwable system
    if (this.throwables) {
      const evs = this.throwables.popDistractions();
      for (const ev of evs) {
        // Distraction heard if within DISTRACTION_HEAR_RADIUS
        const d = this.root.position.distanceTo(ev.pos);
        if (d < DISTRACTION_HEAR_RADIUS) {
          // The monster adapts — if player throws a LOT, monster becomes
          // suspicious and is less likely to fully commit to the noise.
          const trust = 1.0 - this.bb.distractionScore * 0.45;
          if (Math.random() < trust || ev.isBreak) {
            this.bb.lastDistractionPos = ev.pos.clone();
            this.bb.lastDistractionTime = this.globalTimer;
            this.bb.lastDistractionWasBreak = ev.isBreak;
          }
        }
      }
    }

    const sense = this._sense(dt);
    this._transition(sense);

    switch (this.state) {
      case "PATROL":        this._doPatrol(dt); break;
      case "INVESTIGATE":   this._doInvestigate(dt); break;
      case "CHASE":         this._doChase(dt, sense); break;
      case "AMBUSH":        this._doAmbush(dt); break;
      case "STALK":         this._doStalk(dt); break;
      case "SEARCH_HIDING": this._doSearchHiding(dt); break;
      case "STUNNED":       this._doStunned(dt); break;
    }

    this._animate(dt);

    const target = Math.max(
      sense.canSee ? 1 : 0,
      this.state === "CHASE" ? 1.0 : 0,
      this.state === "AMBUSH" ? 0.7 : 0,
      this.state === "STALK" ? 0.6 : 0,
      this.state === "INVESTIGATE" ? 0.5 : 0,
      this.state === "SEARCH_HIDING" ? 0.6 : 0,
      0
    );
    this.alertLevel += (target - this.alertLevel) * Math.min(1, dt * 2.0);

    // Catch player
    const dist = this.root.position.distanceTo(this.player.pos);
    if (!this.player.state.hidden && dist < CATCH_DIST) {
      if (this.onCatch) this.onCatch();
    }
    // Catch in locker if we witnessed hide AND we reach it
    if (this.player.state.hidden && this.player.state.hiddenIn) {
      const hs = this.player.state.hiddenIn;
      const dLocker = this.root.position.distanceTo(new THREE.Vector3(hs.x, 0, hs.z));
      if (dLocker < 1.3 && this.state === "SEARCH_HIDING" && this.bb.witnessedHide) {
        if (this.onCatch) this.onCatch();
      }
    }
  }

  _sense(dt) {
    const mp = this.root.position;
    const pp = this.player.pos;
    const dx = pp.x - mp.x, dz = pp.z - mp.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    const hearMult = 1 + this.bb.sprintScore * 0.9;

    let canSee = false, heard = false;

    if (!this.player.state.hidden && !this.player.state.usingCCTV) {
      // Sight
      if (dist < SIGHT_DIST) {
        const forward = new THREE.Vector3(Math.sin(this.lookYaw), 0, Math.cos(this.lookYaw));
        const toP = new THREE.Vector3(dx, 0, dz).normalize();
        const dot = forward.dot(toP);
        const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
        if (angle < SIGHT_FOV * 0.5 && this._hasLineOfSight(mp, pp)) {
          canSee = true;
        }
      }
      // Hearing
      const noise = this.player.state.noise;
      if (noise > 0) {
        const hearRadius = HEAR_BASE * hearMult * noise;
        if (dist < hearRadius) {
          heard = true;
          this.bb.lastNoisePos = this.player.state.noisePos.clone();
          this.bb.lastNoiseTime = this.globalTimer;
        }
      }
    } else {
      // Hidden or CCTV: detect hide-entry
      if (this.player.state.hidden && this.state === "CHASE"
          && (this.globalTimer - this.bb.lastSeenTime) < 0.9) {
        this.bb.witnessedHide = true;
      }
      // If player is on CCTV still at close range, monster can actually stalk them
      if (this.player.state.usingCCTV && dist < SIGHT_DIST
          && this._hasLineOfSight(mp, pp)) {
        // We "know" the player is at the terminal → slowly stalk.
        this.bb.lastSeenPos = pp.clone();
        this.bb.lastSeenTime = this.globalTimer;
      }
    }

    if (canSee) {
      this.bb.lastSeenPos = pp.clone();
      this.bb.lastSeenTime = this.globalTimer;
    }
    return { canSee, heard, dist };
  }

  _hasLineOfSight(from, to) {
    const dx = to.x - from.x, dz = to.z - from.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.001) return true;
    const rdx = dx / len, rdz = dz / len;
    for (const c of this.level.colliders) {
      if (!c.blocksVision) continue;
      const t = raySegmentAABB(from.x, from.z, rdx, rdz, len, c);
      if (t !== null) return false;
    }
    return true;
  }

  _transition(sense) {
    const tSeen = this.globalTimer - this.bb.lastSeenTime;
    const tNoise = this.globalTimer - this.bb.lastNoiseTime;
    const tDist = this.globalTimer - this.bb.lastDistractionTime;

    // Direct sight → chase
    if (sense.canSee) {
      if (this.state !== "CHASE") {
        if (this.globalTimer - this.bb.lastGrowl > 3.5) {
          Audio.monsterGrowl(0.8);
          this.bb.lastGrowl = this.globalTimer;
        }
      }
      this._setState("CHASE");
      return;
    }

    // Player entered locker and monster witnessed it
    if (this.player.state.hidden && this.bb.witnessedHide && this.state !== "SEARCH_HIDING") {
      this._setState("SEARCH_HIDING");
      return;
    }

    // Player idle on CCTV, monster knows their position → STALK
    if (this.player.state.usingCCTV && tSeen < 3.0
        && this.state !== "CHASE" && this.state !== "AMBUSH") {
      this._setState("STALK");
      return;
    }

    // Distraction recently heard → INVESTIGATE (most important new priority)
    if (tDist < 0.35) {
      this._setState("INVESTIGATE");
      this._pathCooldown = 0;
      return;
    }

    // Chase timeout
    if (this.state === "CHASE") {
      if (tSeen > 3.0) {
        // Decide: AMBUSH if player hides a lot, else INVESTIGATE last seen
        const ambushProb = 0.25 + this.bb.hideScore * 0.4 + this.bb.binocScore * 0.25;
        if (Math.random() < ambushProb) {
          this._pickAmbushNear(this.bb.lastSeenPos || this.player.pos);
          this._setState("AMBUSH");
        } else {
          this._setState("INVESTIGATE");
        }
      }
      return;
    }

    // Noise → INVESTIGATE
    if (tNoise < 0.3) {
      this._setState("INVESTIGATE");
      this._pathCooldown = 0;
      return;
    }

    // AMBUSH timeout
    if (this.state === "AMBUSH") {
      if (this.globalTimer > this.bb.ambushUntil) {
        this._setState("PATROL");
      }
      return;
    }

    // STALK timeout
    if (this.state === "STALK") {
      if (this.stateTimer > 8 || !this.player.state.usingCCTV) {
        this._setState("PATROL");
      }
      return;
    }

    // SEARCH_HIDING — rotate through nearby lockers
    if (this.state === "SEARCH_HIDING") {
      if (!this.player.state.hidden) {
        this.bb.witnessedHide = false;
        this._setState("PATROL");
      } else if (this.stateTimer > 14) {
        // gave up
        this.bb.witnessedHide = false;
        this._setState("PATROL");
      }
      return;
    }

    // INVESTIGATE — end at target
    if (this.state === "INVESTIGATE") {
      // Adapted: if player throws a lot, shorten investigate duration
      const giveUp = 8 - this.bb.distractionScore * 4;
      if (this.stateTimer > giveUp || this._atPathEnd()) {
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

  _doPatrol(dt) {
    if (!this.bb.patrolTarget || this._atPathEnd()) {
      const cell = this.level.pathfinder.randomWalkable();
      const w = this.level.cellToWorld(cell.cx, cell.cy);
      this.bb.patrolTarget = new THREE.Vector3(w.x, 0, w.z);
      this._setPathTo(this.bb.patrolTarget);
    }
    this._followPath(dt, 1.5);
  }

  _doInvestigate(dt) {
    // Most recent cue wins
    const tNoise = this.globalTimer - this.bb.lastNoiseTime;
    const tDist  = this.globalTimer - this.bb.lastDistractionTime;
    const tSeen  = this.globalTimer - this.bb.lastSeenTime;
    let target = null, best = Infinity;
    if (this.bb.lastSeenPos && tSeen < best)       { target = this.bb.lastSeenPos;        best = tSeen; }
    if (this.bb.lastNoisePos && tNoise < best)     { target = this.bb.lastNoisePos;       best = tNoise; }
    if (this.bb.lastDistractionPos && tDist < best) { target = this.bb.lastDistractionPos; best = tDist; }
    if (!target) { this._setState("PATROL"); return; }

    if (!this.path.length || this._pathTarget.distanceTo(target) > 2.5) {
      this._setPathTo(target);
    }
    const speed = 2.4 + this.bb.sprintScore * 0.7;
    this._followPath(dt, speed);

    // Arrived: glance around
    if (this._atPathEnd()) {
      this.vel.set(0, 0, 0);
      this.lookYaw += Math.sin(this.globalTimer * 1.1) * dt * 0.6;
      if (Math.random() < dt * 0.25) Audio.monsterGrowl(0.35);
    }
  }

  _doChase(dt, sense) {
    const target = sense.canSee ? this.player.pos : (this.bb.lastSeenPos || this.player.pos);
    if (!this.path.length || this._pathCooldown <= 0 || this._pathTarget.distanceTo(target) > 1.8) {
      this._setPathTo(target);
      this._pathCooldown = 0.25;
    } else {
      this._pathCooldown -= dt;
    }
    const base = 4.4 + this.bb.sprintScore * 1.4;
    // Flank bonus if player is using binoculars (slow + deaf)
    const flankBonus = this.player.state.binocularsOn ? 0.7 : 0;
    this._followPath(dt, base + flankBonus);
  }

  _doStalk(dt) {
    // Sneak slowly toward the player (who is on CCTV)
    if (!this.path.length || this._atPathEnd()) {
      const t = this.bb.lastSeenPos || this.player.pos;
      // Pick a position slightly behind them
      const approach = new THREE.Vector3(t.x, 0, t.z);
      this._setPathTo(approach);
    }
    this._followPath(dt, 1.3);
  }

  _doAmbush(dt) {
    if (!this.bb.ambushPos) { this._setState("PATROL"); return; }
    const d = this.root.position.distanceTo(this.bb.ambushPos);
    if (d > 0.8 && !this._atPathEnd()) {
      if (!this.path.length) this._setPathTo(this.bb.ambushPos);
      this._followPath(dt, 2.2);
    } else {
      this.vel.set(0, 0, 0);
      this.lookYaw += Math.sin(this.globalTimer * 0.6) * dt * 0.5;
      if (Math.random() < dt * 0.25) Audio.monsterGrowl(0.35);
    }
  }

  _doSearchHiding(dt) {
    // Choose nearest UNSEARCHED locker; otherwise any locker
    if (!this.path.length || this._atPathEnd()) {
      // mark last locker as searched
      if (this.bb.lastSearchedLocker) {
        this.bb.searchedLockers.add(this.bb.lastSearchedLocker);
      }
      let best = null, bestD = Infinity;
      for (const spot of this.level.hideSpots) {
        if (this.bb.searchedLockers.has(spot)) continue;
        const d = this.root.position.distanceTo(new THREE.Vector3(spot.x, 0, spot.z));
        if (d < bestD) { bestD = d; best = spot; }
      }
      if (!best) {
        // all searched → give up
        this.bb.witnessedHide = false;
        this._setState("PATROL");
        return;
      }
      this.bb.lastSearchedLocker = best;
      this._setPathTo(new THREE.Vector3(best.entryX, 0, best.entryZ));
    }
    this._followPath(dt, 2.6 + this.bb.hideScore * 0.8);
    if (Math.random() < dt * 0.25) Audio.monsterGrowl(0.45);
  }

  _doStunned(dt) {
    this.vel.set(0, 0, 0);
    if (this.stateTimer > 2.0) this._setState("PATROL");
  }

  _setPathTo(target) {
    this._pathTarget.copy(target);
    const mp = this.root.position;
    const wp = this.level.pathfinder.findWorld(
      mp.x, mp.z, target.x, target.z,
      this.level.worldToCell, this.level.cellToWorld
    );
    if (!wp || wp.length === 0) {
      this.path = []; this.pathIndex = 0;
      return;
    }
    this.path = wp.slice(1);
    this.pathIndex = 0;
  }

  _atPathEnd() { return !this.path.length || this.pathIndex >= this.path.length; }

  _followPath(dt, speed) {
    if (this._atPathEnd()) { this.vel.set(0, 0, 0); return; }
    const wp = this.path[this.pathIndex];
    const mp = this.root.position;
    const dx = wp.x - mp.x, dz = wp.z - mp.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < 0.4) { this.pathIndex++; return; }
    const nx = dx / d, nz = dz / d;
    const vx = nx * speed, vz = nz * speed;
    const nextX = mp.x + vx * dt;
    const nextZ = mp.z + vz * dt;
    if (!this._collidesWalls(nextX, mp.z)) mp.x = nextX;
    if (!this._collidesWalls(mp.x, nextZ)) mp.z = nextZ;

    const targetYaw = Math.atan2(nx, nz);
    this.lookYaw = lerpAngle(this.lookYaw, targetYaw, Math.min(1, dt * 6));

    this.vel.set(vx, 0, vz);

    // Spatial footstep audio
    this._footTimer -= dt;
    if (this._footTimer <= 0) {
      this._footTimer = 0.45 - Math.min(0.2, (speed - 1.5) * 0.05);
      const distToPlayer = this.player.pos.distanceTo(mp);
      const vol = Math.max(0, 1 - distToPlayer / 20);
      if (vol > 0.03) {
        // simple panning by relative yaw
        const rel = new THREE.Vector3(mp.x - this.player.pos.x, 0, mp.z - this.player.pos.z);
        rel.applyEuler(new THREE.Euler(0, -this.player.yaw, 0, "YXZ"));
        const pan = Math.max(-1, Math.min(1, rel.x / 12));
        Audio.monsterFootstep(vol, pan);
      }
    }
  }

  _pickAmbushNear(pos) {
    const cell = this.level.worldToCell(pos.x, pos.z);
    for (let tries = 0; tries < 40; tries++) {
      const dx = Math.floor(Math.random() * 9 - 4);
      const dy = Math.floor(Math.random() * 9 - 4);
      const cx = cell.cx + dx, cy = cell.cy + dy;
      if (this.level.pathfinder.isWalkable(cx, cy)) {
        const w = this.level.cellToWorld(cx, cy);
        this.bb.ambushPos = new THREE.Vector3(w.x, 0, w.z);
        this.bb.ambushUntil = this.globalTimer + 10 + this.bb.hideScore * 6 + this.bb.binocScore * 4;
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
      if (c.kind === "pallet") continue;
      if (!c.blocksVision && c.kind !== "locker" && c.kind !== "desk"
          && c.kind !== "machine" && c.kind !== "crate" && c.kind !== "cctv"
          && c.kind !== "truck" && c.kind !== "rack" && c.kind !== "container") continue;
      if (x + r > c.minX && x - r < c.maxX &&
          z + r > c.minZ && z - r < c.maxZ) return true;
    }
    return false;
  }

  _animate(dt) {
    const moving = this.vel.lengthSq() > 0.01;
    if (moving) {
      const speed = this.vel.length();
      this._walkPhase += dt * (speed * 2.2);
    }
    const s = Math.sin(this._walkPhase);
    const c = Math.cos(this._walkPhase);
    if (this.legL) this.legL.rotation.x = s * 0.75;
    if (this.legR) this.legR.rotation.x = -s * 0.75;
    if (this.armL) this.armL.rotation.x = -s * 0.55 + 0.12;
    if (this.armR) this.armR.rotation.x = s * 0.55 + 0.12;
    if (this.head) this.head.position.y = 2.85 + Math.abs(c) * 0.04;
    this.root.rotation.y = this.lookYaw;

    // Aura flickers with alert
    if (this.aura) {
      this.aura.intensity = 0.25 + this.alertLevel * 1.2 + Math.random() * 0.05;
      this.aura.color.setHSL(0.0, 1.0, 0.15 + this.alertLevel * 0.25);
    }
  }
}

function lerpAngle(a, b, t) {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

function raySegmentAABB(ox, oz, dx, dz, maxT, box) {
  let tmin = 0, tmax = maxT;
  if (Math.abs(dx) < 1e-8) {
    if (ox < box.minX || ox > box.maxX) return null;
  } else {
    let t1 = (box.minX - ox) / dx, t2 = (box.maxX - ox) / dx;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (Math.abs(dz) < 1e-8) {
    if (oz < box.minZ || oz > box.maxZ) return null;
  } else {
    let t1 = (box.minZ - oz) / dz, t2 = (box.maxZ - oz) / dz;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}
