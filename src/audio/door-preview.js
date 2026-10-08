import { TrackLoop } from './track-loop.js';

// File playback is isolated from the scene. No analysis or beat timer is used.
export const previewRanges = {
  maxVolume: { min: 0, max: 1, step: 0.05 },
  fadeSeconds: { min: 0.05, max: 5, step: 0.05 },
};

export class DoorPreview {
  constructor(tracks, settings, loopSettings) {
    this.tracks = tracks;
    this.settings = settings;
    this.loopSettings = loopSettings;
    this.context = null;
    this.entries = new Map();
    this.current = null;
    this.wanted = null;
    this.stopTimer = null;
    this.ready = false;
    this.spaceId = null;
    this.spacePauseTimer = null;
    this.spacePaused = false;
  }

  async unlock() {
    try {
      if (!this.context) {
        const Context = window.AudioContext || window.webkitAudioContext;
        if (!Context) return;
        this.context = new Context();
        for (const [id, track] of Object.entries(this.tracks)) {
          const audio = new Audio();
          const output = this.context.createGain();
          output.gain.value = 0;
          // Distance smoothing and start/stop fades must not cancel each other.
          const fade = this.context.createGain();
          fade.gain.value = 0;
          const entry = { id, audio, output, fade, target: 0, pending: false, failed: false, ended: false, playVersion: 0 };
          if (this.loopSettings) entry.loop = new TrackLoop(audio, this.context, this.loopSettings, () => {
            entry.failed = true;
            if (this.current === entry) this.stopCurrent();
          });
          this.context.createMediaElementSource(audio).connect(output).connect(fade)
            .connect(entry.loop?.gain ?? this.context.destination);
          entry.loop?.gain.connect(this.context.destination);
          this.entries.set(id, entry);
          audio.addEventListener('error', () => {
            entry.failed = true;
            if (this.current === entry) this.stopCurrent();
          });
          audio.addEventListener('ended', () => {
            if (this.current === entry && entry.loop) { entry.loop.handleEnded(); return; }
            entry.ended = true;
            if (this.current === entry) this.stopCurrent();
          });
          audio.preload = 'auto';
          audio.src = track.file;
          audio.load(); // All three requests start in the first start-button gesture.
        }
      }
      await this.context.resume();
      this.ready = this.context.state === 'running';
      // A blocked play may be retried after another explicit start click.
      for (const entry of this.entries.values()) {
        if (!entry.audio.error) entry.failed = false;
      }
      if (this.spaceId && !this.current) {
        // Entry can be clicked before the initial AudioContext resume completes.
        const id = this.spaceId;
        this.spaceId = null;
        this.reconcile();
        this.spaceId = id;
      }
      if (this.spaceId && this.current?.audio.paused && this.current.loop?.phase !== 'rest') this.spacePaused = true;
    } catch {
      this.ready = false; // Unsupported/blocked audio must never block exploration.
    }
  }

  // The next stage can read this element's currentTime directly.
  getAudio(id) { return this.entries.get(id)?.audio ?? null; }
  getLoopGain() { return this.current?.loop?.gain.gain.value ?? 1; }

  // Reuse the preview's distance ratio, but restore lobby sound if no song plays.
  get proximity() {
    if (this.spaceId) return 0;
    const entry = this.current;
    if (!this.ready || this.context?.state !== 'running' || !entry || entry.pending
      || entry.failed || entry.ended || entry.audio.paused || entry.id !== this.wanted?.id) return 0;
    return this.wanted.proximity;
  }

  setParameters(values) {
    for (const [key, range] of Object.entries(previewRanges)) {
      if (Number.isFinite(values[key])) {
        this.settings[key] = Math.min(range.max, Math.max(range.min, values[key]));
      }
    }
  }

  update(position, doors, activationDistance, active) {
    if (this.spaceId) { this.updateSpace(active); return; }
    if (!active) { this.pause(); return; }
    let nearest = null;
    let distance = Infinity;
    for (const door of doors) {
      const d = Math.hypot(position.x - door.group.position.x, position.z - door.group.position.z);
      if (d <= activationDistance && d < distance) { nearest = door; distance = d; }
    }
    const id = nearest?.id ?? null;
    if (this.wanted?.id !== id) {
      const previous = this.entries.get(this.wanted?.id);
      if (previous) previous.ended = false;
    }
    const proximity = nearest ? Math.max(0, Math.min(1, 1 - distance / activationDistance)) : 0;
    this.wanted = nearest ? {
      id, proximity, volume: this.settings.maxVolume * proximity ** 2,
    } : null;
    this.reconcile();
    const entry = this.current;
    entry?.loop?.update(this.stopTimer === null && !entry.pending && !entry.failed && entry.id === this.wanted?.id);
  }

  pause() {
    this.current?.loop?.update(false);
    if (this.spaceId) {
      if (this.spacePaused) return;
      this.spacePaused = true;
      const entry = this.current;
      if (entry) {
        this.ramp(entry, 0);
        this.spacePauseTimer = setTimeout(() => {
          if (this.spacePaused && this.current === entry) entry.audio.pause();
          this.spacePauseTimer = null;
        }, this.settings.fadeSeconds * 1000);
      }
      return;
    }
    this.wanted = null;
    for (const entry of this.entries.values()) entry.ended = false;
    this.reconcile();
  }

  ramp(entry, target) {
    const now = this.context.currentTime;
    const gain = entry.fade.gain;
    gain.cancelAndHoldAtTime(now);
    gain.linearRampToValueAtTime(target, now + this.settings.fadeSeconds);
  }

