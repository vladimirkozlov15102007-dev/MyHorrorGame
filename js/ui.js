// HUD / overlay management.

export class UI {
  constructor() {
    this.staminaFill = document.getElementById("staminaFill");
    this.slotBino    = document.getElementById("slotBino");
    this.slotHeld    = document.getElementById("slotHeld");
    this.slotCCTV    = document.getElementById("slotCCTV");
    this.zoomReadout = document.getElementById("zoomReadout");
    this.aimBar      = document.getElementById("aimBar");
    this.aimFill     = document.getElementById("aimFill");
    this.prompt      = document.getElementById("prompt");
    this.subtitle    = document.getElementById("subtitle");
    this.damageFlash = document.getElementById("damageFlash");
    this.binoOverlay = document.getElementById("binocularOverlay");
    this.objective   = document.getElementById("objective");
    this.monsterState = document.getElementById("monsterState");
    this.distBar     = document.getElementById("distBar");
    this.distFill    = document.getElementById("distFill");

    this.startScreen = document.getElementById("startScreen");
    this.deathScreen = document.getElementById("deathScreen");
    this.winScreen   = document.getElementById("winScreen");
    this.jumpscare   = document.getElementById("jumpscare");
    this.deathText   = document.getElementById("deathText");

    this._subtitleTimer = 0;
    this._pulseTimer = 0;
  }

  update(dt, { player, monster, interaction, cctv }) {
    // Stamina bar
    const sPct = Math.max(0, Math.min(1, player.state.stamina));
    this.staminaFill.style.width = (sPct * 100).toFixed(1) + "%";

    // Binocular slot active while held
    this.slotBino.classList.toggle("active", player.state.binocularsOn);
    this.zoomReadout.textContent = player.state.binocularsOn
      ? `ZOOM ${player.state.binocZoom.toFixed(1)}x` : "";

    // Held item slot
    const held = player.state.held;
    if (held) {
      this.slotHeld.classList.add("active");
      this.slotHeld.textContent = labelFor(held.kind) + " · LMB THROW";
    } else {
      this.slotHeld.classList.remove("active");
      this.slotHeld.textContent = "Empty hand";
    }

    // CCTV status slot
    if (cctv.isActive) {
      this.slotCCTV.classList.add("active");
      this.slotCCTV.textContent = `CCTV · ${cctv.timeLeft.toFixed(0)}s`;
    } else if (cctv.inCooldown) {
      this.slotCCTV.classList.remove("active");
      this.slotCCTV.textContent = `CCTV · cool ${cctv.cooldownLeft.toFixed(0)}s`;
    } else {
      this.slotCCTV.classList.remove("active");
      this.slotCCTV.textContent = `CCTV · READY`;
    }

    // Aim bar
    if (player.state.aiming && held) {
      this.aimBar.classList.add("on");
      this.aimFill.style.width = (player.state.aimPower * 100) + "%";
    } else {
      this.aimBar.classList.remove("on");
    }

    // Binocular overlay
    this.binoOverlay.classList.toggle("on", player.state.binocularsOn);

    // Prompt
    const cur = interaction.current;
    if (cur) {
      this.prompt.textContent = cur.label + this._truckProgressText(interaction);
      this.prompt.classList.add("on");
    } else if (interaction.truckState.active && !interaction.truckState.started) {
      this.prompt.textContent = "HOLD [E] " + this._truckProgressText(interaction);
      this.prompt.classList.add("on");
    } else {
      this.prompt.classList.remove("on");
    }

    // Tension vignette
    const dist = monster.position.distanceTo(player.pos);
    const tension = Math.max(monster.alertLevel, Math.max(0, 1 - dist / 8));
    this._pulseTimer += dt * (1 + tension * 4);
    const pulse = (Math.sin(this._pulseTimer * 6) * 0.5 + 0.5) * tension;
    this.damageFlash.style.background = `radial-gradient(ellipse at center, rgba(120,0,0,0) ${30 - pulse * 15}%, rgba(180,0,0,${0.05 + pulse * 0.5}) 100%)`;

    // Monster state debug (small)
    if (this.monsterState) {
      this.monsterState.textContent = `${monster.state}  ·  ${dist.toFixed(1)}m`;
    }
    if (this.distFill) {
      this.distFill.style.width = Math.max(0, Math.min(1, 1 - dist / 50)) * 100 + "%";
    }

    if (this._subtitleTimer > 0) {
      this._subtitleTimer -= dt;
      if (this._subtitleTimer <= 0) this.subtitle.classList.remove("on");
    }
  }

  _truckProgressText(inter) {
    if (!inter.truckState.active) return "";
    if (inter.truckState.started) return " · ENGINE RUNNING";
    const labels = [" · inserting keys...", " · cranking...", " · cranking harder..."];
    const pct = Math.round(inter.truckState.progress * 100);
    return `${labels[inter.truckState.step] || ""} ${pct}%`;
  }

  flashMessage(text, dur = 2.6) {
    this.subtitle.textContent = text;
    this.subtitle.classList.add("on");
    this._subtitleTimer = dur;
  }

  setObjective(text) {
    this.objective.textContent = "Objective: " + text;
  }

  showStart() {
    this.startScreen.classList.remove("hidden");
    this.deathScreen.classList.add("hidden");
    this.winScreen.classList.add("hidden");
  }
  hideStart() { this.startScreen.classList.add("hidden"); }

  showDeath(text) {
    this.deathText.textContent = text;
    this.deathScreen.classList.remove("hidden");
  }
  hideDeath() { this.deathScreen.classList.add("hidden"); }

  showWin() { this.winScreen.classList.remove("hidden"); }
  hideWin() { this.winScreen.classList.add("hidden"); }

  showJumpscare() { this.jumpscare.classList.remove("hidden"); }
  hideJumpscare() { this.jumpscare.classList.add("hidden"); }
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
