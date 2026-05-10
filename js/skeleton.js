// Skeleton archer — realistic humanoid skeleton, bow + arrows.
//
// Each skeleton has:
//   * 100 HP. Damage by zone (head 30, torso 20, legs 10 — applied elsewhere).
//   * FSM states: PATROL, INVESTIGATE, COMBAT, FLANK, AMBUSH, RETREAT, GROUP_ATTACK, SUPPRESS, SEARCH, DEAD.
//   * Adaptive AI that reads playerStats shared with the group controller.
//   * Bow animation: draw, hold, release. Shoots an Arrow via ArrowSystem.
//   * Simple ragdoll on death (parts fall + rotate then settle).
//   * Hitboxes:
//        head   — sphere at head
//        torso  — cylinder
//        legs   — cylinder (lower)
//
// Group coordination is handled by a SkeletonGroup that shares blackboard info
// about the player's last known position, recent player style, and role
// assignments (flank-left, flank-right, suppress, pin, retreat).

import * as THREE from "three";
import { Audio } from "./audio.js";

const SIGHT_DIST = 28;
const SIGHT_FOV = Math.PI * 0.55;
const HEAR_BASE = 18;
const MAX_HP = 100;

const BONE_COLOR = 0xe3dcbc;
const BONE_DARK  = 0x887a56;

function makeBoneMaterial(tint = 0) {
  // Slight random tint for visual variety.
  const hsl = new THREE.Color(BONE_COLOR).getHSL({});
  hsl.l = hsl.l - 0.06 + tint * 0.1;
  hsl.s = Math.max(0, hsl.s - 0.1);
  const c = new THREE.Color().setHSL(hsl.h, hsl.s, hsl.l);
  return new THREE.MeshStandardMaterial({
    color: c, roughness: 0.85, metalness: 0.05,
    emissive: 0x0a0806, emissiveIntensity: 0.2,
  });
}

function makeClothMaterial() {
  const colors = [0x2a1a14, 0x1a1a20, 0x2a2a1a, 0x221811];
  return new THREE.MeshStandardMaterial({
    color: colors[(Math.random() * colors.length) | 0],
    roughness: 1.0, metalness: 0.0, side: THREE.DoubleSide,
  });
}

export class Skeleton {
  constructor(id, scene, level, player, group, arrowSystem, fx) {
    this.id = id;
    this.scene = scene;
    this.level = level;
    this.player = player;
    this.group = group;             // SkeletonGroup
    this.arrows = arrowSystem;
    this.fx = fx;

    this.root = new THREE.Group();
    this.root.name = `skeleton_${id}`;
    scene.add(this.root);

    this.hp = MAX_HP;
    this.alive = true;
    this.deadT = 0;
    this.yaw = Math.random() * Math.PI * 2;
    this.vel = new THREE.Vector3();

    // FSM
    this.state = "PATROL";
    this.stateTimer = 0;
    this.globalTimer = Math.random() * 10;

    // Combat timing
    this.drawT = 0;
    this.holdT = 0;
    this.drawDuration = 1.2;   // seconds to fully draw
    this.releaseCooldown = 0;  // seconds before next shot allowed
    this.fireCooldown = 2.0 + Math.random() * 1.2;
    this.bowDraw = 0;          // 0..1 animation

    // Pathing
    this.path = [];
    this.pathIndex = 0;
    this._repathT = 0;
    this._repathTarget = new THREE.Vector3();

    // Senses / blackboard
    this.lastSeenPos = null;
    this.lastSeenTime = -999;
    this.role = "default";     // set by group: flank_left, flank_right, suppress, pin

    // Stagger / hit reaction
    this.staggerT = 0;
    this.lastHitDir = new THREE.Vector3(0, 0, -1);
    this.breath = Math.random() * 10;

    this._tint = Math.random();

    this._buildMesh();
    this._buildBow();
  }

  get position() { return this.root.position; }

  setSpawn(x, z) {
    this.root.position.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.yaw = Math.random() * Math.PI * 2;
  }

