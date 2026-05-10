// Old Amber Factory ("Янтарь") — procedural industrial level.
// 5 zones merged into one grid:
//   1) Administrative corridor (Security room + offices)
//   2) Main production hall (high ceilings, conveyors, presses, catwalks)
//   3) Warehouse (tall shelving, narrow aisles)
//   4) Ventilation / tech shafts (low crawl corridors)
//   5) Outdoor yard with the YELLOW TRUCK (Kamaz-like)
//
// Grid-based collision + A* pathfinding are kept for AI, but visuals go well
// beyond the grid (raised catwalks, props, decals, fog, lamps, etc.).
//
// All textures are generated procedurally on canvas so the game is fully
// self-contained and plays in the browser without assets.

import * as THREE from "three";

export const CELL = 2.0;
export const WALL_H = 3.8;
export const HALL_H = 11.0;     // main production hall ceiling height
export const WAREHOUSE_H = 7.5;
export const OUTDOOR_H = 30.0;  // "sky" height for skybox feel

// Map legend:
//   # wall (indoor, 3.8m)
//   . floor (indoor)
//   H main hall floor (ceiling 11m, no indoor ceiling here)
//   W warehouse floor (ceiling 7.5m)
//   O outdoor (no ceiling, sky)
//   v vent crawl (low corridor 1.2m ceiling)
//   # indoor wall
//   = outdoor fence
//   L locker (hide)
//   D desk
//   C crate (medium)
//   X heavy machine (press/conveyor segment)
//   S player spawn (security room)
//   M monster spawn (legacy single)
//   m skeleton spawn point (tactical shooter — multiple)
//   T yellow truck spawn (outdoor)
//   P pallet of throwables (bottles/pipes)
//   K cctv terminal spawn (monitors desk)
//   l lamp spot (ceiling lamp)
//   R rack / tall shelf (warehouse)
//   g garage shutter (passable, open)
//   b bush / tall grass (outdoor)
//   c abandoned car / container (outdoor)
//
// Canvas: 56 x 48 cells (= 112m x 96m)

const RAW = [
  //         1111111111222222222233333333334444444444555555
  //123456789012345678901234567890123456789012345678901234567890
  "########################################################", // 0
  "#S.......#..........#...........#......................#", // 1  SEC ROOM + ADMIN
  "#........#....D.....#.......D...#..RRRRRRR..RRRRRRR....#", // 2
  "#....D...#.l........#.l...m.....#..RRRRRRR..RRRRRRR..m.#", // 3
  "#........#..........#...........#......................#", // 4
  "#.K......#....L.....#..L........#..RRRRRRR..RRRRRRR....#", // 5
  "#........######.#####..........#...RRRRRRR..RRRRRRR....#", // 6
  "#........#..........#...D.......#......................#", // 7
  "#........#..L.......#...........###.#####.#####.#######", // 8
  "#........#..........#...L.......#......................#", // 9
  "###.######..........###.########...RRRRRRR..RRRRRRR....#", // 10
  "#..........................................RRRRRRR....#", // 11
  "#...l........HHHHHHHHHHHHHHHHH..............RRRRRRR....#", // 12
  "#............HHHHHHHHHHHHHHHHH.........................#", // 13
  "#...L........HHHHHHHHHHHHHHHHH.......P..RRRRRRR..L.....#", // 14 MAIN HALL begin
  "#............HHHHHmHHHHHHHHHHH..........RRRRRRR........#", // 15
  "#............HHHHHHHHHHHHHHHHH..........RRRRRRR........#", // 16
  "#...X........HHHHHHHHHHHmHHHHH..........RRRRRRR..m.....#", // 17
  "#............HHHHHHHHHHHHHHHHH...........WWWWW.........#", // 18
  "#............HHHHHHHHHHHHHHHHH...........WWWWW..L......#", // 19
  "#.....l......HHHHHHHHHHHHHHHHH...........WWWWW.........#", // 20
  "#............HHHHHHHHHHHHHHHHH...........WWWWW.........#", // 21
  "#............HHHHHHHHHHHHHHHHH...........WWWWW.........#", // 22
  "#....X.......HHHHHHHHHHHHHHHHH...........WWWWW.....P...#", // 23
  "#............HHHHHHHHHHHHHHHHH.........................#", // 24
  "#............HHHHHHHHHHHHHHHHH.........................#", // 25
  "#....L.......HHHHHHHHHHHHHHHHH.....L....RRRRRRR...L....#", // 26
  "#............HHHHHHHHHHHHHHHHH..........RRRRRRR........#", // 27
  "#.....X......HHHHHHHHHmHHHHHHH..........RRRRRRR..m.....#", // 28
  "#............HHHHHHHHHHHHHHHHH..........RRRRRRR........#", // 29 MAIN HALL end
  "###.################.################...RRRRRRR........#", // 30
  "#....................................vvvvvvvvvvv.......#", // 31  VENT corridor
  "#...vvvvvvvvvvvvvvvv..L.......P..m...vvvvvvvvvvv.L.....#", // 32
  "#...vvvvvvvvvvvvvvvv..................................#", // 33
  "####.######################ggggggggggg#################", // 34  garage shutters
  "=OOOOOOOOOOOOOOOOOOOOOOOOOOggggggggggg=OOOOOOOOOOOOOOOO=", // 35  OUTDOOR yard begins
  "=OOOOOcOOOOOOOOOOOOOOOOmOOOOOOOOOOOOOOO=OOOOOcOOOOOOOOO=", // 36
  "=OOOOOOOOOOOOOObOOOOOOOOOOOOOOOOOOOOOOO=OOOOOOOOOOOOOOO=", // 37
  "=OOOOOOOOOOOOOOOOOOOOOOOOOOTOOOOOOOOOOO=OOOOOcOOOOOOOOO=", // 38
  "=OOOOOcOOOOOOOObOOOOOOOOOOOOOOOOOOOOOOO=OOOOOOOOmOOOOOO=", // 39
  "=OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO=OOOOOOOOOOOOOOO=", // 40
  "=OOOOOOOOOOOOOOOOOOOOOOOOOOOObOOOOOOOOO=OOOOOcOOOOOOOOO=", // 41
  "=OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO=OOOOOOOOOOOOOOO=", // 42
  "========================================================", // 43
  "========================================================", // 44
  "========================================================", // 45
  "========================================================", // 46
  "========================================================", // 47
];

const W = 56;
const H = RAW.length;
function padRow(r) { return r.length >= W ? r.slice(0, W) : r + "=".repeat(W - r.length); }
const ROWS = RAW.map(padRow);

// Classify each cell
// Passable if not '#' and not '='.
const isWall = (ch) => ch === "#";
const isFence = (ch) => ch === "=";
const isOutdoor = (ch) => ch === "O" || ch === "T" || ch === "c" || ch === "b" || ch === "=";
const isVent = (ch) => ch === "v";
const isHall = (ch) => ch === "H" || ch === "M";
const isWarehouse = (ch) => ch === "W" || ch === "R";

function cellToWorld(cx, cy) {
  const ox = (W * CELL) / 2;
  const oy = (H * CELL) / 2;
  return { x: cx * CELL + CELL / 2 - ox, z: cy * CELL + CELL / 2 - oy };
}
function worldToCell(x, z) {
  const ox = (W * CELL) / 2;
  const oy = (H * CELL) / 2;
  return {
    cx: Math.floor((x + ox) / CELL),
    cy: Math.floor((z + oy) / CELL),
  };
}

