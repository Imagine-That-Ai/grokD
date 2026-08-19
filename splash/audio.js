/**
 * GrokD Splash Screen Sound Synthesizer (Web Audio API)
 * Zero external assets required — 100% procedurally synthesized in real-time.
 */
class SplashAudio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.masterGain = null;
  }

  init() {
    if (this.ctx) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.55;
      this.masterGain.connect(this.ctx.destination);
    } catch (e) {
      console.warn("Web Audio not supported or blocked:", e);
    }
  }

  resume() {
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume();
    }
  }

  toggle(state) {
    this.enabled = state !== undefined ? state : !this.enabled;
    return this.enabled;
  }

  // Phase 1: Echo swarm ambient shimmer & gentle whooshes
  playEchoWhoosh(index = 0, total = 30) {
    if (!this.enabled || !this.ctx) return;
    this.resume();

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    // Pentatonic crystal notes cascading upwards
    const scale = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51, 1567.98];
    const freq = scale[index % scale.length] * (1 + (index / total) * 0.5);

    osc.type = "sine";
    osc.frequency.setValueAtTime(freq * 0.8, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.25, t + 0.35);

    filter.type = "bandpass";
    filter.frequency.setValueAtTime(freq, t);
    filter.Q.value = 4.0;

    const pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    if (pan) {
      pan.pan.value = (Math.random() * 2 - 1) * 0.8;
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(pan);
      pan.connect(this.masterGain);
    } else {
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);
    }

    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(0.045, t + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);

    osc.start(t);
    osc.stop(t + 0.42);
  }

  // Phase 2: Hero Mascot Grand Zoom In
  playHeroRise() {
    if (!this.enabled || !this.ctx) return;
    this.resume();

    const t = this.ctx.currentTime;

    // Sub-bass sweep
    const sub = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    sub.type = "triangle";
    sub.frequency.setValueAtTime(55, t);
    sub.frequency.exponentialRampToValueAtTime(140, t + 0.6);
    sub.frequency.exponentialRampToValueAtTime(70, t + 1.1);

    subGain.gain.setValueAtTime(0.001, t);
    subGain.gain.linearRampToValueAtTime(0.28, t + 0.4);
    subGain.gain.exponentialRampToValueAtTime(0.001, t + 1.15);

    sub.connect(subGain);
    subGain.connect(this.masterGain);
    sub.start(t);
    sub.stop(t + 1.2);

    // Shimmer riser chord
    [440, 554.37, 659.25, 880].forEach((baseFreq, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(baseFreq * 0.5, t);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.5, t + 0.8);

      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.06 / (i + 1), t + 0.5);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.95);
    });
  }

  // Phase 3: Funny Eyes Darting
  playEyeDart() {
    if (!this.enabled || !this.ctx) return;
    this.resume();

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(320, t);
    osc.frequency.exponentialRampToValueAtTime(680, t + 0.08);
    osc.frequency.exponentialRampToValueAtTime(400, t + 0.16);

    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(0.12, t + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  // Phase 3: Cheeky Wink Pop & Sparkle
  playWink() {
    if (!this.enabled || !this.ctx) return;
    this.resume();

    const t = this.ctx.currentTime;

    // Pop bubble
    const pop = this.ctx.createOscillator();
    const popGain = this.ctx.createGain();
    pop.type = "sine";
    pop.frequency.setValueAtTime(520, t);
    pop.frequency.exponentialRampToValueAtTime(1480, t + 0.1);

    popGain.gain.setValueAtTime(0.001, t);
    popGain.gain.linearRampToValueAtTime(0.25, t + 0.02);
    popGain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);

    pop.connect(popGain);
    popGain.connect(this.masterGain);
    pop.start(t);
    pop.stop(t + 0.2);

    // Sparkle chime cascade
    [1760, 2217.46, 2637.02, 3520].forEach((freq, i) => {
      const chime = this.ctx.createOscillator();
      const cGain = this.ctx.createGain();
      chime.type = "sine";
      chime.frequency.setValueAtTime(freq, t + 0.05 + i * 0.03);

      cGain.gain.setValueAtTime(0.001, t + 0.05 + i * 0.03);
      cGain.gain.linearRampToValueAtTime(0.09, t + 0.07 + i * 0.03);
      cGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35 + i * 0.03);

      chime.connect(cGain);
      cGain.connect(this.masterGain);
      chime.start(t + 0.05 + i * 0.03);
      chime.stop(t + 0.4 + i * 0.03);
    });
  }

  // Phase 4: Diagonal "grok" SLAP impact
  playGrokSlam() {
    if (!this.enabled || !this.ctx) return;
    this.resume();

    const t = this.ctx.currentTime;

    // Heavy low punch (808 style drop)
    const kick = this.ctx.createOscillator();
    const kickGain = this.ctx.createGain();
    kick.type = "sine";
    kick.frequency.setValueAtTime(180, t);
    kick.frequency.exponentialRampToValueAtTime(38, t + 0.28);

    kickGain.gain.setValueAtTime(0.7, t);
    kickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.55);

    kick.connect(kickGain);
    kickGain.connect(this.masterGain);
    kick.start(t);
    kick.stop(t + 0.6);

    // White noise impact burst
    const bufferSize = this.ctx.sampleRate * 0.2;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.04));
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = "lowpass";
    noiseFilter.frequency.setValueAtTime(2400, t);
    noiseFilter.frequency.exponentialRampToValueAtTime(200, t + 0.2);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.4, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.masterGain);
    noise.start(t);

    // Metallic ring slap transient
    const slap = this.ctx.createOscillator();
    const slapGain = this.ctx.createGain();
    slap.type = "sawtooth";
    slap.frequency.setValueAtTime(840, t);
    slap.frequency.exponentialRampToValueAtTime(160, t + 0.12);

    slapGain.gain.setValueAtTime(0.22, t);
    slapGain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

    slap.connect(slapGain);
    slapGain.connect(this.masterGain);
    slap.start(t);
    slap.stop(t + 0.16);
  }

  // Phase 5: "D" Slam, Electric Glitch Tweak & Pendulum Dangle
  playDSlamAndTweak() {
    if (!this.enabled || !this.ctx) return;
    this.resume();

    const t = this.ctx.currentTime;

    // Sharp metallic impact
    const strike = this.ctx.createOscillator();
    const sGain = this.ctx.createGain();
    strike.type = "triangle";
    strike.frequency.setValueAtTime(440, t);
    strike.frequency.exponentialRampToValueAtTime(65, t + 0.22);

    sGain.gain.setValueAtTime(0.6, t);
    sGain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);

    strike.connect(sGain);
    sGain.connect(this.masterGain);
    strike.start(t);
    strike.stop(t + 0.5);

    // Electric glitch crackle burst
    for (let i = 0; i < 4; i++) {
      const zapTime = t + 0.04 + i * 0.05;
      const zap = this.ctx.createOscillator();
      const zGain = this.ctx.createGain();
      zap.type = i % 2 === 0 ? "sawtooth" : "square";
      zap.frequency.setValueAtTime(900 + Math.random() * 800, zapTime);
      zap.frequency.exponentialRampToValueAtTime(180, zapTime + 0.04);

      zGain.gain.setValueAtTime(0.18, zapTime);
      zGain.gain.exponentialRampToValueAtTime(0.001, zapTime + 0.045);

      zap.connect(zGain);
      zGain.connect(this.masterGain);
      zap.start(zapTime);
      zap.stop(zapTime + 0.05);
    }

    // Pendulum creak / loose hinge chime
    const creak = this.ctx.createOscillator();
    const cGain = this.ctx.createGain();
    creak.type = "sine";
    creak.frequency.setValueAtTime(260, t + 0.28);
    creak.frequency.linearRampToValueAtTime(190, t + 0.55);

    cGain.gain.setValueAtTime(0.001, t + 0.28);
    cGain.gain.linearRampToValueAtTime(0.08, t + 0.35);
    cGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.65);

    creak.connect(cGain);
    cGain.connect(this.masterGain);
    creak.start(t + 0.28);
    creak.stop(t + 0.7);
  }

  // Micro creak when user drags or taps hanging D
  playCreak() {
    if (!this.enabled || !this.ctx) return;
    this.resume();

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(220 + Math.random() * 60, t);
    osc.frequency.linearRampToValueAtTime(170, t + 0.18);

    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(0.09, t + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.22);
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = SplashAudio;
} else {
  window.SplashAudio = SplashAudio;
}
