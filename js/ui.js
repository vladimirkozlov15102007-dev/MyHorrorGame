// Tactical shooter HUD.
//
// Shows: HP bar, stamina bar, ammo counter (mag / reserve), reload bar,
// skeleton kill counter (10 pips), directional damage indicators,
// hitmarker, objective text, interact prompts, overlays (start/death/win/jumpscare),
// ADS vignette + mode tag, crosshair that widens with weapon spread.

export class UI {
  constructor() {
    // HP / stamina
    this.hpFill = document.getElementById("hpFill");
    this.hpNumber = document.getElementById("hpNumber");
    this.staminaFill = document.getElementById("staminaFill");

    // Ammo
    this.ammoMag = document.getElementById("ammoMag");
    this.ammoReserve = document.getElementById("ammoReserve");
    this.reloadBar = document.getElementById("reloadBar");
    this.reloadFill = document.getElementById("reloadFill");
    this.modeTag = document.getElementById("modeTag");

    // Skeleton pips
    this.skelBar = document.getElementById("skeletonBar");
    this.skelCount = document.getElementById("skeletonCount");
    this._builtPips = false;
    this._pips = [];

    // Objective / prompt / subtitle
    this.objective = document.getElementById("objective");
    this.prompt = document.getElementById("prompt");
    this.subtitle = document.getElementById("subtitle");

    // Damage
    this.damageRing = document.getElementById("damageRing");

    // Hitmarker
    this.hitmarker = document.getElementById("hitmarker");
    this._buildHitmarker();
    this._hitmarkerT = 0;

    // ADS / crosshair
    this.adsVignette = document.getElementById("adsVignette");
    this.crosshair = document.getElementById("crosshair");

    // Overlays
    this.startScreen = document.getElementById("startScreen");
    this.deathScreen = document.getElementById("deathScreen");
    this.winScreen   = document.getElementById("winScreen");
    this.jumpscare   = document.getElementById("jumpscare");
    this.deathText   = document.getElementById("deathText");

    // Legacy slots
    this.slotHeld = document.getElementById("slotHeld");
    this.slotCCTV = document.getElementById("slotCCTV");

    this._subtitleTimer = 0;
  }

  _buildHitmarker() {
    if (!this.hitmarker) return;
    this.hitmarker.innerHTML = "";
    for (const c of ["tl", "tr", "bl", "br"]) {
      const s = document.createElement("span");
      s.className = `hm-line ${c}`;
      this.hitmarker.appendChild(s);
    }
  }

  ensurePips(count) {
    if (this._builtPips) return;
    if (!this.skelBar) return;
    this.skelBar.innerHTML = "";
    this._pips = [];
    for (let i = 0; i < count; i++) {
      const p = document.createElement("span");
      p.className = "skel-pip";
      this.skelBar.appendChild(p);
      this._pips.push(p);
    }
    this._builtPips = true;
  }

