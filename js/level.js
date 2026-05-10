// Industrial factory level generator.
// Grid-based: 1 = wall, 0 = floor. 2m per cell.
// Builds Three.js meshes + collision boxes + hide spots + pickups + truck + A* pathfinder.

import * as THREE from "three";

export const CELL = 2.0;
export const WALL_H = 3.6;

// Hand-authored map. Each character = one cell.
//   #  wall
//   .  floor
//   L  floor + locker (hide spot)
//   D  floor + desk
//   C  floor + crate
//   V  floor + vent/pipes cluster
//   B  floor + battery spawn
//   K  floor + key spawn
//   T  floor + yellow truck (garage)
//   S  floor + player spawn
//   M  floor + monster spawn
//   G  garage floor (open, for truck approach)
//
// 44 wide x 40 tall grid = 88m x 80m.

const MAP = [
  "############################################",
  "#S...........#..............#..............#",
  "#....L.......#....D.........#......L.......#",
  "#............#..............#..............#",
  "#....C.......#.....K........#......C.......#",
  "#............D..............#..............#",
  "#............#..............#......D.......#",
  "#....L.......#....C...C.....#..............#",
  "#............#..............#......B.......#",
  "#............#..............#..............#",
  "######.######################.######.#######",
  "#....................................L.....#",
  "#....L.............M.......................#",
  "#..........................................#",
  "######.######.############.######.##########",
  "#............#............#...........#....#",
  "#....D.......#....L.......#....K......#....#",
  "#............#............#...........#....#",
  "#....C...C...#............#...........#....#",
  "#............#....C...C...#....D......#....#",
  "#....B.......#............#...........#....#",
  "#............#....L.......#...........#....#",
  "#....L.......#............#....C......#....#",
  "#............#....V...V...#...........#....#",
  "######.######.############.#####.######.####",
  "#..........................................#",
  "#....L............V......V.........L.......#",
  "#..........................................#",
  "############.###############################",
  "#..........................................#",
  "#...........GGGGGGGGGGGGGGGGGGGG...........#",
  "#...........GGGGGGGGGGGGGGGGGGGG.....L.....#",
  "#...........GGGGGGGG.T.GGGGGGGGG...........#",
  "#...........GGGGGGGGGGGGGGGGGGGG...........#",
  "#...........GGGGGGGGGGGGGGGGGGGG...........#",
  "#..........................................#",
  "#..........................................#",
  "############################################",
];

// Fix rows to exactly 44 cols (some had trailing trimming above)
const W = 44;
const H = MAP.length;
function padRow(r) {
  if (r.length >= W) return r.slice(0, W);
  return r + "#".repeat(W - r.length);
}
const ROWS = MAP.map(padRow);

// ---------- Utility ----------

function cellToWorld(cx, cy) {
  // center the whole map around origin
  const ox = (W * CELL) / 2;
  const oy = (H * CELL) / 2;
  return { x: cx * CELL + CELL / 2 - ox, z: cy * CELL + CELL / 2 - oy };
}

function worldToCell(x, z) {
  const ox = (W * CELL) / 2;
  const oy = (H * CELL) / 2;
  const cx = Math.floor((x + ox) / CELL);
  const cy = Math.floor((z + oy) / CELL);
  return { cx, cy };
}

// ---------- Material palette ----------