// ============ Procedural textures ============

function canvasTex(draw, w = 256, h = 256, rep = [1, 1]) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  draw(g, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.repeat.set(rep[0], rep[1]);
  return tex;
}

function makeConcrete(color = "#3a3a3a", dark = "#222") {
  return canvasTex((g, w, h) => {
    g.fillStyle = color; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2400; i++) {
      g.globalAlpha = 0.08 + Math.random() * 0.35;
      g.fillStyle = Math.random() < 0.5 ? dark : "#111";
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    // cracks
    g.globalAlpha = 0.35;
    g.strokeStyle = "#0b0b0b";
    for (let i = 0; i < 6; i++) {
      g.lineWidth = 0.7 + Math.random();
      g.beginPath();
      let x = Math.random() * w, y = Math.random() * h;
      g.moveTo(x, y);
      for (let k = 0; k < 5; k++) {
        x += (Math.random() - 0.5) * 80;
        y += (Math.random() - 0.5) * 80;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    // stains
    for (let i = 0; i < 10; i++) {
      g.globalAlpha = 0.1 + Math.random() * 0.2;
      g.fillStyle = Math.random() < 0.5 ? "#2a1a10" : "#1a1a15";
      g.beginPath();
      g.ellipse(Math.random() * w, Math.random() * h, 15 + Math.random() * 30, 8 + Math.random() * 20, Math.random() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  });
}

function makeTiles() {
  return canvasTex((g, w, h) => {
    g.fillStyle = "#2f2f30"; g.fillRect(0, 0, w, h);
    const ts = 32;
    for (let y = 0; y < h; y += ts) {
      for (let x = 0; x < w; x += ts) {
        g.fillStyle = Math.random() < 0.5 ? "#3a3a3b" : "#323233";
        g.fillRect(x + 1, y + 1, ts - 2, ts - 2);
        if (Math.random() < 0.08) {
          g.fillStyle = "#101010";
          g.fillRect(x + 2, y + 2, ts - 4, ts - 4);
        }
      }
    }
    // dirt
    for (let i = 0; i < 1200; i++) {
      g.globalAlpha = 0.05 + Math.random() * 0.3;
      g.fillStyle = Math.random() < 0.5 ? "#111" : "#2a1a10";
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    g.globalAlpha = 1;
  });
}

function makeRustyMetal() {
  return canvasTex((g, w, h) => {
    g.fillStyle = "#46372c"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 800; i++) {
      g.globalAlpha = 0.2 + Math.random() * 0.55;
      g.fillStyle = ["#6a3a14", "#7a4a1a", "#2a1810", "#4a2a12", "#8a5020"][(Math.random() * 5) | 0];
      const r = 2 + Math.random() * 12;
      g.beginPath();
      g.arc(Math.random() * w, Math.random() * h, r, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 0.25;
    g.strokeStyle = "#1a0e06"; g.lineWidth = 1;
    for (let i = 0; i < 10; i++) {
      g.beginPath();
      g.moveTo(0, Math.random() * h); g.lineTo(w, Math.random() * h);
      g.stroke();
    }
    g.globalAlpha = 1;
  });
}

function makeBrick() {
  return canvasTex((g, w, h) => {
    g.fillStyle = "#4a3028"; g.fillRect(0, 0, w, h);
    const bw = 48, bh = 20;
    for (let y = 0; y < h; y += bh) {
      const off = (y / bh) % 2 === 0 ? 0 : bw / 2;
      for (let x = -bw; x < w + bw; x += bw) {
        g.fillStyle = ["#5a3a30", "#50342a", "#6a443a", "#44281f"][(Math.random() * 4) | 0];
        g.fillRect(x + off + 1, y + 1, bw - 2, bh - 2);
      }
    }
    g.globalAlpha = 0.3;
    for (let i = 0; i < 600; i++) {
      g.fillStyle = "#1a0e08";
      g.fillRect(Math.random() * w, Math.random() * h, 1, 1);
    }
    g.globalAlpha = 1;
  });
}

function makeGrass() {
  return canvasTex((g, w, h) => {
    g.fillStyle = "#1a2012"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 3000; i++) {
      g.globalAlpha = 0.1 + Math.random() * 0.4;
      g.fillStyle = ["#2a3018", "#1e2812", "#3a4020", "#0e140a"][(Math.random() * 4) | 0];
      g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
    g.globalAlpha = 1;
  });
}

function makeAsphalt() {
  return canvasTex((g, w, h) => {
    g.fillStyle = "#1a1a1b"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4000; i++) {
      g.globalAlpha = 0.1 + Math.random() * 0.3;
      g.fillStyle = ["#222", "#0a0a0a", "#2a2a28"][(Math.random() * 3) | 0];
      g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
    // a faint yellow hazard stripe
    g.globalAlpha = 0.25;
    g.fillStyle = "#8a6a20";
    g.fillRect(0, h / 2 - 2, w, 4);
    g.globalAlpha = 1;
  });
}

// ============ Builder ============

export function buildLevel(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const colliders = [];
  const hideSpots = [];
  const throwablesSpawns = [];   // world positions for throwable items
  const cctvInfo = {
    terminalPos: null,           // Vector3 of CCTV desk
    terminalInteract: null,      // Vector3 near desk to approach
    cameras: [],                 // array of { pos: Vec3, lookAt: Vec3, name }
  };
  let playerSpawn = { x: 0, y: 1.65, z: 0 };
  let monsterSpawn = { x: 0, y: 0, z: 0 };
  const skeletonSpawns = [];
  let truck = null;

  const walk = Array.from({ length: H }, () => Array(W).fill(false));
  const zoneMap = Array.from({ length: H }, () => Array(W).fill("."));

  // Pre-pass: collect skeleton spawns ('m') and rewrite those cells to
  // inherit their zone character from a walkable neighbor (so floor materials
  // + ceiling heights remain correct).
  for (let cy = 0; cy < H; cy++) {
    let row = ROWS[cy];
    if (row.indexOf("m") === -1) continue;
    const arr = row.split("");
    for (let cx = 0; cx < W; cx++) {
      if (arr[cx] !== "m") continue;
      const { x, z } = cellToWorld(cx, cy);
      skeletonSpawns.push({ x, y: 0, z });
      // inherit from a passable neighbor that isn't 'm'
      let inherit = ".";
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const nc = ROWS[ny][nx];
        if (nc === "#" || nc === "=" || nc === "m") continue;
        inherit = nc;
        break;
      }
      arr[cx] = inherit;
    }
    ROWS[cy] = arr.join("");
  }

  // classify cells
  for (let cy = 0; cy < H; cy++) {
    for (let cx = 0; cx < W; cx++) {
      const ch = ROWS[cy][cx];
      if (!isWall(ch) && !isFence(ch)) walk[cy][cx] = true;
      zoneMap[cy][cx] = ch;
    }
  }

  // ----- Floors (split by zone, distinct materials) -----
  const floorTiles = makeTiles();        floorTiles.repeat.set(W, H);
  const floorConcrete = makeConcrete("#2e2e2e", "#151515"); floorConcrete.repeat.set(W, H);
  const floorWarehouse = makeConcrete("#3c342a", "#1a1510"); floorWarehouse.repeat.set(W, H);
  const floorVent = makeRustyMetal();    floorVent.repeat.set(W, H);
  const floorAsphalt = makeAsphalt();    floorAsphalt.repeat.set(W, H);
  const floorGrass = makeGrass();        floorGrass.repeat.set(W, H);

  // We'll draw one large floor plane per zone using per-cell box panels to
  // keep texture coverage + performance reasonable. Use two huge planes for outdoor (grass+asphalt).

  // Big outdoor grass plane far beyond fence — creates depth
  const grassBig = new THREE.Mesh(
    new THREE.PlaneGeometry(220, 220),
    new THREE.MeshStandardMaterial({ map: floorGrass, roughness: 1.0 })
  );
  grassBig.rotation.x = -Math.PI / 2;
  grassBig.position.set(0, -0.02, (H * CELL) / 2 - 20);
  group.add(grassBig);

  // Per-cell floor panels
  const cellGeo = new THREE.PlaneGeometry(CELL, CELL);
  const floorMats = {
    indoor: new THREE.MeshStandardMaterial({ map: floorTiles, roughness: 0.95 }),
    hall:   new THREE.MeshStandardMaterial({ map: floorConcrete, roughness: 0.95 }),
    wh:     new THREE.MeshStandardMaterial({ map: floorWarehouse, roughness: 0.95 }),
    vent:   new THREE.MeshStandardMaterial({ map: floorVent, roughness: 0.7, metalness: 0.5 }),
    out:    new THREE.MeshStandardMaterial({ map: floorAsphalt, roughness: 1.0 }),
  };
  function classifyFloor(ch) {
    if (isHall(ch)) return floorMats.hall;
    if (isWarehouse(ch)) return floorMats.wh;
    if (isVent(ch)) return floorMats.vent;
    if (isOutdoor(ch)) return floorMats.out;
    return floorMats.indoor;
  }

  // Batch: instanced meshes per material
  const matGroups = new Map();
  for (let cy = 0; cy < H; cy++) {
    for (let cx = 0; cx < W; cx++) {
      const ch = ROWS[cy][cx];
      if (isWall(ch) || isFence(ch)) continue;
      const mat = classifyFloor(ch);
      if (!matGroups.has(mat)) matGroups.set(mat, []);
      matGroups.get(mat).push([cx, cy, ch]);
    }
  }
  const dummy = new THREE.Object3D();
  for (const [mat, cells] of matGroups) {
    const inst = new THREE.InstancedMesh(cellGeo, mat, cells.length);
    inst.receiveShadow = true;
    for (let i = 0; i < cells.length; i++) {
      const [cx, cy] = cells[i];
      const { x, z } = cellToWorld(cx, cy);
      dummy.position.set(x, 0, z);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
  }

  // ----- Ceilings: indoor areas get a ceiling at WALL_H; warehouse at WAREHOUSE_H;
  //        main hall at HALL_H (with skylight holes via lunar light).
  //        Vent crawl is low. Outdoor has no ceiling (sky).
  const ceilConcrete = makeConcrete("#1a1a1a", "#0a0a0a");
  const ceilMats = {
    indoor: new THREE.MeshStandardMaterial({ map: ceilConcrete, roughness: 1.0, side: THREE.DoubleSide }),
    hall:   new THREE.MeshStandardMaterial({ color: 0x0b0b0f, roughness: 1.0, side: THREE.DoubleSide }),
    wh:     new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 1.0, side: THREE.DoubleSide }),
    vent:   new THREE.MeshStandardMaterial({ map: makeRustyMetal(), roughness: 0.9, side: THREE.DoubleSide, metalness: 0.3 }),
  };
  const ceilGroups = {
    indoor: [], hall: [], wh: [], vent: [],
  };
  for (let cy = 0; cy < H; cy++) {
    for (let cx = 0; cx < W; cx++) {
      const ch = ROWS[cy][cx];
      if (isWall(ch) || isFence(ch) || isOutdoor(ch)) continue;
      if (isHall(ch)) ceilGroups.hall.push([cx, cy]);
      else if (isWarehouse(ch)) ceilGroups.wh.push([cx, cy]);
      else if (isVent(ch)) ceilGroups.vent.push([cx, cy]);
      else ceilGroups.indoor.push([cx, cy]);
    }
  }
  function ceilHeightOf(kind) {
    return kind === "hall" ? HALL_H : kind === "wh" ? WAREHOUSE_H : kind === "vent" ? 1.4 : WALL_H;
  }
  for (const kind of Object.keys(ceilGroups)) {
    const cells = ceilGroups[kind];
    if (!cells.length) continue;
    const inst = new THREE.InstancedMesh(cellGeo, ceilMats[kind], cells.length);
    const hgt = ceilHeightOf(kind);
    for (let i = 0; i < cells.length; i++) {
      const [cx, cy] = cells[i];
      const { x, z } = cellToWorld(cx, cy);
      dummy.position.set(x, hgt, z);
      dummy.rotation.set(Math.PI / 2, 0, 0);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
  }

  // ----- Walls (indoor '#') and fence ('=') -----
  const wallTex = makeConcrete("#3a3a38", "#1d1d1c"); wallTex.repeat.set(1, 2);
  const brickTex = makeBrick(); brickTex.repeat.set(1, 2);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.95 });
  const brickMat = new THREE.MeshStandardMaterial({ map: brickTex, roughness: 0.95 });

  // Walls where height depends on neighbor zone (tallest neighbor gets its height)
  let wallCells = [];
  for (let cy = 0; cy < H; cy++) {
    for (let cx = 0; cx < W; cx++) {
      if (ROWS[cy][cx] === "#") wallCells.push([cx, cy]);
    }
  }
  const wallInst = new THREE.InstancedMesh(
    new THREE.BoxGeometry(CELL, 1, CELL),
    wallMat,
    wallCells.length
  );
  for (let i = 0; i < wallCells.length; i++) {
    const [cx, cy] = wallCells[i];
    const { x, z } = cellToWorld(cx, cy);
    // choose height: max of neighbor passable cells' zone heights (or fallback to WALL_H)
    let hgt = WALL_H;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const nc = ROWS[ny][nx];
      if (isWall(nc) || isFence(nc)) continue;
      let zh = WALL_H;
      if (isHall(nc)) zh = HALL_H;
      else if (isWarehouse(nc)) zh = WAREHOUSE_H;
      else if (isOutdoor(nc)) zh = 6.0; // outer industrial wall
      else if (isVent(nc)) zh = 1.4;
      if (zh > hgt) hgt = zh;
    }
    dummy.position.set(x, hgt / 2, z);
    dummy.scale.set(1, hgt, 1);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    wallInst.setMatrixAt(i, dummy.matrix);
    colliders.push({
      minX: x - CELL / 2, maxX: x + CELL / 2,
      minZ: z - CELL / 2, maxZ: z + CELL / 2,
      blocksVision: true, kind: "wall"
    });
  }
  wallInst.instanceMatrix.needsUpdate = true;
  dummy.scale.set(1, 1, 1);
  group.add(wallInst);

  // Outer brick exterior wall of factory (where indoor meets outdoor) — decorative
  // (Handled indirectly by wall cells; we add brick pillars along the south face.)

  // Fence (outdoor boundary '=')
  const fenceCells = [];
  for (let cy = 0; cy < H; cy++) {
    for (let cx = 0; cx < W; cx++) {
      if (ROWS[cy][cx] === "=") fenceCells.push([cx, cy]);
    }
  }
  if (fenceCells.length) {
    const fenceGeo = new THREE.BoxGeometry(CELL, 2.2, CELL * 0.15);
    const fenceMat = new THREE.MeshStandardMaterial({
      color: 0x302522, roughness: 0.9, metalness: 0.2
    });
    const fenceInst = new THREE.InstancedMesh(fenceGeo, fenceMat, fenceCells.length * 2);
    let fi = 0;
    for (const [cx, cy] of fenceCells) {
      const { x, z } = cellToWorld(cx, cy);
      dummy.position.set(x, 1.1, z);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      fenceInst.setMatrixAt(fi++, dummy.matrix);
      colliders.push({
        minX: x - CELL / 2, maxX: x + CELL / 2,
        minZ: z - CELL / 2, maxZ: z + CELL / 2,
        blocksVision: false, kind: "fence"
      });
    }
    fenceInst.count = fi;
    fenceInst.instanceMatrix.needsUpdate = true;
    group.add(fenceInst);
  }

  // ---------- Props by zone ----------
  const metalTex = makeRustyMetal();

  for (let cy = 0; cy < H; cy++) {
    for (let cx = 0; cx < W; cx++) {
      const ch = ROWS[cy][cx];
      const { x, z } = cellToWorld(cx, cy);

      if (ch === "S") {
        playerSpawn = { x, y: 1.65, z };
      } else if (ch === "M") {
        monsterSpawn = { x, y: 0, z };
      } else if (ch === "L") {
        makeLocker(group, x, z, cx, cy, ROWS, metalTex, colliders, hideSpots);
      } else if (ch === "D") {
        makeDesk(group, x, z, colliders);
      } else if (ch === "C") {
        makeCrate(group, x, z, colliders);
      } else if (ch === "X") {
        makeHeavyMachine(group, x, z, metalTex, colliders);
      } else if (ch === "R") {
        makeWarehouseRack(group, x, z, metalTex, colliders);
      } else if (ch === "P") {
        // pallet of throwables (spawn pile)
        makeThrowablePallet(group, x, z, colliders, throwablesSpawns);
      } else if (ch === "K") {
        const tinfo = makeCCTVTerminal(group, x, z, colliders);
        cctvInfo.terminalPos = tinfo.pos;
        cctvInfo.terminalInteract = tinfo.interactPos;
      } else if (ch === "T") {
        truck = makeYellowTruck(group, x, z, metalTex, colliders);
      } else if (ch === "c") {
        makeAbandonedContainer(group, x, z, metalTex, colliders);
      } else if (ch === "b") {
        makeBush(group, x, z, colliders);
      } else if (ch === "l") {
        // lamp placeholder handled below when we put lights
      } else if (ch === "g") {
        makeShutter(group, x, z);
      }
    }
  }

  // ----- Catwalks over main hall (Zone 2) -----
  buildMainHallProps(group, metalTex, colliders);

  // Warehouse shelves decorations already via 'R', but add top crates
  buildWarehouseTopDecor(group);

  // Outdoor: broken cars + lone lamp above the truck
  buildOutdoorDecor(group, metalTex, colliders, truck);

  // ----- Lighting -----
  // Per spec: outdoors should read as sunlit/brightly moonlit with strong
  // fill from the sky, so detail reads clearly across the yard.  Indoors the
  // local lamps carry the mood.
  const ambient = new THREE.AmbientLight(0x5a6a82, 0.75);
  scene.add(ambient);
  const hemi = new THREE.HemisphereLight(0x8aa6d8, 0x2a251e, 0.95);
  scene.add(hemi);

  // "Sun" (cold moonlight pretending to be low sun) — strong directional light
  const moon = new THREE.DirectionalLight(0xf0eac8, 2.4);
  moon.position.set(60, 90, 40);
  moon.castShadow = false; // keep perf for big scene
  scene.add(moon);

  // Secondary cool fill light from opposite side
  const fillLight = new THREE.DirectionalLight(0x6a8cc4, 0.55);
  fillLight.position.set(-40, 60, -30);
  scene.add(fillLight);

  // Admin lamps (ceiling fluorescent)
  const flickerLights = [];
  const lampCells = [];
  for (let cy = 0; cy < H; cy++) {
    for (let cx = 0; cx < W; cx++) {
      if (ROWS[cy][cx] === "l") lampCells.push([cx, cy]);
    }
  }
  for (const [cx, cy] of lampCells) {
    const { x, z } = cellToWorld(cx, cy);
    const lamp = new THREE.PointLight(0xfff0c0, 1.4, 9.0, 1.8);
    lamp.position.set(x, WALL_H - 0.2, z);
    scene.add(lamp);
    const tube = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.08, 0.18),
      new THREE.MeshStandardMaterial({ emissive: 0xffe0a0, color: 0xffe0a0, emissiveIntensity: 1.2 })
    );
    tube.position.copy(lamp.position);
    scene.add(tube);
    flickerLights.push({ light: lamp, bulb: tube, base: 1.4, phase: Math.random() * 10 });
  }

  // Main hall bright spotlights (few, cold)
  const hallLampSpots = [
    { cx: 16, cy: 16 }, { cx: 24, cy: 20 }, { cx: 16, cy: 26 }, { cx: 24, cy: 28 },
  ];
  for (const { cx, cy } of hallLampSpots) {
    const { x, z } = cellToWorld(cx, cy);
    const spot = new THREE.SpotLight(0x9ec4ff, 2.5, 22, Math.PI / 5, 0.5, 1.2);
    spot.position.set(x, HALL_H - 0.5, z);
    const tgt = new THREE.Object3D();
    tgt.position.set(x, 0, z);
    scene.add(tgt);
    spot.target = tgt;
    scene.add(spot);
    const housing = new THREE.Mesh(
      new THREE.ConeGeometry(0.4, 0.5, 12),
      new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0x99bbff, emissiveIntensity: 0.5 })
    );
    housing.position.copy(spot.position);
    housing.rotation.x = Math.PI;
    scene.add(housing);
    flickerLights.push({ light: spot, bulb: housing, base: 2.5, phase: Math.random() * 10, small: 0.05 });
  }

  // Warehouse: warm sparse lamps
  for (let cx = 35; cx <= 50; cx += 6) {
    for (let cy = 14; cy <= 28; cy += 7) {
      const { x, z } = cellToWorld(cx, cy);
      const lamp = new THREE.PointLight(0xffc070, 1.0, 8.5, 2.0);
      lamp.position.set(x, WAREHOUSE_H - 0.4, z);
      scene.add(lamp);
      const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xffc070 })
      );
      bulb.position.copy(lamp.position);
      scene.add(bulb);
      flickerLights.push({ light: lamp, bulb, base: 1.0, phase: Math.random() * 10 });
    }
  }

  // Truck beacon / yard lamp (lone lamppost)
  if (truck) {
    const yardLamp = new THREE.PointLight(0xffb060, 2.0, 14, 1.8);
    yardLamp.position.set(truck.pos.x, 5.0, truck.pos.z - 0.5);
    scene.add(yardLamp);
    const yardBulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0xffd090 })
    );
    yardBulb.position.copy(yardLamp.position);
    scene.add(yardBulb);
    // lamppost pole
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.1, 5, 8),
      new THREE.MeshStandardMaterial({ color: 0x202020, roughness: 0.8 })
    );
    pole.position.set(truck.pos.x, 2.5, truck.pos.z - 0.5);
    scene.add(pole);
    flickerLights.push({ light: yardLamp, bulb: yardBulb, base: 2.0, phase: 7, small: 0.04 });
    truck.beacon = yardLamp;
  }

  // Fog — thinner so outdoor yard stays readable; indoors still feels misty.
  scene.fog = new THREE.FogExp2(0x14202c, 0.011);

  // ----- CCTV camera setup (6 cams) -----
  // Placed at ceiling corners of key zones; look at key areas.
  const cam = (px, py, pz, tx, ty, tz, name) => ({
    pos: new THREE.Vector3(px, py, pz),
    lookAt: new THREE.Vector3(tx, ty, tz),
    name,
  });
  const secRoom = cellToWorld(5, 3);
  const hall1 = cellToWorld(20, 14);
  const hall2 = cellToWorld(20, 28);
  const wh1 = cellToWorld(44, 18);
  const corridor = cellToWorld(24, 32);
  const outdoorView = cellToWorld(30, 38);
  cctvInfo.cameras = [
    cam(secRoom.x + 3, 3.2, secRoom.z + 1, hall1.x, 1.5, hall1.z, "CAM-01 HALL-N"),
    cam(hall1.x - 6, HALL_H - 1, hall1.z, hall1.x + 6, 1.5, hall1.z, "CAM-02 PROD-W"),
    cam(hall2.x + 6, HALL_H - 1, hall2.z, hall2.x - 6, 1.5, hall2.z, "CAM-03 PROD-E"),
    cam(wh1.x - 4, WAREHOUSE_H - 0.6, wh1.z - 2, wh1.x + 4, 1.5, wh1.z + 2, "CAM-04 WAREHOUSE"),
    cam(corridor.x, 2.8, corridor.z - 2, corridor.x, 1.5, corridor.z + 6, "CAM-05 CORRIDOR"),
    cam(outdoorView.x, 8.0, outdoorView.z - 4, outdoorView.x, 1.5, outdoorView.z + 6, "CAM-06 YARD"),
  ];
  // Mount tiny camera meshes at each cam position (visual only)
  for (const c of cctvInfo.cameras) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.2, 0.4),
      new THREE.MeshStandardMaterial({ color: 0x303030, metalness: 0.6, roughness: 0.5 })
    );
    const lens = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 0.2, 10),
      new THREE.MeshStandardMaterial({ color: 0x101010, emissive: 0x220000, emissiveIntensity: 0.4 })
    );
    lens.rotation.z = Math.PI / 2;
    lens.position.x = 0.2;
    g.add(body); g.add(lens);
    g.position.copy(c.pos);
    g.lookAt(c.lookAt);
    group.add(g);
  }

  // --- Pathfinder ---
  const pathfinder = new GridPathfinder(walk, W, H);

  if (!playerSpawn || (playerSpawn.x === 0 && playerSpawn.z === 0)) {
    const w0 = cellToWorld(1, 1);
    playerSpawn = { x: w0.x, y: 1.65, z: w0.z };
  }
  if (!monsterSpawn || (monsterSpawn.x === 0 && monsterSpawn.z === 0)) {
    const w1 = cellToWorld(W - 4, 4);
    monsterSpawn = { x: w1.x, y: 0, z: w1.z };
  }
  // If we somehow have fewer than 10 skeleton spawns, auto-scatter the rest
  // onto random walkable cells far from the player spawn.
  while (skeletonSpawns.length < 10) {
    const cell = pathfinder.randomWalkable();
    const w = cellToWorld(cell.cx, cell.cy);
    const d = Math.hypot(w.x - playerSpawn.x, w.z - playerSpawn.z);
    if (d > 14) {
      skeletonSpawns.push({ x: w.x, y: 0, z: w.z });
    } else {
      // try again
    }
    if (skeletonSpawns.length > 20) break;  // safety
  }

  return {
    group,
    colliders,
    hideSpots,
    throwablesSpawns,
    cctvInfo,
    truck,
    playerSpawn,
    monsterSpawn,
    skeletonSpawns,
    walk, zoneMap,
    W, H,
    CELL, WALL_H, HALL_H, WAREHOUSE_H,
    cellToWorld, worldToCell,
    flickerLights,
    pathfinder,
    ROWS,
  };
}

