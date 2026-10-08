// Optional developer click, driven only by BeatClock crossings.
export class BeatClick {
  constructor() {
    this.enabled = false;
    this.context = null;
    this.source = null;
  }

  play(context) {
    if (!this.enabled || context?.state !== 'running') return;
    try {
      if (this.context !== context) {
        this.stop();
        this.context = context;
        this.buffer = context.createBuffer(1, Math.ceil(context.sampleRate * 0.018), context.sampleRate);
        const data = this.buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) {
          const t = i / context.sampleRate;
          data[i] = 0.045 * Math.sin(2 * Math.PI * 2800 * t) * Math.exp(-t / 0.0025);
        }
      }
      this.stop();
      const source = context.createBufferSource();
      source.buffer = this.buffer;
      source.connect(context.destination);
      source.onended = () => {
        source.disconnect();
        if (this.source === source) this.source = null;
      };
      this.source = source;
      source.start();
    } catch { this.stop(); } // Sound failure must not affect the scene.
  }

  stop() {
    if (!this.source) return;
    try { this.source.stop(); } catch { /* Already ended. */ }
    this.source.disconnect();
    this.source = null;
  }
}