function makeConcreteTexture(color = "#2a2a2a", speckle = "#1a1a1a") {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = color;
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2000; i++) {
    g.fillStyle = Math.random() < 0.5 ? speckle : "#0f0f0f";
    g.globalAlpha = 0.12 + Math.random() * 0.3;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  g.globalAlpha = 1;
  // subtle horizontal streaks (grime)
  for (let i = 0; i < 20; i++) {
    g.fillStyle = "#0c0c0c";
    g.globalAlpha = 0.08 + Math.random() * 0.1;
    g.fillRect(0, Math.random() * 256, 256, 1 + Math.random() * 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function makeRustyMetalTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = "#3a3028";
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 600; i++) {
    g.fillStyle = ["#4a2a15", "#6b3a1a", "#2a1a10", "#5a3a20"][Math.floor(Math.random() * 4)];
    g.globalAlpha = 0.2 + Math.random() * 0.5;
    const r = 2 + Math.random() * 10;
    g.beginPath();
    g.arc(Math.random() * 256, Math.random() * 256, r, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ---------- Builder ----------

export function buildLevel(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const colliders = []; // axis-aligned boxes: {minX, maxX, minZ, maxZ}
  const hideSpots = []; // locker world positions + orient + door mesh
  const pickups = [];
  const keys = [];
  let playerSpawn = { x: 0, y: 1.6, z: 0 };
  let monsterSpawn = { x: 0, y: 0, z: 0 };
  let truck = null;

  // Walkable grid for pathfinding (true = walkable)
  const walk = Array.from({ length: H }, () => Array(W).fill(false));

  // Parse grid
  for (let cy = 0; cy < H; cy++) {
    for (let cx = 0; cx < W; cx++) {
      const ch = ROWS[cy][cx];
      if (ch !== "#") walk[cy][cx] = true;
    }
  }

  // --- Floor (one big plane) ---
  const floorTex = makeConcreteTexture("#252525", "#151515");
  floorTex.repeat.set(W, H);
  const floorMat = new THREE.MeshStandardMaterial({
    map: floorTex, roughness: 0.95, metalness: 0.0
  });
  const floorGeo = new THREE.PlaneGeometry(W * CELL, H * CELL);
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  floor.receiveShadow = true;
  group.add(floor);

  // --- Ceiling ---
  const ceilTex = makeConcreteTexture("#1a1a1a", "#0a0a0a");
  ceilTex.repeat.set(W, H);
  const ceilMat = new THREE.MeshStandardMaterial({
    map: ceilTex, roughness: 1.0, metalness: 0.0
  });
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W * CELL, H * CELL), ceilMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = WALL_H;
  group.add(ceil);

  // --- Walls (instanced) ---
  const wallTex = makeConcreteTexture("#3a3a38", "#1d1d1c");
  wallTex.repeat.set(1, 2);
  const wallMat = new THREE.MeshStandardMaterial({
    map: wallTex, roughness: 0.9, metalness: 0.0
  });
  const wallGeo = new THREE.BoxGeometry(CELL, WALL_H, CELL);

  // count wall cells
  let wallCount = 0;
  for (let cy = 0; cy < H; cy++)
    for (let cx = 0; cx < W; cx++)
      if (ROWS[cy][cx] === "#") wallCount++;

  const wallInstanced = new THREE.InstancedMesh(wallGeo, wallMat, wallCount);
  wallInstanced.castShadow = false;
  wallInstanced.receiveShadow = true;

  const dummy = new THREE.Object3D();
  let wi = 0;
  for (let cy = 0; cy < H; cy++) {
    for (let cx = 0; cx < W; cx++) {
      if (ROWS[cy][cx] !== "#") continue;
      const { x, z } = cellToWorld(cx, cy);
      dummy.position.set(x, WALL_H / 2, z);
      dummy.updateMatrix();
      wallInstanced.setMatrixAt(wi++, dummy.matrix);
      // mark instance matrix dirty at end of loop below
      colliders.push({
        minX: x - CELL / 2, maxX: x + CELL / 2,
        minZ: z - CELL / 2, maxZ: z + CELL / 2,
        blocksVision: true
      });
    }
  }
  wallInstanced.instanceMatrix.needsUpdate = true;
  group.add(wallInstanced);

  // --- Props ---
  const metalTex = makeRustyMetalTexture();

  for (let cy = 0; cy < H; cy++) {
    for (let cx = 0; cx < W; cx++) {
      const ch = ROWS[cy][cx];
      const { x, z } = cellToWorld(cx, cy);

      if (ch === "S") {
        playerSpawn = { x, y: 1.6, z };
      } else if (ch === "M") {
        monsterSpawn = { x, y: 0, z };
      } else if (ch === "L") {
        makeLocker(group, x, z, cx, cy, ROWS, metalTex, colliders, hideSpots);
      } else if (ch === "D") {
        makeDesk(group, x, z, colliders);
      } else if (ch === "C") {
        makeCrate(group, x, z, colliders);
      } else if (ch === "V") {
        makeVentPipes(group, x, z, metalTex, colliders);
      } else if (ch === "B") {
        pickups.push(makeBattery(group, x, z));
      } else if (ch === "K") {
        keys.push(makeKey(group, x, z));
      } else if (ch === "T") {
        truck = makeYellowTruck(group, x, z, metalTex, colliders);
      }
    }
  }

  // Fallback spawns if missing
  if (!playerSpawn.x && !playerSpawn.z) {
    const { x, z } = cellToWorld(1, 1);
    playerSpawn = { x, y: 1.6, z };
  }
  if (!monsterSpawn.x && !monsterSpawn.z) {
    const { x, z } = cellToWorld(W - 3, 3);
    monsterSpawn = { x, y: 0, z };
  }

  // --- Lighting: mostly dark, with a few flickering hanging lamps ---
  const ambient = new THREE.AmbientLight(0x1a1a22, 0.22);
  scene.add(ambient);

  // Moonlight from ceiling (very soft)
  const moon = new THREE.HemisphereLight(0x223044, 0x050505, 0.18);
  scene.add(moon);

  // Scattered flickering lamps in large rooms
  const lampSpots = [
    cellToWorld(5, 5), cellToWorld(20, 5), cellToWorld(36, 5),
    cellToWorld(5, 18), cellToWorld(22, 19), cellToWorld(38, 18),
    cellToWorld(5, 26), cellToWorld(38, 26),
    cellToWorld(22, 32), // garage
  ];
  const flickerLights = [];
  for (const p of lampSpots) {
    const lamp = new THREE.PointLight(0xffb070, 0.9, 9, 2.0);
    lamp.position.set(p.x, WALL_H - 0.3, p.z);
    scene.add(lamp);
    // tiny lamp bulb mesh
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffc080 })
    );
    bulb.position.copy(lamp.position);
    scene.add(bulb);
    flickerLights.push({ light: lamp, bulb, base: 0.9, phase: Math.random() * 10 });
  }

  // Truck headlight / beacon
  if (truck) {
    const beaconColor = 0xffaa22;
    const beacon = new THREE.PointLight(beaconColor, 1.2, 14, 1.8);
    beacon.position.set(truck.pos.x, 2.2, truck.pos.z);
    scene.add(beacon);
    truck.beacon = beacon;
  }

  // Build A* pathfinder
  const pathfinder = new GridPathfinder(walk, W, H);

  return {
    group,
    colliders,
    hideSpots,
    pickups,
    keys,
    truck,
    playerSpawn,
    monsterSpawn,
    walk,
    W, H,
    cellToWorld,
    worldToCell,
    flickerLights,
    pathfinder,
  };
}

