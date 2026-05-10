# Old Amber Factory — Tactical Survival Horror (Three.js)

A 3D first-person **tactical survival-horror / stealth-shooter** that runs
entirely in the browser. Built with
[Three.js](https://threejs.org/) (via ES modules / import map) and the
Web Audio API. No build step, no external assets — geometry, textures, and
all sounds are generated at runtime.

## Story

You wake up at night inside the abandoned Amber Factory. Ten ancient archer
skeletons have already risen from the dust and are hunting you with coordinated,
adaptive tactics. Somewhere in the outdoor yard is an old yellow truck — if you
can eliminate every last skeleton and reach it, you escape.

## Controls

| Key | Action |
| --- | --- |
| `W A S D` | Move |
| `Shift`   | Sprint (loud) |
| `Ctrl`    | Crouch (quiet, smaller silhouette) |
| `Space`   | Jump |
| `Mouse`   | Look |
| `LMB`     | Fire pistol |
| `RMB`     | Aim down sights (ADS) |
| `R`       | Reload |
| `E`       | Interact (CCTV, lockers, truck) |

## Combat model

- **Player: 100 HP** with regenerating stamina but no HP regen.
- **Directional damage indicators**: arrows pinpoint the angle you were hit from.
- **Body-part damage** for both sides:
  - Head = **30** damage
  - Body = **20** damage
  - Legs = **10** damage
- **Pistol MAK-9**: 12-round magazine, 48-round reserve, procedural recoil,
  hip-fire spread, ADS zoom, full reload animation with slide rack.

## Skeleton squad AI

Ten anatomically-modelled archer skeletons share a squad blackboard and
individually run an FSM with states:

```
patrol → investigate → alert → combat
                       ↘ flank / ambush / search
                       ↘ retreat (on low HP)
```

Each skeleton has:

- A procedural anatomical body (pelvis, spine vertebrae, 14 ribs, sternum,
  clavicles, arms with elbows/hands/fingers, skull with jaw, eye sockets,
  glowing emissive eye orbs, legs with knees/feet), a curved bow with a
  bowstring, a torn cloth rag and a rusty chest plate.
- HP 100, three AABB hitboxes for head / body / legs.
- Per-skeleton variance (scale, posture lean, shoulder tilt) so silhouettes
  differ.
- Bow-draw animation when firing arrows (physical ballistic projectiles with
  gravity that can impale the player or stick in walls).
- A ragdoll on death — the body collapses into ten bone primitives that
  bounce and settle via simple physics.

### Adaptive tactics

The squad reads your playstyle and adjusts:

| Your behavior | Squad response |
| --- | --- |
| You hide in lockers a lot | Some skeletons switch to `search` and check nearby lockers |
| You sprint constantly | Skeletons hear farther and **lead their shots** to predict your path |
| You camp in one area | Some skeletons switch to `flank` to attack you from behind |
| You fire your pistol | Every skeleton alive on the map hears it instantly |
| You are very aggressive | Skeletons stay at maximum range and fire slower to conserve |
| One skeleton spots you | All living skeletons get your last-known position (radio contact) |

## Rendering

Daytime with sunny outdoor lighting per spec:

- Warm AmbientLight + HemisphereLight (sky/ground bounce).
- Strong DirectionalLight sun (2.2 intensity) + cool fill for shadow lift.
- ACES filmic tone mapping + SRGB output color space.
- Procedural HDR-ish sky dome (blue zenith → warm horizon band), sun billboard
  with glow halo, 14 cloud puff spheres.
- Exponential atmospheric fog for depth.

The 5 zones of the factory (admin corridor, main production hall, warehouse,
ventilation tunnels, outdoor yard) are shielded by ceilings so the interior
retains a dimmer, more oppressive feel while the outdoor yard is bright
and readable.

## How to run

The project uses ES module imports, so you need a static server:

```bash
cd MyHorrorGame
python3 -m http.server 8000
# then open http://localhost:8000/
```

Or enable GitHub Pages on this repository and point it at this folder.

## Project layout

```
MyHorrorGame/
├── index.html            HUD, overlays, Three.js import map
├── styles.css            HP bar, ammo panel, damage arrows, hit marker, overlays
└── js/
    ├── main.js           Game loop, input (WASD/Shift/Ctrl/Space/LMB/RMB/R/E)
    ├── audio.js          Procedural WebAudio + pistol/arrow/skeleton cues
    ├── level.js          Factory generator + sunny lighting + A* pathfinder
    ├── player.js         FPS controller (HP 100, jump, crouch, ADS, directional dmg)
    ├── weapon.js         Pistol MAK-9: viewmodel, recoil, flash, shells, reload
    ├── skeleton.js       10 anatomical archer skeletons + squad AI + ragdoll
    ├── arrow.js          Ballistic arrow projectiles (player damage + impale)
    ├── throwable.js      Distraction items (legacy — kept as secondary mechanic)
    ├── cctv.js           Security-room surveillance mode (optional)
    ├── interactive.js    Truck start sequence (blocked until squad is eliminated)
    └── ui.js             HUD / overlay management (HP, ammo, kills, threat)
```

## Tips

- **Head shots** kill a skeleton in 4 hits. Body = 5. Legs = 10. Aim high.
- Every pistol shot is a dinner bell. Pick your moments; a quiet miss is
  louder than a precise kill.
- If you can, use **Ctrl** to crouch-move between cover and **RMB** to ADS
  before each shot — your pistol is far more accurate than you are.
- The truck will refuse to start while *any* skeleton is still alive.