// ============ Prop builders ============

function makeLocker(group, x, z, cx, cy, ROWS, metalTex, colliders, hideSpots) {
  const w = 0.9, h = 1.9, d = 0.55;
  const H2 = ROWS.length, W2 = ROWS[0].length;
  const isOpenCell = (ix, iy) => ix >= 0 && iy >= 0 && ix < W2 && iy < H2
    && ROWS[iy][ix] !== "#" && ROWS[iy][ix] !== "=";
  const orientations = [
    { dx: 0, dz: 1, rotY: 0, cx: 0, cy: 1 },
    { dx: 0, dz: -1, rotY: Math.PI, cx: 0, cy: -1 },
    { dx: 1, dz: 0, rotY: -Math.PI / 2, cx: 1, cy: 0 },
    { dx: -1, dz: 0, rotY: Math.PI / 2, cx: -1, cy: 0 },
  ];
  let chosen = orientations[0];
  for (const o of orientations) {
    if (isOpenCell(cx + o.cx, cy + o.cy)) { chosen = o; break; }
  }
  const lockerMat = new THREE.MeshStandardMaterial({
    map: metalTex, color: 0x424a55, roughness: 0.75, metalness: 0.45
  });
  const locker = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lockerMat);
  locker.position.set(x, h / 2, z);
  locker.rotation.y = chosen.rotY;
  group.add(locker);

  const doorMat = new THREE.MeshStandardMaterial({
    color: 0x535a63, roughness: 0.7, metalness: 0.5
  });
  const door = new THREE.Mesh(new THREE.BoxGeometry(w * 0.94, h * 0.95, 0.04), doorMat);
  door.position.set(x + chosen.dx * (d / 2 + 0.01), h / 2, z + chosen.dz * (d / 2 + 0.01));
  door.rotation.y = chosen.rotY;
  group.add(door);

  const vent = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.6, 0.1, 0.01),
    new THREE.MeshStandardMaterial({ color: 0x161616 })
  );
  vent.position.set(
    x + chosen.dx * (d / 2 + 0.025),
    h - 0.25,
    z + chosen.dz * (d / 2 + 0.025)
  );
  vent.rotation.y = chosen.rotY;
  group.add(vent);

  colliders.push({
    minX: x - w / 2, maxX: x + w / 2,
    minZ: z - d / 2, maxZ: z + d / 2,
    blocksVision: false, kind: "locker"
  });
  hideSpots.push({
    x, z,
    entryX: x + chosen.dx * 0.6,
    entryZ: z + chosen.dz * 0.6,
    door, doorBaseRotY: chosen.rotY,
    open: false, occupied: false,
  });
}

