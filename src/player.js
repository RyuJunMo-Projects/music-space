import { Vector2 } from '../vendor/three/three.module.min.js';

export class Player {
  constructor(camera, canvas, settings, onLockChange, spaces = {}, getSpace = () => 'lobby') {
    this.camera = camera;
    this.canvas = canvas;
    this.settings = settings;
    this.spaces = spaces;
    this.getSpace = getSpace;
    this.keys = new Set();
    this.direction = new Vector2();
    this.mouseDelta = new Vector2();
    this.lockPending = false;
    this.inputEnabled = true;
    camera.rotation.order = 'YXZ';
    camera.position.set(settings.startPosition.x, settings.eyeHeight, settings.startPosition.z);

    document.addEventListener('pointerlockchange', () => {
      this.clearInput();
      onLockChange(this.locked);
    });
    document.addEventListener('mousemove', (event) => {
      if (!this.locked || !this.inputEnabled) return;
      const { movementX: x, movementY: y } = event;
      if (!Number.isFinite(x) || !Number.isFinite(y)
        || Math.abs(x) > settings.maxMouseDelta || Math.abs(y) > settings.maxMouseDelta) return;
      this.mouseDelta.x += x;
      this.mouseDelta.y += y;
    });
    document.addEventListener('keydown', (event) => {
      if (!this.locked || !this.inputEnabled || !['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)) return;
      event.preventDefault();
      this.keys.add(event.code);
    });
    document.addEventListener('keyup', (event) => this.keys.delete(event.code));
    const pause = () => {
      this.clearInput();
      if (this.locked) document.exitPointerLock();
    };
    window.addEventListener('blur', pause);
    document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  }

  get locked() { return document.pointerLockElement === this.canvas; }

  setInputEnabled(enabled) {
    this.inputEnabled = enabled;
    this.clearInput();
  }

  clearInput() {
    this.keys.clear();
    this.mouseDelta.set(0, 0);
  }

  requestLock(options) {
    // Events also cover older browsers whose requestPointerLock returns void.
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        document.removeEventListener('pointerlockchange', onChange);
        document.removeEventListener('pointerlockerror', onError);
      };
      const onError = (error) => {
        cleanup();
        reject(error instanceof Error ? error : new Error('Pointer Lock request failed'));
      };
      const onChange = () => {
        cleanup();
        if (this.locked) resolve();
        else reject(new Error('Pointer Lock request cancelled'));
      };
      document.addEventListener('pointerlockchange', onChange);
      document.addEventListener('pointerlockerror', onError);
      try {
        const request = options === undefined
          ? this.canvas.requestPointerLock()
          : this.canvas.requestPointerLock(options);
        request?.catch(onError);
      } catch (error) {
        onError(error);
      }
    });
  }

  async lock() {
    if (this.locked || this.lockPending) return;
    if (!this.canvas.requestPointerLock) throw new Error('Pointer Lock is unavailable');
    this.lockPending = true;
    this.clearInput();
    try {
      try {
        await this.requestLock({ unadjustedMovement: true });
      } catch {
        await this.requestLock();
      }
    } finally {
      this.lockPending = false;
    }
  }

  update(delta) {
    if (!this.locked || !this.inputEnabled) return;
    // Apply all accepted mouse events once, before movement uses the new yaw.
    this.camera.rotation.y -= this.mouseDelta.x * this.settings.mouseSensitivity;
    this.camera.rotation.x = Math.max(-this.settings.maxPitch, Math.min(this.settings.maxPitch,
      this.camera.rotation.x - this.mouseDelta.y * this.settings.mouseSensitivity));
    this.mouseDelta.set(0, 0);
    const x = Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA'));
    const z = Number(this.keys.has('KeyS')) - Number(this.keys.has('KeyW'));
    this.direction.set(x, z).normalize().multiplyScalar(this.settings.speed * delta);
    const yaw = this.camera.rotation.y;
    // Move on the ground plane regardless of the vertical viewing angle.
    this.camera.position.x += this.direction.x * Math.cos(yaw) + this.direction.y * Math.sin(yaw);
    this.camera.position.z += -this.direction.x * Math.sin(yaw) + this.direction.y * Math.cos(yaw);
    const bound = this.settings.bounds;
    const radius = this.spaces[this.getSpace()]?.bounds;
    if (Number.isFinite(radius)) {
      const distance = Math.hypot(this.camera.position.x, this.camera.position.z);
      if (distance > radius) {
        this.camera.position.x *= radius / distance;
        this.camera.position.z *= radius / distance;
      }
    } else if (radius && typeof radius === 'object') {
      this.camera.position.x = Math.max(radius.minX, Math.min(radius.maxX, this.camera.position.x));
      this.camera.position.z = Math.max(radius.minZ, Math.min(radius.maxZ, this.camera.position.z));
    } else {
      this.camera.position.x = Math.max(-bound, Math.min(bound, this.camera.position.x));
      this.camera.position.z = Math.max(-bound, Math.min(bound, this.camera.position.z));
    }
    this.camera.position.y = this.settings.eyeHeight;
  }
}
