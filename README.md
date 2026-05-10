# The Yellow Truck — Browser Horror Game

A 3D first-person horror game that runs entirely in the browser. Built with
[Three.js](https://threejs.org/) (via ES modules / import map) and the Web
Audio API. No build step, no assets on disk — geometry, textures, and all
sounds are generated at runtime.

## Story

You wake up at night in an abandoned industrial complex. Something tall and
thin is already hunting you. Somewhere in the garage there is an old **yellow
truck** — if you can find the three keys, reach it, and start the engine, you
might live to see morning.

## Controls

| Key | Action |
| --- | --- |
| `W A S D` | Move |
| `Mouse` | Look |
| `Shift` | Run (loud — the monster learns to chase footsteps) |
| `Ctrl` / `C` | Crouch (quiet) |
| `F` | Flashlight (drains battery, can give you away) |
| `B` | Binoculars (zoom, but you move slowly and barely hear) |
| `E` | Interact / hide in locker / exit locker / hold to crank truck |

## Features

- **Adaptive monster AI.** A Finite State Machine (`PATROL`,
  `INVESTIGATE`, `CHASE`, `AMBUSH`, `SEARCH_HIDING`, `STUNNED`) backed by a
  persistent blackboard that learns from your playstyle:
  - Hide in lockers too often → the monster starts checking lockers and
    setting ambushes near your last known position.
  - Keep the flashlight on → its effective light-detection range grows.
  - Sprint a lot → its hearing radius widens and chase speed increases.
- **Sight / sound / light** senses with wall line-of-sight checks.
- **Grid-based A\* pathfinding** for the monster.
- **Procedurally generated factory** — corridors, rooms, a central garage,
  lockers, crates, desks, vents, and a detailed yellow truck.
- **Hiding** in lockers, **pickups** (3 keys, batteries), **truck start
  mini-game** (insert keys → crank → crank → roar away).
- **Procedural audio**: heartbeat, breathing, footsteps, monster growls
  and screeches, engine cranks — all synthesized via WebAudio, no assets.
- **Moody rendering**: concrete/metal canvas textures, flickering point
  lights, exponential fog, vignette, heartbeat pulse, death jumpscare,
  binoculars "tunnel" overlay.

## How to run

Just open `index.html` via any HTTP server (browsers block ES module
imports on `file://`):

```bash
# from inside the MyHorrorGame directory
python3 -m http.server 8000
# then open http://localhost:8000/
```

Or enable GitHub Pages on this repository (Settings → Pages → Deploy from
branch → `main` → `/MyHorrorGame`) and visit the URL.

## Project layout

```
MyHorrorGame/
├── index.html         # HUD, overlays, Three.js import map
├── styles.css         # Vignette, panels, binoculars overlay, jumpscare
└── js/
    ├── main.js        # Game loop, input, start/death/win, truck escape
    ├── audio.js       # Procedural WebAudio engine
    ├── level.js       # Factory generator + A* pathfinder
    ├── interactive.js # Pickups, lockers, truck mini-game
    ├── player.js      # FPS controller, flashlight, binoculars, stats
    ├── monster.js     # FSM + blackboard adaptive AI
    └── ui.js          # HUD / overlay management
```

## Tips (no spoilers)

- Crouch is your friend. Sprinting teaches the monster to chase sound.
- The flashlight is a spotlight: if it sweeps across the monster, it *will*
  notice. But total darkness is worse — there is no way out without it.
- Use binoculars from a locker opening to check the next room before moving.
- The garage is at the **bottom** of the map. Find 3 keys first.
