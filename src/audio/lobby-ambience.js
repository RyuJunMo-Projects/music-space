import { loadSfxBuffer, crossfadeLoopBuffer } from './sfx-buffer.js';

// File ambience with the original synth as fallback. No audio analysis is used.
export class LobbyAmbience {
  constructor(settings) {
    this.settings = settings;
    this.context = null;
    this.output = null;
    this.voices = [];
    this.active = false;
    this.mode = 'loading';
    this.loadPromise = null;
  }

  async unlock() {
    if (!this.context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error('Web Audio unavailable');
      this.context = new AudioContextClass();
      this.output = this.context.createGain();
      this.output.gain.value = 0;
      this.duckGain = this.context.createGain();
      this.duckGain.gain.value = 1;
      this.duckTarget = 1;
      this.output.connect(this.duckGain).connect(this.context.destination);
      this.loadController = new AbortController();
      this.loadPromise = this.loadSource(this.context, this.loadController);
    }
    // Called directly by the start-button gesture, alongside Pointer Lock.
    await this.context.resume();
    this.setActive(this.active);
  }

  async loadSource(context, controller) {
    try {
      const buffer = await loadSfxBuffer(context, this.settings.file, controller.signal);
      if (context !== this.context || controller.signal.aborted) return;
      const source = context.createBufferSource();
      source.buffer = crossfadeLoopBuffer(context, buffer, this.settings.crossfadeSeconds);
      source.loop = true;
      source.connect(this.output);
      source.start();
      this.voices.push(source);
      this.mode = 'file';
    } catch (error) {
      if (context !== this.context || controller.signal.aborted) return;
      console.warn('Lobby ambience file unavailable; using synthesized fallback:', error);
      this.settings.frequencies.forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const level = context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        level.gain.value = this.settings.voiceLevels[index];
        oscillator.connect(level).connect(this.output);
        oscillator.start();
        this.voices.push(oscillator);
      });
      this.mode = 'synth';
    }
  }

  setActive(active, fadeSeconds = this.settings.fadeSeconds) {
    this.active = active;
    if (!this.context || !this.output) return;
    const now = this.context.currentTime;
    const gain = this.output.gain;
    // Hold the current envelope when pausing/resuming mid-fade (no click).
    gain.cancelAndHoldAtTime(now);
    gain.linearRampToValueAtTime(active ? this.settings.volume : 0, now + fadeSeconds);
  }

  setDuck(multiplier) {
    if (!this.duckGain || this.duckTarget === multiplier) return;
    this.duckTarget = multiplier;
    this.duckGain.gain.setTargetAtTime(multiplier, this.context.currentTime, 0.15);
  }

  async dispose() {
    this.active = false;
    this.loadController?.abort();
    if (!this.context) return;
    this.voices.forEach(voice => voice.stop());
    await this.context.close();
    this.voices = [];
    this.context = null;
    this.output = null;
    this.duckGain = null;
    this.loadPromise = null;
    this.mode = 'loading';
  }
}
