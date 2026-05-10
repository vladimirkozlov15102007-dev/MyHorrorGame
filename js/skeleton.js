// Archer skeletons — 10 ancient undead warriors with bows.
//
// Each skeleton has:
//   - Anatomically-structured body (skull, ribcage, pelvis, spine,
//     shoulders, arms, legs, bow)
//   - HP: 100
//   - Body-part hitboxes: head (30 dmg), body (20), legs (10)
//   - Glowing eye points
//   - Adaptive AI: patrol, investigate, alert, combat (archer), retreat,
//     flank, ambush, search, group_attack
//   - Group coordination via SkeletonManager (shared blackboard):
//       - radio contact: if one sees the player, squad is alerted
//       - surrounding formation: assign each alerted skeleton a unique
//         angle around the player so they flank instead of clumping
//       - suppression: if player pins them from one angle, some move to
//         flank while others fire to pin
//   - Adaptive tactics (from player stats):
//       - If player hides a lot → skeletons check lockers nearby
//       - If player sprints often → skeletons predict movement (lead shots)
//       - If player is aggressive (many shots) → stay at max distance
//       - If player camps → swap to flanking
//
// Ragdoll: on death, the skeleton falls with per-part motion (body parts
// collapse with velocities influenced by the bullet direction).

import * as THREE from "three";
import { Audio } from "./audio.js";

const MAX_SKELS = 10;
const HP_MAX = 100;
const SIGHT_RANGE = 36;
const SIGHT_FOV = Math.PI * 0.70;
const HEAR_BASE = 18;
const ATTACK_RANGE = 28;
const OPTIMAL_RANGE = 16;    // skeletons prefer to sit here
const RETREAT_HP = 25;
const BODY_RADIUS = 0.45;
const ARROW_SPEED = 28;

// --- Hitbox half-extents (local-space boxes attached to skeleton root) ---
// All expressed relative to root at feet y=0
// Head is around y=1.78, body around 1.35, legs around 0.55
const HITBOX_HEAD = { cy: 1.78, rx: 0.18, ry: 0.22, rz: 0.18, part: "head", damage: 30 };
const HITBOX_BODY = { cy: 1.30, rx: 0.28, ry: 0.40, rz: 0.20, part: "body", damage: 20 };
const HITBOX_LEGS = { cy: 0.50, rx: 0.22, ry: 0.50, rz: 0.20, part: "legs", damage: 10 };

// ==================== SkeletonManager ====================

export class SkeletonManager {
  constructor(scene, level, player, arrowSystem) {
    this.scene = scene;
    this.level = level;
    this.player = player;
    this.arrows = arrowSystem;

    this.skeletons = [];
    this.alive = 0;
    this.totalSpawned = 0;

    // Squad blackboard
    this.bb = {
      playerSeen: false,
      playerSeenTime: -999,
      playerLastKnown: null,
      playerLastHeard: null,
      playerLastHeardTime: -999,
      gunshotPos: null,
      gunshotTime: -999,
      // Adaptive metrics
      hideScore: 0,
      sprintScore: 0,
      aggroScore: 0,
      campScore: 0,
      // For camping detection
      _camBuckets: new Map(), // posKey -> accumulated seconds
      _lastCampReset: 0,
    };
    this._globalT = 0;

    // Callbacks to main/UI
    this.onKilled = null;  // (skel) =>
    this.onArrowHit = null; // (part, dmg) =>
  }

  spawn() {
    const spawns = this._collectSpawnPoints();
    const count = Math.min(MAX_SKELS, spawns.length);
    for (let i = 0; i < count; i++) {
      const s = new Skeleton(this.scene, this.level, this.player, this.arrows, this, i);
      const sp = spawns[i];
      s.setPosition(sp.x, 0, sp.z);
      s.patrolHome = new THREE.Vector3(sp.x, 0, sp.z);
      this.skeletons.push(s);
    }
    this.alive = this.skeletons.length;
    this.totalSpawned = this.skeletons.length;
  }

  _collectSpawnPoints() {
    // Place skeletons across zones. Use the level.pathfinder to ensure walkable.
    const spawns = [];
    const candidates = [
      // Admin corridor
      { cx: 5,  cy: 8 }, { cx: 18, cy: 5 },
      // Main hall (spread)
      { cx: 20, cy: 14 }, { cx: 28, cy: 20 }, { cx: 20, cy: 28 },
      // Warehouse
      { cx: 43, cy: 14 }, { cx: 49, cy: 20 }, { cx: 43, cy: 28 },
      // Vent approach
      { cx: 20, cy: 33 },
      // Outdoor yard
      { cx: 25, cy: 39 },
      // Backup positions
      { cx: 33, cy: 20 }, { cx: 45, cy: 22 }, { cx: 10, cy: 20 },
    ];
    for (const c of candidates) {
      if (this.level.pathfinder.isWalkable(c.cx, c.cy)) {
        const w = this.level.cellToWorld(c.cx, c.cy);
        spawns.push({ x: w.x, z: w.z });
      }
      if (spawns.length >= MAX_SKELS) break;
    }
    return spawns;
  }

  // Raycast from origin in dir, returning { skel, t, part, point } or null
  raycast(origin, dir, maxT = 100) {
    let best = null, bestT = maxT;
    for (const s of this.skeletons) {
      if (s.dead) continue;
      const hit = s.raycast(origin, dir, bestT);
      if (hit && hit.t < bestT) {
        bestT = hit.t;
        best = { skel: s, t: hit.t, part: hit.part, point: hit.point };
      }
    }
    return best;
  }

  applyDamage(skel, dmg, part, point, bulletDir) {
    if (skel.dead) return;
    skel.takeDamage(dmg, part, point, bulletDir);
    if (this.onArrowHit) this.onArrowHit(part, dmg);
    if (skel.dead) {
      this.alive--;
      if (this.onKilled) this.onKilled(skel);
    }
  }