// ---------- Prop builders ----------

function makeLocker(group, x, z, cx, cy, ROWS, metalTex, colliders, hideSpots) {
  const w = 0.9, h = 1.9, d = 0.55;

  // Pick orientation: door faces an adjacent walkable cell.
  const H_ROWS = ROWS.length;
  const W_COLS = ROWS[0].length;
  const isOpen = (ix, iy) => ix >= 0 && iy >= 0 && ix < W_COLS && iy < H_ROWS && ROWS[iy][ix] !== "#";
  const orientations = [
    { dx: 0, dz: 1, rotY: 0, cx: 0, cy: 1 },    // face +Z (south)
    { dx: 0, dz: -1, rotY: Math.PI, cx: 0, cy: -1 },
    { dx: 1, dz: 0, rotY: -Math.PI / 2, cx: 1, cy: 0 },
    { dx: -1, dz: 0, rotY: Math.PI / 2, cx: -1, cy: 0 },
  ];
  let chosen = orientations[0];
  for (const o of orientations) {
    if (isOpen(cx + o.cx, cy + o.cy)) { chosen = o; break; }
  }

  const lockerGeo = new THREE.BoxGeometry(w, h, d);
  const lockerMat = new THREE.MeshStandardMaterial({
    map: metalTex, color: 0x444a50, roughness: 0.75, metalness: 0.4
  });
  const locker = new THREE.Mesh(lockerGeo, lockerMat);
  locker.position.set(x, h / 2, z);
  locker.rotation.y = chosen.rotY;
  group.add(locker);

  // door (slightly lighter)
  const doorGeo = new THREE.BoxGeometry(w * 0.95, h * 0.95, 0.04);
  const doorMat = new THREE.MeshStandardMaterial({
    color: 0x555c63, roughness: 0.7, metalness: 0.5
  });
  const door = new THREE.Mesh(doorGeo, doorMat);
  door.position.set(x + chosen.dx * (d / 2 + 0.01), h / 2, z + chosen.dz * (d / 2 + 0.01));
  door.rotation.y = chosen.rotY;
  group.add(door);

  // small handle
  const handle = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.12, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x222222 })
  );
  handle.position.set(
    x + chosen.dx * (d / 2 + 0.05) + chosen.dz * 0.25,
    h / 2 - 0.1,
    z + chosen.dz * (d / 2 + 0.05) - chosen.dx * 0.25
  );
  group.add(handle);

  colliders.push({
    minX: x - w / 2, maxX: x + w / 2,
    minZ: z - d / 2, maxZ: z + d / 2,
    blocksVision: false
  });

  hideSpots.push({
    x, z,
    entryX: x + chosen.dx * 0.6,
    entryZ: z + chosen.dz * 0.6,
    door,
    doorBaseRotY: chosen.rotY,
    open: false,
    occupied: false,
  });
}

