// Interactive object manager.
//
// Interactions (E):
//   - Throwable pickup (from ThrowableSystem items)
//   - Locker hide / exit
//   - CCTV terminal activate / deactivate
//   - Truck start sequence (hold E). Truck REFUSES to start until all 10
//     skeletons are dead (user spec).

import * as THREE from "three";
import { Audio } from "./audio.js";

export class InteractionSystem {
  constructor(level, player, ui, throwableSystem, cctv, skeletonManager) {
    this.level = level;
    this.player = player;
    this.ui = ui;
    this.throwables = throwableSystem;
    this.cctv = cctv;
    this.skeletons = skeletonManager;    // may be null during early construction; set by setter

    this.time = 0;
    this.current = null;
    this.truckState = {
      active: false,
      step: 0,
      progress: 0,
      started: false,
      promptTimer: 0,
    };
  }

  setSkeletonManager(mgr) {
    this.skeletons = mgr;
  }

  update(dt, playerPos, playerDir) {
    this.time += dt;
    this.throwables.update(dt, playerPos);
    this.current = this._findFocus(playerPos, playerDir);
    if (this.truckState.active) this._updateTruckPromptTimer(dt);
  }

  _findFocus(pos, dir) {
    const range = 2.4;
    let best = null, bestD = range;

    // If hidden, only "exit locker" is available
    if (this.player.state.hidden) {
      const spot = this.player.state.hiddenIn;
      if (spot) {
        return { type: "exitLocker", ref: spot, label: "EXIT LOCKER [E]" };
      }
    }

    // Throwables
    const it = this.throwables.nearestItem(pos, range);
    if (it) {
      best = { type: "throwable", ref: it, label: `PICK UP ${labelFor(it.kind)} [E]` };
      bestD = it.pos.distanceTo(pos);
    }

    // Lockers
    for (const spot of this.level.hideSpots) {
      const dx = pos.x - spot.entryX, dz = pos.z - spot.entryZ;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < range && d < bestD && !spot.occupied) {
        bestD = d;
        best = { type: "locker", ref: spot, label: "HIDE IN LOCKER [E]" };
      }
    }

    // CCTV terminal
    const cctvInfo = this.level.cctvInfo;
    if (cctvInfo && cctvInfo.terminalInteract) {
      const d = cctvInfo.terminalInteract.distanceTo(pos);
      if (d < 2.6 && d < bestD) {
        let label;
        if (this.cctv.isActive) label = "EXIT SURVEILLANCE [E]";
        else if (this.cctv.inCooldown) label = `CCTV COOLDOWN (${this.cctv.cooldownLeft.toFixed(0)}s)`;
        else label = "ACCESS CCTV [E]";
        best = { type: "cctv", ref: null, label };
        bestD = d;
      }
    }

    // Truck
    if (this.level.truck) {
      const t = this.level.truck;
      const d = t.interactPos.distanceTo(pos);
      if (d < 3.2 && d < bestD && !t.started) {
        const skelAlive = this.skeletons ? this.skeletons.alive : 0;
        if (skelAlive > 0) {
          best = { type: "truck_blocked", ref: t,
            label: `ELIMINATE THE ${skelAlive} REMAINING SKELETON${skelAlive !== 1 ? "S" : ""}` };
        } else if (!this.truckState.active) {
          best = { type: "truck", ref: t, label: "ENTER TRUCK [E]" };
        } else {
          best = { type: "truck", ref: t, label: "HOLD [E] TO START ENGINE" };
        }
        bestD = d;
      }
    }

