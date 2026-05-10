// HUD / overlay management.

export class UI {
  constructor() {
    this.batteryFill = document.getElementById("batteryFill");
    this.staminaFill = document.getElementById("staminaFill");
    this.slotFlash   = document.getElementById("slotFlash");
    this.slotBino    = document.getElementById("slotBino");
    this.keyCountEl  = document.getElementById("keyCount");
    this.prompt      = document.getElementById("prompt");
    this.subtitle    = document.getElementById("subtitle");
    this.damageFlash = document.getElementById("damageFlash");
    this.binoOverlay = document.getElementById("binocularOverlay");
    this.objective   = document.getElementById("objective");

    this.startScreen = document.getElementById("startScreen");
    this.deathScreen = document.getElementById("deathScreen");
    this.winScreen   = document.getElementById("winScreen");
    this.jumpscare   = document.getElementById("jumpscare");
    this.deathText   = document.getElementById("deathText");

    this._subtitleTimer = 0;
    this._pulseTimer = 0;
  }

  update(dt, { player, monster, interaction }) {
    // Bars
    const bPct = Math.max(0, Math.min(1, player.state.battery));
    const sPct = Math.max(0, Math.min(1, player.state.stamina));
    this.batteryFill.style.width = (bPct * 100).toFixed(1) + "%";
    this.staminaFill.style.width = (sPct * 100).toFixed(1) + "%";

    // Flashlight slot color
    this.slotFlash.classList.toggle("active", player.state.flashlightOn);
    this.slotBino.classList.toggle("active", player.state.binocularsOn);
    this.keyCountEl.textContent = `${player.state.keyCount}/3`;

    // Binocular overlay visible
    this.binoOverlay.classList.toggle("on", player.state.binocularsOn);

    // Prompt (interaction)
    const cur = interaction.current;
    if (cur) {
      this.prompt.textContent = cur.label + this._truckProgressText(interaction);
      this.prompt.classList.add("on");
    } else if (interaction.truckState.active && !interaction.truckState.started) {
      this.prompt.textContent = "HOLD [E] · " + this._truckProgressText(interaction);
      this.prompt.classList.add("on");
    } else {
      this.prompt.classList.remove("on");
    }

    // Damage pulse based on monster proximity / chase
    const dist = monster.position.distanceTo(player.pos);
    const tension = Math.max(monster.alertLevel, Math.max(0, 1 - dist / 8));
    this._pulseTimer += dt * (1 + tension * 4);
    const pulse = (Math.sin(this._pulseTimer * 6) * 0.5 + 0.5) * tension;
    this.damageFlash.style.background = `radial-gradient(ellipse at center, rgba(120,0,0,0) ${30 - pulse * 15}%, rgba(180,0,0,${0.05 + pulse * 0.5}) 100%)`;

    // Subtitle timer
    if (this._subtitleTimer > 0) {
      this._subtitleTimer -= dt;
      if (this._subtitleTimer <= 0) {
        this.subtitle.classList.remove("on");
      }
    }
  }

  _truckProgressText(inter) {
    if (!inter.truckState.active) return "";
    if (inter.truckState.started) return " · ENGINE RUNNING";
    const labels = ["  · inserting key", "  · cranking...", "  · cranking harder..."];
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
