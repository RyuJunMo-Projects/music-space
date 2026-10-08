const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };

// A separate gain preserves distance/start/stop envelopes. Beats still use media time.
export class TrackLoop {
  constructor(audio, context, settings, onFailure) {
    this.audio = audio; this.context = context; this.settings = settings;
    this.onFailure = onFailure; this.gain = context.createGain();
    this.version = 0;
    this.cancel();
  }

  cancel() {
    this.version++;
    this.phase = 'playing'; this.restElapsed = 0; this.pending = false;
    this.active = false; this.lastTime = this.context.currentTime;
    this.gain.gain.value = 1;
  }

  handleEnded() {
    this.audio.pause(); this.phase = 'rest'; this.restElapsed = 0;
    this.lastTime = this.context.currentTime; this.gain.gain.value = 0;
  }

  update(active) {
    const now = this.context.currentTime;
    const elapsed = this.active && active ? Math.max(0, now - this.lastTime) : 0;
    this.active = active; this.lastTime = now;
    if (this.pending) return;
    const audio = this.audio;
    if (this.phase === 'rest') {
      if (!active) return;
      this.restElapsed += elapsed;
      if (this.restElapsed < this.settings.restSeconds) return;
      this.phase = 'in'; this.pending = true;
      const version = ++this.version;
      try {
        audio.currentTime = 0;
        Promise.resolve(audio.play()).then(() => {
          if (version !== this.version) return;
          this.pending = false;
          // Pause can happen while the play promise is loading.
          if (!this.active) audio.pause();
        }).catch(() => {
          if (version !== this.version) return;
          this.pending = false;
          if (this.active) this.onFailure();
        });
      } catch { this.pending = false; this.onFailure(); }
      return;
    }
    if (audio.ended) { this.handleEnded(); return; }
    // Existing Esc fades allow one last second of playback. Follow that media
    // position too, then freeze naturally once the element is actually paused.
    if (audio.paused || audio.seeking || audio.readyState < 3) return;
    const duration = audio.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    const out = Math.min(this.settings.outSeconds, duration / 2);
    const fadeIn = Math.min(this.settings.inSeconds, duration / 2);
    if (out > 0 && audio.currentTime >= duration - out) {
      this.phase = 'out';
      this.gain.gain.value = 1 - smooth((audio.currentTime - duration + out) / out);
    } else if (this.phase === 'in' && fadeIn > 0 && audio.currentTime < fadeIn) {
      this.gain.gain.value = smooth(audio.currentTime / fadeIn);
    } else {
      this.phase = 'playing'; this.gain.gain.value = 1;
    }
  }
}

// The wall module and its live config stay intact; only its effective amount fades.
export function loopReactionSettings(settings, preview) {
  const effective = Object.create(settings);
  Object.defineProperty(effective, 'amount', { get: () => settings.amount * preview.getLoopGain() });
  return effective;
}

export function setupLoopControls(development, settings) {
  if (!development.showControls) return;
  for (const input of document.querySelectorAll('[data-track-loop]')) {
    const key = input.dataset.trackLoop;
    input.value = settings[key];
    input.addEventListener('input', () => {
      const value = input.valueAsNumber;
      if (Number.isFinite(value)) settings[key] = Math.max(0, Math.min(15, value));
    });
    input.addEventListener('change', () => { input.value = settings[key]; });
  }
}