  // Called by weapon.fire() — gunshots alert EVERY skeleton regardless of distance
  onGunshot(pos) {
    this.bb.gunshotPos = pos.clone();
    this.bb.gunshotTime = this._globalT;
    // Mark all skeletons as suspicious; closer ones will transition to combat
    for (const s of this.skeletons) {
      if (s.dead) continue;
      s.onGunshotHeard(pos);
    }
  }

  // Global player-position oracle for group flanking. Returns unique angle
  // around the player for this skeleton index.
  assignFlankAngle(skel) {
    const alive = this.skeletons.filter(s => !s.dead && s.state === "combat");
    if (alive.length === 0) return 0;
    const idx = alive.indexOf(skel);
    return (idx / alive.length) * Math.PI * 2;
  }

  update(dt) {
    this._globalT += dt;

    // Update blackboard adaptation scores from player stats
    this.bb.hideScore   = Math.min(1, this.player.state.timesHidden / 4);
    this.bb.sprintScore = Math.min(1, this.player.state.sprintingSeconds / 20);
    this.bb.aggroScore  = Math.min(1, this.player.state.shotsFired / 20);

    // Camping detection — bucket player position on a 3m grid
    const pKey = `${Math.floor(this.player.pos.x / 3)},${Math.floor(this.player.pos.z / 3)}`;
    this.bb._camBuckets.set(pKey, (this.bb._camBuckets.get(pKey) || 0) + dt);
    if (this._globalT - this.bb._lastCampReset > 10) {
      this.bb._camBuckets = new Map();
      this.bb._lastCampReset = this._globalT;
    }
    let maxBucket = 0;
    for (const v of this.bb._camBuckets.values()) {
      if (v > maxBucket) maxBucket = v;
    }
    this.bb.campScore = Math.min(1, maxBucket / 6);

    // Each skeleton updates
    for (const s of this.skeletons) s.update(dt);

    // Squad-level coordination: share contact info
    // If any skeleton saw the player recently, all get playerLastKnown
    let anySaw = false;
    let newestT = this.bb.playerSeenTime;
    for (const s of this.skeletons) {
      if (s.dead) continue;
      if (s.perc.lastSeenTime > newestT) {
        newestT = s.perc.lastSeenTime;
        this.bb.playerLastKnown = s.perc.lastSeenPos;
        anySaw = true;
      }
    }
    if (newestT > this.bb.playerSeenTime) {
      this.bb.playerSeenTime = newestT;
      this.bb.playerSeen = true;
    }
    // Decay
    if (this._globalT - this.bb.playerSeenTime > 12) {
      this.bb.playerSeen = false;
    }

    // Radio contact — propagate last-known to everyone else
    if (this.bb.playerLastKnown && (this._globalT - this.bb.playerSeenTime < 4)) {
      for (const s of this.skeletons) {
        if (s.dead) continue;
        if (s.perc.lastSeenTime < this.bb.playerSeenTime) {
          s.perc.lastSeenPos = this.bb.playerLastKnown.clone();
          s.perc.lastSeenTime = this.bb.playerSeenTime;
          if (s.state === "patrol") s._transitionTo("alert");
        }
      }
    }
  }

  reset() {
    for (const s of this.skeletons) s.destroy();
    this.skeletons = [];
    this.alive = 0;
    this.totalSpawned = 0;
    this.bb.playerSeen = false;
    this.bb.playerSeenTime = -999;
    this.bb.playerLastKnown = null;
    this.bb.gunshotPos = null;
    this.bb.gunshotTime = -999;
    this._globalT = 0;
  }

  // Is anyone currently engaging?
  anyInCombat() {
    return this.skeletons.some(s => !s.dead && s.state === "combat");
  }
  anyAlerted() {
    return this.skeletons.some(s => !s.dead && (s.state === "combat" || s.state === "alert" || s.state === "flank" || s.state === "group_attack"));
  }
  remaining() { return this.alive; }
}

// ==================== Skeleton ====================

class Skeleton {
  constructor(scene, level, player, arrows, manager, index) {
    this.scene = scene;
    this.level = level;
    this.player = player;
    this.arrows = arrows;
    this.manager = manager;
    this.index = index;

    this.root = new THREE.Group();
    scene.add(this.root);

    this.hp = HP_MAX;
    this.dead = false;
    this.state = "patrol";
    this.stateTimer = 0;
    this.nextShootTime = 0;
    this.yaw = Math.random() * Math.PI * 2;
    this.lookYaw = this.yaw;
    this.vel = new THREE.Vector3();
    this.path = [];
    this.pathIndex = 0;
    this._pathCooldown = 0;
    this._pathTarget = new THREE.Vector3();

    this.walkPhase = Math.random() * Math.PI * 2;
    this.drawPhase = 0;  // bow draw animation 0..1

    // Perception memory
    this.perc = {
      lastSeenPos: null,
      lastSeenTime: -999,
      lastHeardPos: null,
      lastHeardTime: -999,
      alertLevel: 0,
    };

    // Per-skeleton variance (so they don't look identical)
    this.scale = 0.92 + Math.random() * 0.12;
    this.postureLean = (Math.random() - 0.5) * 0.18;
    this.shoulderLean = (Math.random() - 0.5) * 0.12;

    // Combat
    this.reloadBow = 0;     // time until next shot
    this.flankAngle = Math.random() * Math.PI * 2;
    this.targetPos = new THREE.Vector3();

    // Ragdoll parts filled on death
    this.ragdollParts = [];

    // Local look pitch (head tilt toward player)
    this.headPitch = 0;

    this._build();
    this._ensurePatrolTarget();
  }

