# Old Amber Factory — Unity Horror Game

A fully procedural Unity port of the browser version. Unlike the Three.js
version (kept in `../MyHorrorGame/` of the same repository), this project
targets **Unity 2022.3 LTS** and builds every mesh, texture, material, and
audio clip in C# at runtime — no imported assets, no Asset Store packages.

Open in Unity 2022.3 LTS → Play. That's it.

## How to open

1. Install **Unity Hub** + **Unity 2022.3.40f1** (any 2022.3 LTS patch works).
2. In Unity Hub: `Open → Add project from disk →` select the `MyHorrorGame-Unity/`
   folder.
3. Open `Assets/AmberFactory/Scenes/Main.unity`. (It's intentionally empty;
   `Bootstrap.cs` builds the entire world from code on play.)
4. Press **Play**.

## Story

You wake up at night in the abandoned `Amber` factory (Заброшенный завод
«Янтарь»). Something tall and thin is already hunting. Find three truck
keys, reach the yellow KAMAZ in the yard, and drive away.

## Controls

| Key | Action |
| --- | --- |
| `WASD` | Move |
| `Mouse` | Look |
| `Q` | Sprint (loud — AI learns) |
| `CTRL` / `C` | Crouch (quiet) |
| **Hold `Shift`** | Binoculars |
| `Mouse Wheel` (while binoculars held) | Zoom 1× → 8× |
| `E` | Interact / enter locker / exit locker / activate CCTV / enter truck |
| `LMB` hold | Aim thrown item (charge shown in prompt) |
| `LMB` release | Throw with force proportional to charge |
| `G` | Drop held item |

> **There is no flashlight.** The factory has authored lighting (cold moon
> shafts, fluorescent tubes, warm work lamps, a street lamp over the truck)
> so you can see — but the shadows are deep.

## Level: "Amber Factory" zones

Everything is constructed in `LevelBuilder.cs`:

1. **Zone 1 — Admin block** (security room, offices, break room)
   - Flipped desks, yellowed papers, broken CRT monitors, coats on racks.
   - Flickering fluorescent lights.
   - Player spawns in the security room — next to the **4-monitor terminal**.
2. **Zone 2 — Main production hall**
   - 50×44 m, 12.5 m ceiling.
   - Three rusty conveyor belts, four hydraulic presses, a gantry crane
     on ceiling rails, barrels, lockers along the walls.
   - Blue moon shafts through roof holes (with dust cones), warm work lamps.
3. **Zone 3 — Warehouse**
   - Four tall shelf rows packed with wooden crates.
   - Broken windows emit cold blue exterior light through the east wall.
4. **Zone 4 — Ventilation ducts**
   - Low horizontal ductwork across the hall. Player can walk/crouch under.
5. **Zone 5 — Outdoor yard (exit)**
   - Asphalt yard with rusty shipping containers, abandoned cars, grass,
     a single working street lamp, and the **yellow KAMAZ truck**.

## Systems

### Throwable / Distraction system (`ThrowableSystem.cs`, `Throwable.cs`, `Projectile.cs`)

- Pickup types: **bottle, tin can, steel pipe, rebar, nut**.
- Hold `LMB` → crosshair "CHARGE x%" grows; held item wobbles.
- Release `LMB` → ballistic projectile with substepped collision.
- Glass shatters (burst particle + shard SFX), metal clangs, wood thuds.
- Every landing emits a **noise event** the Monster consumes. The monster
  walks over to the last noise point in `Investigate` state.

### Adaptive Monster AI (`Monster.cs` + `MonsterMesh.cs`)

- **States:** `Patrol / Investigate / Chase / Ambush / SearchHiding / Stunned`.
- **Blackboard** stores `LastSeen`, `LastNoise`, `AmbushPos`, `WitnessedHide`,
  plus three adaptive scores:
  - `HideScore` → more ambushes + it will **break into the same locker** it
    saw you enter.
  - `SprintScore` → bigger hearing radius, faster chase.
- **Senses:** sight cone with wall LOS (`Physics.Raycast`), hearing from
  player noise and thrown-item noise.
- **Pathfinding:** `NavGrid.cs` — 2 m A\* grid with octile heuristic.

### Dynamic Music (`DynamicMusic.cs`)

Four looping layers that crossfade by monster distance:

| Layer | Target |
| --- | --- |
| Ambient drone | always on, ducked when tension rises |
| Tension 1 | fades in at 25–40 m |
| Tension 2 | fades in under 20 m |
| Chase    | fades in only during `Chase` state — adds kick drum pulses |

### Spatial ambience (`AmbientSfx.cs`)

- Random distant drips, creaks, wind gusts placed in 3D around the player.
- 3D monster-breath triggers when the monster is 10–30 m away.
- Player heart rate + breathing scaled by tension & activity.

### CCTV Security Room (`CCTVSystem.cs` + `SecurityTerminal.cs`)

- Press `E` at the 4-monitor security desk.
- Renders 4 fixed cameras (corridor, main hall, warehouse, yard) into
  `RenderTexture`s shown on a split-screen UI with scanlines and static.
- Player freezes (cannot move or look). The monster can reach you while
  you watch.
- Active for **30 s**, then **75 s cooldown**.

### Truck escape (`TruckStarter.cs`)

- All 3 keys required.
- Press `E` to climb in → hold `E` to insert key → crank → crank → **roar**.
- Truck headlights flare, truck drives away, win panel shows.

## File map

```
MyHorrorGame-Unity/
├── ProjectSettings/ProjectVersion.txt        2022.3.40f1
├── Packages/manifest.json                     (built-in only)
└── Assets/AmberFactory/
    ├── Scenes/Main.unity                      (empty; everything built in code)
    └── Scripts/
        ├── Bootstrap.cs                       RuntimeInitialize entry point
        ├── GameManager.cs                     top-level orchestration
        ├── LevelBuilder.cs                    all 5 zones
        ├── ProceduralTextures.cs              concrete / rust / wood / ...
        ├── ProceduralAudio.cs                 all AudioClip synthesis
        ├── DynamicMusic.cs                    4-layer adaptive music
        ├── AmbientSfx.cs                      drips / creaks / wind / heart
        ├── PlayerController.cs                move / crouch / sprint / hide
        │                                       + binoculars (Shift + wheel)
        ├── Monster.cs                         FSM + blackboard
        ├── MonsterMesh.cs                     procedural skeleton
        ├── NavGrid.cs                         A* on 2 m grid
        ├── ThrowableSystem.cs                 pickup / aim / throw focus
        ├── Throwable.cs                       world item
        ├── Projectile.cs                      physics + noise emission
        ├── HidingSpot.cs                      locker interaction
        ├── Pickup.cs                          truck keys
        ├── TruckStarter.cs                    start mini-game + escape
        ├── SecurityTerminal.cs                interactive marker
        ├── CCTVSystem.cs                      4 cams + UI + cooldown
        ├── FlickerLight.cs                    fluorescent flicker
        ├── HUDController.cs                   in-game HUD
        └── GameUI.cs                          menu / death / win / jumpscare
```

## Building a standalone

In Unity → `File → Build Settings → Windows / Mac / Linux` → `Build`. The
only scene is `Main.unity`; everything else is constructed at startup.

## Why no imported assets?

The repo is shipped via text files only, which is incompatible with Unity's
binary asset + GUID-based .meta workflow. Instead we put **100% of the world
construction into C#**, so cloning the repo and hitting Play is enough.