  _buildMesh() {
    // Hierarchy:
    //   root (group) - world origin at feet, y=0
    //     pelvis  (at y ~0.95)
    //       spine
    //         chest
    //           head
    //           shoulderL -> armL
    //           shoulderR -> armR (holds bow)
    //       hipL -> legL
    //       hipR -> legR

    const mat = makeBoneMaterial(this._tint);
    const matDark = makeBoneMaterial(this._tint - 0.15);
    const cloth = makeClothMaterial();
    this._mat = mat;

    // --- Pelvis ---
    const pelvis = new THREE.Group();
    pelvis.position.y = 0.95;
    this.root.add(pelvis);
    this.pelvis = pelvis;

    const pelvisMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.12, 0.18),
      mat
    );
    pelvis.add(pelvisMesh);
    const pelvisBowl = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      mat
    );
    pelvisBowl.position.y = -0.1;
    pelvisBowl.rotation.x = Math.PI;
    pelvis.add(pelvisBowl);

    // Tattered waistcloth
    const waist = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.35, 8, 1, true),
      cloth
    );
    waist.position.y = -0.2;
    pelvis.add(waist);

    // --- Spine ---
    const spine = new THREE.Group();
    spine.position.y = 0.12;
    pelvis.add(spine);
    this.spine = spine;

    // Vertebrae (stack of small cylinders)
    for (let i = 0; i < 6; i++) {
      const vert = new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 8, 6),
        matDark
      );
      vert.position.y = 0.05 + i * 0.075;
      spine.add(vert);
    }

    // --- Ribcage ---
    const chest = new THREE.Group();
    chest.position.y = 0.55;
    spine.add(chest);
    this.chest = chest;

    // Sternum
    const sternum = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.28, 0.04), mat);
    sternum.position.set(0, 0, 0.12);
    chest.add(sternum);
    // Ribs — series of torus-ish curves on each side
    for (let i = 0; i < 6; i++) {
      for (const side of [-1, 1]) {
        const ribGeo = new THREE.TorusGeometry(0.13, 0.012, 4, 10, Math.PI);
        const rib = new THREE.Mesh(ribGeo, mat);
        rib.rotation.x = Math.PI / 2;
        rib.rotation.z = side * Math.PI / 2;
        rib.position.y = -0.1 + i * 0.055;
        rib.position.x = side * 0.005;
        chest.add(rib);
      }
    }
    // Torso hit sphere (invisible helper for raycasts)
    const torsoBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.38, 0.65, 0.26),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    torsoBox.position.y = 0;
    chest.add(torsoBox);
    this.torsoBox = torsoBox;

    // Cloth chest armor (plate with straps)
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.28, 0.04),
      new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.8, metalness: 0.5 })
    );
    plate.position.set(0, 0, 0.16);
    chest.add(plate);

    // --- Neck + Head ---
    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.05, 0.1, 8),
      matDark
    );
    neck.position.y = 0.3;
    chest.add(neck);

    const head = new THREE.Group();
    head.position.y = 0.45;
    chest.add(head);
    this.head = head;

    // Skull — sphere + elongated jaw
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 12), mat);
    head.add(skull);
    // Slight deformation: make it less symmetrical
    skull.scale.set(1.0 + (Math.random() - 0.5) * 0.08, 1.05, 0.95);
    // Jaw
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.05, 0.14), matDark);
    jaw.position.set(0, -0.11, 0.02);
    head.add(jaw);
    // Eye sockets (dark)
    const socketMat = new THREE.MeshBasicMaterial({ color: 0x000 });
    for (const sx of [-0.05, 0.05]) {
      const socket = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), socketMat);
      socket.position.set(sx, 0.02, 0.11);
      head.add(socket);
    }
    // Glowing eyes (faint red inside sockets)
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xff3828 });
    for (const sx of [-0.05, 0.05]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 6), glowMat);
      eye.position.set(sx, 0.02, 0.115);
      head.add(eye);
    }
    const eyeLight = new THREE.PointLight(0xff4020, 0.2, 1.2, 2);
    eyeLight.position.set(0, 0.02, 0.15);
    head.add(eyeLight);
    this.eyeLight = eyeLight;

    // Head hit sphere
    const headBox = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 10, 8),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    head.add(headBox);
    this.headBox = headBox;

    // Teeth (thin line)
    const teeth = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.02, 0.01),
      new THREE.MeshStandardMaterial({ color: 0xcdb88f, roughness: 0.6 })
    );
    teeth.position.set(0, -0.08, 0.095);
    head.add(teeth);

    // Hood cloth (tattered cape at shoulders)
    const hood = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.5, 8, 1, true),
      cloth
    );
    hood.position.y = 0.1;
    hood.rotation.z = 0.0;
    chest.add(hood);

    // --- Arms ---
    // Shoulder/arm L (bow hand)
    const shoulderL = new THREE.Group();
    shoulderL.position.set(-0.17, 0.2, 0.0);
    chest.add(shoulderL);
    const upperArmL = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.032, 0.28, 8),
      mat
    );
    upperArmL.position.y = -0.14;
    shoulderL.add(upperArmL);
    const elbowL = new THREE.Group();
    elbowL.position.y = -0.28;
    shoulderL.add(elbowL);
    const forearmL = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.028, 0.26, 8),
      mat
    );
    forearmL.position.y = -0.13;
    elbowL.add(forearmL);
    // Hand
    const handL = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), matDark);
    handL.position.y = -0.28;
    elbowL.add(handL);
    this.shoulderL = shoulderL;
    this.elbowL = elbowL;
    this.handL = handL;

    // Shoulder/arm R (draw hand)
    const shoulderR = new THREE.Group();
    shoulderR.position.set(0.17, 0.2, 0.0);
    chest.add(shoulderR);
    const upperArmR = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.032, 0.28, 8),
      mat
    );
    upperArmR.position.y = -0.14;
    shoulderR.add(upperArmR);
    const elbowR = new THREE.Group();
    elbowR.position.y = -0.28;
    shoulderR.add(elbowR);
    const forearmR = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.028, 0.26, 8),
      mat
    );
    forearmR.position.y = -0.13;
    elbowR.add(forearmR);
    const handR = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), matDark);
    handR.position.y = -0.28;
    elbowR.add(handR);
    this.shoulderR = shoulderR;
    this.elbowR = elbowR;
    this.handR = handR;

    // --- Legs ---
    const hipL = new THREE.Group();
    hipL.position.set(-0.1, -0.08, 0);
    pelvis.add(hipL);
    const thighL = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.42, 8), mat);
    thighL.position.y = -0.21;
    hipL.add(thighL);
    const kneeL = new THREE.Group();
    kneeL.position.y = -0.42;
    hipL.add(kneeL);
    const shinL = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.4, 8), mat);
    shinL.position.y = -0.2;
    kneeL.add(shinL);
    const footL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.14), matDark);
    footL.position.set(0, -0.42, 0.04);
    kneeL.add(footL);
    this.hipL = hipL;
    this.kneeL = kneeL;

    const hipR = new THREE.Group();
    hipR.position.set(0.1, -0.08, 0);
    pelvis.add(hipR);
    const thighR = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.42, 8), mat);
    thighR.position.y = -0.21;
    hipR.add(thighR);
    const kneeR = new THREE.Group();
    kneeR.position.y = -0.42;
    hipR.add(kneeR);
    const shinR = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.4, 8), mat);
    shinR.position.y = -0.2;
    kneeR.add(shinR);
    const footR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.14), matDark);
    footR.position.set(0, -0.42, 0.04);
    kneeR.add(footR);
    this.hipR = hipR;
    this.kneeR = kneeR;

    // Leg hit box
    const legBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.82, 0.2),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    legBox.position.y = 0.55;
    this.root.add(legBox);
    this.legBox = legBox;

    // Chains dangling from belt
    for (let i = 0; i < 3; i++) {
      const c = new THREE.Mesh(
        new THREE.CylinderGeometry(0.01, 0.01, 0.18, 5),
        new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.8, metalness: 0.5 })
      );
      c.position.set((i - 1) * 0.08, -0.1, 0.12);
      pelvis.add(c);
    }
  }

  _buildBow() {
    // Bow attached to hand L
    const bow = new THREE.Group();
    bow.name = "bow";
    // Bow limbs (two curved arcs joined at middle)
    const bowMat = new THREE.MeshStandardMaterial({
      color: 0x3a2410, roughness: 0.7, metalness: 0.2,
    });
    const topLimb = new THREE.Mesh(
      new THREE.TorusGeometry(0.28, 0.012, 6, 10, Math.PI / 2),
      bowMat
    );
    topLimb.rotation.z = 0;
    topLimb.position.set(0, 0.28, 0);
    bow.add(topLimb);
    const botLimb = new THREE.Mesh(
      new THREE.TorusGeometry(0.28, 0.012, 6, 10, Math.PI / 2),
      bowMat
    );
    botLimb.rotation.z = Math.PI;
    botLimb.position.set(0, -0.28, 0);
    bow.add(botLimb);
    // Riser (grip)
    const riser = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.14, 0.03),
      new THREE.MeshStandardMaterial({ color: 0x1a1008, roughness: 0.9 })
    );
    bow.add(riser);
    // String (line)
    const strMat = new THREE.LineBasicMaterial({ color: 0xc8c8c0, transparent: true, opacity: 0.8 });
    const pts = [
      new THREE.Vector3(0, 0.55, 0),
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, -0.55, 0),
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const str = new THREE.Line(geo, strMat);
    bow.add(str);
    this.bowString = str;
    this.bowStringGeo = geo;

    // Offset the bow so the grip sits in the hand
    bow.position.set(0, -0.28, 0);
    bow.rotation.z = 0;

    // Nocked arrow on string (visible when drawn)
    const arrow = new THREE.Group();
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, 0.7, 6),
      new THREE.MeshStandardMaterial({ color: 0x3a2a1a })
    );
    shaft.rotation.z = Math.PI / 2;
    arrow.add(shaft);
    const headTip = new THREE.Mesh(
      new THREE.ConeGeometry(0.02, 0.08, 6),
      new THREE.MeshStandardMaterial({ color: 0x202020 })
    );
    headTip.rotation.z = -Math.PI / 2;
    headTip.position.x = 0.38;
    arrow.add(headTip);
    arrow.position.set(0.35, 0, 0);
    arrow.visible = false;
    bow.add(arrow);
    this.nockArrow = arrow;

    // Attach to hand L
    this.handL.add(bow);
    this.bow = bow;
  }

  // ==== Damage ====
  // Ray test against hit zones, called from Weapon._rayTrace.
  // Returns { zone, distance, point, normal } | null.
  rayTest(origin, dir, maxDist = 120) {
    if (!this.alive) return null;
    // Update world matrices for hit boxes
    this.root.updateMatrixWorld(true);

    const tests = [
      { zone: "head", box: this.headBox },
      { zone: "torso", box: this.torsoBox },
      { zone: "legs", box: this.legBox },
    ];
    let best = null;
    for (const t of tests) {
      // Get world-space bounding box
      const mesh = t.box;
      const geom = mesh.geometry;
      if (!geom.boundingBox) geom.computeBoundingBox();
      const bb = geom.boundingBox.clone();
      bb.applyMatrix4(mesh.matrixWorld);
      // Intersect ray with AABB
      const tMin = rayAABBIntersect(origin, dir, bb);
      if (tMin !== null && tMin < maxDist && (!best || tMin < best.distance)) {
        const point = origin.clone().addScaledVector(dir, tMin);
        best = { zone: t.zone, distance: tMin, point, normal: dir.clone().negate() };
      }
    }
    return best;
  }

  takeDamage(damage, info = {}) {
    if (!this.alive) return;
    this.hp -= damage;
    // Stagger on strong hits
    this.staggerT = Math.max(this.staggerT, damage >= 25 ? 0.45 : 0.18);
    if (info.dir) this.lastHitDir.copy(info.dir);
    // blood (at body center approx)
    const hitPoint = info.point || this.root.position.clone().add(new THREE.Vector3(0, 1.4, 0));
    this.fx.bloodBurst(hitPoint, info.dir ? info.dir.clone().negate() : new THREE.Vector3(0, 1, 0), 0.7, true);
    // Sound
    Audio.skeletonHit();
    // Notify group — this skeleton sees that player shot them → shares player pos
    if (this.group) {
      this.group.reportCombat({ shooterPos: this.player.pos.clone(), time: performance.now() / 1000 });
    }
    if (this.hp <= 0) {
      this._die(info.dir || new THREE.Vector3(0, 0, 1));
    }
  }

  _die(dir) {
    this.alive = false;
    this.state = "DEAD";
    this.deadT = 0;
    Audio.skeletonDie();
    // Fling bones outward (fake ragdoll)
    this._ragdoll = {
      pelvisVY: 2.5,
      pelvisVH: new THREE.Vector2(dir.x * 0.5, dir.z * 0.5),
      rotSpin: new THREE.Vector3(
        (Math.random() - 0.5) * 4,
        (Math.random() - 0.5) * 6,
        (Math.random() - 0.5) * 6,
      ),
      tilt: 0,
      settled: false,
    };
    // small gib spray
    this.fx.explodeCorpse(this.root.position.clone().add(new THREE.Vector3(0, 1.0, 0)));
    // eye glow goes out
    if (this.eyeLight) this.eyeLight.intensity = 0;
    // tell the group
    if (this.group) this.group.onMemberDied(this);
  }

  // ==== AI ====

  update(dt) {
    this.globalTimer += dt;
    this.stateTimer += dt;
    this.breath += dt;

    if (!this.alive) {
      this._updateRagdoll(dt);
      return;
    }

    if (this.staggerT > 0) {
      this.staggerT -= dt;
      // During stagger, skip state logic but animate
    }

    const sense = this._senseForPlayer();
    if (sense.seen) {
      this.lastSeenPos = this.player.pos.clone();
      this.lastSeenTime = this.globalTimer;
      if (this.group) this.group.reportSighting(this.lastSeenPos, this.globalTimer);
    }

    // Transition logic
    this._transition(sense, dt);

    // Action per state
    switch (this.state) {
      case "PATROL":       this._doPatrol(dt); break;
      case "INVESTIGATE":  this._doInvestigate(dt); break;
      case "COMBAT":       this._doCombat(dt, sense); break;
      case "FLANK":        this._doFlank(dt, sense); break;
      case "AMBUSH":       this._doAmbush(dt); break;
      case "RETREAT":      this._doRetreat(dt); break;
      case "GROUP_ATTACK": this._doGroupAttack(dt, sense); break;
      case "SUPPRESS":     this._doSuppress(dt, sense); break;
      case "SEARCH":       this._doSearch(dt); break;
    }

    // Animate
    this._animate(dt);
  }

  _senseForPlayer() {
    const pp = this.player.pos;
    const mp = this.root.position;
    const dx = pp.x - mp.x;
    const dz = pp.z - mp.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (this.player.state.dead) return { seen: false, heard: false, dist };
    let seen = false, heard = false;

    if (dist < SIGHT_DIST) {
      const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      const toP = new THREE.Vector3(dx, 0, dz).normalize();
      const dot = fwd.dot(toP);
      const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
      if (angle < SIGHT_FOV * 0.5 && this._hasLineOfSight(mp, pp)) {
        seen = true;
      }
    }
    // Hearing: player noise or recent shot (from group blackboard)
    const noise = this.player.state.noise || 0;
    if (noise > 0.1 && dist < HEAR_BASE * noise) heard = true;
    return { seen, heard, dist };
  }

  _hasLineOfSight(from, to) {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
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

  _transition(sense, dt) {
    // Group blackboard gives hint about player style and role assignments.
    const bb = this.group ? this.group.blackboard : null;
    const knownPos = this.lastSeenPos || (bb && bb.sharedPos) || null;
    const knownTime = Math.max(this.lastSeenTime, bb ? bb.sharedPosTime : -999);
    const tSinceKnown = this.globalTimer - knownTime;

    if (sense.seen || tSinceKnown < 2.5) {
      // Player is seen or recently seen → combat behaviour
      // Determine sub-state by role
      if (this.role === "flank_left" || this.role === "flank_right") {
        this._setState("FLANK");
      } else if (this.role === "suppress") {
        this._setState("SUPPRESS");
      } else if (this.role === "retreat" && this.hp < 40) {
        this._setState("RETREAT");
      } else if (bb && bb.groupAttackOn) {
        this._setState("GROUP_ATTACK");
      } else {
        this._setState("COMBAT");
      }
      return;
    }

    if (sense.heard || (bb && bb.recentNoise && (this.globalTimer - bb.recentNoiseTime) < 4)) {
      if (this._isInAmbush() && Math.random() < 0.3) {
        this._setState("AMBUSH");
      } else {
        this._setState("INVESTIGATE");
      }
      return;
    }

    // If group sighting exists → search around
    if (bb && bb.sharedPos && tSinceKnown < 12) {
      this._setState("SEARCH");
      return;
    }

    // Default patrol
    if (this.state !== "PATROL" && this.state !== "AMBUSH") {
      this._setState("PATROL");
    }
    // Random chance to set up ambush based on player style
    if (bb && bb.playerStyle === "hider" && Math.random() < dt * 0.04 && this.state === "PATROL") {
      this._setState("AMBUSH");
    }
  }

  _setState(s) {
    if (this.state === s) return;
    this.state = s;
    this.stateTimer = 0;
    this.path = [];
    this.pathIndex = 0;
    this._repathT = 0;
  }

  _isInAmbush() {
    // Check if near a wall or large cover
    const r = 1.3;
    for (const c of this.level.colliders) {
      if (!c.blocksVision) continue;
      const closeX = Math.max(c.minX, Math.min(this.root.position.x, c.maxX));
      const closeZ = Math.max(c.minZ, Math.min(this.root.position.z, c.maxZ));
      const d = Math.hypot(this.root.position.x - closeX, this.root.position.z - closeZ);
      if (d < r) return true;
    }
    return false;
  }

  // ==== State actions ====

  _doPatrol(dt) {
    if (!this.path.length || this._atPathEnd()) {
      const cell = this.level.pathfinder.randomWalkable();
      const w = this.level.cellToWorld(cell.cx, cell.cy);
      this._setPathTo(new THREE.Vector3(w.x, 0, w.z));
    }
    this._followPath(dt, 1.4);
  }

  _doInvestigate(dt) {
    const target = this.lastSeenPos
      || (this.group && this.group.blackboard.sharedPos)
      || (this.group && this.group.blackboard.recentNoisePos)
      || null;
    if (!target) { this._setState("PATROL"); return; }
    if (!this.path.length || this._repathT <= 0) {
      this._setPathTo(target);
      this._repathT = 1.0;
    } else this._repathT -= dt;
    this._followPath(dt, 2.2);
    if (this._atPathEnd() && this.stateTimer > 3) this._setState("PATROL");
  }

  _doCombat(dt, sense) {
    const pp = this.player.pos;
    const mp = this.root.position;
    const dist = sense.dist;

    // Determine ideal range: 7..14m. Too close = back off.
    const idealMin = 6, idealMax = 14;

    // Face player
    const desiredYaw = Math.atan2(pp.x - mp.x, pp.z - mp.z);
    this.yaw = lerpAngle(this.yaw, desiredYaw, Math.min(1, dt * 6));

    if (dist < idealMin) {
      // Step back
      this._strafeAway(dt, 1.6);
      this._draw(dt);
      return;
    }
    if (dist > idealMax) {
      // Close distance
      if (!this.path.length || this._repathT <= 0) {
        this._setPathTo(pp);
        this._repathT = 0.4;
      } else this._repathT -= dt;
      this._followPath(dt, 2.1);
    } else {
      // Stay, draw + strafe slightly
      this._strafeLateral(dt, 0.9);
      this._draw(dt);
    }

    if (sense.seen && this.bowDraw > 0.95 && this.releaseCooldown <= 0) {
      this._shoot(pp);
    }
    this.releaseCooldown = Math.max(0, this.releaseCooldown - dt);
  }

  _doFlank(dt, sense) {
    // Move to a point flanking the player by ~70 degrees relative to the group centroid
    const pp = this.player.pos;
    const sideSign = this.role === "flank_left" ? -1 : 1;
    const dir = new THREE.Vector3(pp.x - this.root.position.x, 0, pp.z - this.root.position.z).normalize();
    const perp = new THREE.Vector3(dir.z * sideSign, 0, -dir.x * sideSign);
    const flankTarget = new THREE.Vector3()
      .copy(pp)
      .addScaledVector(perp, 6)
      .addScaledVector(dir, -3);  // slightly behind the player axis

    if (!this.path.length || this._repathT <= 0) {
      this._setPathTo(flankTarget);
      this._repathT = 0.6;
    } else this._repathT -= dt;

    this._followPath(dt, 2.6);

    if (sense.seen) {
      // Face & shoot if we also have line of sight
      const desiredYaw = Math.atan2(pp.x - this.root.position.x, pp.z - this.root.position.z);
      this.yaw = lerpAngle(this.yaw, desiredYaw, Math.min(1, dt * 6));
      this._draw(dt);
      if (this.bowDraw > 0.95 && this.releaseCooldown <= 0) this._shoot(pp);
      this.releaseCooldown = Math.max(0, this.releaseCooldown - dt);
    }
    if (this.stateTimer > 10) this._setState("COMBAT");
  }

  _doAmbush(dt) {
    // Stay still, orient toward last seen or group sharedPos
    const pp = (this.group && this.group.blackboard.sharedPos) || this.player.pos;
    const desiredYaw = Math.atan2(pp.x - this.root.position.x, pp.z - this.root.position.z);
    this.yaw = lerpAngle(this.yaw, desiredYaw, Math.min(1, dt * 2));
    this.vel.set(0, 0, 0);
    this._draw(dt * 0.8);
    if (this.stateTimer > 14) this._setState("PATROL");
  }

  _doRetreat(dt) {
    // Move AWAY from player to a walkable tile further away
    const pp = this.player.pos;
    const dir = new THREE.Vector3(this.root.position.x - pp.x, 0, this.root.position.z - pp.z);
    if (dir.lengthSq() < 0.01) dir.set(1, 0, 0);
    dir.normalize();
    const tgt = this.root.position.clone().addScaledVector(dir, 10);
    if (!this.path.length || this._repathT <= 0) {
      this._setPathTo(tgt);
      this._repathT = 1.5;
    } else this._repathT -= dt;
    this._followPath(dt, 3.0);
    if (this.stateTimer > 5) this._setState("COMBAT");
  }

  _doGroupAttack(dt, sense) {
    // Aggressive push: get close, draw fast
    const pp = this.player.pos;
    if (sense.dist > 10) {
      if (!this.path.length || this._repathT <= 0) {
        this._setPathTo(pp);
        this._repathT = 0.4;
      } else this._repathT -= dt;
      this._followPath(dt, 2.8);
    } else {
      this._strafeLateral(dt, 1.2);
    }
    const desiredYaw = Math.atan2(pp.x - this.root.position.x, pp.z - this.root.position.z);
    this.yaw = lerpAngle(this.yaw, desiredYaw, Math.min(1, dt * 6));
    this._draw(dt * 1.6);
    if (sense.seen && this.bowDraw > 0.85 && this.releaseCooldown <= 0) this._shoot(pp);
    this.releaseCooldown = Math.max(0, this.releaseCooldown - dt);
  }

  _doSuppress(dt, sense) {
    // Stay back, shoot rapidly toward last-known-pos
    const pp = (this.group && this.group.blackboard.sharedPos) || this.player.pos;
    const desiredYaw = Math.atan2(pp.x - this.root.position.x, pp.z - this.root.position.z);
    this.yaw = lerpAngle(this.yaw, desiredYaw, Math.min(1, dt * 5));
    this.vel.multiplyScalar(0.8);
    this._draw(dt * 1.3);
    if (this.bowDraw > 0.8 && this.releaseCooldown <= 0) this._shoot(pp, 0.6);
    this.releaseCooldown = Math.max(0, this.releaseCooldown - dt);
    if (this.stateTimer > 6) this._setState("COMBAT");
  }

  _doSearch(dt) {
    const bb = this.group ? this.group.blackboard : null;
    const base = (bb && bb.sharedPos) || this.lastSeenPos;
    if (!base) { this._setState("PATROL"); return; }
    // Move to points around the base
    if (!this.path.length || this._atPathEnd()) {
      const off = new THREE.Vector3(
        (Math.random() - 0.5) * 6,
        0,
        (Math.random() - 0.5) * 6,
      );
      const tgt = base.clone().add(off);
      this._setPathTo(tgt);
    }
    this._followPath(dt, 1.8);
    if (this.stateTimer > 12) this._setState("PATROL");
  }

  _strafeAway(dt, speed) {
    const away = new THREE.Vector3(
      this.root.position.x - this.player.pos.x,
      0,
      this.root.position.z - this.player.pos.z,
    );
    if (away.lengthSq() < 0.001) return;
    away.normalize();
    this._moveStep(away.x * speed * dt, away.z * speed * dt);
    this.vel.x = away.x * speed;
    this.vel.z = away.z * speed;
  }
  _strafeLateral(dt, speed) {
    const toP = new THREE.Vector3(
      this.player.pos.x - this.root.position.x,
      0,
      this.player.pos.z - this.root.position.z,
    );
    toP.normalize();
    const perp = new THREE.Vector3(toP.z, 0, -toP.x);
    const dir = (this.id % 2 === 0) ? 1 : -1;
    this._moveStep(perp.x * dir * speed * dt, perp.z * dir * speed * dt);
    this.vel.x = perp.x * dir * speed;
    this.vel.z = perp.z * dir * speed;
  }

  _draw(dt) {
    this.bowDraw = Math.min(1, this.bowDraw + dt / this.drawDuration);
    // Show nocked arrow once drawing
    if (this.nockArrow) this.nockArrow.visible = this.bowDraw > 0.05;
    // Bend string
    if (this.bowStringGeo) {
      const arr = this.bowStringGeo.attributes.position.array;
      arr[3] = -this.bowDraw * 0.18;  // middle string pulled back
      this.bowStringGeo.attributes.position.needsUpdate = true;
    }
    if (this.bowDraw >= 0.3 && Math.random() < dt * 0.8) {
      Audio.bowDraw();
    }
  }

  _shoot(targetPos, accuracy = 0.85) {
    // Origin: world position of hand L + bow nock
    const world = new THREE.Vector3();
    this.handL.updateMatrixWorld(true);
    world.setFromMatrixPosition(this.handL.matrixWorld);
    world.y += 0.05;
    // Add small aim-up for gravity
    const tgt = targetPos.clone();
    tgt.y += 1.2;    // aim at upper torso / head
    // Aim accuracy modified by adaptive stats
    const bb = this.group ? this.group.blackboard : null;
    let acc = accuracy;
    if (bb && bb.playerStyle === "runner") acc = Math.min(1, acc + 0.05);   // predict runner
    if (bb && bb.playerStyle === "camper") acc = Math.min(1, acc + 0.07);
    this.arrows.spawn(world, tgt, acc);
    this.bowDraw = 0;
    if (this.nockArrow) this.nockArrow.visible = false;
    if (this.bowStringGeo) {
      const arr = this.bowStringGeo.attributes.position.array;
      arr[3] = 0;
      this.bowStringGeo.attributes.position.needsUpdate = true;
    }
    this.releaseCooldown = this.fireCooldown;
    this.fireCooldown = 1.6 + Math.random() * 1.4;
  }

  _setPathTo(target) {
    this._repathTarget.copy(target);
    const wp = this.level.pathfinder.findWorld(
      this.root.position.x, this.root.position.z,
      target.x, target.z,
      this.level.worldToCell, this.level.cellToWorld,
    );
    if (!wp || wp.length === 0) {
      this.path = []; this.pathIndex = 0; return;
    }
    this.path = wp.slice(1);
    this.pathIndex = 0;
  }

  _atPathEnd() { return !this.path.length || this.pathIndex >= this.path.length; }

  _followPath(dt, speed) {
    if (this._atPathEnd()) { this.vel.x *= 0.6; this.vel.z *= 0.6; return; }
    const wp = this.path[this.pathIndex];
    const mp = this.root.position;
    const dx = wp.x - mp.x, dz = wp.z - mp.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < 0.5) { this.pathIndex++; return; }
    const nx = dx / d, nz = dz / d;
    const vx = nx * speed, vz = nz * speed;
    this._moveStep(vx * dt, vz * dt);
    this.vel.x = vx; this.vel.z = vz;
    const tyaw = Math.atan2(nx, nz);
    this.yaw = lerpAngle(this.yaw, tyaw, Math.min(1, dt * 4));
  }

  _moveStep(dx, dz) {
    const mp = this.root.position;
    const r = 0.35;
    const nextX = mp.x + dx;
    if (!this._collides(nextX, mp.z, r)) mp.x = nextX;
    const nextZ = mp.z + dz;
    if (!this._collides(mp.x, nextZ, r)) mp.z = nextZ;
  }

  _collides(x, z, r) {
    for (const c of this.level.colliders) {
      if (c.kind === "pallet" || c.kind === "fence") continue;
      if (x + r > c.minX && x - r < c.maxX &&
          z + r > c.minZ && z - r < c.maxZ) return true;
    }
    return false;
  }

  // ==== Animation ====
  _animate(dt) {
    // Walking gait
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const cycle = this.globalTimer * (4 + speed * 2);

    if (this.hipL) {
      this.hipL.rotation.x = Math.sin(cycle) * (0.5 + speed * 0.15);
      this.kneeL.rotation.x = Math.max(0, Math.sin(cycle + 0.5)) * 0.7;
    }
    if (this.hipR) {
      this.hipR.rotation.x = -Math.sin(cycle) * (0.5 + speed * 0.15);
      this.kneeR.rotation.x = Math.max(0, Math.sin(cycle + 0.5 + Math.PI)) * 0.7;
    }

    // Spine/chest subtle bob
    if (this.chest) {
      this.chest.rotation.x = Math.sin(cycle * 0.5) * 0.04;
      this.chest.position.y = 0.55 + Math.abs(Math.sin(cycle)) * 0.025;
    }
    // Breath micromovement
    if (this.pelvis) {
      this.pelvis.position.y = 0.95 + Math.sin(this.breath * 1.3) * 0.008;
    }

    // Arms: bow held up & forward in hand L; hand R draws the string
    if (this.shoulderL) {
      this.shoulderL.rotation.x = -1.1;   // raised
      this.shoulderL.rotation.y = -0.25;
      this.shoulderL.rotation.z = 0.1;
    }
    if (this.shoulderR) {
      const draw = this.bowDraw;
      this.shoulderR.rotation.x = -0.9 + draw * -0.1;
      this.shoulderR.rotation.y = -0.4 + draw * 0.5;  // pull back
      this.shoulderR.rotation.z = 0.05;
    }
    if (this.elbowR) {
      // Elbow bends more when drawing
      this.elbowR.rotation.x = -1.1 - this.bowDraw * 0.6;
    }
    // Face player when in combat
    if (this.state === "COMBAT" || this.state === "GROUP_ATTACK"
        || this.state === "SUPPRESS" || this.state === "AMBUSH") {
      if (this.head) {
        const dx = this.player.pos.x - this.root.position.x;
        const dy = (this.player.pos.y) - (this.root.position.y + 1.4);
        const dz = this.player.pos.z - this.root.position.z;
        const horz = Math.sqrt(dx * dx + dz * dz);
        const pitch = Math.atan2(dy, Math.max(0.1, horz));
        this.head.rotation.x = Math.max(-0.6, Math.min(0.6, pitch));
      }
    } else {
      if (this.head) this.head.rotation.x = 0;
    }

    // Eye glow flickers when alerted
    if (this.eyeLight) {
      this.eyeLight.intensity = (this.state === "COMBAT" || this.state === "GROUP_ATTACK" || this.state === "SUPPRESS")
        ? (0.45 + Math.random() * 0.1)
        : 0.22 + Math.sin(this.breath * 3) * 0.02;
    }

    // Stagger lean back
    if (this.staggerT > 0 && this.pelvis) {
      this.pelvis.rotation.x = -this.staggerT * 0.6;
    } else if (this.pelvis) {
      this.pelvis.rotation.x *= 0.85;
    }

    this.root.position.y = 0;
    this.root.rotation.y = this.yaw;
  }

  _updateRagdoll(dt) {
    this.deadT += dt;
    const r = this._ragdoll;
    if (!r) return;
    if (r.settled) {
      // slow decay; fade the body into the floor
      return;
    }
    // Rotate whole root like a log falling
    r.tilt += dt * 2.4;
    const t = Math.min(Math.PI / 2, r.tilt);
    this.root.rotation.x = t;
    // Drop pelvis height
    this.pelvis.position.y = Math.max(0.15, 0.95 - t * 0.5);
    // Spin slight
    this.root.rotation.z += r.rotSpin.z * dt * 0.3;
    // Skid slightly
    this.root.position.x += r.pelvisVH.x * dt * (1 - t / (Math.PI / 2));
    this.root.position.z += r.pelvisVH.y * dt * (1 - t / (Math.PI / 2));
    if (t >= Math.PI / 2) {
      r.settled = true;
      if (this.eyeLight) this.eyeLight.intensity = 0;
    }
  }
}

