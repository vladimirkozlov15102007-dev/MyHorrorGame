// Cinematic FX system for Three.js horror game.
//
// Provides:
//   * blood burst      — dark red spray on hit (with bone fragments for skeletons)
//   * bone debris      — small bone shards flying off
//   * muzzle flash     — bright quad + light flare
//   * smoke puffs      — soft grey billboards
//   * sparks           — bright yellow streaks (bullet impact on metal)
//   * dust impact      — grey cloud (bullet impact on concrete)
//   * shell casing     — physical ejected brass shell (bouncy)
//   * arrow stuck      — visual only handled in arrow.js
//   * ambient dust     — slow-moving floating motes in shafts of light
//   * blood decals     — flat dark splats on floor
//   * screen blood     — we expose a hook fired for UI
//   * gibs             — simple limb shards after kill

import * as THREE from "three";

// ============ Shared geometry / materials ============

const _tmpV = new THREE.Vector3();

const QUAD_GEO = new THREE.PlaneGeometry(1, 1);

function makeRadialTexture(inner, outer, softness = 0.5, size = 128) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(softness, outer);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeFlashTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,240,200,1)");
  grad.addColorStop(0.18, "rgba(255,190,90,0.9)");
  grad.addColorStop(0.5, "rgba(220,100,20,0.45)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  // star rays
  g.strokeStyle = "rgba(255,220,140,0.9)";
  g.lineWidth = 3;
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    const a = (i / 4) * Math.PI * 2;
    g.moveTo(64 + Math.cos(a) * 12, 64 + Math.sin(a) * 12);
    g.lineTo(64 + Math.cos(a) * 58, 64 + Math.sin(a) * 58);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeSmokeTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, "rgba(230,230,230,0.85)");
  grad.addColorStop(0.4, "rgba(160,160,160,0.45)");
  grad.addColorStop(1, "rgba(50,50,50,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  // noise
  const img = g.getImageData(0, 0, 128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 40;
    img.data[i]   = Math.max(0, img.data[i]   + n);
    img.data[i+1] = Math.max(0, img.data[i+1] + n);
    img.data[i+2] = Math.max(0, img.data[i+2] + n);
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  return t;
}

function makeBloodSplatTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  g.clearRect(0, 0, 256, 256);
  g.fillStyle = "rgba(0,0,0,0)";
  g.fillRect(0, 0, 256, 256);
  // main blob
  g.fillStyle = "rgba(90,6,6,0.92)";
  g.beginPath();
  g.ellipse(128, 128, 60, 70, 0.2, 0, Math.PI * 2);
  g.fill();
  // secondary drops
  for (let i = 0; i < 28; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 40 + Math.random() * 100;
    const x = 128 + Math.cos(a) * r;
    const y = 128 + Math.sin(a) * r;
    const rr = 3 + Math.random() * 16;
    g.globalAlpha = 0.5 + Math.random() * 0.45;
    g.fillStyle = Math.random() < 0.5 ? "#5a0a0a" : "#3a0505";
    g.beginPath();
    g.ellipse(x, y, rr, rr * (0.6 + Math.random() * 0.6), Math.random() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  // thin streaks
  g.globalAlpha = 0.8;
  g.strokeStyle = "#3a0404";
  g.lineWidth = 2;
  for (let i = 0; i < 8; i++) {
    g.beginPath();
    g.moveTo(128, 128);
    const a = Math.random() * Math.PI * 2;
    g.lineTo(128 + Math.cos(a) * (60 + Math.random() * 80),
             128 + Math.sin(a) * (60 + Math.random() * 80));
    g.stroke();
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let FLASH_TEX, SMOKE_TEX, SPARK_TEX, BLOOD_TEX, DUST_TEX, BLOOD_DECAL_TEX;

function ensureTex() {
  if (!FLASH_TEX) {
    FLASH_TEX = makeFlashTexture();
    SMOKE_TEX = makeSmokeTexture();
    SPARK_TEX = makeRadialTexture("rgba(255,240,180,1)", "rgba(255,140,40,0.4)", 0.4, 64);
    BLOOD_TEX = makeRadialTexture("rgba(160,10,10,1)", "rgba(60,4,4,0.5)", 0.5, 64);
    DUST_TEX  = makeRadialTexture("rgba(200,190,170,0.8)", "rgba(100,90,80,0.3)", 0.5, 64);
    BLOOD_DECAL_TEX = makeBloodSplatTexture();
  }
}

// ============ FX Manager ============

export class FXManager {
  constructor(scene) {
    this.scene = scene;
    ensureTex();

    this.particles = [];       // sprite-based
    this.debris = [];          // physical small meshes (bone, shell)
    this.decals = [];          // floor sprites
    this.lights = [];          // short-lived lights
    this.time = 0;

    // ambient dust motes (persistent)
    this._makeAmbientDust();

    this._sharedMats = {
      flash: new THREE.SpriteMaterial({
        map: FLASH_TEX, color: 0xfff0b0, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
      smoke: new THREE.SpriteMaterial({
        map: SMOKE_TEX, color: 0x9a9a9a, transparent: true,
        opacity: 0.6, depthWrite: false,
      }),
      spark: new THREE.SpriteMaterial({
        map: SPARK_TEX, color: 0xffe080, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
      blood: new THREE.SpriteMaterial({
        map: BLOOD_TEX, color: 0x800404, transparent: true, depthWrite: false,
      }),
      dust: new THREE.SpriteMaterial({
        map: DUST_TEX, color: 0xcbc4b0, transparent: true, opacity: 0.7, depthWrite: false,
      }),
    };
  }

  _makeAmbientDust() {
    const count = 400;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3]     = (Math.random() - 0.5) * 110;
      pos[i * 3 + 1] = 0.5 + Math.random() * 8;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 100;
      vel[i * 3]     = (Math.random() - 0.5) * 0.05;
      vel[i * 3 + 1] = 0.02 + Math.random() * 0.04;
      vel[i * 3 + 2] = (Math.random() - 0.5) * 0.05;
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this._dustGeo = geo;
    this._dustVel = vel;
    const mat = new THREE.PointsMaterial({
      size: 0.045, color: 0xd8cfb8, transparent: true, opacity: 0.5,
      depthWrite: false, map: DUST_TEX,
    });
    this._dustPoints = new THREE.Points(geo, mat);
    this.scene.add(this._dustPoints);
  }

  update(dt, cameraPos) {
    this.time += dt;

    // Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.scene.remove(p.obj);
        this.particles.splice(i, 1);
        continue;
      }
      // physics
      if (p.vel) {
        if (p.gravity) p.vel.y += p.gravity * dt;
        if (p.drag) p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
        p.obj.position.addScaledVector(p.vel, dt);
      }
      // scale anim
      const t = p.age / p.life;
      if (p.scaleFrom !== undefined) {
        const s = p.scaleFrom + (p.scaleTo - p.scaleFrom) * t;
        p.obj.scale.set(s, s, s);
      }
      // opacity anim
      if (p.fade) {
        const a = (p.opacityFrom ?? 1) * (1 - t);
        if (p.obj.material) p.obj.material.opacity = a;
      }
      // color shift (flame → smoke)
      if (p.colorFrom && p.colorTo && p.obj.material?.color) {
        p.obj.material.color.lerpColors(p.colorFrom, p.colorTo, t);
      }
      if (p.spin) p.obj.material && p.obj.material.rotation !== undefined
        ? (p.obj.material.rotation += p.spin * dt) : null;
    }

    // Debris (physical small meshes with real velocity)
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.age += dt;
      d.vel.y -= 16 * dt;
      d.pos.addScaledVector(d.vel, dt);
      d.obj.position.copy(d.pos);
      d.obj.rotation.x += d.spin.x * dt;
      d.obj.rotation.y += d.spin.y * dt;
      d.obj.rotation.z += d.spin.z * dt;
      // floor bounce
      if (d.pos.y < d.floorY) {
        d.pos.y = d.floorY;
        d.vel.y = -d.vel.y * 0.35;
        d.vel.x *= 0.55;
        d.vel.z *= 0.55;
        d.spin.multiplyScalar(0.55);
        if (Math.abs(d.vel.y) < 0.4) { d.vel.y = 0; d.settled = true; }
      }
      // settled debris persists a while then fades
      if (d.age > d.life) {
        if (d.obj.material) {
          d.obj.material.opacity = Math.max(0, 1 - (d.age - d.life) / 2);
          d.obj.material.transparent = true;
        }
        if (d.age > d.life + 2) {
          this.scene.remove(d.obj);
          this.debris.splice(i, 1);
        }
      }
    }

    // Lights (timed)
    for (let i = this.lights.length - 1; i >= 0; i--) {
      const L = this.lights[i];
      L.age += dt;
      if (L.age >= L.life) {
        this.scene.remove(L.light);
        this.lights.splice(i, 1);
        continue;
      }
      const t = 1 - L.age / L.life;
      L.light.intensity = L.baseIntensity * t * t;
    }

    // Decals — fade out over time
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      d.age += dt;
      if (d.age > d.life) {
        this.scene.remove(d.obj);
        this.decals.splice(i, 1);
        continue;
      }
      const fade = d.age / d.life;
      if (d.obj.material) d.obj.material.opacity = (1 - fade) * (d.maxOpacity ?? 0.9);
    }

    // Ambient dust drift
    if (this._dustGeo) {
      const p = this._dustGeo.attributes.position;
      const v = this._dustVel;
      for (let i = 0; i < p.count; i++) {
        p.array[i * 3]     += v[i * 3]     * dt + Math.sin(this.time * 0.3 + i) * 0.002;
        p.array[i * 3 + 1] += v[i * 3 + 1] * dt;
        p.array[i * 3 + 2] += v[i * 3 + 2] * dt;
        if (p.array[i * 3 + 1] > 9) {
          p.array[i * 3 + 1] = 0.3;
          p.array[i * 3]     = (Math.random() - 0.5) * 110;
          p.array[i * 3 + 2] = (Math.random() - 0.5) * 100;
        }
      }
      p.needsUpdate = true;
      // Keep dust around the camera (re-center pool)
      if (cameraPos) {
        this._dustPoints.position.x = cameraPos.x;
        this._dustPoints.position.z = cameraPos.z;
      }
    }
  }

  // ============ Public effects ============

  muzzleFlash(origin, dir, scale = 1.0) {
    // sprite flash
    const spr = new THREE.Sprite(this._sharedMats.flash.clone());
    spr.position.copy(origin);
    const s = (0.55 + Math.random() * 0.25) * scale;
    spr.scale.set(s, s, s);
    spr.material.rotation = Math.random() * Math.PI * 2;
    this.scene.add(spr);
    this.particles.push({
      obj: spr, age: 0, life: 0.07,
      scaleFrom: s, scaleTo: s * 1.6,
      fade: true, opacityFrom: 1,
    });
    // short lived bright light
    const flashLight = new THREE.PointLight(0xffe0a0, 4.0 * scale, 8 * scale, 2.0);
    flashLight.position.copy(origin);
    this.scene.add(flashLight);
    this.lights.push({ light: flashLight, age: 0, life: 0.08, baseIntensity: 4.0 * scale });
    // small smoke puff trailing dir
    const puff = new THREE.Sprite(this._sharedMats.smoke.clone());
    puff.material.opacity = 0.8;
    puff.position.copy(origin).addScaledVector(dir, 0.4);
    puff.scale.set(0.35, 0.35, 0.35);
    this.scene.add(puff);
    this.particles.push({
      obj: puff, age: 0, life: 0.9,
      vel: new THREE.Vector3(dir.x * 0.8 + (Math.random() - 0.5) * 0.3,
                             0.4,
                             dir.z * 0.8 + (Math.random() - 0.5) * 0.3),
      drag: 2.0, gravity: 0,
      scaleFrom: 0.35, scaleTo: 1.4,
      fade: true, opacityFrom: 0.7,
    });
  }

  bulletImpactConcrete(pos, normal) {
    // dust cloud
    for (let i = 0; i < 5; i++) {
      const spr = new THREE.Sprite(this._sharedMats.dust.clone());
      spr.position.copy(pos);
      spr.scale.setScalar(0.15);
      this.scene.add(spr);
      const v = new THREE.Vector3(
        (Math.random() - 0.5) * 2 + normal.x * 2,
        Math.random() * 1.5 + 0.3,
        (Math.random() - 0.5) * 2 + normal.z * 2,
      );
      this.particles.push({
        obj: spr, age: 0, life: 0.9 + Math.random() * 0.4,
        vel: v, drag: 3.0, gravity: -2.5,
        scaleFrom: 0.15, scaleTo: 0.55,
        fade: true, opacityFrom: 0.8,
      });
    }
    // tiny debris pebbles
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a3a38, roughness: 1 });
    for (let i = 0; i < 4; i++) {
      const g = new THREE.BoxGeometry(0.04, 0.04, 0.04);
      const m = new THREE.Mesh(g, mat);
      m.position.copy(pos);
      this.scene.add(m);
      this.debris.push({
        obj: m, pos: m.position.clone(),
        vel: new THREE.Vector3(
          (Math.random() - 0.5) * 3 + normal.x * 3,
          Math.random() * 3 + 1,
          (Math.random() - 0.5) * 3 + normal.z * 3,
        ),
        spin: new THREE.Vector3(
          (Math.random() - 0.5) * 20,
          (Math.random() - 0.5) * 20,
          (Math.random() - 0.5) * 20,
        ),
        age: 0, life: 1.2, floorY: 0.02,
      });
    }
  }

  bulletImpactMetal(pos, normal) {
    // sparks (bright)
    for (let i = 0; i < 10; i++) {
      const spr = new THREE.Sprite(this._sharedMats.spark.clone());
      spr.position.copy(pos);
      spr.scale.setScalar(0.12);
      this.scene.add(spr);
      const v = new THREE.Vector3(
        (Math.random() - 0.5) * 4 + normal.x * 5,
        Math.random() * 4 + 1,
        (Math.random() - 0.5) * 4 + normal.z * 5,
      );
      this.particles.push({
        obj: spr, age: 0, life: 0.35 + Math.random() * 0.25,
        vel: v, drag: 2.0, gravity: -8,
        scaleFrom: 0.12, scaleTo: 0.04,
        fade: true, opacityFrom: 1,
      });
    }
    // short flash light
    const l = new THREE.PointLight(0xffd080, 2.5, 4, 2);
    l.position.copy(pos);
    this.scene.add(l);
    this.lights.push({ light: l, age: 0, life: 0.12, baseIntensity: 2.5 });
  }

  // Blood + bone shards + decal
  bloodBurst(pos, normal, scale = 1.0, withBone = true) {
    // red misty sprites
    for (let i = 0; i < 14; i++) {
      const spr = new THREE.Sprite(this._sharedMats.blood.clone());
      spr.position.copy(pos);
      spr.scale.setScalar(0.12 * scale);
      this.scene.add(spr);
      const v = new THREE.Vector3(
        (Math.random() - 0.5) * 3.5 + normal.x * 1.5,
        Math.random() * 2.5 + 0.5,
        (Math.random() - 0.5) * 3.5 + normal.z * 1.5,
      );
      this.particles.push({
        obj: spr, age: 0, life: 0.7 + Math.random() * 0.3,
        vel: v, drag: 2.5, gravity: -5.5,
        scaleFrom: 0.12 * scale, scaleTo: 0.28 * scale,
        fade: true, opacityFrom: 0.95,
      });
    }
    // a few solid droplets
    const dropMat = new THREE.MeshStandardMaterial({
      color: 0x5a0606, roughness: 0.4, metalness: 0, emissive: 0x1a0202,
    });
    for (let i = 0; i < 5; i++) {
      const g = new THREE.SphereGeometry(0.035 * scale, 6, 5);
      const m = new THREE.Mesh(g, dropMat);
      m.position.copy(pos);
      this.scene.add(m);
      this.debris.push({
        obj: m, pos: m.position.clone(),
        vel: new THREE.Vector3(
          (Math.random() - 0.5) * 3 + normal.x * 1,
          Math.random() * 3 + 1,
          (Math.random() - 0.5) * 3 + normal.z * 1,
        ),
        spin: new THREE.Vector3(
          (Math.random() - 0.5) * 5,
          (Math.random() - 0.5) * 5,
          (Math.random() - 0.5) * 5,
        ),
        age: 0, life: 1.0, floorY: 0.04,
      });
    }
    // bone shards
    if (withBone) {
      const boneMat = new THREE.MeshStandardMaterial({
        color: 0xd8cfb3, roughness: 0.9, metalness: 0,
      });
      for (let i = 0; i < 3; i++) {
        const g = new THREE.BoxGeometry(0.05 * scale, 0.03 * scale, 0.1 * scale);
        const m = new THREE.Mesh(g, boneMat);
        m.position.copy(pos);
        this.scene.add(m);
        this.debris.push({
          obj: m, pos: m.position.clone(),
          vel: new THREE.Vector3(
            (Math.random() - 0.5) * 3 + normal.x * 1.2,
            Math.random() * 2.5 + 0.5,
            (Math.random() - 0.5) * 3 + normal.z * 1.2,
          ),
          spin: new THREE.Vector3(
            (Math.random() - 0.5) * 10,
            (Math.random() - 0.5) * 10,
            (Math.random() - 0.5) * 10,
          ),
          age: 0, life: 1.8, floorY: 0.02,
        });
      }
    }
    // floor decal under the burst
    this._floorBloodDecal(pos, 0.7 * scale + Math.random() * 0.3);
  }

  _floorBloodDecal(pos, size) {
    const mat = new THREE.MeshBasicMaterial({
      map: BLOOD_DECAL_TEX, transparent: true, opacity: 0.9, depthWrite: false,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.random() * Math.PI * 2;
    m.position.set(pos.x + (Math.random() - 0.5) * 0.2, 0.025 + Math.random() * 0.005,
                   pos.z + (Math.random() - 0.5) * 0.2);
    this.scene.add(m);
    this.decals.push({ obj: m, age: 0, life: 30, maxOpacity: 0.9 });
  }

  // Shell casing: small bright brass cylinder ejected sideways
  ejectShell(origin, weaponDir, sideDir) {
    const geo = new THREE.CylinderGeometry(0.013, 0.011, 0.035, 8);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xd8a437, roughness: 0.35, metalness: 0.85, emissive: 0x110800, emissiveIntensity: 0.3,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(origin);
    m.rotation.z = Math.PI / 2;
    this.scene.add(m);
    const dir = sideDir.clone().normalize();
    const v = new THREE.Vector3(
      dir.x * (1.6 + Math.random() * 0.6) - weaponDir.x * 0.3,
      1.3 + Math.random() * 0.5,
      dir.z * (1.6 + Math.random() * 0.6) - weaponDir.z * 0.3,
    );
    this.debris.push({
      obj: m, pos: m.position.clone(), vel: v,
      spin: new THREE.Vector3(
        (Math.random() - 0.5) * 30,
        (Math.random() - 0.5) * 30,
        (Math.random() - 0.5) * 30,
      ),
      age: 0, life: 3.5, floorY: 0.02,
    });
  }

  // Gibs (chunks flung at death)
  explodeCorpse(pos) {
    const mats = [
      new THREE.MeshStandardMaterial({ color: 0xd0c8ae, roughness: 0.9 }),
      new THREE.MeshStandardMaterial({ color: 0x5a0606, roughness: 0.5 }),
      new THREE.MeshStandardMaterial({ color: 0x262015, roughness: 0.95 }),
    ];
    for (let i = 0; i < 12; i++) {
      const g = new THREE.BoxGeometry(0.06 + Math.random() * 0.05,
                                       0.05 + Math.random() * 0.04,
                                       0.08 + Math.random() * 0.06);
      const m = new THREE.Mesh(g, mats[(Math.random() * mats.length) | 0]);
      m.position.copy(pos);
      this.scene.add(m);
      this.debris.push({
        obj: m, pos: m.position.clone(),
        vel: new THREE.Vector3(
          (Math.random() - 0.5) * 5,
          Math.random() * 4 + 1.5,
          (Math.random() - 0.5) * 5,
        ),
        spin: new THREE.Vector3(
          (Math.random() - 0.5) * 15,
          (Math.random() - 0.5) * 15,
          (Math.random() - 0.5) * 15,
        ),
        age: 0, life: 3.5, floorY: 0.02,
      });
    }
    this.bloodBurst(pos, new THREE.Vector3(0, 1, 0), 1.3, false);
  }
}
