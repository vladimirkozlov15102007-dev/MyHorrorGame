// Interactive object manager: pickups, lockers (hide), truck start sequence.

import * as THREE from "three";
import { Audio } from "./audio.js";

export class InteractionSystem {
  constructor(level, player, ui) {
    this.level = level;
    this.player = player;
    this.ui = ui;

    this.time = 0;
    this.current = null; // currently focused interactable
    this.truckState = {
      active: false,        // mini-game running
      step: 0,              // 0: insert key, 1: crank 1, 2: crank 2, 3: started
      progress: 0,          // 0..1 on current step
      started: false,
      promptTimer: 0,
    };
  }

  update(dt, playerPos, playerDir) {
    this.time += dt;

    // Float & rotate pickups
    for (const item of [...this.level.pickups, ...this.level.keys]) {
      if (item.collected) continue;
      item.mesh.rotation.y += dt * 1.2;
      item.mesh.position.y = item._baseY + Math.sin(this.time * 2 + item._phase) * 0.08;
    }

    // Find nearest interactable within reach
    this.current = this._findFocus(playerPos, playerDir);

    // Truck mini-game update
    if (this.truckState.active) {
      this._updateTruckMinigame(dt);
    }
  }

  _findFocus(pos, dir) {
    const range = 2.4;

    let best = null;
    let bestScore = Infinity;

    // Pickups (batteries/keys)
    for (const item of [...this.level.pickups, ...this.level.keys]) {
      if (item.collected) continue;
      const d = item.pos.distanceTo(pos);
      if (d < range && d < bestScore) {
        bestScore = d;
        best = { type: item.type === "key" ? "key" : "battery", ref: item, label: item.type === "key" ? "PICK UP KEY [E]" : "PICK UP BATTERY [E]" };
      }
    }

    // Lockers
    for (const spot of this.level.hideSpots) {
      const dx = pos.x - spot.entryX, dz = pos.z - spot.entryZ;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < range && d < bestScore && !spot.occupied) {
        bestScore = d;
        best = { type: "locker", ref: spot, label: "HIDE IN LOCKER [E]" };
      }
    }

    // If already hidden, the only interactable is "exit locker"
    if (this.player.state.hidden) {
      const spot = this.player.state.hiddenIn;
      if (spot) {
        return { type: "exitLocker", ref: spot, label: "EXIT LOCKER [E]" };
      }
    }

    // Truck
    if (this.level.truck) {
      const t = this.level.truck;
      const d = t.interactPos.distanceTo(pos);
      if (d < 3.0 && d < bestScore && !t.started) {
        const haveAllKeys = this.player.state.keyCount >= 3;
        if (haveAllKeys) {
          bestScore = d;
          best = { type: "truck", ref: t, label: this.truckState.active ? "HOLD [E] TO CRANK" : "ENTER TRUCK [E]" };
        } else {
          bestScore = d;
          best = { type: "truckLocked", ref: t, label: `NEED ALL 3 KEYS (${this.player.state.keyCount}/3)` };
        }
      }
    }

    return best;
  }

  interact() {
    if (!this.current) return;
    const f = this.current;

    if (f.type === "battery") {
      f.ref.collected = true;
      this.level.group.remove(f.ref.mesh);
      this.player.state.battery = Math.min(1.0, this.player.state.battery + 0.4);
      Audio.pickup();
      this.ui.flashMessage("Battery +40%");
    } else if (f.type === "key") {
      f.ref.collected = true;
      this.level.group.remove(f.ref.mesh);
      this.player.state.keyCount++;
      Audio.keyPickup();
      this.ui.flashMessage(`Key ${this.player.state.keyCount}/3`);
      if (this.player.state.keyCount >= 3) {
        this.ui.flashMessage("All keys found — reach the YELLOW TRUCK");
      }
    } else if (f.type === "locker") {
      this._enterLocker(f.ref);
    } else if (f.type === "exitLocker") {
      this._exitLocker(f.ref);
    } else if (f.type === "truck") {
      if (!this.truckState.active) {
        this.truckState.active = true;
        this.truckState.step = 0;
        this.truckState.progress = 0;
        Audio.doorOpen();
        this.ui.flashMessage("Insert keys, hold E to crank engine");
      } else {
        // handled via hold-to-progress
      }
    }
  }

  // Called each tick while player holds E and truck mini-game is active
  holdInteract(dt) {
    if (!this.truckState.active) return;
    if (this.truckState.started) return;

    this.truckState.progress += dt * 0.35;
    this.truckState.promptTimer += dt;

    if (this.truckState.step === 0) {
      // insert key
      if (this.truckState.progress >= 1.0) {
        this.truckState.step = 1;
        this.truckState.progress = 0;
        this.ui.flashMessage("Keys in. Crank the engine — hold E");
      }
    } else if (this.truckState.step === 1) {
      // crank 1
      if (this.truckState.promptTimer > 0.6) {
        this.truckState.promptTimer = 0;
        Audio.engineCrank();
      }
      if (this.truckState.progress >= 1.0) {
        this.truckState.step = 2;
        this.truckState.progress = 0;
        this.ui.flashMessage("Again — hold E");
      }
    } else if (this.truckState.step === 2) {
      if (this.truckState.promptTimer > 0.55) {
        this.truckState.promptTimer = 0;
        Audio.engineCrank();
      }
      if (this.truckState.progress >= 1.0) {
        // started!
        this.truckState.step = 3;
        this.truckState.started = true;
        this.level.truck.started = true;
        Audio.engineStart();
        this.ui.flashMessage("Engine roars. DRIVE!");
      }
    }
  }

  _enterLocker(spot) {
    if (spot.occupied) return;
    spot.occupied = true;
    spot.open = true;
    spot.door.rotation.y = spot.doorBaseRotY + Math.PI / 2.2; // swing open visually
    Audio.lockerOpen();

    this.player.state.hidden = true;
    this.player.state.hiddenIn = spot;
    this.player.setPosition(spot.x, 1.2, spot.z);

    // Close door after short delay (cosmetic — visually closes)
    setTimeout(() => {
      if (spot.occupied) {
        spot.door.rotation.y = spot.doorBaseRotY;
        spot.open = false;
      }
    }, 500);

    this.ui.flashMessage("Hidden. Hold your breath.");
  }

  _exitLocker(spot) {
    if (!spot || !spot.occupied) return;
    spot.occupied = false;
    spot.open = true;
    spot.door.rotation.y = spot.doorBaseRotY + Math.PI / 2.2;
    Audio.lockerOpen();

    this.player.state.hidden = false;
    this.player.state.hiddenIn = null;

    // place player at entry position
    this.player.setPosition(spot.entryX, 1.6, spot.entryZ);

    setTimeout(() => {
      spot.door.rotation.y = spot.doorBaseRotY;
      spot.open = false;
    }, 400);
  }
}
