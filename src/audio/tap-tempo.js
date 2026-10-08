// Tap timing estimates BPM only; the beat clock still follows media currentTime.
export class TapTempo {
  constructor() {
    this.lastTap = null;
    this.intervals = [];
  }

  tap(now = performance.now()) {
    const gap = this.lastTap === null ? 0 : now - this.lastTap;
    this.lastTap = now;
    if (gap <= 0 || gap >= 2000) {
      this.intervals.length = 0;
      return null;
    }
    this.intervals.push(gap);
    if (this.intervals.length > 8) this.intervals.shift();
    const sorted = this.intervals.slice().sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    return Math.round(60000 / median * 100) / 100;
  }
}