    return best;
  }

  interact() {
    if (!this.current) return;
    const f = this.current;

    if (f.type === "throwable") {
      // Picking up throwables just collects them (no carry system in the
      // shooter build — kept for legacy distraction mechanic).
      const picked = this.throwables.pickup(f.ref);
      if (picked) {
        this.ui.flashMessage(`Picked up ${labelFor(f.ref.kind)}`);
      }
    } else if (f.type === "locker") {
      this._enterLocker(f.ref);
    } else if (f.type === "exitLocker") {
      this._exitLocker(f.ref);
    } else if (f.type === "cctv") {
      if (this.cctv.isActive) {
        this.cctv.deactivate(false);
        this.player.state.usingCCTV = false;
        this.ui.flashMessage("CCTV off");
      } else if (!this.cctv.inCooldown) {
        if (this.cctv.activate()) {
          this.player.state.usingCCTV = true;
          Audio.cctvHum();
          this.ui.flashMessage("SURVEILLANCE ACTIVE");
        }
      } else {
        this.ui.flashMessage("System cooling down");
      }
    } else if (f.type === "truck") {
      if (!this.truckState.active) {
        this.truckState.active = true;
        this.truckState.step = 0;
        this.truckState.progress = 0;
        Audio.doorOpen();
        this.ui.flashMessage("Get in, hold E to start the engine");
      }
    } else if (f.type === "truck_blocked") {
      this.ui.flashMessage("Cannot escape yet — eliminate all skeletons first");
    }
  }

  holdInteract(dt) {
    if (!this.truckState.active || this.truckState.started) return;
    this.truckState.progress += dt * 0.32;
    this.truckState.promptTimer += dt;
    if (this.truckState.step === 0) {
      if (this.truckState.progress >= 1.0) {
        this.truckState.step = 1; this.truckState.progress = 0;
        this.ui.flashMessage("Keys in. CRANK — hold E");
      }
    } else if (this.truckState.step === 1) {
      if (this.truckState.promptTimer > 0.6) {
        this.truckState.promptTimer = 0;
        Audio.engineCrank();
      }
      if (this.truckState.progress >= 1.0) {
        this.truckState.step = 2; this.truckState.progress = 0;
        this.ui.flashMessage("Again! — hold E");
      }
    } else if (this.truckState.step === 2) {
      if (this.truckState.promptTimer > 0.55) {
        this.truckState.promptTimer = 0;
        Audio.engineCrank();
      }
      if (this.truckState.progress >= 1.0) {
        this.truckState.step = 3;
        this.truckState.started = true;
        this.level.truck.started = true;
        Audio.engineStart();
        this.ui.flashMessage("Engine ROARS. DRIVE!");
      }
    }
  }

  _updateTruckPromptTimer(dt) {
    // no-op reserved
  }

  _enterLocker(spot) {
    if (spot.occupied) return;
    spot.occupied = true;
    spot.open = true;
    spot.door.rotation.y = spot.doorBaseRotY + Math.PI / 2.2;
    Audio.lockerOpen();

    this.player.state.hidden = true;
    this.player.state.hiddenIn = spot;
    this.player.setPosition(spot.x, 1.2, spot.z);

    setTimeout(() => {
      if (spot.occupied) {
        spot.door.rotation.y = spot.doorBaseRotY;
        spot.open = false;
      }
    }, 500);

    this.ui.flashMessage("Hidden. Breathe silently.");
  }

  _exitLocker(spot) {
    if (!spot || !spot.occupied) return;
    spot.occupied = false;
    spot.open = true;
    spot.door.rotation.y = spot.doorBaseRotY + Math.PI / 2.2;
    Audio.lockerOpen();

    this.player.state.hidden = false;
    this.player.state.hiddenIn = null;

    this.player.setPosition(spot.entryX, 1.68, spot.entryZ);

    setTimeout(() => {
      spot.door.rotation.y = spot.doorBaseRotY;
      spot.open = false;
    }, 400);
  }
}

function labelFor(kind) {
  switch (kind) {
    case "bottle": return "BOTTLE";
    case "pipe":   return "PIPE";
    case "nut":    return "NUT";
    case "can":    return "CAN";
    case "rebar":  return "REBAR";
  }
  return (kind || "ITEM").toUpperCase();
}
