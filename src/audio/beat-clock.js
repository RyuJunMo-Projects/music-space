// Read the media position every frame. No independent timer or audio analysis.
export class BeatClock {
  constructor() { this.reset(); }

  reset() {
    this.phase = 0;
    this.sinceBeat = 0;
    this.period = 0;
    this.beatIndex = -1;
    this.accent = 0;
    this.strengthScale = 1;
    this.beatChanged = false;
    this.active = false;
    this.audio = null;
    this.previousTime = 0;
    this.offset = 0;
    this.tempoAnchorTime = 0;
    this.tempoAnchorBeats = 0;
    return this;
  }

  update(audio, track) {
    const period = track ? track.pulseEveryBeats * 60 / track.perceivedBpm : 0;
    const offset = track?.firstBeatOffset;
    const time = audio?.currentTime;
    if (!audio || audio.paused || audio.ended || audio.error || audio.seeking
      || audio.readyState < 3 || !Number.isFinite(time) || !Number.isFinite(offset)
      || !Number.isFinite(period) || period <= 0) return this.reset();

    const sameSource = this.active && this.audio === audio
      && this.offset === offset && time >= this.previousTime;
    if (!sameSource) {
      this.tempoAnchorTime = offset;
      this.tempoAnchorBeats = 0;
    } else if (this.period !== period) {
      // Rebase at the current media position so a live tempo edit cannot renumber
      // past beats or flip accents. Future progress still comes only from audio.
      this.tempoAnchorBeats += (time - this.tempoAnchorTime) / this.period;
      this.tempoAnchorTime = time;
    }
    const beatPosition = this.tempoAnchorBeats + (time - this.tempoAnchorTime) / period;
    const index = beatPosition >= 0 ? Math.floor(beatPosition) : -1;
    const sameClock = sameSource && this.period === period;
    // Emit at most one crossing after a slow frame; never replay missed beats.
    this.beatChanged = index >= 0 && (sameClock
      ? index > this.beatIndex
      : !sameSource && index === 0 && beatPosition * period < 0.05);
    this.sinceBeat = index >= 0 ? (beatPosition - index) * period : 0;
    this.phase = this.sinceBeat / period;
    this.period = period;
    this.beatIndex = index;
    const accents = track.accents;
    this.accent = index >= 0 ? (accents?.length ? accents[index % accents.length] : 1) : 0;
    this.strengthScale = track.strengthScale ?? 1;
    this.active = true;
    this.audio = audio;
    this.previousTime = time;
    this.offset = offset;
    return this;
  }
}
