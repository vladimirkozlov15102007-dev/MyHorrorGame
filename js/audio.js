// Procedural audio engine with dynamic layered music.
//
// No external samples — everything is synthesized via WebAudio.
//
// Layered music (faded via gain nodes):
//   - ambientBed      (always on): wind in pipes, drips, distant metal
//   - tenseLayer      (mid): low drone + dissonant pad
//   - closeLayer      (high): low brass hits + pulsing sub
//   - chaseLayer      (max): urgent percussion + siren-like sweep
//   - heartbeat/breath (tied to tension too)
//
// Mix is driven by Audio.tick(dt, {monsterDist, alert, ...}) called each frame.
//
// Spatial: many one-shot sounds accept a `pan` argument (-1 left ... 1 right)
// created via StereoPannerNode.

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.ambientGain = null;
    this.tenseGain = null;
    this.closeGain = null;
    this.chaseGain = null;
    this.heartGain = null;
    this.breathGain = null;
    this.unlocked = false;

    this._heartTimer = 0;
    this._breathTimer = 0;

    this._percTimer = 0;
    this._ambScrape = 0;
    this._ambDrip = 0;
    this._oscillators = [];
  }

  init() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);

    // Layer gains
    this.ambientGain = this._makeGain(0.0);
    this.tenseGain = this._makeGain(0.0);
    this.closeGain = this._makeGain(0.0);
    this.chaseGain = this._makeGain(0.0);
    this.heartGain = this._makeGain(0.0);
    this.breathGain = this._makeGain(0.0);

    // -------- Ambient bed: low drone + wind + drip accent --------
    // Low drone (two detuned sines)
    this._droneOsc(42, 0.15, this.ambientGain, "sine");
    this._droneOsc(56, 0.12, this.ambientGain, "sine");
    // Wind hiss
    const wind = this._noiseLoop();
    const windF = this.ctx.createBiquadFilter();
    windF.type = "bandpass";
    windF.frequency.value = 380;
    windF.Q.value = 0.6;
    const windG = this.ctx.createGain();
    windG.gain.value = 0.07;
    wind.connect(windF); windF.connect(windG); windG.connect(this.ambientGain);

    // fade ambient in
    const now = this.ctx.currentTime;
    this.ambientGain.gain.setValueAtTime(0, now);
    this.ambientGain.gain.linearRampToValueAtTime(0.75, now + 2.0);

    // -------- Tense layer: low pad + minor interval --------
    const padBase = 65; // C2ish
    this._droneOsc(padBase, 0.0, this.tenseGain, "sawtooth", 150); // filtered at 150
    this._droneOsc(padBase * 1.189, 0.0, this.tenseGain, "sawtooth", 200); // m3
    this.tenseGain.gain.value = 0.0;

    // -------- Close layer: sub pulse + mid dissonance --------
    const subOsc = this.ctx.createOscillator();
    subOsc.type = "sine"; subOsc.frequency.value = 38;
    const subLFO = this.ctx.createOscillator();
    subLFO.type = "sine"; subLFO.frequency.value = 1.5;
    const subLFOGain = this.ctx.createGain(); subLFOGain.gain.value = 10;
    subLFO.connect(subLFOGain); subLFOGain.connect(subOsc.frequency);
    const subG = this.ctx.createGain(); subG.gain.value = 0.6;
    subOsc.connect(subG); subG.connect(this.closeGain);
    subOsc.start(); subLFO.start();
    this._oscillators.push(subOsc, subLFO);

    // tritone pad whisper
    this._droneOsc(220, 0.0, this.closeGain, "triangle", 700, 0.06);
    this._droneOsc(220 * 1.414, 0.0, this.closeGain, "triangle", 700, 0.045);

    // -------- Chase layer: shimmering high + drum timer --------
    this._droneOsc(880, 0.0, this.chaseGain, "sawtooth", 1600, 0.05);
    this._droneOsc(660, 0.0, this.chaseGain, "sawtooth", 1400, 0.05);

    this.unlocked = true;
  }

  resume() {
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
  }

  _makeGain(v) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    g.connect(this.master);
    return g;
  }

  _makeNoiseBuffer(seconds) {
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = this.ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  _noiseLoop() {
    const src = this.ctx.createBufferSource();
    src.buffer = this._makeNoiseBuffer(3.0);
    src.loop = true;
    src.start();
    this._oscillators.push(src);
    return src;
  }

  _droneOsc(freq, gainVal, destination, type = "sine", lpCut = 0, mult = 1.0) {
    const osc = this.ctx.createOscillator();
    osc.type = type; osc.frequency.value = freq;
    let node = osc;
    if (lpCut > 0) {
      const lp = this.ctx.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = lpCut; lp.Q.value = 0.7;
      osc.connect(lp); node = lp;
    }
    const g = this.ctx.createGain(); g.gain.value = gainVal * mult;
    node.connect(g); g.connect(destination);
    osc.start();
    this._oscillators.push(osc);
    return g;
  }

  _envBlip(freq, dur, { type = "sine", gain = 0.5, filter = null, pan = 0 } = {}) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type; osc.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let out = osc;
    if (filter) {
      const f = this.ctx.createBiquadFilter();
      f.type = filter.type || "lowpass";
      f.frequency.value = filter.freq || 1200;
      f.Q.value = filter.Q || 1;
      out.connect(f); out = f;
    }
    out.connect(g);
    const pn = this._panner(pan);
    g.connect(pn);
    pn.connect(this.master);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
  }

  _noiseBurst(dur, { gain = 0.3, freq = 800, type = "bandpass", Q = 1, pan = 0 } = {}) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._makeNoiseBuffer(dur + 0.05);
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = Q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g);
    const pn = this._panner(pan);
    g.connect(pn); pn.connect(this.master);
    src.start(t0); src.stop(t0 + dur + 0.05);
  }

  _panner(value) {
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, value));
      return p;
    }
    // fallback: simple gain (no pan)
    return this.ctx.createGain();
  }

  // ====== Public triggers ======
  footstep(intensity = 1.0, pan = 0) {
    this._noiseBurst(0.12, { gain: 0.12 * intensity, freq: 180, type: "lowpass", Q: 0.7, pan });
    this._noiseBurst(0.04, { gain: 0.06 * intensity, freq: 3500, type: "highpass", Q: 0.9, pan });
  }

  monsterFootstep(intensity = 1.0, pan = 0) {
    this._noiseBurst(0.22, { gain: 0.28 * intensity, freq: 85, type: "lowpass", Q: 0.6, pan });
    this._envBlip(70, 0.18, { type: "sine", gain: 0.18 * intensity, pan });
  }

  binocularZoom() {
    this._envBlip(2600, 0.05, { type: "sine", gain: 0.1 });
    this._noiseBurst(0.04, { gain: 0.05, freq: 4500, type: "highpass" });
  }

  throwablePickup() {
    this._envBlip(1500, 0.06, { type: "triangle", gain: 0.15 });
    this._envBlip(2200, 0.08, { type: "triangle", gain: 0.1 });
  }

  throwSwoosh() {
    this._noiseBurst(0.35, { gain: 0.2, freq: 900, type: "bandpass", Q: 0.6 });
  }

  bottleBreak() {
    // high frequency glass shatter
    this._noiseBurst(0.4, { gain: 0.5, freq: 5200, type: "highpass", Q: 0.8 });
    this._noiseBurst(0.5, { gain: 0.3, freq: 2200, type: "bandpass", Q: 1.5 });
    for (let i = 0; i < 5; i++) {
      const f = 3000 + Math.random() * 3000;
      this._envBlip(f, 0.08 + Math.random() * 0.1, { type: "triangle", gain: 0.1 });
    }
  }

  metalClang(intensity = 1.0) {
    const f = 250 + Math.random() * 300;
    this._envBlip(f, 0.6, { type: "triangle", gain: 0.22 * intensity, filter: { type: "bandpass", freq: 1100, Q: 5 } });
    this._noiseBurst(0.25, { gain: 0.2 * intensity, freq: 2000, type: "bandpass", Q: 3 });
  }

  canClink(intensity = 1.0) {
    this._envBlip(1200, 0.2, { type: "triangle", gain: 0.22 * intensity, filter: { type: "bandpass", freq: 1400, Q: 4 } });
    this._noiseBurst(0.08, { gain: 0.1 * intensity, freq: 3200, type: "highpass" });
  }

  doorOpen() {
    this._noiseBurst(0.6, { gain: 0.2, freq: 400, type: "bandpass", Q: 0.8 });
    this._envBlip(120, 0.6, { type: "sawtooth", gain: 0.08, filter: { type: "lowpass", freq: 500 } });
  }

  lockerOpen() {
    this._noiseBurst(0.35, { gain: 0.24, freq: 1100, type: "bandpass", Q: 1.2 });
    this._envBlip(180, 0.2, { type: "square", gain: 0.06, filter: { type: "lowpass", freq: 700 } });
  }

  pickup() {
    this._envBlip(1200, 0.08, { type: "triangle", gain: 0.18 });
    this._envBlip(1800, 0.08, { type: "triangle", gain: 0.12 });
  }

  keyPickup() {
    this._envBlip(1500, 0.1, { type: "sine", gain: 0.2 });
    this._envBlip(2200, 0.2, { type: "sine", gain: 0.15 });
  }

  engineCrank() {
    this._noiseBurst(0.8, { gain: 0.45, freq: 220, type: "lowpass", Q: 0.7 });
    this._envBlip(80, 0.8, { type: "sawtooth", gain: 0.25 });
  }

  engineStart() {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(60, t0);
    osc.frequency.exponentialRampToValueAtTime(180, t0 + 1.2);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.45, t0 + 0.2);
    g.gain.linearRampToValueAtTime(0.5, t0 + 1.4);
    g.gain.linearRampToValueAtTime(0.0, t0 + 4.5);
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass"; f.frequency.value = 900;
    osc.connect(f); f.connect(g); g.connect(this.master);
    osc.start(t0); osc.stop(t0 + 4.8);
    this._noiseBurst(3.5, { gain: 0.18, freq: 700, type: "bandpass", Q: 0.6 });
  }

  cctvHum() {
    // a low CRT hum
    this._envBlip(60, 0.5, { type: "sawtooth", gain: 0.15, filter: { type: "lowpass", freq: 200 } });
  }

  monsterGrowl(intensity = 1.0, pan = 0) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const dur = 1.2;
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(85, t0);
    osc.frequency.linearRampToValueAtTime(45, t0 + dur);
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 18;
    const lfoGain = this.ctx.createGain(); lfoGain.gain.value = 14;
    lfo.connect(lfoGain); lfoGain.connect(osc.frequency);
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass"; f.frequency.value = 380;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.4 * intensity, t0 + 0.2);
    g.gain.linearRampToValueAtTime(0, t0 + dur);
    const pn = this._panner(pan);
    osc.connect(f); f.connect(g); g.connect(pn); pn.connect(this.master);
    osc.start(t0); osc.stop(t0 + dur + 0.1);
    lfo.start(t0); lfo.stop(t0 + dur + 0.1);
    this._noiseBurst(dur, { gain: 0.1 * intensity, freq: 500, type: "bandpass", Q: 0.6, pan });
  }

  monsterScreech() {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const dur = 1.9;
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(1900, t0);
    osc.frequency.exponentialRampToValueAtTime(220, t0 + dur);
    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass"; f.frequency.value = 1200; f.Q.value = 3;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.6, t0 + 0.1);
    g.gain.linearRampToValueAtTime(0, t0 + dur);
    osc.connect(f); f.connect(g); g.connect(this.master);
    osc.start(t0); osc.stop(t0 + dur + 0.1);
    this._noiseBurst(dur, { gain: 0.3, freq: 2800, type: "bandpass", Q: 2 });
    // sub stinger
    const sub = this.ctx.createOscillator();
    sub.type = "sine"; sub.frequency.value = 42;
    const sg = this.ctx.createGain();
    sg.gain.setValueAtTime(0.6, t0); sg.gain.exponentialRampToValueAtTime(0.001, t0 + 1.6);
    sub.connect(sg); sg.connect(this.master);
    sub.start(t0); sub.stop(t0 + 1.7);
  }

  stinger() {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(90, t0);
    osc.frequency.exponentialRampToValueAtTime(40, t0 + 1.2);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.6, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.2);
    osc.connect(g); g.connect(this.master);
    osc.start(t0); osc.stop(t0 + 1.3);
    this._noiseBurst(1.2, { gain: 0.3, freq: 200, type: "lowpass", Q: 1 });
  }

  // -------- Dynamic music / tension mixer (called each frame from main) --------
  tick(dt, { monsterDist = 999, alert = 0, sprinting = false, hiding = false, binoculars = false, chasing = false } = {}) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // Music layer weights based on spec:
    //   > 40m      → almost silence (just ambient)
    //   25..40m    → tense begins (soft)
    //   < 20m      → close layer rises
    //   chasing    → chase layer maxes
    let wAmb = 0.75, wTense = 0, wClose = 0, wChase = 0;
    if (monsterDist > 40) {
      // mostly silent ambient
      wAmb = 0.7;
    } else if (monsterDist > 25) {
      const t = 1 - (monsterDist - 25) / 15;  // 0..1
      wAmb = 0.75;
      wTense = t * 0.55;
    } else if (monsterDist > 15) {
      const t = 1 - (monsterDist - 15) / 10;
      wAmb = 0.75;
      wTense = 0.55 + t * 0.2;
      wClose = t * 0.45;
    } else {
      wAmb = 0.6;
      wTense = 0.7;
      wClose = 0.65;
    }
    if (chasing || alert > 0.85) {
      wChase = 0.8;
      wClose = Math.max(wClose, 0.7);
      wTense = Math.max(wTense, 0.6);
    }
    if (binoculars) {
      // Muffle when using binoculars — spec says binoculars reduce hearing
      wAmb *= 0.4; wTense *= 0.4; wClose *= 0.5; wChase *= 0.5;
    }

    this.ambientGain.gain.cancelScheduledValues(now);
    this.tenseGain.gain.cancelScheduledValues(now);
    this.closeGain.gain.cancelScheduledValues(now);
    this.chaseGain.gain.cancelScheduledValues(now);
    this.ambientGain.gain.linearRampToValueAtTime(wAmb * 0.9, now + 0.3);
    this.tenseGain.gain.linearRampToValueAtTime(wTense * 0.55, now + 0.4);
    this.closeGain.gain.linearRampToValueAtTime(wClose * 0.55, now + 0.25);
    this.chaseGain.gain.linearRampToValueAtTime(wChase * 0.5, now + 0.15);

    // Chase-layer percussion pulse
    this._percTimer -= dt;
    if (wChase > 0.2 && this._percTimer <= 0) {
      this._percTimer = 0.28 + Math.random() * 0.08;
      // low drum + hiss hi-hat
      this._noiseBurst(0.12, { gain: 0.35 * wChase, freq: 110, type: "lowpass", Q: 0.6 });
      this._noiseBurst(0.04, { gain: 0.1 * wChase, freq: 7500, type: "highpass" });
    }

    // Ambient accents: occasional drip / metal scrape when calm
    this._ambScrape -= dt; this._ambDrip -= dt;
    if (wChase < 0.1 && wClose < 0.1) {
      if (this._ambScrape <= 0 && Math.random() < 0.4) {
        this._ambScrape = 6 + Math.random() * 10;
        this._noiseBurst(1.2, { gain: 0.1, freq: 1400, type: "bandpass", Q: 4 });
      }
      if (this._ambDrip <= 0 && Math.random() < 0.6) {
        this._ambDrip = 4 + Math.random() * 8;
        this._envBlip(1800 + Math.random() * 300, 0.25, { type: "sine", gain: 0.1 });
      }
    }

    // Heartbeat
    const proximity = Math.max(0, Math.min(1, 1 - monsterDist / 16));
    const tension = Math.max(proximity, alert);
    const heartVol = tension * 0.6;
    const heartRate = 0.9 + tension * 2.0;
    this.heartGain.gain.cancelScheduledValues(now);
    this.heartGain.gain.linearRampToValueAtTime(heartVol, now + 0.1);
    this._heartTimer -= dt;
    if (this._heartTimer <= 0 && tension > 0.12) {
      this._heartTimer = 1 / heartRate;
      const t0 = this.ctx.currentTime;
      for (const [dt2, amp] of [[0, 1.0], [0.16, 0.7]]) {
        const o = this.ctx.createOscillator();
        o.type = "sine";
        o.frequency.setValueAtTime(70, t0 + dt2);
        o.frequency.exponentialRampToValueAtTime(40, t0 + dt2 + 0.12);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0, t0 + dt2);
        g.gain.linearRampToValueAtTime(0.55 * amp, t0 + dt2 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt2 + 0.18);
        o.connect(g); g.connect(this.heartGain);
        o.start(t0 + dt2); o.stop(t0 + dt2 + 0.22);
      }
    }

    // Breath
    let breathVol = sprinting ? 0.4 : (hiding ? 0.15 : 0.07);
    if (binoculars) breathVol *= 0.5;
    this.breathGain.gain.cancelScheduledValues(now);
    this.breathGain.gain.linearRampToValueAtTime(breathVol, now + 0.2);
    this._breathTimer -= dt;
    const breathInterval = sprinting ? 0.9 : (hiding ? 3.2 : 2.6);
    if (this._breathTimer <= 0) {
      this._breathTimer = breathInterval;
      const t0 = this.ctx.currentTime;
      const src = this.ctx.createBufferSource();
      src.buffer = this._makeNoiseBuffer(0.6);
      const f = this.ctx.createBiquadFilter();
      f.type = "bandpass"; f.frequency.value = 600; f.Q.value = 0.5;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.55, t0 + 0.08);
      g.gain.linearRampToValueAtTime(0, t0 + 0.55);
      src.connect(f); f.connect(g); g.connect(this.breathGain);
      src.start(t0); src.stop(t0 + 0.6);
    }
  }
}

