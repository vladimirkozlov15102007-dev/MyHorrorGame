// HUD / overlay manager for the tactical survival-horror game.

import * as THREE from "three";

export class UI {
  constructor() {
    // Stat bars
    this.hpFill = document.getElementById("hpFill");
    this.hpValue = document.getElementById("hpValue");
    this.staminaFill = document.getElementById("staminaFill");

    // Ammo panel
    this.ammoMag = document.getElementById("ammoMag");
    this.ammoRes = document.getElementById("ammoRes");
    this.reloadBar = document.getElementById("reloadBar");
    this.reloadFill = document.getElementById("reloadFill");

    // Kill counter
    this.killsLeft = document.getElementById("killsLeft");

    // Threat
    this.threatValue = document.getElementById("threatValue");

    // Prompt / subtitle / objective
    this.prompt = document.getElementById("prompt");
    this.subtitle = document.getElementById("subtitle");
    this.objective = document.getElementById("objective");

    // Damage overlays
    this.damageFlash = document.getElementById("damageFlash");
    this.bloodOverlay = document.getElementById("bloodOverlay");
    this.dmgArrows = Array.from(document.querySelectorAll(".dmg-arrow"));
    this._dmgArrowTimers = this.dmgArrows.map(() => 0);

    // ADS + crosshair + hit marker
    this.adsOverlay = document.getElementById("adsOverlay");
    this.crosshair = document.getElementById("crosshair");
    this.hitmarker = document.getElementById("hitmarker");

    // Overlays
    this.startScreen = document.getElementById("startScreen");
    this.deathScreen = document.getElementById("deathScreen");
    this.winScreen   = document.getElementById("winScreen");
    this.jumpscare   = document.getElementById("jumpscare");
    this.deathText   = document.getElementById("deathText");

    this._subtitleTimer = 0;
    this._pulseTimer = 0;
    this._lastHp = 100;
    this._damageFlashTimer = 0;
    this._hitmarkerTimer = 0;
  }

  update(dt, { player, skeletons, weapon, interaction, cctv }) {
    // HP
    const hp = Math.max(0, Math.round(player.state.hp));
    if (this.hpValue) this.hpValue.textContent = hp;
    if (this.hpFill) this.hpFill.style.width = Math.max(0, (hp / 100) * 100) + "%";
    if (hp < this._lastHp) {
      this._damageFlashTimer = 0.6;
    }
    this._lastHp = hp;

    // Blood on lens at low HP
    if (this.bloodOverlay) {
      this.bloodOverlay.classList.toggle("on", hp < 40);
    }

    // Stamina
    const sPct = Math.max(0, Math.min(1, player.state.stamina));
    if (this.staminaFill) this.staminaFill.style.width = (sPct * 100).toFixed(1) + "%";

    // Ammo
    if (weapon) {
      if (this.ammoMag) {
        this.ammoMag.textContent = weapon.magAmmo;
        this.ammoMag.className = "ammo-mag"
          + (weapon.magAmmo === 0 ? " empty"
             : weapon.magAmmo <= 3 ? " low" : "");
      }
      if (this.ammoRes) this.ammoRes.textContent = weapon.reserveAmmo;
      if (this.reloadBar) {
        this.reloadBar.classList.toggle("on", weapon.isReloading);
        if (weapon.isReloading) {
          this.reloadFill.style.width = (weapon.reloadProgress * 100) + "%";
        }
      }
    }

    // Skeleton kill counter
    if (skeletons && this.killsLeft) {
      this.killsLeft.textContent = skeletons.alive;
    }

    // Threat label
    if (skeletons && this.threatValue) {
      if (skeletons.anyInCombat()) {
        this.threatValue.textContent = "CONTACT";
        this.threatValue.className = "combat";
      } else if (skeletons.anyAlerted()) {
        this.threatValue.textContent = "ALERT";
        this.threatValue.className = "alert";
      } else {
        this.threatValue.textContent = "CLEAR";
        this.threatValue.className = "clear";
      }
    }

    // ADS overlay
    if (this.adsOverlay) this.adsOverlay.classList.toggle("on", player.state.ads);

    // Crosshair spread / hide during ADS
    if (this.crosshair) {
      this.crosshair.classList.toggle("ads", player.state.ads);
      const moving = player.vel.lengthSq() > 0.5;
      this.crosshair.classList.toggle("spread",
        !player.state.ads && (moving || player.state.sprinting));
    }

    // Damage flash
    if (this._damageFlashTimer > 0) {
      this._damageFlashTimer = Math.max(0, this._damageFlashTimer - dt);
      const a = this._damageFlashTimer / 0.6;
      this.damageFlash.style.background =
        `radial-gradient(ellipse at center, rgba(140,0,0,${a*0.25}) 20%, rgba(180,0,0,${a*0.75}) 100%)`;
    } else {
      this.damageFlash.style.background = "radial-gradient(ellipse at center, rgba(180,0,0,0) 40%, rgba(180,0,0,0) 100%)";
    }

    // Directional damage arrows
    // player.state.dmgFromYaw is already a RELATIVE angle (0 = in front of
    // player, +PI/2 = right, PI = behind, -PI/2 = left). CSS rotate() with
    // 0deg places the arrow pointing up (front), which matches.
    if (player.state.dmgFromYaw !== null && player.state.dmgTimer > 0) {
      const relDeg = player.state.dmgFromYaw * 180 / Math.PI;
      const snapDeg = ((Math.round(relDeg / 45) * 45) % 360 + 360) % 360;
      for (const arrow of this.dmgArrows) {
        const d = parseInt(arrow.dataset.dir, 10);
        if (d === snapDeg) {
          arrow.classList.add("on");
          arrow.style.transform = `rotate(${snapDeg}deg)`;
          // auto-hide after ~0.6s via CSS transition
          clearTimeout(arrow._tmo);
          arrow._tmo = setTimeout(() => arrow.classList.remove("on"), 650);
        }
      }
    }

    // Hit marker timer
    if (this._hitmarkerTimer > 0) {
      this._hitmarkerTimer -= dt;
      if (this._hitmarkerTimer <= 0) {
        this.hitmarker.classList.remove("on", "kill");
      }
    }

    // Prompt
    if (interaction && interaction.current) {
      this.prompt.textContent = interaction.current.label + this._truckProgressText(interaction);
      this.prompt.classList.add("on");
    } else if (interaction && interaction.truckState.active && !interaction.truckState.started) {
      this.prompt.textContent = "HOLD [E] " + this._truckProgressText(interaction);
      this.prompt.classList.add("on");
    } else {
      this.prompt.classList.remove("on");
    }

    // Subtitle timer
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

  showHitMarker(isKill = false) {
    this.hitmarker.classList.remove("on", "kill");
    // force reflow to restart animation
    void this.hitmarker.offsetWidth;
    this.hitmarker.classList.add("on");
    if (isKill) this.hitmarker.classList.add("kill");
    this._hitmarkerTimer = 0.3;
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