function makeDesk(group, x, z, colliders) {
  const w = 1.6, h = 0.82, d = 0.9;
  const top = new THREE.Mesh(
    new THREE.BoxGeometry(w, 0.08, d),
    new THREE.MeshStandardMaterial({ color: 0x4a331f, roughness: 0.85 })
  );
  top.position.set(x, h, z); group.add(top);
  for (const [dx, dz] of [[-0.72, -0.38], [0.72, -0.38], [-0.72, 0.38], [0.72, 0.38]]) {
    const leg = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, h, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x1f140c, roughness: 0.9 })
    );
    leg.position.set(x + dx, h / 2, z + dz); group.add(leg);
  }
  // CRT monitor on top (shattered)
  const mon = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.45, 0.5),
    new THREE.MeshStandardMaterial({ color: 0xbdbd9c, roughness: 0.9 })
  );
  mon.position.set(x - 0.3, h + 0.25, z - 0.1);
  group.add(mon);
  const screen = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.32, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x050a0a, emissive: 0x020302, emissiveIntensity: 0.2 })
  );
  screen.position.set(x - 0.3, h + 0.25, z - 0.36);
  group.add(screen);
  // mug
  const mug = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 0.1, 8),
    new THREE.MeshStandardMaterial({ color: 0xbe4e2a })
  );
  mug.position.set(x + 0.3, h + 0.08, z + 0.1);
  group.add(mug);
  colliders.push({
    minX: x - w / 2, maxX: x + w / 2,
    minZ: z - d / 2, maxZ: z + d / 2,
    blocksVision: false, kind: "desk"
  });
}

