import { Vector3, Euler } from '../../vendor/three/three.module.min.js';

// Offsets are ephemeral: movement, collision and transitions retain the base camera.
export class CyberpunkCameraSway {
  constructor(settings) {
    this.settings = settings; this.elapsed = 0; this.fade = 0;
    this.offset = { horizontal: 0, vertical: 0, roll: 0 };
    this.basePosition = new Vector3(); this.baseRotation = new Euler(); this.applied = false;
  }
  update(inSpace, playing, idle, delta) {
    if (!inSpace) { this.elapsed = 0; this.fade = 0; this.zero(); return; }
    if (!idle) { this.fade = 0; this.zero(); return; }
    if (playing) {
      this.elapsed += Math.max(0, delta);
      this.fade = Math.min(1, this.fade + Math.max(0, delta) / Math.max(0.001, this.settings.fadeSeconds));
    }
    const amount = Math.max(0, Math.min(1, this.settings.amount)) * this.fade;
    if (amount === 0) { this.zero(); return; }
    const t = this.elapsed * Math.PI * 2;
    this.offset.horizontal = amount * this.settings.horizontal * Math.sin(t / this.settings.horizontalPeriod);
    this.offset.vertical = amount * this.settings.vertical * Math.sin(t / this.settings.verticalPeriod);
    this.offset.roll = amount * this.settings.rollDegrees * Math.PI / 180 * Math.sin(t / this.settings.rollPeriod);
  }
  zero() { this.offset.horizontal = this.offset.vertical = this.offset.roll = 0; }
  apply(camera) {
    this.basePosition.copy(camera.position); this.baseRotation.copy(camera.rotation); this.applied = true;
    const yaw = this.baseRotation.y;
    camera.position.x += this.offset.horizontal * Math.cos(yaw);
    camera.position.z -= this.offset.horizontal * Math.sin(yaw);
    camera.position.y += this.offset.vertical;
    camera.rotation.z += this.offset.roll;
    camera.updateMatrixWorld();
  }
  restore(camera) {
    if (!this.applied) return;
    camera.position.copy(this.basePosition); camera.rotation.copy(this.baseRotation); camera.updateMatrixWorld();
    this.applied = false;
  }
  withCamera(camera, action) {
    this.apply(camera);
    try { return action(); } finally { this.restore(camera); }
  }
}