// ===== Group coordinator =====

export class SkeletonGroup {
  constructor(level, player) {
    this.level = level;
    this.player = player;
    this.members = [];
    this.blackboard = {
      sharedPos: null,          // Vec3
      sharedPosTime: -999,
      recentNoise: false,
      recentNoiseTime: -999,
      recentNoisePos: null,
      playerStyle: "default",   // "hider" | "runner" | "camper" | "aggressive"
      groupAttackOn: false,
      groupAttackUntil: 0,
      suppressCount: 0,
    };
    this._stylePollT = 0;
  }

  add(skel) { this.members.push(skel); skel.group = this; }
  aliveCount() { return this.members.filter(m => m.alive).length; }
  allDead() { return this.members.every(m => !m.alive); }

  // Called by skeleton when it gets hit by the player
  reportCombat({ shooterPos, time }) {
    this.blackboard.sharedPos = shooterPos.clone();
    this.blackboard.sharedPosTime = time;
    // If player is aggressive, trigger group attack
    if (this.blackboard.playerStyle === "aggressive") {
      this.blackboard.groupAttackOn = true;
      this.blackboard.groupAttackUntil = time + 8;
    }
  }

  reportSighting(pos, time) {
    this.blackboard.sharedPos = pos.clone();
    this.blackboard.sharedPosTime = time;
  }