  // ==================== Build anatomical skeleton ====================
  _build() {
    const boneMat = new THREE.MeshStandardMaterial({
      color: 0xd8cfb8, roughness: 0.88, metalness: 0.02
    });
    const darkBoneMat = new THREE.MeshStandardMaterial({
      color: 0xa89f88, roughness: 0.92, metalness: 0.02
    });
    const ragMat = new THREE.MeshStandardMaterial({
      color: 0x3a2e20, roughness: 0.98, metalness: 0.0, side: THREE.DoubleSide
    });
    const rustyArmor = new THREE.MeshStandardMaterial({
      color: 0x5a3a22, roughness: 0.75, metalness: 0.5
    });
    const bowMat = new THREE.MeshStandardMaterial({
      color: 0x2a1a10, roughness: 0.85, metalness: 0.1
    });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff5a28 });

    const s = this.scale;
    const g = this.root;

    // ---- Pelvis (hip) ----
    const pelvis = new THREE.Mesh(
      new THREE.BoxGeometry(0.28 * s, 0.16 * s, 0.22 * s),
      boneMat
    );
    pelvis.position.set(0, 0.95, 0);
    g.add(pelvis);

    // ---- Spine (segmented vertebrae) ----
    this.spine = new THREE.Group();
    this.spine.position.set(0, 1.05, 0);
    g.add(this.spine);
    for (let i = 0; i < 6; i++) {
      const v = new THREE.Mesh(
        new THREE.CylinderGeometry(0.048 - i * 0.002, 0.05 - i * 0.002, 0.06, 8),
        darkBoneMat
      );
      v.position.y = i * 0.065;
      this.spine.add(v);
    }

    // ---- Ribcage (rib pairs as curved bars) ----
    this.ribcage = new THREE.Group();
    this.ribcage.position.set(0, 1.35, 0);
    g.add(this.ribcage);
    for (let i = 0; i < 7; i++) {
      const yy = (i / 6) * 0.4;
      const rWidth = 0.26 - i * 0.012;
      for (const side of [-1, 1]) {
        const rib = new THREE.Mesh(
          new THREE.TorusGeometry(rWidth * 0.9, 0.014, 4, 10, Math.PI),
          boneMat
        );
        rib.rotation.y = side * (Math.PI / 2);
        rib.rotation.z = side * -0.15;
        rib.position.set(side * 0.02, yy - 0.2, 0);
        this.ribcage.add(rib);
      }
    }
    // Sternum
    const sternum = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.28, 0.04),
      boneMat
    );
    sternum.position.set(0, 0, 0.12);
    this.ribcage.add(sternum);

    // Rusty chest plate fragment
    const chestPlate = new THREE.Mesh(
      new THREE.BoxGeometry(0.4 * s, 0.3 * s, 0.06),
      rustyArmor
    );
    chestPlate.position.set(0, 0, 0.135);
    chestPlate.rotation.x = -0.1;
    this.ribcage.add(chestPlate);

    // Torn cloth rag hanging
    const rag = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5 * s, 0.8 * s),
      ragMat
    );
    rag.position.set(0, -0.2, 0.0);
    this.ribcage.add(rag);
    this.rag = rag;

    // ---- Shoulders ----
    this.shoulderL = new THREE.Group();
    this.shoulderL.position.set(-0.22 * s, 1.72, 0);
    g.add(this.shoulderL);
    this.shoulderR = new THREE.Group();
    this.shoulderR.position.set(0.22 * s, 1.72, 0);
    g.add(this.shoulderR);

    // Clavicles
    for (const sh of [this.shoulderL, this.shoulderR]) {
      const clav = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.02, 0.18, 6),
        boneMat
      );
      clav.rotation.z = Math.PI / 2;
      sh.add(clav);
    }

    // ---- Arms: upper + forearm + hand ----
    this._makeArm(this.shoulderL, -1, boneMat);
    this._makeArm(this.shoulderR,  1, boneMat);

    // ---- Neck + Skull ----
    this.neck = new THREE.Group();
    this.neck.position.set(0, 1.83, 0);
    g.add(this.neck);
    const neckBone = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.05, 0.1, 8), boneMat);
    this.neck.add(neckBone);

    this.head = new THREE.Group();
    this.head.position.y = 0.18;
    this.neck.add(this.head);

    // Skull — slightly squashed sphere
    const skull = new THREE.Mesh(
      new THREE.SphereGeometry(0.17, 16, 14),
      boneMat
    );
    skull.scale.set(1.0, 1.1, 1.05);
    this.head.add(skull);

    // Jaw
    const jaw = new THREE.Mesh(
      new THREE.BoxGeometry(0.17, 0.08, 0.16),
      darkBoneMat
    );
    jaw.position.set(0, -0.12, 0.04);
    this.head.add(jaw);

    // Eye sockets (dark spheres with emissive dots inside)
    for (const sx of [-0.055, 0.055]) {
      const socket = new THREE.Mesh(
        new THREE.SphereGeometry(0.035, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 1 })
      );
      socket.position.set(sx, 0.04, 0.14);
      this.head.add(socket);
      // glowing eye orb
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.022, 8, 8),
        eyeMat
      );
      eye.position.set(sx, 0.04, 0.155);
      this.head.add(eye);
    }

    // Glowing eye light
    this.eyeGlow = new THREE.PointLight(0xff5a28, 0.35, 2.2, 2.0);
    this.eyeGlow.position.set(0, 0.04, 0.18);
    this.head.add(this.eyeGlow);

    // Nasal cavity / teeth hints
    const nose = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.04, 0.04),
      new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 1 })
    );
    nose.position.set(0, -0.02, 0.17);
    this.head.add(nose);

    // ---- Legs ----
    this._makeLeg(-1, boneMat, darkBoneMat);
    this._makeLeg( 1, boneMat, darkBoneMat);

    // ---- Bow (held in left hand) ----
    this.bow = new THREE.Group();
    this.bow.position.set(-0.05, 0.35, 0.18);
    this.shoulderL.add(this.bow);
    // Bow body (curved)
    const bowArc = new THREE.Mesh(
      new THREE.TorusGeometry(0.5, 0.012, 4, 16, Math.PI * 0.95),
      bowMat
    );
    bowArc.rotation.z = Math.PI / 2;
    this.bow.add(bowArc);
    // Bowstring
    const stringGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, -0.48, 0),
      new THREE.Vector3(0, 0.48, 0),
    ]);
    this.bowstring = new THREE.Line(stringGeo,
      new THREE.LineBasicMaterial({ color: 0xdddddd })
    );
    this.bow.add(this.bowstring);

    // ---- Apply posture variance ----
    g.position.y = 0;
    g.rotation.y = this.yaw;
    this.spine.rotation.x = this.postureLean;
    this.ribcage.rotation.x = this.postureLean * 0.3;
    this.shoulderL.position.y += this.shoulderLean * 0.05;
    this.shoulderR.position.y -= this.shoulderLean * 0.05;
  }

  _makeArm(parent, side, boneMat) {
    // Upper arm
    const upper = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.03, 0.34, 8),
      boneMat
    );
    upper.position.y = -0.17;
    parent.add(upper);
    // Elbow joint + forearm
    const elbow = new THREE.Group();
    elbow.position.y = -0.34;
    parent.add(elbow);
    const forearm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.024, 0.028, 0.32, 8),
      boneMat
    );
    forearm.position.y = -0.16;
    elbow.add(forearm);
    // Hand (small bone cluster)
    const hand = new THREE.Group();
    hand.position.y = -0.32;
    elbow.add(hand);
    const palm = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.05, 0.04),
      boneMat
    );
    hand.add(palm);
    // 4 fingers
    for (let i = 0; i < 4; i++) {
      const f = new THREE.Mesh(
        new THREE.CylinderGeometry(0.007, 0.007, 0.08, 5),
        boneMat
      );
      f.position.set((i - 1.5) * 0.015, -0.05, 0.02);
      hand.add(f);
    }
    // Give slight outward angle so arm silhouette is readable
    parent.rotation.z = side * -0.06;

    if (side === -1) { this.armL = { shoulder: parent, elbow, hand }; }
    else             { this.armR = { shoulder: parent, elbow, hand }; }
  }

  _makeLeg(side, boneMat, darkBoneMat) {
    const g = new THREE.Group();
    g.position.set(side * 0.1, 0.92, 0);
    this.root.add(g);
    // Thigh
    const thigh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.038, 0.46, 8),
      boneMat
    );
    thigh.position.y = -0.23;
    g.add(thigh);
    // Knee
    const knee = new THREE.Group();
    knee.position.y = -0.46;
    g.add(knee);
    const shin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.032, 0.036, 0.42, 8),
      darkBoneMat
    );
    shin.position.y = -0.21;
    knee.add(shin);
    // Foot
    const foot = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.06, 0.18),
      darkBoneMat
    );
    foot.position.set(0, -0.45, 0.04);
    knee.add(foot);

    if (side === -1) this.legL = { hip: g, knee };
    else this.legR = { hip: g, knee };
  }

  // ==================== Position / utils ====================
  setPosition(x, y, z) {
    this.root.position.set(x, y, z);
  }

  get position() { return this.root.position; }

  destroy() {
    this.scene.remove(this.root);
    if (this._corpseGroup) this.scene.remove(this._corpseGroup);
  }

  // ==================== Hitbox raycast ====================
  // Returns {t, part, point} or null for closest hit
  raycast(origin, dir, maxT) {
    if (this.dead) return null;
    const rp = this.root.position;
    let best = null, bestT = maxT;
    for (const hb of [HITBOX_HEAD, HITBOX_BODY, HITBOX_LEGS]) {
      const box = {
        minX: rp.x - hb.rx, maxX: rp.x + hb.rx,
        minY: rp.y + hb.cy - hb.ry, maxY: rp.y + hb.cy + hb.ry,
        minZ: rp.z - hb.rz, maxZ: rp.z + hb.rz,
      };
      const t = rayAABB3(origin, dir, box);
      if (t !== null && t < bestT) {
        bestT = t;
        best = {
          t,
          part: hb.part,
          point: new THREE.Vector3(
            origin.x + dir.x * t,
            origin.y + dir.y * t,
            origin.z + dir.z * t
          ),
        };
      }
    }
    return best;
  }

  // ==================== Damage / death ====================
  takeDamage(dmg, part, point, bulletDir) {
    if (this.dead) return;
    this.hp -= dmg;
    Audio.skeletonBoneHit(Math.min(1, dmg / 30));
    // Stagger
    if (dmg >= 20) this._stagger = 0.25;
    // Low HP → retreat
    if (this.hp <= RETREAT_HP && this.state !== "retreat") {
      this._transitionTo("retreat");
    }
    // Being shot is strong perception — they know where player is
    this.perc.lastSeenPos = this.player.pos.clone();
    this.perc.lastSeenTime = this.manager._globalT;
    if (this.state === "patrol" || this.state === "investigate") {
      this._transitionTo("alert");
    }
    if (this.hp <= 0) this._die(bulletDir, point);
  }

  _die(bulletDir, impactPoint) {
    this.dead = true;
    Audio.skeletonDeath();
    // Build a "corpse" group by detaching all mesh children into a ragdoll
    // We create a simpler collapsed pile for performance (14 primitive bones).
    this._corpseGroup = new THREE.Group();
    this._corpseGroup.position.copy(this.root.position);
    this.scene.add(this._corpseGroup);
    this.scene.remove(this.root);

    // Scatter 10 bone pieces with velocities influenced by bullet direction
    const boneMat = new THREE.MeshStandardMaterial({
      color: 0xc8c0a8, roughness: 0.9
    });
    const pieces = [
      { g: new THREE.BoxGeometry(0.08, 0.18, 0.08), y: 1.7 },
      { g: new THREE.SphereGeometry(0.15, 10, 8),    y: 1.85 },  // skull
      { g: new THREE.BoxGeometry(0.3, 0.32, 0.2),    y: 1.35 },  // ribcage lump
      { g: new THREE.CylinderGeometry(0.03, 0.03, 0.35, 8), y: 1.55 },
      { g: new THREE.CylinderGeometry(0.03, 0.03, 0.35, 8), y: 1.55 },
      { g: new THREE.CylinderGeometry(0.04, 0.04, 0.5, 8),  y: 0.7 },
      { g: new THREE.CylinderGeometry(0.04, 0.04, 0.5, 8),  y: 0.7 },
      { g: new THREE.CylinderGeometry(0.036, 0.036, 0.45, 8), y: 0.3 },
      { g: new THREE.CylinderGeometry(0.036, 0.036, 0.45, 8), y: 0.3 },
      { g: new THREE.BoxGeometry(0.28, 0.16, 0.22),  y: 0.95 },
    ];
    for (const p of pieces) {
      const m = new THREE.Mesh(p.g, boneMat);
      m.position.set(
        (Math.random() - 0.5) * 0.3,
        p.y,
        (Math.random() - 0.5) * 0.3
      );
      m.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      this._corpseGroup.add(m);
    }
    // Initial ragdoll velocities (children fall under gravity)
    this._ragdoll = this._corpseGroup.children.map((m) => ({
      mesh: m,
      vel: new THREE.Vector3(
        (Math.random() - 0.5) * 1.5 + (bulletDir ? bulletDir.x * 2 : 0),
        Math.random() * 2.5 + 1.2,
        (Math.random() - 0.5) * 1.5 + (bulletDir ? bulletDir.z * 2 : 0)
      ),
      angvel: new THREE.Vector3(
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 8
      ),
      life: 10.0,
    }));
  }

  onGunshotHeard(pos) {
    if (this.dead) return;
    // Loud regardless of distance
    this.perc.lastHeardPos = pos.clone();
    this.perc.lastHeardTime = this.manager._globalT;
    if (this.state === "patrol") this._transitionTo("alert");
    else if (this.state === "alert" || this.state === "investigate") {
      // strengthen alert
      this.perc.alertLevel = Math.min(1, this.perc.alertLevel + 0.5);
    }
  }

  // ==================== Update ====================
  update(dt) {
    if (this.dead) {
      this._updateRagdoll(dt);
      return;
    }
    this.stateTimer += dt;

    // Perception
    this._sense(dt);

    // State machine transitions
    this._stateDecide();

    // State actions
    switch (this.state) {
      case "patrol":       this._doPatrol(dt); break;
      case "investigate":  this._doInvestigate(dt); break;
      case "alert":        this._doAlert(dt); break;
      case "combat":       this._doCombat(dt); break;
      case "flank":        this._doFlank(dt); break;
      case "retreat":      this._doRetreat(dt); break;
      case "ambush":       this._doAmbush(dt); break;
      case "search":       this._doSearch(dt); break;
    }

    // Animations
    this._animate(dt);

    // Eye glow pulses with alert
    if (this.eyeGlow) {
      const t = this.perc.alertLevel;
      this.eyeGlow.intensity = 0.35 + t * 0.8 + Math.random() * 0.05;
    }
  }

  _sense(dt) {
    const rp = this.root.position;
    const pp = this.player.pos;
    const dx = pp.x - rp.x, dz = pp.z - rp.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    // Decay alert
    this.perc.alertLevel = Math.max(0, this.perc.alertLevel - dt * 0.1);

    if (this.player.state.hidden || this.player.state.dead) return;

    let canSee = false;
    if (dist < SIGHT_RANGE) {
      // FOV
      const toP = new THREE.Vector3(dx, 0, dz).normalize();
      const fwd = new THREE.Vector3(Math.sin(this.lookYaw), 0, Math.cos(this.lookYaw));
      const dot = Math.max(-1, Math.min(1, fwd.dot(toP)));
      const angle = Math.acos(dot);
      if (angle < SIGHT_FOV * 0.5 && this._hasLineOfSight(rp, pp)) {
        canSee = true;
      }
    }

    // Hearing — scales with sprint score of player
    const hearMul = 1 + this.manager.bb.sprintScore * 0.6;
    if (this.player.state.noise > 0) {
      const r = HEAR_BASE * hearMul * this.player.state.noise;
      if (dist < r) {
        this.perc.lastHeardPos = this.player.state.noisePos.clone();
        this.perc.lastHeardTime = this.manager._globalT;
      }
    }

    if (canSee) {
      this.perc.lastSeenPos = pp.clone();
      this.perc.lastSeenTime = this.manager._globalT;
      this.perc.alertLevel = Math.min(1, this.perc.alertLevel + dt * 2.0);
    }

    // Also: gunshot contact resets to alert from the manager (onGunshotHeard)
  }

  _hasLineOfSight(from, to) {
    const dx = to.x - from.x, dz = to.z - from.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.001) return true;
    const rdx = dx / len, rdz = dz / len;
    // Ray from eye level (~1.8m) toward player eye level
    const eyeY = 1.72;
    for (const c of this.level.colliders) {
      if (!c.blocksVision) continue;
      if (c.kind === "truck") continue;
      const t = raySegmentAABB_XZ(from.x, from.z, rdx, rdz, len, c);
      if (t !== null) return false;
    }
    return true;
  }

  _stateDecide() {
    const gt = this.manager._globalT;
    const tSeen = gt - this.perc.lastSeenTime;
    const tHeard = gt - this.perc.lastHeardTime;

    if (this.hp <= RETREAT_HP && this.state !== "retreat") {
      this._transitionTo("retreat");
      return;
    }

    // See player → combat
    if (tSeen < 0.5) {
      // Choose combat or flank based on adaptation
      const wantFlank = this.manager.bb.campScore > 0.55
        || this.manager.bb.sprintScore > 0.6;
      // Spread skeletons: one or two become flankers, others combat
      if (wantFlank && this.index % 3 === 0 && this.state !== "combat") {
        this._transitionTo("flank");
      } else {
        this._transitionTo("combat");
      }
      return;
    }

    // Retreat end condition
    if (this.state === "retreat") {
      if (this.stateTimer > 5 && this.hp > RETREAT_HP + 10) {
        this._transitionTo("alert");
      }
      return;
    }

    // Recently lost sight → alert
    if (tSeen < 6) {
      if (this.state === "combat" || this.state === "flank") {
        // keep pressing
        if (this.state === "combat" && this.stateTimer > 3) {
          // occasionally try flank if player went hidden a lot
          if (this.manager.bb.hideScore > 0.5 && Math.random() < 0.3) {
            this._transitionTo("search");
          }
        }
        return;
      }
      this._transitionTo("alert");
      return;
    }

    // Heard something → investigate
    if (tHeard < 4) {
      if (this.state !== "investigate" && this.state !== "combat") {
        this._transitionTo("investigate");
      }
      return;
    }

    // Search mode end condition
    if (this.state === "search") {
      if (this.stateTimer > 12) this._transitionTo("patrol");
      return;
    }

    // Alert timeout → investigate last known → then patrol
    if (this.state === "alert") {
      if (this.stateTimer > 4) {
        this._transitionTo("investigate");
      }
      return;
    }

    // Investigate end
    if (this.state === "investigate") {
      const giveUp = 8;
      if (this.stateTimer > giveUp || this._atPathEnd()) {
        this._transitionTo("patrol");
      }
      return;
    }
  }

  _transitionTo(s) {
    if (this.state === s) return;
    // Optional: groan/shriek on transition
    if ((s === "combat" || s === "alert") && (this.state === "patrol" || this.state === "investigate")) {
      if (Math.random() < 0.35) Audio.skeletonShriek();
    }
    this.state = s;
    this.stateTimer = 0;
    this.path = []; this.pathIndex = 0;
  }

  // ==================== State behaviors ====================
  _ensurePatrolTarget() {
    if (!this.patrolHome) {
      this.patrolHome = this.root.position.clone();
    }
  }

  _doPatrol(dt) {
    if (!this.path.length || this._atPathEnd()) {
      // Pick a random cell within 8 cells of patrolHome
      const home = this.level.worldToCell(this.patrolHome.x, this.patrolHome.z);
      for (let tries = 0; tries < 20; tries++) {
        const cx = home.cx + Math.floor(Math.random() * 11 - 5);
        const cy = home.cy + Math.floor(Math.random() * 11 - 5);
        if (this.level.pathfinder.isWalkable(cx, cy)) {
          const w = this.level.cellToWorld(cx, cy);
          this._setPathTo(new THREE.Vector3(w.x, 0, w.z));
          break;
        }
      }
    }
    this._followPath(dt, 1.5);
  }

  _doInvestigate(dt) {
    const target = this.perc.lastSeenPos || this.perc.lastHeardPos
      || this.manager.bb.gunshotPos;
    if (!target) { this._transitionTo("patrol"); return; }
    if (!this.path.length || this._pathTarget.distanceTo(target) > 2) {
      this._setPathTo(target);
    }
    this._followPath(dt, 2.5);
    if (this._atPathEnd()) {
      // Look around
      this.lookYaw += Math.sin(this.manager._globalT * 1.2 + this.index) * dt * 0.8;
    }
  }

  _doAlert(dt) {
    // Crouch slightly, scan around the last-known position
    const target = this.perc.lastSeenPos || this.perc.lastHeardPos;
    if (target) {
      const d = this.root.position.distanceTo(target);
      if (d > 8) {
        if (!this.path.length) this._setPathTo(target);
        this._followPath(dt, 2.0);
      } else {
        this.vel.set(0, 0, 0);
        this.lookYaw += Math.sin(this.manager._globalT * 1.1 + this.index) * dt * 0.9;
      }
    }
  }

  _doCombat(dt) {
    // Maintain optimal range; rotate around player
    const pp = this.player.pos;
    const rp = this.root.position;
    const dx = rp.x - pp.x, dz = rp.z - pp.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    // Target angle = player.yaw + offset based on index (surround)
    const aliveAttackers = this.manager.skeletons.filter(s => !s.dead && (s.state === "combat" || s.state === "flank"));
    const idx = aliveAttackers.indexOf(this);
    const ang = (idx / Math.max(1, aliveAttackers.length)) * Math.PI * 2;
    const r = OPTIMAL_RANGE;
    const tx = pp.x + Math.sin(ang) * r;
    const tz = pp.z + Math.cos(ang) * r;

    // Shift target slightly toward walkable cells
    const target = new THREE.Vector3(tx, 0, tz);

    if (!this.path.length || this._pathCooldown <= 0
        || this._pathTarget.distanceTo(target) > 3.5) {
      this._setPathTo(target);
      this._pathCooldown = 0.8;
    } else {
      this._pathCooldown -= dt;
    }

    // Move if we're far from optimal, else hold
    if (dist > r + 4) {
      this._followPath(dt, 2.8);
    } else if (dist < r - 5) {
      // too close — back away
      this._setPathTo(new THREE.Vector3(
        rp.x + (rp.x - pp.x) * 0.4,
        0,
        rp.z + (rp.z - pp.z) * 0.4
      ));
      this._followPath(dt, 2.6);
    } else {
      // Strafe while shooting
      this.vel.multiplyScalar(0.5);
      this._followPath(dt, 1.6);
    }

    // Face player & shoot
    const faceYaw = Math.atan2(-dx, -dz);
    this.lookYaw = lerpAngle(this.lookYaw, faceYaw, Math.min(1, dt * 6));

    // Head pitch toward player eye height
    const eyeY = this.root.position.y + 1.82;
    const dy = (this.player.pos.y - eyeY);
    this.headPitch = Math.max(-0.5, Math.min(0.5, dy / dist));

    // Shooting
    const hasLOS = this._hasLineOfSight(
      new THREE.Vector3(rp.x, rp.y + 1.75, rp.z),
      new THREE.Vector3(pp.x, pp.y, pp.z)
    );

    this.reloadBow -= dt;
    // Bow draw animation follows reloadBow: when reloadBow in [0..0.8s], draw
    if (this.reloadBow < 0.9) this.drawPhase = Math.min(1, (0.9 - this.reloadBow) / 0.9);
    else this.drawPhase = Math.max(0, this.drawPhase - dt * 3);

    if (this.reloadBow <= 0 && hasLOS && dist < ATTACK_RANGE) {
      this._fireArrow();
      // Fire interval shortens when aggro is low (player passive) and
      // lengthens when aggressive (skeleton stays defensive)
      const fireDelay = 1.8 + this.manager.bb.aggroScore * 1.0
        - this.manager.bb.campScore * 0.3
        + Math.random() * 0.6;
      this.reloadBow = Math.max(0.8, fireDelay);
    }
  }

  _doFlank(dt) {
    // Move to a 90-135° offset from player facing, then transition to combat
    const pp = this.player.pos;
    const r = OPTIMAL_RANGE;
    const offset = (this.index % 2 === 0 ? 1 : -1) * (Math.PI * 0.6);
    const ang = this.player.yaw + offset + Math.PI;  // behind/flank
    const tx = pp.x + Math.sin(ang) * r;
    const tz = pp.z + Math.cos(ang) * r;
    const target = new THREE.Vector3(tx, 0, tz);

    if (!this.path.length || this._pathTarget.distanceTo(target) > 3) {
      this._setPathTo(target);
    }
    this._followPath(dt, 3.2);

    // After flanking distance reached or timed out → combat
    if (this.stateTimer > 6 || this.root.position.distanceTo(target) < 3) {
      this._transitionTo("combat");
    }
  }

  _doRetreat(dt) {
    // Move away from the player
    const pp = this.player.pos;
    const rp = this.root.position;
    const dx = rp.x - pp.x, dz = rp.z - pp.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 0.01) return;
    const target = new THREE.Vector3(
      rp.x + (dx / dist) * 18,
      0,
      rp.z + (dz / dist) * 18
    );
    // Clamp to walkable
    const cell = this.level.worldToCell(target.x, target.z);
    if (!this.level.pathfinder.isWalkable(cell.cx, cell.cy)) {
      const near = this.level.pathfinder.randomWalkable();
      const w = this.level.cellToWorld(near.cx, near.cy);
      target.set(w.x, 0, w.z);
    }
    if (!this.path.length || this.stateTimer % 2 < dt) {
      this._setPathTo(target);
    }
    this._followPath(dt, 3.6);
  }

  _doAmbush(dt) {
    // Sit still and peek toward last-known
    this.vel.set(0, 0, 0);
    const target = this.perc.lastSeenPos;
    if (target) {
      const dx = target.x - this.root.position.x;
      const dz = target.z - this.root.position.z;
      const want = Math.atan2(dx, dz);
      this.lookYaw = lerpAngle(this.lookYaw, want, Math.min(1, dt * 2));
    }
  }

  _doSearch(dt) {
    // Check a nearby locker the player might be in
    if (!this.path.length || this._atPathEnd()) {
      if (this.level.hideSpots && this.level.hideSpots.length) {
        let best = null, bestD = Infinity;
        for (const sp of this.level.hideSpots) {
          const d = this.root.position.distanceTo(new THREE.Vector3(sp.x, 0, sp.z));
          if (d < bestD) { bestD = d; best = sp; }
        }
        if (best) this._setPathTo(new THREE.Vector3(best.entryX, 0, best.entryZ));
      }
    }
    this._followPath(dt, 2.5);
  }

  _fireArrow() {
    // Spawn at bow position (left shoulder + offset)
    const bowWorld = new THREE.Vector3();
    this.bow.getWorldPosition(bowWorld);
    bowWorld.y += 0.2;

    const pp = this.player.pos.clone();
    // Lead target if player is sprinting (adaptation)
    if (this.manager.bb.sprintScore > 0.5 && this.player.vel.lengthSq() > 2) {
      const flightTime = bowWorld.distanceTo(pp) / ARROW_SPEED;
      pp.x += this.player.vel.x * flightTime * 0.6;
      pp.z += this.player.vel.z * flightTime * 0.6;
    }

    // Aim with small accuracy wiggle depending on distance
    const dir = new THREE.Vector3().subVectors(pp, bowWorld);
    const dist = dir.length();
    dir.normalize();
    // Inaccuracy scales with distance
    const inacc = 0.02 + dist * 0.002;
    dir.x += (Math.random() - 0.5) * inacc;
    dir.y += (Math.random() - 0.5) * inacc * 0.5;
    dir.z += (Math.random() - 0.5) * inacc;
    dir.normalize();

    // Give the arrow a gravity pre-compensation (ballistic)
    const flightTime = dist / ARROW_SPEED;
    dir.y += 0.5 * 6 * flightTime / ARROW_SPEED;  // tiny lob
    dir.normalize();

    const vel = dir.clone().multiplyScalar(ARROW_SPEED);
    this.arrows.spawn(bowWorld, vel, this);
    Audio.bowRelease();
  }

  // ==================== Movement utilities ====================
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
    if (d < 0.45) { this.pathIndex++; return; }
    const nx = dx / d, nz = dz / d;
    const vx = nx * speed, vz = nz * speed;
    const nextX = mp.x + vx * dt;
    const nextZ = mp.z + vz * dt;
    if (!this._collidesWalls(nextX, mp.z)) mp.x = nextX;
    if (!this._collidesWalls(mp.x, nextZ)) mp.z = nextZ;

    // Face movement direction softly (but not in combat — that one faces player)
    if (this.state !== "combat") {
      const targetYaw = Math.atan2(nx, nz);
      this.lookYaw = lerpAngle(this.lookYaw, targetYaw, Math.min(1, dt * 6));
    }
    this.vel.set(vx, 0, vz);
  }

  _collidesWalls(x, z) {
    const r = BODY_RADIUS;
    for (const c of this.level.colliders) {
      if (c.kind === "pallet" || c.kind === "fence") continue;
      if (x + r > c.minX && x - r < c.maxX &&
          z + r > c.minZ && z - r < c.maxZ) return true;
    }
    return false;
  }

  // ==================== Animation ====================
  _animate(dt) {
    const moving = this.vel.lengthSq() > 0.05;
    if (moving) {
      const speed = this.vel.length();
      this.walkPhase += dt * (speed * 2.1 + 1.2);
    }
    const s = Math.sin(this.walkPhase);
    const c = Math.cos(this.walkPhase);

    if (this.legL && this.legR) {
      this.legL.hip.rotation.x = s * 0.7;
      this.legR.hip.rotation.x = -s * 0.7;
      this.legL.knee.rotation.x = Math.max(0, -s * 0.9);
      this.legR.knee.rotation.x = Math.max(0, s * 0.9);
    }
    if (this.armL && this.armR) {
      // Default arm swing (opposing legs); but if in combat, right arm draws bowstring
      this.armL.shoulder.rotation.x = -s * 0.5 + 0.1;
      this.armR.shoulder.rotation.x =  s * 0.5 + 0.1;

      if (this.state === "combat" && this.drawPhase > 0) {
        // Right arm draws the string back (rotation x more negative + y-rotate)
        this.armR.shoulder.rotation.x = -0.6 - this.drawPhase * 0.5;
        this.armR.shoulder.rotation.y = -0.3 - this.drawPhase * 0.3;
        this.armR.elbow.rotation.x = 1.3 + this.drawPhase * 0.6;

        // Left arm holds bow out
        this.armL.shoulder.rotation.x = -1.1;
        this.armL.shoulder.rotation.y = 0.1;
        this.armL.elbow.rotation.x = 0.2;

        // Bowstring "draw"
        if (this.bowstring) {
          // shift string geometry — replace with short horizontal offset via scale
          this.bowstring.position.x = this.drawPhase * -0.12;
        }
      } else if (this.bowstring) {
        this.bowstring.position.x = 0;
      }
    }
    // Ribcage bob + rag sway
    if (this.ribcage) {
      this.ribcage.rotation.z = s * 0.04;
    }
    if (this.rag) {
      this.rag.rotation.z = s * 0.08;
    }
    // Head pitch
    if (this.head) {
      this.head.rotation.x = this.headPitch;
    }
    // Root rotation
    this.root.rotation.y = this.lookYaw;

    // Gentle breathing
    const breathe = Math.sin(this.manager._globalT * 1.5 + this.index) * 0.015;
    if (this.ribcage) this.ribcage.position.y = 1.35 + breathe;
  }

  // ==================== Ragdoll ====================
  _updateRagdoll(dt) {
    if (!this._ragdoll) return;
    for (const p of this._ragdoll) {
      p.life -= dt;
      p.vel.y -= 18 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.rotation.x += p.angvel.x * dt;
      p.mesh.rotation.y += p.angvel.y * dt;
      p.mesh.rotation.z += p.angvel.z * dt;
      if (p.mesh.position.y <= 0.06) {
        p.mesh.position.y = 0.06;
        if (Math.abs(p.vel.y) > 0.3) {
          p.vel.y = -p.vel.y * 0.2;
          p.vel.x *= 0.55; p.vel.z *= 0.55;
          p.angvel.multiplyScalar(0.6);
          if (Math.abs(p.vel.y) > 1.2 && Math.random() < 0.3) {
            Audio.boneRattle();
          }
        } else {
          p.vel.set(0, 0, 0);
          p.angvel.multiplyScalar(0.92);
        }
      }
    }
  }
}