function makeCrate(group, x, z, colliders) {
  const s = 0.85 + Math.random() * 0.3;
  const crate = new THREE.Mesh(
    new THREE.BoxGeometry(s, s, s),
    new THREE.MeshStandardMaterial({ color: 0x5a3d22, roughness: 0.95 })
  );
  crate.position.set(x + (Math.random() - 0.5) * 0.2, s / 2, z + (Math.random() - 0.5) * 0.2);
  crate.rotation.y = Math.random() * 0.4 - 0.2;
  group.add(crate);
  const edge = new THREE.Mesh(
    new THREE.BoxGeometry(s * 1.02, 0.04, s * 1.02),
    new THREE.MeshStandardMaterial({ color: 0x2a1a0e })
  );
  edge.position.set(crate.position.x, s - 0.02, crate.position.z);
  group.add(edge);
  colliders.push({
    minX: crate.position.x - s / 2, maxX: crate.position.x + s / 2,
    minZ: crate.position.z - s / 2, maxZ: crate.position.z + s / 2,
    blocksVision: false, kind: "crate"
  });
}

function makeHeavyMachine(group, x, z, metalTex, colliders) {
  const mat = new THREE.MeshStandardMaterial({
    map: metalTex, color: 0x4a4a48, roughness: 0.75, metalness: 0.55
  });
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.0, 1.4), mat);
  base.position.set(x, 0.5, z);
  group.add(base);
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.3, 0.9), mat);
  top.position.set(x, 1.65, z - 0.1);
  group.add(top);
  const piston = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.15, 0.8, 12),
    new THREE.MeshStandardMaterial({ color: 0x8a8a8a, metalness: 0.8, roughness: 0.3 })
  );
  piston.position.set(x, 2.6, z);
  group.add(piston);
  colliders.push({
    minX: x - 0.9, maxX: x + 0.9,
    minZ: z - 0.7, maxZ: z + 0.7,
    blocksVision: false, kind: "machine"
  });
}

