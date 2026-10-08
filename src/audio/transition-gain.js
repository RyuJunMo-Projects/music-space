// A single persistent branch after the existing playback/loop envelopes.
// Preview and media timing remain owned by their original modules.
export class TransitionGain {
  attach(preview) {
    if (!preview.ready || this.context === preview.context) return;
    this.context = preview.context; this.node = this.context.createGain();
    this.node.connect(this.context.destination);
    for (const entry of preview.entries.values()) {
      const tail = entry.loop?.gain ?? entry.fade;
      tail.disconnect(this.context.destination); tail.connect(this.node);
    }
  }
  hold() {
    if (!this.node) return;
    const now = this.context.currentTime; const gain = this.node.gain; const held = gain.value;
    gain.cancelAndHoldAtTime(now);
    // Anchor even when the previous event was a long-ago constant value.
    gain.setValueAtTime(held, now);
  }
  fadeOut(seconds) {
    if (!this.node) return;
    this.hold(); this.node.gain.linearRampToValueAtTime(0, this.context.currentTime + Math.max(0, seconds));
  }
  reset() {
    if (!this.node) return;
    this.node.gain.cancelScheduledValues(this.context.currentTime);
    this.node.gain.setValueAtTime(1, this.context.currentTime);
  }
}