function makeDesk(group, x, z, colliders) {
  const w = 1.6, h = 0.8, d = 0.9;
  const top = new THREE.Mesh(
    new THREE.BoxGeometry(w, 0.08, d),
    new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.8 })
  );
  top.position.set(x, h, z);
  group.add(top);
  for (const [dx, dz] of [[-0.7, -0.35], [0.7, -0.35], [-0.7, 0.35], [0.7, 0.35]]) {
    const leg = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, h, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x1f1511, roughness: 0.9 })
    );
    leg.position.set(x + dx, h / 2, z + dz);
    group.add(leg);
  }
  colliders.push({
    minX: x - w / 2, maxX: x + w / 2,
    minZ: z - d / 2, maxZ: z + d / 2,
    blocksVision: false
  });
}

function makeCrate(group, x, z, colliders) {
  const s = 0.9 + Math.random() * 0.3;
  const crate = new THREE.Mesh(
    new THREE.BoxGeometry(s, s, s),
    new THREE.MeshStandardMaterial({ color: 0x5a3e22, roughness: 0.95 })
  );
  crate.position.set(x + (Math.random() - 0.5) * 0.2, s / 2, z + (Math.random() - 0.5) * 0.2);
  crate.rotation.y = Math.random() * 0.4 - 0.2;
  group.add(crate);
  // add plank edges
  const edge = new THREE.Mesh(
    new THREE.BoxGeometry(s * 1.02, 0.04, s * 1.02),
    new THREE.MeshStandardMaterial({ color: 0x2a1a0e })
  );
  edge.position.set(crate.position.x, s - 0.02, crate.position.z);
  group.add(edge);

  colliders.push({
    minX: crate.position.x - s / 2, maxX: crate.position.x + s / 2,
    minZ: crate.position.z - s / 2, maxZ: crate.position.z + s / 2,
    blocksVision: false
  });
}

function makeVentPipes(group, x, z, metalTex, colliders) {
  // vertical + horizontal pipes cluster
  const pipeMat = new THREE.MeshStandardMaterial({
    map: metalTex, color: 0x555555, roughness: 0.6, metalness: 0.6
  });
  for (let i = 0; i < 3; i++) {
    const pipe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, WALL_H, 10),
      pipeMat
    );
    pipe.position.set(x + (i - 1) * 0.35, WALL_H / 2, z);
    group.add(pipe);
  }
  // horizontal
  const h1 = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.1, 1.8, 10),
    pipeMat
  );
  h1.rotation.z = Math.PI / 2;
  h1.position.set(x, WALL_H - 0.6, z);
  group.add(h1);

  colliders.push({
    minX: x - 0.6, maxX: x + 0.6,
    minZ: z - 0.2, maxZ: z + 0.2,
    blocksVision: false
  });
}

function makeBattery(group, x, z) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.12, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x224422, roughness: 0.6, emissive: 0x113322, emissiveIntensity: 0.4 })
  );
  const tip = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.04, 0.05),
    new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.8, roughness: 0.3 })
  );
  tip.position.set(0.11, 0.05, 0);
  g.add(body); g.add(tip);

  // halo
  const halo = new THREE.PointLight(0x66ff99, 0.4, 2.0, 2.0);
  halo.position.set(0, 0, 0);
  g.add(halo);

  g.position.set(x, 0.9, z);
  group.add(g);

  return {
    type: "battery",
    mesh: g,
    pos: new THREE.Vector3(x, 0.9, z),
    collected: false,
    _baseY: 0.9,
    _phase: Math.random() * 10,
  };
}