function makeWarehouseRack(group, x, z, metalTex, colliders) {
  const mat = new THREE.MeshStandardMaterial({
    map: metalTex, color: 0x4a4a46, roughness: 0.8, metalness: 0.4
  });
  const colMat = new THREE.MeshStandardMaterial({
    color: 0x303030, roughness: 0.9, metalness: 0.4
  });
  // 4 vertical columns
  for (const [dx, dz] of [[-0.95, -0.45], [0.95, -0.45], [-0.95, 0.45], [0.95, 0.45]]) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.1, WAREHOUSE_H - 0.3, 0.1), colMat);
    col.position.set(x + dx, (WAREHOUSE_H - 0.3) / 2, z + dz);
    group.add(col);
  }
  // 3 shelves
  for (const h of [0.4, 1.8, 3.3, 4.8]) {
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.06, 1.0), mat);
    shelf.position.set(x, h, z);
    group.add(shelf);
    // random boxes on shelf
    const nBoxes = 2 + (Math.random() * 3) | 0;
    for (let i = 0; i < nBoxes; i++) {
      const bw = 0.4 + Math.random() * 0.3;
      const bh = 0.35 + Math.random() * 0.25;
      const bd = 0.4 + Math.random() * 0.2;
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(bw, bh, bd),
        new THREE.MeshStandardMaterial({ color: [0x5a3e22, 0x3a3a3a, 0x7a5a2a, 0x2a2a2a][(Math.random() * 4) | 0], roughness: 0.95 })
      );
      const bx = x + (Math.random() - 0.5) * 1.4;
      const bz = z + (Math.random() - 0.5) * 0.6;
      box.position.set(bx, h + bh / 2 + 0.04, bz);
      box.rotation.y = Math.random() * 0.3 - 0.15;
      group.add(box);
    }
  }
  colliders.push({
    minX: x - 1.0, maxX: x + 1.0,
    minZ: z - 0.5, maxZ: z + 0.5,
    blocksVision: true, kind: "rack"
  });
}

function makeThrowablePallet(group, x, z, colliders, spawns) {
  // Wooden pallet
  const pal = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 0.1, 1.1),
    new THREE.MeshStandardMaterial({ color: 0x4a2f1a, roughness: 0.95 })
  );
  pal.position.set(x, 0.05, z);
  group.add(pal);
  colliders.push({
    minX: x - 0.55, maxX: x + 0.55,
    minZ: z - 0.55, maxZ: z + 0.55,
    blocksVision: false, kind: "pallet"
  });
  // Spawn markers (throwable.js will populate)
  const kinds = ["bottle", "pipe", "bottle", "nut", "can", "pipe"];
  for (let i = 0; i < 5; i++) {
    const ox = (Math.random() - 0.5) * 0.7;
    const oz = (Math.random() - 0.5) * 0.7;
    spawns.push({
      x: x + ox, y: 0.2, z: z + oz,
      kind: kinds[(Math.random() * kinds.length) | 0],
    });
  }
}