  reportNoise(pos) {
    this.blackboard.recentNoise = true;
    this.blackboard.recentNoiseTime = performance.now() / 1000;
    this.blackboard.recentNoisePos = pos.clone();
  }

  onMemberDied(member) {
    // Other members who are nearby go into RETREAT briefly
    const dp = member.root.position;
    for (const m of this.members) {
      if (!m.alive || m === member) continue;
      const d = m.root.position.distanceTo(dp);
      if (d < 8 && m.hp < 50) m.role = "retreat";
    }
  }

  // Assign roles based on count and player stats every N seconds.
  update(dt, playerStats) {
    this.blackboard.sharedPosTime = Math.min(this.blackboard.sharedPosTime, performance.now());
    const now = performance.now() / 1000;
    if (this.blackboard.groupAttackUntil < now) this.blackboard.groupAttackOn = false;

    this._stylePollT -= dt;
    if (this._stylePollT <= 0) {
      this._stylePollT = 1.0;
      this._updatePlayerStyle(playerStats);
      this._assignRoles();
    }
  }

  _updatePlayerStyle(stats) {
    const s = stats || {};
    // Score each style
    const scoreHider  = (s.timesHidden || 0) * 2 + (s.binocularsSeconds || 0) * 0.2;
    const scoreRunner = (s.sprintingSeconds || 0) * 1.2;
    const scoreCamper = (s.timeSpentStill || 0) * 0.8;
    const scoreAgg    = (s.shotsFired || 0) * 1.0 + (s.hitsLanded || 0) * 1.5;
    const best = [
      ["hider", scoreHider],
      ["runner", scoreRunner],
      ["camper", scoreCamper],
      ["aggressive", scoreAgg],
      ["default", 0.5],
    ].sort((a, b) => b[1] - a[1])[0][0];
    this.blackboard.playerStyle = best;
  }

