import { loadSfxBuffer } from './sfx-buffer.js';

// Independent audio branch: the lobby hum never passes through this reverb.
export const footstepRanges = {
  volume: { min: 0, max: 0.5, step: 0.01 },
  intervalSeconds: { min: 0.2, max: 1.5, step: 0.01 },
  reverbSeconds: { min: 0.3, max: 5, step: 0.1 },
};

function randomSource() {
  let seed = 317;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296 * 2 - 1;
  };
}

export class LobbyFootsteps {
  constructor(settings) {
    this.settings = settings;
    this.context = null;
    this.inLobby = false;
    this.nextStepAt = null;
    this.foot = 0;
    this.voices = new Set();
    this.retiredReverbs = new Map();
    this.buffers = [];
    this.lastFile = -1;
    this.mode = 'loading';
  }

  attach(context) {
    if (this.context === context) return;
    if (this.context) this.dispose();
    this.context = context;
    this.output = context.createGain();
    this.output.gain.value = 0;
    this.duckGain = context.createGain();
    this.duckGain.gain.value = 1;
    this.duckTarget = 1;
    // Apply the same multiplier to dry impacts and the existing reverb tail.
    this.output.connect(this.duckGain).connect(context.destination);
    this.input = context.createGain();
    this.dry = context.createGain();
    this.dry.gain.value = 0.65;
    this.input.connect(this.dry).connect(this.output);
    const random = randomSource();
    this.noise = context.createBuffer(1, Math.ceil(context.sampleRate * 0.1), context.sampleRate);
    const samples = this.noise.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = random();
    this.replaceReverb();
    this.updateVolume();
    this.loadController = new AbortController();
    this.loadPromise = this.loadFiles(context, this.loadController);
  }

  async loadFiles(context, controller) {
    try {
      if (!this.settings.files?.length) throw new Error('Footstep files not configured');
      const buffers = await Promise.all(this.settings.files.map(file => loadSfxBuffer(context, file, controller.signal)));
      if (context !== this.context || controller.signal.aborted) return;
      this.buffers = buffers;
      this.mode = 'file';
    } catch (error) {
      if (context !== this.context || controller.signal.aborted) return;
      console.warn('Footstep files unavailable; using synthesized fallback:', error);
      this.mode = 'synth';
    }
  }

  replaceReverb() {
    const context = this.context;
    if (!context) return;
    const old = this.reverb;
    const duration = this.settings.reverbSeconds;
    const buffer = context.createBuffer(2, Math.ceil(context.sampleRate * duration), context.sampleRate);
    const random = randomSource();
    for (let channel = 0; channel < 2; channel++) {
      const samples = buffer.getChannelData(channel);
      let softened = 0;
      for (let i = 0; i < samples.length; i++) {
        const t = i / context.sampleRate;
        softened += 0.18 * (random() - softened);
        // A short predelay, dense stereo reflections, and a dark finite tail.
        const attack = Math.min(1, Math.max(0, (t - 0.025) / 0.025));
        const end = Math.min(1, (duration - t) / 0.08);
        samples[i] = softened * attack * Math.exp(-6 * t / duration) * end;
      }
    }
    const convolver = context.createConvolver();
    convolver.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1000;
    filter.Q.value = 0.45;
    const wet = context.createGain();
    wet.gain.value = 0.85;
    this.input.connect(convolver).connect(filter).connect(wet).connect(this.output);
    this.reverb = { convolver, filter, wet, duration };
    if (old) {
      // Old footsteps finish ringing; only new footsteps use the new room size.
      this.input.disconnect(old.convolver);
      const timer = setTimeout(() => {
        this.disconnectReverb(old);
        this.retiredReverbs.delete(old);
      }, (old.duration + 0.3) * 1000);
      this.retiredReverbs.set(old, timer);
    }
  }

  setParameters(values) {
    const previousDuration = this.settings.reverbSeconds;
    for (const [key, range] of Object.entries(footstepRanges)) {
      if (Number.isFinite(values[key])) {
        this.settings[key] = Math.min(range.max, Math.max(range.min, values[key]));
      }
    }
    if (previousDuration !== this.settings.reverbSeconds) this.replaceReverb();
    this.updateVolume();
  }

  updateVolume() {
    if (!this.context) return;
    const now = this.context.currentTime;
    this.output.gain.cancelAndHoldAtTime(now);
    this.output.gain.linearRampToValueAtTime(this.inLobby ? this.settings.volume : 0, now + 0.04);
  }

  setDuck(multiplier) {
    if (!this.duckGain || this.duckTarget === multiplier) return;
    this.duckTarget = multiplier;
    this.duckGain.gain.setTargetAtTime(multiplier, this.context.currentTime, 0.15);
  }