function makeKey(group, x, z) {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, 0.2, 8),
    new THREE.MeshStandardMaterial({ color: 0xd9b64a, metalness: 0.8, roughness: 0.3, emissive: 0x8a6a20, emissiveIntensity: 0.3 })
  );
  shaft.rotation.z = Math.PI / 2;
  const head = new THREE.Mesh(
    new THREE.TorusGeometry(0.06, 0.02, 6, 16),
    new THREE.MeshStandardMaterial({ color: 0xd9b64a, metalness: 0.8, roughness: 0.3, emissive: 0x8a6a20, emissiveIntensity: 0.3 })
  );
  head.position.x = -0.11;
  head.rotation.y = Math.PI / 2;
  const tooth = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.04, 0.02),
    new THREE.MeshStandardMaterial({ color: 0xd9b64a, metalness: 0.8, roughness: 0.3 })
  );
  tooth.position.set(0.08, -0.03, 0);
  g.add(shaft); g.add(head); g.add(tooth);

  const halo = new THREE.PointLight(0xffcc55, 0.5, 2.4, 2.0);
  g.add(halo);

  g.position.set(x, 0.95, z);
  group.add(g);

  return {
    type: "key",
    mesh: g,
    pos: new THREE.Vector3(x, 0.95, z),
    collected: false,
    _baseY: 0.95,
    _phase: Math.random() * 10,
  };
}

function makeYellowTruck(group, x, z, metalTex, colliders) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);

  const yellow = new THREE.MeshStandardMaterial({
    color: 0xe8b020, roughness: 0.55, metalness: 0.3
  });
  const darkYellow = new THREE.MeshStandardMaterial({
    color: 0xaa7a18, roughness: 0.6, metalness: 0.3
  });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x0a0a14, roughness: 0.3, metalness: 0.1, emissive: 0x050510, emissiveIntensity: 0.2
  });
  const tire = new THREE.MeshStandardMaterial({
    color: 0x0a0a0a, roughness: 0.95, metalness: 0.0
  });

  // Cab
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.6, 2.2), yellow);
  cab.position.set(0, 1.4, -1.2);
  g.add(cab);

  // Roof
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.12, 2.2), darkYellow);
  roof.position.set(0, 2.26, -1.2);
  g.add(roof);

  // Windshield
  const wind = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.9, 0.06), glass);
  wind.position.set(0, 1.75, -0.12);
  g.add(wind);

  // Side windows
  for (const sx of [-1.01, 1.01]) {
    const sw = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.8, 1.4), glass);
    sw.position.set(sx, 1.8, -1.2);
    g.add(sw);
  }

  // Hood
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.9, 1.4), yellow);
  hood.position.set(0, 1.0, 0.6);
  g.add(hood);

  // Flat bed behind cab
  const bed = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.15, 2.5), darkYellow);
  bed.position.set(0, 1.05, -3.3);
  g.add(bed);
  const bedRim = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.6, 0.12), darkYellow);
  bedRim.position.set(0, 1.35, -4.5);
  g.add(bedRim);
  for (const sx of [-1.04, 1.04]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.6, 2.5), darkYellow);
    side.position.set(sx, 1.35, -3.3);
    g.add(side);
  }

  // Wheels
  for (const [wx, wz] of [[-0.95, 0.5], [0.95, 0.5], [-0.95, -2.6], [0.95, -2.6]]) {
    const wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.5, 0.35, 16),
      tire
    );
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.5, wz);
    g.add(wheel);
  }

  // Grille
  const grille = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.4, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.7, roughness: 0.5 })
  );
  grille.position.set(0, 0.8, 1.35);
  g.add(grille);

  // Headlights (geometry)
  for (const hx of [-0.7, 0.7]) {
    const hl = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.2, 0.1),
      new THREE.MeshStandardMaterial({ color: 0xfff4c0, emissive: 0x886020, emissiveIntensity: 1.0 })
    );
    hl.position.set(hx, 1.0, 1.35);
    g.add(hl);
  }

  // Bumper
  const bumper = new THREE.Mesh(
    new THREE.BoxGeometry(2.0, 0.18, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.6, roughness: 0.5 })
  );
  bumper.position.set(0, 0.55, 1.4);
  g.add(bumper);

  group.add(g);

  // Collision box (car bulk)
  colliders.push({
    minX: x - 1.2, maxX: x + 1.2,
    minZ: z - 4.8, maxZ: z + 1.5,
    blocksVision: false
  });

  // Driver door interaction position (left side of cab)
  const interactPos = new THREE.Vector3(x - 1.6, 1.0, z - 1.2);

  return {
    group: g,
    pos: new THREE.Vector3(x, 0, z),
    interactPos,
    started: false,
    // cosmetic — when starting, headlights get real lights
    headlights: [
      new THREE.Vector3(x - 0.7, 1.0, z + 1.35),
      new THREE.Vector3(x + 0.7, 1.0, z + 1.35),
    ],
  };
}

