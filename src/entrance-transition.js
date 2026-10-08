import * as THREE from '../vendor/three/three.module.min.js';
import { loadSpace, createPlaceholderSpace } from './spaces.js';
import { PortalLight } from './portal-light.js';
import { TransitionGain } from './audio/transition-gain.js';
const smooth = value => { const t = Math.min(1, Math.max(0, value)); return t * t * (3 - 2 * t); };

export class EntranceTransition {
  constructor(dependencies) {
    Object.assign(this, dependencies);
    this.loader = loadSpace;
    this.light = new PortalLight(this.config.entrance.light);
    this.audio = new TransitionGain();
    this.phase = 'idle'; this.direction = 'enter'; this.version = 0;
    this.cameraStart = new THREE.Vector3(); this.cameraForward = new THREE.Vector3();
    this.notice = document.querySelector('#door-notice'); this.noticeShown = false;
    this.lobbyBackground = this.scene.background; this.lobbyFog = this.scene.fog;
    window.addEventListener('keydown', event => {
      if (this.player.locked && this.blocksInput && event.code !== 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    }, true);
  }
  get busy() { return this.phase !== 'idle'; }
  get blocksInput() { return this.busy; }
  get active() { return this.player.locked && !document.hidden && document.hasFocus(); }
  prepare(target) {
    this.phase = 'fill'; this.elapsed = 0; this.version++; this.wasPaused = false;
    this.colors = this.config.doors.spaces.find(space => space.id === this.door.id).colors;
    this.light.begin(target, this.door.membrane.material.map, this.colors, this.camera, innerWidth, innerHeight);
    this.cameraStart.copy(this.camera.position);
    this.camera.getWorldDirection(this.cameraForward); this.cameraForward.y = 0; this.cameraForward.normalize();
    document.body.classList.add('entrance-active'); this.player.setInputEnabled(false);
    this.notice.hidden = true; this.footsteps.stop(); this.stopPulses();
  }
  begin(door) {
    if (!this.active || this.busy || this.scene.userData.space !== 'lobby') return;
    this.door = door; this.direction = 'enter';
    this.prepare({ group: door.group, width: this.config.doors.width, height: this.config.doors.height });
    this.audio.attach(this.preview); this.audio.reset();
    this.preview.enterSpace(door.id, this.config.audio.space, this.config.entrance.fillSeconds);
    this.ambience.setActive(false, this.config.entrance.fillSeconds);
    this.footsteps.update(false, door.id);
  }
  beginReturn(target) {
    if (!this.active || this.busy || this.scene.userData.space === 'lobby' || !this.door) return;
    this.direction = 'return'; this.prepare(target);
    this.audio.attach(this.preview); this.audio.fadeOut(this.config.entrance.fillSeconds);
  }
  pause() {
    if (this.busy && !this.wasPaused) { this.audio.hold(); this.wasPaused = true; }
  }
  startLoad() {
    const version = this.version;
    const fallback = error => {
      if (version !== this.version || this.loaded || this.space) return;
      console.warn('Space load fallback:', error);
      this.loaded = createPlaceholderSpace(this.door.id, this.colors); clearTimeout(this.loadTimer);
    };
    this.loadTimer = setTimeout(() => fallback('8-second load limit exceeded'), this.config.entrance.loadTimeoutSeconds * 1000);
    Promise.resolve().then(() => this.loader(this.door.id, this.colors)).then(space => {
      if (version !== this.version || this.loaded || this.space) { space.dispose(); return; }
      this.loaded = space; clearTimeout(this.loadTimer);
    }).catch(fallback);
  }
  update(delta) {
    this.audio.attach(this.preview);
    if (!this.active) {
      this.pause();
      return;
    }
    if (!this.busy) { this.updateNotice(delta); return; }
    if (this.wasPaused && this.direction === 'return' && this.phase === 'fill') {
      this.audio.fadeOut(Math.max(0, this.config.entrance.fillSeconds - this.elapsed));
    }
    this.wasPaused = false; this.elapsed += delta; this.light.update(delta);
    const settings = this.config.entrance;
    if (this.phase === 'fill') {
      const progress = this.elapsed / settings.fillSeconds;
      this.light.cover(progress);
      this.camera.position.copy(this.cameraStart).addScaledVector(this.cameraForward, smooth(progress) * settings.advanceDistance);
      if (this.elapsed >= settings.fillSeconds) {
        this.phase = 'hold'; this.elapsed = 0;
        if (this.direction === 'enter') this.startLoad();
      }
    } else if (this.phase === 'hold') {
      if (this.elapsed < settings.holdSeconds || (this.direction === 'enter' && !this.loaded)) return;
      if (this.direction === 'enter') {
        this.space = this.loaded; this.loaded = null;
        this.lobby.root.visible = false; this.doorways.root.visible = false; this.scene.add(this.space.root);
        this.scene.background = this.space.background; this.scene.fog = this.space.fog; this.scene.userData.space = this.door.id;
        this.placePlayer(this.config.spaces[this.door.id].start);
      } else this.restoreLobby();
      this.phase = 'reveal'; this.elapsed = 0;
    } else if (this.phase === 'reveal') {
      this.light.reveal(this.elapsed / settings.revealSeconds);
      if (this.elapsed >= settings.revealSeconds) {
        this.hideLight();
        if (this.direction === 'enter' && !this.noticeShown) {
          this.noticeShown = true; this.noticeElapsed = 0;
          this.notice.textContent = this.config.exit.noticeText; this.notice.style.opacity = '0.65'; this.notice.hidden = false;
        }
      }
    }
  }
  updateNotice(delta) {
    if (this.notice.hidden) return;
    this.noticeElapsed += delta;
    const remaining = this.config.exit.noticeSeconds - this.noticeElapsed;
    if (remaining <= 0) this.notice.hidden = true;
    else this.notice.style.opacity = String(0.65 * smooth(remaining / Math.max(0.01, this.config.exit.noticeFadeSeconds)));
  }
  placePlayer(start) {
    this.camera.position.set(start.x, this.config.player.eyeHeight, start.z);
    this.camera.rotation.set(0, 0, 0, 'YXZ'); this.player.clearInput();
  }
  hideLight() {
    this.phase = 'idle'; this.light.hide(); document.body.classList.remove('entrance-active'); this.player.setInputEnabled(true);
  }
  restoreLobby() {
    this.version++; clearTimeout(this.loadTimer);
    this.loaded?.dispose(); this.space?.dispose(); this.loaded = null; this.space = null;
    this.lobby.root.visible = true; this.doorways.root.visible = true;
    this.scene.background = this.lobbyBackground; this.scene.fog = this.lobbyFog; this.scene.userData.space = 'lobby';
    if (this.door) {
      const distance = this.config.doors.activationDistance + this.config.exit.lobbyOutsideOffset;
      const { x, z } = this.door.group.position;
      const yaw = this.door.group.rotation.y;
      this.camera.position.set(x + Math.sin(yaw) * distance, this.config.player.eyeHeight, z + Math.cos(yaw) * distance);
      this.camera.rotation.set(0, yaw, 0, 'YXZ'); this.player.clearInput();
    } else this.placePlayer(this.config.player.startPosition);
    this.preview.exitSpace(); this.audio.reset(); this.stopPulses();
    this.footsteps.setDuck(1); this.ambience.setDuck(1); this.footsteps.update(false, 'lobby');
    this.ambience.setActive(this.active, this.config.entrance.revealSeconds);
  }
  returnLobby() { this.notice.hidden = true; this.restoreLobby(); this.hideLight(); }
}