  update(dt, ctx) {
    const { player, weapon, interaction, cctv, skeletons } = ctx;

    // ---- HP ----
    const hp = Math.max(0, Math.round(player.state.health));
    this.hpNumber.textContent = hp;
    this.hpFill.style.width = (hp) + "%";
    if (hp < 30) this.hpFill.classList.add("critical");
    else this.hpFill.classList.remove("critical");

    // ---- Stamina ----
    this.staminaFill.style.width = Math.max(0, Math.min(1, player.state.stamina)) * 100 + "%";

    // ---- Ammo ----
    this.ammoMag.textContent = weapon.magazine;
    this.ammoReserve.textContent = weapon.reserve;
    this.ammoMag.classList.toggle("empty", weapon.magazine === 0);
    this.ammoMag.classList.toggle("low", weapon.magazine > 0 && weapon.magazine <= 3);

    // Reload bar
    if (weapon._reloading) {
      this.reloadBar.classList.add("on");
      const t = 1 - (weapon._reloadT / 2.0);
      this.reloadFill.style.width = (t * 100).toFixed(0) + "%";
    } else {
      this.reloadBar.classList.remove("on");
      this.reloadFill.style.width = "0%";
    }

    // Mode tag
    if (weapon.aiming) {
      this.modeTag.textContent = "ADS";
      this.modeTag.classList.add("ads");
    } else {
      this.modeTag.textContent = "HIP";
      this.modeTag.classList.remove("ads");
    }

    // ADS vignette + crosshair
    this.adsVignette.classList.toggle("on", weapon.aiming);
    this.crosshair.classList.toggle("ads", weapon.aiming);
    // Crosshair widens with spread
    const spread = weapon.getCrosshairSpread ? weapon.getCrosshairSpread() : 0.04;
    const size = 20 + spread * 700;
    this.crosshair.style.width = size + "px";
    this.crosshair.style.height = size + "px";

    // ---- Skeleton pips ----
    if (skeletons && skeletons.members) {
      this.ensurePips(skeletons.members.length);
      let alive = 0;
      for (let i = 0; i < skeletons.members.length; i++) {
        const p = this._pips[i];
        if (!p) continue;
        const isDead = !skeletons.members[i].alive;
        p.classList.toggle("dead", isDead);
        if (!isDead) alive++;
      }
      this.skelCount.textContent = `${alive} / ${skeletons.members.length}`;
    }

    // ---- Damage indicators ----
    this._updateDamageArrows(player);

    // ---- Hitmarker ----
    if (this._hitmarkerT > 0) {
      this._hitmarkerT -= dt;
      if (this._hitmarkerT <= 0) {
        this.hitmarker.classList.remove("on");
        this.hitmarker.classList.remove("crit");
      }
    }

    // ---- Interact prompt ----
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

    // ---- CCTV slot ----
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

    // Held slot (throwable)
    if (player.state.held) {
      this.slotHeld.classList.add("active");
      this.slotHeld.textContent = (player.state.held.kind || "ITEM").toUpperCase();
    } else {
      this.slotHeld.classList.remove("active");
      this.slotHeld.textContent = "рука пуста";
    }

    // Subtitle timer
    if (this._subtitleTimer > 0) {
      this._subtitleTimer -= dt;
      if (this._subtitleTimer <= 0) this.subtitle.classList.remove("on");
    }
  }

  _updateDamageArrows(player) {
    const dirs = player.state.damageDirs || [];
    // Clear and rebuild quickly
    this.damageRing.innerHTML = "";
    for (const d of dirs) {
      if (d.age >= d.life) continue;
      const fade = 1 - (d.age / d.life);
      const wrap = document.createElement("div");
      wrap.className = "dmg-arrow";
      // Convert to CSS: 0 rad = up (north). angle is relative to player facing.
      const deg = (d.angle * 180 / Math.PI);
      wrap.style.transform = `translate(-50%, -50%) rotate(${deg}deg)`;
      const inner = document.createElement("div");
      inner.className = "arrow-inner";
      inner.style.opacity = (0.3 + fade * 0.7).toFixed(2);
      wrap.appendChild(inner);
      this.damageRing.appendChild(wrap);
    }
  }

  showHitmarker(zone) {
    if (!this.hitmarker) return;
    this.hitmarker.classList.add("on");
    if (zone === "head") this.hitmarker.classList.add("crit");
    else this.hitmarker.classList.remove("crit");
    this._hitmarkerT = 0.14;
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
    if (text) this.deathText.textContent = text;
    this.deathScreen.classList.remove("hidden");
  }
  hideDeath() { this.deathScreen.classList.add("hidden"); }

  showWin() { this.winScreen.classList.remove("hidden"); }
  hideWin() { this.winScreen.classList.add("hidden"); }

  showJumpscare() { this.jumpscare.classList.remove("hidden"); }
  hideJumpscare() { this.jumpscare.classList.add("hidden"); }
}