function makeCCTVTerminal(group, x, z, colliders) {
  const w = 2.2, h = 0.95, d = 0.9;
  const deskMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.8 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, d), deskMat);
  top.position.set(x, h, z); group.add(top);
  // desk body
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h - 0.04, d * 0.9), deskMat);
  body.position.set(x, (h - 0.04) / 2, z + 0.03);
  group.add(body);
  // 4 monitors
  const monMat = new THREE.MeshStandardMaterial({ color: 0x181818, roughness: 0.85 });
  const scrMat = new THREE.MeshStandardMaterial({
    color: 0x0a1a0a, emissive: 0x103010, emissiveIntensity: 0.8
  });
  for (let i = 0; i < 4; i++) {
    const mx = x - w / 2 + 0.35 + i * 0.5;
    const hb = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.38, 0.06), monMat);
    hb.position.set(mx, h + 0.3, z - d / 2 + 0.1);
    group.add(hb);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.32), scrMat);
    scr.position.set(mx, h + 0.3, z - d / 2 + 0.14);
    group.add(scr);
  }
  // keyboard
  const kb = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 0.04, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x0a0a0a })
  );
  kb.position.set(x, h + 0.05, z + d / 2 - 0.25);
  group.add(kb);
  // chair
  const chair = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.1, 0.55),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a })
  );
  chair.position.set(x, 0.55, z + d / 2 + 0.5);
  group.add(chair);
  const back = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.6, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a })
  );
  back.position.set(x, 0.9, z + d / 2 + 0.75);
  group.add(back);
  colliders.push({
    minX: x - w / 2, maxX: x + w / 2,
    minZ: z - d / 2, maxZ: z + d / 2,
    blocksVision: false, kind: "cctv"
  });
  return {
    pos: new THREE.Vector3(x, h + 0.3, z - d / 2 + 0.14),
    interactPos: new THREE.Vector3(x, 1.6, z + d / 2 + 0.6),
  };
}

function makeAbandonedContainer(group, x, z, metalTex, colliders) {
  const w = 2.0, h = 2.2, d = 1.6;
  const mat = new THREE.MeshStandardMaterial({
    map: metalTex, color: [0x4a2020, 0x205040, 0x4a3a1a][(Math.random() * 3) | 0],
    roughness: 0.85, metalness: 0.35
  });
  const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  box.position.set(x, h / 2, z);
  box.rotation.y = Math.random() * 0.3 - 0.15;
  group.add(box);
  // ribs
  for (let i = -1; i <= 1; i += 1) {
    const rib = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, h * 0.95, d * 0.98),
      new THREE.MeshStandardMaterial({ color: 0x1a1a1a })
    );
    rib.position.set(x + i * (w * 0.35), h / 2, z);
    rib.rotation.y = box.rotation.y;
    group.add(rib);
  }
  colliders.push({
    minX: x - w / 2, maxX: x + w / 2,
    minZ: z - d / 2, maxZ: z + d / 2,
    blocksVision: true, kind: "container"
  });
}

function makeBush(group, x, z, colliders) {
  for (let i = 0; i < 10; i++) {
    const blade = new THREE.Mesh(
      new THREE.PlaneGeometry(0.12, 0.9),
      new THREE.MeshStandardMaterial({ color: 0x2a3a1a, roughness: 1, side: THREE.DoubleSide })
    );
    blade.position.set(
      x + (Math.random() - 0.5) * 1.0,
      0.45,
      z + (Math.random() - 0.5) * 1.0
    );
    blade.rotation.y = Math.random() * Math.PI;
    group.add(blade);
  }
}

function makeShutter(group, x, z) {
  const mat = new THREE.MeshStandardMaterial({
    map: makeRustyMetal(), color: 0x555555, roughness: 0.8, metalness: 0.4
  });
  // raised shutter — a horizontal bar up high
  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(CELL, 0.5, 0.12),
    mat
  );
  bar.position.set(x, WALL_H - 0.5, z);
  group.add(bar);
  // tracks on walls
  const track = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, WALL_H, 0.15),
    mat
  );
  track.position.set(x - CELL / 2 + 0.05, WALL_H / 2, z);
  group.add(track);
  const track2 = track.clone(); track2.position.x = x + CELL / 2 - 0.05;
  group.add(track2);
}

function buildMainHallProps(group, metalTex, colliders) {
  // Catwalk: metallic walkway at ~5.5m, crossing hall at a few Z lines
  const walkMat = new THREE.MeshStandardMaterial({
    map: metalTex, color: 0x555555, roughness: 0.7, metalness: 0.5
  });
  const railMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a });
  const zLines = [-12, -4, 6, 14];
  for (const zw of zLines) {
    const wk = new THREE.Mesh(
      new THREE.BoxGeometry(34, 0.1, 1.4),
      walkMat
    );
    wk.position.set(0, 5.6, zw);
    group.add(wk);
    // railings
    for (const side of [-0.7, 0.7]) {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(34, 0.04, 0.04),
        railMat
      );
      rail.position.set(0, 6.5, zw + side);
      group.add(rail);
      // vertical posts
      for (let px = -16; px <= 16; px += 2) {
        const post = new THREE.Mesh(
          new THREE.BoxGeometry(0.06, 0.9, 0.06),
          railMat
        );
        post.position.set(px, 6.05, zw + side);
        group.add(post);
      }
    }
  }
  // Conveyor belts (simple)
  for (let i = 0; i < 3; i++) {
    const zw = -8 + i * 8;
    const belt = new THREE.Mesh(
      new THREE.BoxGeometry(26, 0.2, 1.0),
      new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.95 })
    );
    belt.position.set(0, 0.8, zw);
    group.add(belt);
    // legs
    for (let lx = -12; lx <= 12; lx += 4) {
      const leg = new THREE.Mesh(
        new THREE.BoxGeometry(0.15, 0.8, 0.15),
        new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.4 })
      );
      leg.position.set(lx, 0.4, zw);
      group.add(leg);
    }
    colliders.push({
      minX: -13, maxX: 13, minZ: zw - 0.5, maxZ: zw + 0.5,
      blocksVision: false, kind: "conveyor"
    });
  }
  // Big hanging pipes across ceiling
  for (let i = 0; i < 5; i++) {
    const zw = -13 + i * 6;
    const pipe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.25, 32, 10),
      new THREE.MeshStandardMaterial({ map: metalTex, color: 0x5a5040, roughness: 0.6, metalness: 0.5 })
    );
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(0, HALL_H - 1.2, zw);
    group.add(pipe);
  }
}

function buildWarehouseTopDecor(group) {
  // nothing needed beyond what makeWarehouseRack already does
}

