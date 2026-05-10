// Security Room CCTV system.
//
// When active, a second WebGL renderer draws the scene into 6 sub-viewports
// on a dedicated overlay canvas (split screen). The player is immobile while
// watching, leaving them vulnerable (monster may STALK them — see monster.js).
//
// Time budget:
//   - Activation drains battery for 25..40 seconds (random per session).
//   - When depleted, enters cooldown 60..90 seconds before it can be used again.
//
// Effects:
//   - Light static noise via overlay divs (CSS).
//   - Slight green tint via a post pass (we use transparent DOM overlay).
//
// Public API:
//   new CCTV(scene, level) — pass main scene (world) + level
//   activate() / deactivate()
//   update(dt)
//   isActive / inCooldown / timeLeft / cooldownLeft

import * as THREE from "three";

const USE_MIN = 25, USE_MAX = 40;
const COOL_MIN = 60, COOL_MAX = 90;

export class CCTV {
  constructor(scene, level) {
    this.scene = scene;
    this.level = level;

    this.isActive = false;
    this.inCooldown = false;
    this.timeLeft = 0;
    this.cooldownLeft = 0;
    this._duration = 0;

    this._root = document.getElementById("cctvOverlay");
    this._grid = document.getElementById("cctvGrid");
    this._status = document.getElementById("cctvStatus");
    this._cooldownEl = document.getElementById("cctvCooldown");

    // Build one canvas per camera view (simpler than render targets composited)
    this._tiles = [];
    this._renderers = [];
    this._cameras = [];

    for (let i = 0; i < level.cctvInfo.cameras.length; i++) {
      const info = level.cctvInfo.cameras[i];
      const tile = document.createElement("div");
      tile.className = "cctv-tile";
      tile.innerHTML = `
        <canvas class="cctv-canvas"></canvas>
        <div class="cctv-scan"></div>
        <div class="cctv-static"></div>
        <div class="cctv-label">${info.name}</div>
        <div class="cctv-rec">REC ●</div>
        <div class="cctv-time"></div>
      `;
      this._grid.appendChild(tile);

      const cvs = tile.querySelector(".cctv-canvas");
      const renderer = new THREE.WebGLRenderer({
        canvas: cvs, antialias: false, alpha: true,
        powerPreference: "low-power"
      });
      renderer.setPixelRatio(1);
      renderer.setSize(320, 200, false);
      renderer.setClearColor(0x000000, 0.0);

      const cam = new THREE.PerspectiveCamera(62, 320 / 200, 0.1, 120);
      cam.position.copy(info.pos);
      cam.lookAt(info.lookAt);

      this._tiles.push(tile);
      this._renderers.push(renderer);
      this._cameras.push({ cam, info });
    }

    // Hide by default
    this._root.classList.add("hidden");
    this._updateStatusText();
  }

  activate() {
    if (this.inCooldown) return false;
    if (this.isActive) return true;
    this.isActive = true;
    this._duration = USE_MIN + Math.random() * (USE_MAX - USE_MIN);
    this.timeLeft = this._duration;
    this._root.classList.remove("hidden");
    // resize renderers to match tile size once visible
    setTimeout(() => this._resizeTiles(), 30);
    this._updateStatusText();
    return true;
  }

  deactivate(forced = false) {
    if (!this.isActive) return;
    this.isActive = false;
    this._root.classList.add("hidden");
    if (forced) {
      this.inCooldown = true;
      this.cooldownLeft = COOL_MIN + Math.random() * (COOL_MAX - COOL_MIN);
    }
    this._updateStatusText();
  }

  toggle() {
    if (this.isActive) this.deactivate(false);
    else this.activate();
  }

  _resizeTiles() {
    for (let i = 0; i < this._tiles.length; i++) {
      const tile = this._tiles[i];
      const rect = tile.getBoundingClientRect();
      const w = Math.max(160, rect.width | 0);
      const h = Math.max(100, rect.height | 0);
      this._renderers[i].setSize(w, h, false);
      this._cameras[i].cam.aspect = w / h;
      this._cameras[i].cam.updateProjectionMatrix();
    }
  }

  update(dt) {
    if (this.isActive) {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        this.deactivate(true);
      } else {
        this._renderAll();
      }
    } else if (this.inCooldown) {
      this.cooldownLeft -= dt;
      if (this.cooldownLeft <= 0) {
        this.inCooldown = false;
        this.cooldownLeft = 0;
      }
    }
    this._updateStatusText();
  }

  _renderAll() {
    // Simulate small pan/jitter on each camera for realism
    const t = performance.now() / 1000;
    for (let i = 0; i < this._cameras.length; i++) {
      const { cam, info } = this._cameras[i];
      // Slight hand-held jitter
      cam.position.x = info.pos.x + Math.sin(t * 0.9 + i) * 0.03;
      cam.position.y = info.pos.y + Math.cos(t * 0.7 + i) * 0.02;
      cam.lookAt(info.lookAt);

      try {
        this._renderers[i].render(this.scene, cam);
      } catch (e) {
        // ignore sporadic context issues
      }

      // occasional "glitch" — toggle static overlay
      if (Math.random() < 0.004) {
        const staticEl = this._tiles[i].querySelector(".cctv-static");
        staticEl.classList.add("glitch");
        setTimeout(() => staticEl.classList.remove("glitch"), 120 + Math.random() * 200);
      }

      // update clock
      const clock = this._tiles[i].querySelector(".cctv-time");
      clock.textContent = `${pad(t % 60)}`;
    }
  }

  _updateStatusText() {
    if (!this._status) return;
    if (this.isActive) {
      this._status.textContent = `SURVEILLANCE ONLINE · ${this.timeLeft.toFixed(1)}s`;
      this._status.className = "cctv-status online";
      this._cooldownEl.textContent = "";
    } else if (this.inCooldown) {
      this._status.textContent = `SYSTEM COOLING DOWN`;
      this._status.className = "cctv-status cooldown";
      this._cooldownEl.textContent = `AVAILABLE IN ${this.cooldownLeft.toFixed(1)}s`;
    } else {
      this._status.textContent = `READY`;
      this._status.className = "cctv-status ready";
      this._cooldownEl.textContent = "";
    }
  }
}

function pad(n) {
  const s = (n | 0).toString().padStart(2, "0");
  return `03:12:${s}`;
}