  followVolume(entry, target, force = false) {
    if (!force && Math.abs(entry.target - target) < 0.005) return;
    entry.output.gain.setTargetAtTime(target, this.context.currentTime, 0.1);
    entry.target = target;
  }

  resumeFade(entry) {
    // Cancel only the pending stop envelope when re-entering before it finishes.
    const now = this.context.currentTime;
    const gain = entry.fade.gain;
    const held = gain.value;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(held, now);
    gain.setTargetAtTime(1, now, 0.1);
  }

  reconcile() {
    if (!this.ready || this.spaceId) return;
    if (this.current && this.current.id !== this.wanted?.id) {
      if (this.stopTimer === null) {
        this.ramp(this.current, 0);
        // A timeout completes pauses even when hidden tabs stop rendering frames.
        // It only stops/reset playback; song timing always belongs to currentTime.
        this.stopTimer = setTimeout(() => {
          this.stopCurrent();
          this.reconcile();
        }, this.settings.fadeSeconds * 1000);
      }
      return; // Fade the old track fully to silence before starting another.
    }
    if (!this.wanted) return;
    if (this.current) {
      if (this.stopTimer !== null) {
        clearTimeout(this.stopTimer);
        this.stopTimer = null;
        if (!this.current.pending) {
          this.resumeFade(this.current);
          this.followVolume(this.current, this.wanted.volume, true);
        }
      } else if (!this.current.pending) {
        this.followVolume(this.current, this.wanted.volume);
      }
      return;
    }
    const entry = this.entries.get(this.wanted.id);
    if (!entry || entry.failed || entry.ended) return;
    this.current = entry;
    entry.pending = true;
    const version = ++entry.playVersion;
    try {
      entry.audio.currentTime = 0;
      Promise.resolve(entry.audio.play()).then(() => {
        if (entry.playVersion !== version) return;
        entry.pending = false;
        if (this.spaceId === entry.id) {
          if (this.spacePaused) entry.audio.pause();
          else this.raiseSpaceVolume(this.spaceFillSeconds);
          return;
        }
        if (this.current === entry && this.stopTimer === null && this.wanted?.id === entry.id) {
          this.followVolume(entry, this.wanted.volume, true);
          this.ramp(entry, 1);
        }
      }).catch(() => {
        if (entry.playVersion !== version) return;
        entry.pending = false;
        if (this.spaceId === entry.id && this.spacePaused) return;
        // A deliberate pause while loading also rejects play(); it is not a failure.
        if (this.current === entry) { entry.failed = true; this.stopCurrent(); }
      });
    } catch {
      entry.pending = false;
      entry.failed = true;
      this.stopCurrent();
    }
  }

  stopCurrent() {
    clearTimeout(this.spacePauseTimer);
    this.spacePauseTimer = null;
    clearTimeout(this.stopTimer);
    this.stopTimer = null;
    const entry = this.current;
    this.current = null;
    if (!entry) return;
    entry.playVersion++;
    entry.loop?.cancel();
    entry.pending = false;
    entry.output.gain.cancelScheduledValues(this.context.currentTime);
    entry.output.gain.setValueAtTime(0, this.context.currentTime);
    entry.fade.gain.cancelScheduledValues(this.context.currentTime);
    entry.fade.gain.setValueAtTime(0, this.context.currentTime);
    entry.target = 0;
    entry.audio.pause();
    try { entry.audio.currentTime = 0; } catch { /* Metadata may be unavailable. */ }
  }

  enterSpace(id, settings, fillSeconds) {
    clearTimeout(this.stopTimer);
    this.stopTimer = null;
    if (this.current && this.current.id !== id) this.stopCurrent();
    this.wanted = { id, proximity: 0, volume: settings.maxVolume };
    this.reconcile(); // Only starts playback if this door was not already playing.
    this.spaceId = id;
    this.spaceSettings = settings;
    this.spaceFillSeconds = fillSeconds;
    this.spacePaused = false;
    if (this.current && !this.current.pending) this.raiseSpaceVolume(fillSeconds);
  }

  raiseSpaceVolume(seconds) {
    const entry = this.current;
    if (!entry || !this.context) return;
    const now = this.context.currentTime;
    for (const [gain, target] of [[entry.output.gain, this.spaceSettings.maxVolume], [entry.fade.gain, 1]]) {
      gain.cancelAndHoldAtTime(now);
      gain.linearRampToValueAtTime(target, now + seconds);
    }
    entry.target = this.spaceSettings.maxVolume;
  }

  updateSpace(active) {
    if (!active) { this.pause(); return; }
    const entry = this.current;
    if (!entry || entry.failed || entry.ended || entry.pending) return;
    if (this.spacePaused) {
      this.spacePaused = false;
      clearTimeout(this.spacePauseTimer);
      this.spacePauseTimer = null;
      if (entry.loop?.phase === 'rest') this.raiseSpaceVolume(this.settings.fadeSeconds);
      else {
        const version = entry.playVersion;
        Promise.resolve(entry.audio.play()).then(() => {
          if (this.current !== entry || entry.playVersion !== version) return;
          if (this.spacePaused) entry.audio.pause();
          else this.raiseSpaceVolume(this.settings.fadeSeconds);
        }).catch(() => { /* Keep position; a later explicit gesture can resume. */ });
      }
    } else if (Math.abs(entry.target - this.spaceSettings.maxVolume) >= 0.005) {
      this.followVolume(entry, this.spaceSettings.maxVolume);
    }
    entry.loop?.update(!this.spacePaused);
  }

  exitSpace() {
    this.spaceId = null;
    this.spacePaused = false;
    this.wanted = null;
    this.stopCurrent();
  }
}