function buildOutdoorDecor(group, metalTex, colliders, truck) {
  // Brick exterior wall along south face of factory (decorative pillars at fence line)
  // Already handled by walls/fence. Add a skybox-ish dome.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(180, 32, 20, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x0a1226) },
        horizonColor: { value: new THREE.Color(0x3a5278) },
        sunColor: { value: new THREE.Color(0x94aacc) },
        sunDir: { value: new THREE.Vector3(60, 90, 40).normalize() },
      },
      vertexShader: `
        varying vec3 vWorldPos;
        void main() {
          vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vWorldPos;
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        uniform vec3 sunColor;
        uniform vec3 sunDir;
        void main() {
          vec3 dir = normalize(vWorldPos);
          float h = clamp(dir.y, 0.0, 1.0);
          vec3 col = mix(horizonColor, topColor, pow(h, 0.6));
          float sunDot = max(0.0, dot(dir, normalize(sunDir)));
          col += sunColor * pow(sunDot, 18.0) * 1.4;
          col += sunColor * pow(sunDot, 3.0) * 0.08;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    })
  );
  sky.position.y = 0;
  group.add(sky);
  // add some faint star dots via a particle sprite
  const starGeo = new THREE.BufferGeometry();
  const starCount = 400;
  const positions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const r = 140;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.random() * Math.PI * 0.48 + 0.05;
    positions[i * 3]     = Math.sin(ph) * Math.cos(th) * r;
    positions[i * 3 + 1] = Math.cos(ph) * r;
    positions[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * r;
  }
  starGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
    color: 0xbfd6ff, size: 0.8, sizeAttenuation: false, depthWrite: false, opacity: 0.85, transparent: true
  }));
  group.add(stars);

  // Moon billboard
  const moonMesh = new THREE.Mesh(
    new THREE.CircleGeometry(3.2, 32),
    new THREE.MeshBasicMaterial({ color: 0xd8e4ff, transparent: true, opacity: 0.92, depthWrite: false })
  );
  moonMesh.position.set(62, 72, 42);
  moonMesh.lookAt(0, 0, 0);
  group.add(moonMesh);
  // Moon halo
  const moonHalo = new THREE.Mesh(
    new THREE.CircleGeometry(5.5, 24),
    new THREE.MeshBasicMaterial({ color: 0x94aacc, transparent: true, opacity: 0.18, depthWrite: false })
  );
  moonHalo.position.copy(moonMesh.position).multiplyScalar(0.99);
  moonHalo.lookAt(0, 0, 0);
  group.add(moonHalo);
}

function makeYellowTruck(group, x, z, metalTex, colliders) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);

  const yellow = new THREE.MeshStandardMaterial({
    color: 0xe3a61c, roughness: 0.55, metalness: 0.3
  });
  const darkYellow = new THREE.MeshStandardMaterial({
    color: 0xa87418, roughness: 0.65, metalness: 0.3
  });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x0a0a14, roughness: 0.3, metalness: 0.1, emissive: 0x050510, emissiveIntensity: 0.2
  });
  const tire = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.95 });

  // Cab
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.8, 2.4), yellow);
  cab.position.set(0, 1.5, -1.3);
  g.add(cab);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 2.4), darkYellow);
  roof.position.set(0, 2.46, -1.3);
  g.add(roof);
  // windshield (back of cab if facing +Z is "front"; using cab facing +Z towards viewer)
  const wind = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.95, 0.06), glass);
  wind.position.set(0, 1.9, -0.14);
  g.add(wind);
  // side windows
  for (const sx of [-1.11, 1.11]) {
    const sw = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.85, 1.5), glass);
    sw.position.set(sx, 1.95, -1.3);
    g.add(sw);
  }
  // hood
  const hood = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.0, 1.6), yellow);
  hood.position.set(0, 1.05, 0.7);
  g.add(hood);
  // flat bed
  const bed = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.15, 2.8), darkYellow);
  bed.position.set(0, 1.1, -3.5);
  g.add(bed);
  const bedRim = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.65, 0.12), darkYellow);
  bedRim.position.set(0, 1.42, -4.82);
  g.add(bedRim);
  for (const sx of [-1.14, 1.14]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.65, 2.8), darkYellow);
    side.position.set(sx, 1.42, -3.5);
    g.add(side);
  }
  // wheels
  for (const [wx, wz] of [[-1.0, 0.6], [1.0, 0.6], [-1.0, -2.8], [1.0, -2.8]]) {
    const wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.55, 0.4, 18),
      tire
    );
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.55, wz);
    g.add(wheel);
    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 0.42, 10),
      new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.7, roughness: 0.3 })
    );
    hub.rotation.z = Math.PI / 2;
    hub.position.set(wx, 0.55, wz);
    g.add(hub);
  }
  // grille
  const grille = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 0.5, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.7, roughness: 0.5 })
  );
  grille.position.set(0, 0.85, 1.55);
  g.add(grille);
  // headlights
  for (const hx of [-0.75, 0.75]) {
    const hl = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.22, 0.1),
      new THREE.MeshStandardMaterial({ color: 0xfff4c0, emissive: 0x886020, emissiveIntensity: 1.0 })
    );
    hl.position.set(hx, 1.05, 1.55);
    g.add(hl);
  }
  // bumper
  const bumper = new THREE.Mesh(
    new THREE.BoxGeometry(2.0, 0.2, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.6, roughness: 0.5 })
  );
  bumper.position.set(0, 0.6, 1.6);
  g.add(bumper);
  // side mirror
  for (const mx of [-1.2, 1.2]) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.15, 0.25, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x1a1a1a })
    );
    m.position.set(mx, 2.0, -0.2);
    g.add(m);
  }

  group.add(g);

  colliders.push({
    minX: x - 1.3, maxX: x + 1.3,
    minZ: z - 5.0, maxZ: z + 1.7,
    blocksVision: false, kind: "truck"
  });

  return {
    group: g,
    pos: new THREE.Vector3(x, 0, z),
    interactPos: new THREE.Vector3(x - 1.8, 1.0, z - 1.3),
    started: false,
    headlights: [
      new THREE.Vector3(x - 0.75, 1.05, z + 1.55),
      new THREE.Vector3(x + 0.75, 1.05, z + 1.55),
    ],
  };
}

// ============ A* pathfinder ============

class GridPathfinder {
  constructor(walk, W, H) { this.walk = walk; this.W = W; this.H = H; }
  isWalkable(cx, cy) { return cx >= 0 && cy >= 0 && cx < this.W && cy < this.H && this.walk[cy][cx]; }
  find(start, goal) {
    if (!this.isWalkable(start.cx, start.cy) || !this.isWalkable(goal.cx, goal.cy)) return null;
    const key = (x, y) => y * this.W + x;
    const open = new Map(); const closed = new Set();
    const g = new Map(); const f = new Map(); const parent = new Map();
    const startK = key(start.cx, start.cy); const goalK = key(goal.cx, goal.cy);
    g.set(startK, 0); f.set(startK, heuristic(start, goal));
    open.set(startK, { cx: start.cx, cy: start.cy });
    const neighbors = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
    let safety = 9000;
    while (open.size > 0 && safety-- > 0) {
      let bestK = null, bestF = Infinity;
      for (const [k] of open) { const fv = f.get(k) ?? Infinity; if (fv < bestF) { bestF = fv; bestK = k; } }
      if (bestK === null) break;
      const cur = open.get(bestK);
      if (bestK === goalK) {
        const path = []; let k = bestK;
        while (k !== undefined) {
          const y = Math.floor(k / this.W); const x = k - y * this.W;
          path.push({ cx: x, cy: y }); k = parent.get(k);
        }
        return path.reverse();
      }
      open.delete(bestK); closed.add(bestK);
      for (const [dx, dy] of neighbors) {
        const nx = cur.cx + dx, ny = cur.cy + dy;
        if (!this.isWalkable(nx, ny)) continue;
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
  findWorld(fromX, fromZ, toX, toZ, w2cFn, c2wFn) {
    const s = w2cFn(fromX, fromZ), g = w2cFn(toX, toZ);
    const path = this.find(s, g);
    if (!path) return null;
    return path.map(p => { const w = c2wFn(p.cx, p.cy); return new THREE.Vector3(w.x, 0, w.z); });
  }
  randomWalkable() {
    for (let i = 0; i < 600; i++) {
      const cx = Math.floor(Math.random() * this.W);
      const cy = Math.floor(Math.random() * this.H);
      if (this.walk[cy][cx]) return { cx, cy };
    }
    return { cx: 1, cy: 1 };
  }
}
function heuristic(a, b) {
  const dx = Math.abs(a.cx - b.cx), dy = Math.abs(a.cy - b.cy);
  return (dx + dy) + (1.414 - 2) * Math.min(dx, dy);
}