export const Audio = new AudioEngine();



// ============== Shooter-specific audio additions ==============
//
// New sounds used by weapon.js / skeleton.js / arrow.js / player.js.
// We attach them to the existing AudioEngine singleton.

AudioEngine.prototype.pistolShot = function (intensity = 1.0) {
  if (!this.ctx) return;
  const t0 = this.ctx.currentTime;
  // Initial crack — high hiss
  this._noiseBurst(0.05, {
    gain: 0.6 * intensity, freq: 3800, type: "bandpass", Q: 0.8
  });
  // Body — mid thump
  this._noiseBurst(0.18, {
    gain: 0.55 * intensity, freq: 380, type: "lowpass", Q: 0.7
  });
  // Tail — short reverb whoosh
  this._noiseBurst(0.45, {
    gain: 0.22 * intensity, freq: 900, type: "bandpass", Q: 0.5
  });
  // Sub thump
  const osc = this.ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(120, t0);
  osc.frequency.exponentialRampToValueAtTime(40, t0 + 0.14);
  const g = this.ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(0.55 * intensity, t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
  osc.connect(g); g.connect(this.master);
  osc.start(t0); osc.stop(t0 + 0.3);
};

AudioEngine.prototype.pistolReload = function () {
  // Magazine release click
  this._envBlip(1400, 0.04, { type: "triangle", gain: 0.2 });
  // Mag drop
  setTimeout(() => {
    this._envBlip(220, 0.12, { type: "square", gain: 0.22,
      filter: { type: "bandpass", freq: 600, Q: 2 } });
  }, 250);
  // New mag slap
  setTimeout(() => {
    this._envBlip(380, 0.08, { type: "square", gain: 0.3,
      filter: { type: "bandpass", freq: 800, Q: 2 } });
    this._noiseBurst(0.06, { gain: 0.2, freq: 2200, type: "bandpass", Q: 3 });
  }, 1200);
  // Slide pull/release
  setTimeout(() => {
    this._noiseBurst(0.25, { gain: 0.18, freq: 3500, type: "highpass", Q: 0.8 });
  }, 1600);
  setTimeout(() => {
    this._envBlip(1200, 0.04, { type: "triangle", gain: 0.3 });
    this._noiseBurst(0.05, { gain: 0.25, freq: 4000, type: "highpass" });
  }, 1900);
};

AudioEngine.prototype.bowDraw = function () {
  // Faint wood creak
  if (!this.ctx) return;
  this._envBlip(140, 0.25, { type: "triangle", gain: 0.12,
    filter: { type: "bandpass", freq: 300, Q: 2 } });
};

AudioEngine.prototype.bowRelease = function () {
  // String thrum + short whoosh
  this._noiseBurst(0.12, { gain: 0.25, freq: 700, type: "bandpass", Q: 3 });
  this._envBlip(160, 0.15, { type: "triangle", gain: 0.25 });
  this._noiseBurst(0.3, { gain: 0.14, freq: 1400, type: "bandpass", Q: 0.5 });
};

AudioEngine.prototype.arrowHitFlesh = function () {
  this._noiseBurst(0.12, { gain: 0.32, freq: 240, type: "lowpass", Q: 0.8 });
  this._envBlip(90, 0.15, { type: "sawtooth", gain: 0.22 });
};

AudioEngine.prototype.arrowStick = function () {
  this._envBlip(520, 0.1, { type: "triangle", gain: 0.2,
    filter: { type: "bandpass", freq: 900, Q: 2 } });
  this._noiseBurst(0.08, { gain: 0.15, freq: 2200, type: "bandpass", Q: 2 });
};

AudioEngine.prototype.skeletonHit = function () {
  // Bone crack
  this._envBlip(1600, 0.06, { type: "triangle", gain: 0.28,
    filter: { type: "bandpass", freq: 1800, Q: 3 } });
  this._noiseBurst(0.1, { gain: 0.18, freq: 3200, type: "highpass" });
  // Pained rattle
  this._noiseBurst(0.25, { gain: 0.16, freq: 400, type: "bandpass", Q: 1.5 });
};

AudioEngine.prototype.skeletonDie = function () {
  if (!this.ctx) return;
  const t0 = this.ctx.currentTime;
  // Dry bone collapse
  this._noiseBurst(0.5, { gain: 0.3, freq: 1200, type: "bandpass", Q: 2 });
  // Falling bones rattle
  for (let i = 0; i < 5; i++) {
    setTimeout(() => {
      this._envBlip(600 + Math.random() * 400, 0.08, {
        type: "triangle", gain: 0.18,
        filter: { type: "bandpass", freq: 1100, Q: 4 }
      });
    }, 80 + i * 120);
  }
  // Low final thud
  const osc = this.ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(65, t0 + 0.5);
  osc.frequency.exponentialRampToValueAtTime(38, t0 + 0.8);
  const g = this.ctx.createGain();
  g.gain.setValueAtTime(0.38, t0 + 0.5);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.85);
  osc.connect(g); g.connect(this.master);
  osc.start(t0 + 0.5); osc.stop(t0 + 0.9);
};

AudioEngine.prototype.playerHurt = function (intensity = 1.0) {
  // Grunt + breath
  if (!this.ctx) return;
  const t0 = this.ctx.currentTime;
  const osc = this.ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(170 + Math.random() * 40, t0);
  osc.frequency.exponentialRampToValueAtTime(110, t0 + 0.25);
  const f = this.ctx.createBiquadFilter();
  f.type = "bandpass"; f.frequency.value = 600; f.Q.value = 0.7;
  const g = this.ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(0.35 * intensity, t0 + 0.05);
  g.gain.linearRampToValueAtTime(0, t0 + 0.35);
  osc.connect(f); f.connect(g); g.connect(this.master);
  osc.start(t0); osc.stop(t0 + 0.4);
  this._noiseBurst(0.2, { gain: 0.18 * intensity, freq: 600, type: "bandpass", Q: 0.5 });
};

AudioEngine.prototype.dryFire = function () {
  this._envBlip(1200, 0.04, { type: "triangle", gain: 0.15 });
  this._noiseBurst(0.04, { gain: 0.1, freq: 3500, type: "highpass" });
};