  update(moving, space) {
    const inLobby = space === 'lobby';
    if (this.inLobby !== inLobby) {
      this.inLobby = inLobby;
      this.updateVolume();
    }
    if (!moving || !inLobby || this.context?.state !== 'running') {
      this.stop();
      return;
    }
    const now = this.context.currentTime;
    if (this.nextStepAt === null || now >= this.nextStepAt) {
      this.playStep(now);
      // No queued footsteps and no catch-up burst after a slow frame or pause.
      this.nextStepAt = now + this.settings.intervalSeconds;
    }
  }

  playStep(time) {
    if (this.buffers.length) { this.playFileStep(time); return; }
    this.playSynthStep(time);
  }

  playFileStep(time) {
    const context = this.context;
    const count = this.buffers.length;
    // Select among every clip except the last one; two-file sets also alternate.
    let index = Math.floor(Math.random() * (this.lastFile < 0 ? count : count - 1));
    if (this.lastFile >= 0 && index >= this.lastFile) index++;
    if (count === 1) index = 0;
    this.lastFile = index;
    const source = context.createBufferSource();
    source.buffer = this.buffers[index];
    source.playbackRate.value = 0.95 + Math.random() * 0.1;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1250;
    filter.Q.value = 0.5;
    const gain = context.createGain();
    const duration = source.buffer.duration / source.playbackRate.value;
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(1, time + Math.min(0.008, duration / 4));
    gain.gain.setValueAtTime(1, time + Math.max(duration - 0.02, duration / 2));
    gain.gain.linearRampToValueAtTime(0, time + duration);
    source.connect(filter).connect(gain).connect(this.input);
    const voice = { source, filter, gain };
    this.voices.add(voice);
    source.onended = () => {
      Object.values(voice).forEach(node => node.disconnect());
      this.voices.delete(voice);
    };
    source.start(time);
    source.stop(time + duration);
  }

  playSynthStep(time) {
    const context = this.context;
    const pitch = 2 ** ((this.foot === 0 ? -18 : 18) / 1200);
    this.foot = 1 - this.foot;
    const noise = context.createBufferSource();
    noise.buffer = this.noise;
    noise.playbackRate.value = pitch;
    const noiseFilter = context.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.value = 1250 * pitch;
    noiseFilter.Q.value = 0.5;
    const impact = context.createGain();
    impact.gain.setValueAtTime(0, time);
    impact.gain.linearRampToValueAtTime(0.7, time + 0.004);
    impact.gain.exponentialRampToValueAtTime(0.0001, time + 0.085);
    noise.connect(noiseFilter).connect(impact).connect(this.input);
    const body = context.createOscillator();
    body.type = 'sine';
    body.frequency.setValueAtTime(115 * pitch, time);
    body.frequency.exponentialRampToValueAtTime(62 * pitch, time + 0.15);
    const bodyGain = context.createGain();
    bodyGain.gain.setValueAtTime(0, time);
    bodyGain.gain.linearRampToValueAtTime(0.8, time + 0.008);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.19);
    body.connect(bodyGain).connect(this.input);
    const voice = { noise, noiseFilter, impact, body, bodyGain };
    this.voices.add(voice);
    body.onended = () => {
      Object.values(voice).forEach(node => node.disconnect());
      this.voices.delete(voice);
    };
    noise.start(time);
    noise.stop(time + 0.1);
    body.start(time);
    body.stop(time + 0.2);
  }

  stop() {
    // Let the existing impact and convolution decay naturally after movement stops.
    this.nextStepAt = null;
  }

  disconnectReverb(reverb) {
    reverb.convolver.disconnect();
    reverb.filter.disconnect();
    reverb.wet.disconnect();
  }

  dispose() {
    this.stop();
    this.loadController?.abort();
    if (!this.context) return;
    for (const voice of this.voices) {
      Object.values(voice).forEach(node => { node.stop?.(); node.disconnect(); });
    }
    this.voices.clear();
    for (const [reverb, timer] of this.retiredReverbs) {
      clearTimeout(timer);
      this.disconnectReverb(reverb);
    }
    this.retiredReverbs.clear();
    this.disconnectReverb(this.reverb);
    this.reverb = null;
    this.input.disconnect();
    this.dry.disconnect();
    this.output.disconnect();
    this.duckGain.disconnect();
    this.duckGain = null;
    this.context = null; // Shared context belongs to the audio owner, not footsteps.
    this.buffers = [];
    this.lastFile = -1;
    this.loadPromise = null;
    this.mode = 'loading';
  }
}
