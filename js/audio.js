// Procedural audio engine — all sounds synthesized with WebAudio.
// No external assets needed. Volume reacts to monster distance for tension.

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.ambientGain = null;
    this.heartGain = null;
    this.breathGain = null;
    this.unlocked = false;

    this._heartTimer = 0;
    this._breathTimer = 0;
    this._footTimer = 0;
  }

  init() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(this.ctx.destination);

    // --- Persistent ambient drone ---
    this.ambientGain = this.ctx.createGain();
    this.ambientGain.gain.value = 0.0;
    this.ambientGain.connect(this.master);

    // Two low detuned oscillators + noise for industrial drone
    const oscA = this.ctx.createOscillator();
    oscA.type = "sawtooth";
    oscA.frequency.value = 55;
    const oscB = this.ctx.createOscillator();
    oscB.type = "sine";
    oscB.frequency.value = 41;

    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 180;

    const droneGain = this.ctx.createGain();
    droneGain.gain.value = 0.15;

    oscA.connect(lp);
    oscB.connect(lp);
    lp.connect(droneGain);
    droneGain.connect(this.ambientGain);

    oscA.start();
    oscB.start();

    // Noise hiss (air / vents)
    const noiseBuf = this._makeNoiseBuffer(2.0);
    const noise = this.ctx.createBufferSource();
    noise.buffer = noiseBuf;
    noise.loop = true;
    const noiseFilt = this.ctx.createBiquadFilter();
    noiseFilt.type = "bandpass";
    noiseFilt.frequency.value = 400;
    noiseFilt.Q.value = 0.8;
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.value = 0.05;
    noise.connect(noiseFilt);
    noiseFilt.connect(noiseGain);
    noiseGain.connect(this.ambientGain);
    noise.start();

    // fade ambient in
    const now = this.ctx.currentTime;
    this.ambientGain.gain.setValueAtTime(0, now);
    this.ambientGain.gain.linearRampToValueAtTime(0.6, now + 2.5);

    // --- Heartbeat gain ---
    this.heartGain = this.ctx.createGain();
    this.heartGain.gain.value = 0.0;
    this.heartGain.connect(this.master);

    this.breathGain = this.ctx.createGain();
    this.breathGain.gain.value = 0.0;
    this.breathGain.connect(this.master);

    this.unlocked = true;
  }

  resume() {
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume();
    }
  }

  // --- Helpers ---

  _makeNoiseBuffer(seconds) {
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = this.ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  _envBlip(freq, dur, { type = "sine", gain = 0.5, filter = null } = {}) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;

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
      out.connect(f);
      out = f;
    }
    out.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  _noiseBurst(dur, { gain = 0.3, freq = 800, type = "bandpass", Q = 1 } = {}) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._makeNoiseBuffer(dur + 0.05);
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = Q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  // --- Public triggers ---

  footstep(intensity = 1.0) {
    // Short low thud + a tiny click
    this._noiseBurst(0.12, { gain: 0.12 * intensity, freq: 180, type: "lowpass", Q: 0.7 });
    this._noiseBurst(0.04, { gain: 0.06 * intensity, freq: 3500, type: "highpass", Q: 0.9 });
  }

  monsterFootstep(intensity = 1.0) {
    this._noiseBurst(0.2, { gain: 0.25 * intensity, freq: 90, type: "lowpass", Q: 0.6 });
    this._envBlip(70, 0.18, { type: "sine", gain: 0.15 * intensity });
  }

  flashlightClick() {
    this._envBlip(1800, 0.04, { type: "square", gain: 0.15 });
    this._noiseBurst(0.03, { gain: 0.08, freq: 6000, type: "highpass" });
  }

  binocularClick() {
    this._envBlip(900, 0.07, { type: "triangle", gain: 0.12 });
  }

  doorOpen() {
    this._noiseBurst(0.6, { gain: 0.18, freq: 400, type: "bandpass", Q: 0.8 });
    this._envBlip(120, 0.6, { type: "sawtooth", gain: 0.08, filter: { type: "lowpass", freq: 500 } });
  }

  lockerOpen() {
    this._noiseBurst(0.35, { gain: 0.22, freq: 1100, type: "bandpass", Q: 1.2 });
    this._envBlip(180, 0.2, { type: "square", gain: 0.05, filter: { type: "lowpass", freq: 700 } });
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
    // failing crank
    this._noiseBurst(0.8, { gain: 0.45, freq: 220, type: "lowpass", Q: 0.7 });
    this._envBlip(80, 0.8, { type: "sawtooth", gain: 0.25 });
  }

  engineStart() {
    // roar
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(60, t0);
    osc.frequency.exponentialRampToValueAtTime(180, t0 + 1.2);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0, t0);
    g.gain.linearRampToValueAtTime(0.4, t0 + 0.2);
    g.gain.linearRampToValueAtTime(0.5, t0 + 1.4);
    g.gain.linearRampToValueAtTime(0.0, t0 + 4.0);
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 900;
    osc.connect(f); f.connect(g); g.connect(this.master);
    osc.start(t0); osc.stop(t0 + 4.2);

    this._noiseBurst(3.5, { gain: 0.18, freq: 700, type: "bandpass", Q: 0.6 });
  }

  monsterGrowl(intensity = 1.0) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const dur = 1.2;
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(80, t0);
    osc.frequency.linearRampToValueAtTime(45, t0 + dur);
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 18;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 12;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 350;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.35 * intensity, t0 + 0.2);
    g.gain.linearRampToValueAtTime(0, t0 + dur);
    osc.connect(f); f.connect(g); g.connect(this.master);
    osc.start(t0); osc.stop(t0 + dur + 0.1);
    lfo.start(t0); lfo.stop(t0 + dur + 0.1);

    this._noiseBurst(dur, { gain: 0.1 * intensity, freq: 500, type: "bandpass", Q: 0.6 });
  }

  monsterScreech() {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const dur = 1.8;
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(1800, t0);
    osc.frequency.exponentialRampToValueAtTime(220, t0 + dur);
    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 1200; f.Q.value = 3;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.5, t0 + 0.1);
    g.gain.linearRampToValueAtTime(0, t0 + dur);
    osc.connect(f); f.connect(g); g.connect(this.master);
    osc.start(t0); osc.stop(t0 + dur + 0.1);
    this._noiseBurst(dur, { gain: 0.25, freq: 2500, type: "bandpass", Q: 2 });
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

  // called each frame by main loop with distance to monster & alert level
  tick(dt, { monsterDist = 999, alert = 0, sprinting = false, hiding = false, binoculars = false } = {}) {
    if (!this.ctx) return;

    // Heartbeat — louder & faster when monster close or chase
    const proximity = Math.max(0, Math.min(1, 1 - monsterDist / 14));
    const tension = Math.max(proximity, alert);
    const heartVol = tension * 0.55;
    const heartRate = 0.9 + tension * 1.8; // beats per second

    // smooth
    const now = this.ctx.currentTime;
    this.heartGain.gain.cancelScheduledValues(now);
    this.heartGain.gain.linearRampToValueAtTime(heartVol, now + 0.1);

    this._heartTimer -= dt;
    if (this._heartTimer <= 0 && tension > 0.15) {
      this._heartTimer = 1 / heartRate;
      // two thuds (lub-dub)
      const t0 = this.ctx.currentTime;
      for (const [dt2, amp] of [[0, 1.0], [0.16, 0.7]]) {
        const o = this.ctx.createOscillator();
        o.type = "sine";
        o.frequency.setValueAtTime(70, t0 + dt2);
        o.frequency.exponentialRampToValueAtTime(40, t0 + dt2 + 0.12);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0, t0 + dt2);
        g.gain.linearRampToValueAtTime(0.5 * amp, t0 + dt2 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt2 + 0.18);
        o.connect(g); g.connect(this.heartGain);
        o.start(t0 + dt2); o.stop(t0 + dt2 + 0.22);
      }
    }

    // Breath — heavier when sprinting, calmer when hiding
    let breathVol = sprinting ? 0.35 : (hiding ? 0.12 : 0.06);
    if (binoculars) breathVol *= 0.4; // muffled while using binoculars
    this.breathGain.gain.cancelScheduledValues(now);
    this.breathGain.gain.linearRampToValueAtTime(breathVol, now + 0.2);

    this._breathTimer -= dt;
    const breathInterval = sprinting ? 0.9 : (hiding ? 3.2 : 2.6);
    if (this._breathTimer <= 0) {
      this._breathTimer = breathInterval;
      // exhale
      const t0 = this.ctx.currentTime;
      const src = this.ctx.createBufferSource();
      src.buffer = this._makeNoiseBuffer(0.6);
      const f = this.ctx.createBiquadFilter();
      f.type = "bandpass"; f.frequency.value = 600; f.Q.value = 0.5;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.5, t0 + 0.08);
      g.gain.linearRampToValueAtTime(0, t0 + 0.55);
      src.connect(f); f.connect(g); g.connect(this.breathGain);
      src.start(t0); src.stop(t0 + 0.6);
    }

    // Duck ambient when using binoculars
    const ambTarget = binoculars ? 0.15 : 0.6;
    this.ambientGain.gain.cancelScheduledValues(now);
    this.ambientGain.gain.linearRampToValueAtTime(ambTarget, now + 0.2);
  }
}

export const Audio = new AudioEngine();