// ---------- A* pathfinder on grid ----------

class GridPathfinder {
  constructor(walk, W, H) {
    this.walk = walk;
    this.W = W; this.H = H;
  }

  isWalkable(cx, cy) {
    return cx >= 0 && cy >= 0 && cx < this.W && cy < this.H && this.walk[cy][cx];
  }

  // Returns array of {cx,cy} or null. Uses 8-dir with corner check.
  find(start, goal) {
    if (!this.isWalkable(start.cx, start.cy) || !this.isWalkable(goal.cx, goal.cy)) return null;
    const key = (x, y) => y * this.W + x;
    const open = new Map();
    const closed = new Set();
    const g = new Map();
    const f = new Map();
    const parent = new Map();

    const startK = key(start.cx, start.cy);
    const goalK = key(goal.cx, goal.cy);
    g.set(startK, 0);
    f.set(startK, heuristic(start, goal));
    open.set(startK, { cx: start.cx, cy: start.cy });

    const neighbors = [
      [1, 0], [-1, 0], [0, 1], [0, -1],
      [1, 1], [1, -1], [-1, 1], [-1, -1],
    ];

    let safety = 6000;
    while (open.size > 0 && safety-- > 0) {
      // pick node with lowest f
      let bestK = null, bestF = Infinity;
      for (const [k] of open) {
        const fv = f.get(k) ?? Infinity;
        if (fv < bestF) { bestF = fv; bestK = k; }
      }
      if (bestK === null) break;
      const cur = open.get(bestK);
      if (bestK === goalK) {
        // reconstruct
        const path = [];
        let k = bestK;
        while (k !== undefined) {
          const y = Math.floor(k / this.W);
          const x = k - y * this.W;
          path.push({ cx: x, cy: y });
          k = parent.get(k);
        }
        return path.reverse();
      }
      open.delete(bestK);
      closed.add(bestK);

      for (const [dx, dy] of neighbors) {
        const nx = cur.cx + dx, ny = cur.cy + dy;
        if (!this.isWalkable(nx, ny)) continue;
        // corner cutting check for diagonals
        if (dx !== 0 && dy !== 0) {
          if (!this.isWalkable(cur.cx + dx, cur.cy) || !this.isWalkable(cur.cx, cur.cy + dy)) continue;
        }
        const nk = key(nx, ny);
        if (closed.has(nk)) continue;
        const step = (dx !== 0 && dy !== 0) ? 1.414 : 1.0;
        const tentative = (g.get(bestK) ?? Infinity) + step;
        if (tentative < (g.get(nk) ?? Infinity)) {
          parent.set(nk, bestK);
          g.set(nk, tentative);
          f.set(nk, tentative + heuristic({ cx: nx, cy: ny }, goal));
          if (!open.has(nk)) open.set(nk, { cx: nx, cy: ny });
        }
      }
    }
    return null;
  }

  // Path from world coords → world waypoints
  findWorld(fromX, fromZ, toX, toZ, worldToCellFn, cellToWorldFn) {
    const s = worldToCellFn(fromX, fromZ);
    const g = worldToCellFn(toX, toZ);
    const path = this.find(s, g);
    if (!path) return null;
    return path.map(p => {
      const w = cellToWorldFn(p.cx, p.cy);
      return new THREE.Vector3(w.x, 0, w.z);
    });
  }

  // random walkable cell
  randomWalkable() {
    for (let i = 0; i < 500; i++) {
      const cx = Math.floor(Math.random() * this.W);
      const cy = Math.floor(Math.random() * this.H);
      if (this.walk[cy][cx]) return { cx, cy };
    }
    return { cx: 1, cy: 1 };
  }
}

function heuristic(a, b) {
  const dx = Math.abs(a.cx - b.cx), dy = Math.abs(a.cy - b.cy);
  return (dx + dy) + (1.414 - 2) * Math.min(dx, dy); // octile
}