// ==================== Math helpers ====================
function lerpAngle(a, b, t) {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

function rayAABB3(origin, dir, box) {
  let tmin = 0, tmax = Infinity;
  // X
  if (Math.abs(dir.x) < 1e-8) {
    if (origin.x < box.minX || origin.x > box.maxX) return null;
  } else {
    let t1 = (box.minX - origin.x) / dir.x;
    let t2 = (box.maxX - origin.x) / dir.x;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  // Y
  if (Math.abs(dir.y) < 1e-8) {
    if (origin.y < box.minY || origin.y > box.maxY) return null;
  } else {
    let t1 = (box.minY - origin.y) / dir.y;
    let t2 = (box.maxY - origin.y) / dir.y;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  // Z
  if (Math.abs(dir.z) < 1e-8) {
    if (origin.z < box.minZ || origin.z > box.maxZ) return null;
  } else {
    let t1 = (box.minZ - origin.z) / dir.z;
    let t2 = (box.maxZ - origin.z) / dir.z;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin > 0 ? tmin : null;
}

function raySegmentAABB_XZ(ox, oz, dx, dz, maxT, box) {
  let tmin = 0, tmax = maxT;
  if (Math.abs(dx) < 1e-8) {
    if (ox < box.minX || ox > box.maxX) return null;
  } else {
    let t1 = (box.minX - ox) / dx, t2 = (box.maxX - ox) / dx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (Math.abs(dz) < 1e-8) {
    if (oz < box.minZ || oz > box.maxZ) return null;
  } else {
    let t1 = (box.minZ - oz) / dz, t2 = (box.maxZ - oz) / dz;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}