  _assignRoles() {
    // Sort alive members by distance from player so closer ones can flank/push;
    // rear ones suppress.
    const alive = this.members.filter(m => m.alive);
    const playerPos = this.player.pos;
    alive.sort((a, b) => a.root.position.distanceTo(playerPos) - b.root.position.distanceTo(playerPos));

    const style = this.blackboard.playerStyle;
    for (let i = 0; i < alive.length; i++) {
      const s = alive[i];
      if (style === "camper") {
        // Force flanks — many
        if (i % 3 === 0) s.role = "flank_left";
        else if (i % 3 === 1) s.role = "flank_right";
        else s.role = "suppress";
      } else if (style === "runner") {
        // Spread out + suppress to predict route
        if (i === 0) s.role = "default";
        else if (i % 2 === 0) s.role = "flank_left";
        else s.role = "flank_right";
      } else if (style === "aggressive") {
        // Keep distance
        if (i < 2) s.role = "retreat";
        else s.role = "suppress";
      } else if (style === "hider") {
        // Split into roaming searchers — mostly default, some flank
        if (i % 3 === 0) s.role = "flank_left";
        else if (i % 3 === 1) s.role = "flank_right";
        else s.role = "default";
      } else {
        s.role = "default";
      }
    }
  }
}

// ===== helpers =====

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

function rayAABBIntersect(origin, dir, box) {
  let tmin = 0.001, tmax = 1e9;
  for (const ax of ["x", "y", "z"]) {
    const o = origin[ax], d = dir[ax];
    const mn = box.min[ax], mx = box.max[ax];
    if (Math.abs(d) < 1e-8) {
      if (o < mn || o > mx) return null;
    } else {
      let t1 = (mn - o) / d, t2 = (mx - o) / d;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}
