import * as THREE from '../../vendor/three/three.module.min.js';
import { BeatClock } from '../audio/beat-clock.js';

const PATTERNS = ['a', 'b', 'c', 'd'];
const random = seed => { const n = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return n - Math.floor(n); };
const smooth = t => t * t * (3 - 2 * t);
const clamp = t => Math.min(1, Math.max(0, t));

// An independent consumer of the unchanged media-position clock. No audio writes.
export class OutrunBars {
  constructor(settings, envelope) {
    this.settings = settings;
    this.envelope = envelope;
    this.clock = new BeatClock();
    this.transform = new THREE.Object3D();
    this.color = new THREE.Color();
    this.space = null;
    this.beatInfo = { active: false, beatIndex: -1, phase: 0, sinceBeat: 0, period: 0, accent: 0, strengthScale: 1, pattern: 'a' };
    this.readBeatInfo = () => this.getBeatInfo();
    this.dirty = false;
  }

  // Read-only shared state for a future object-pulse consumer; no snapshot allocation.
  getBeatInfo() { return this.beatInfo; }

  bind(space) {
    if (this.space === space) return;
    if (this.space) { this.restore(); delete this.space.getBeatInfo; }
    this.space = space;
    this.clock.reset(); this.dirty = false;
    this.bars = space?.beatTargets?.bars ?? null;
    this.meshes = null; this.originals = null;
    if (!this.bars) return;
    const b = this.bars;
    this.meshes = [b.mesh, b.coreMesh, b.glowMesh];
    this.originals = this.meshes.map(mesh => ({ matrix: mesh.instanceMatrix.array.slice(), colors: mesh.instanceColor.array.slice() }));
    b.lengths = b.baseLengths.slice(); b.responses = new Float32Array(b.count);
    b.amplitudes = new Float32Array(b.count);
    this.frontDelays = new Float32Array(b.count); this.sideDelays = new Float32Array(b.count);
    for (let i = 0; i < b.count; i++) {
      b.amplitudes[i] = 0.6 + 0.4 * b.phase[i] / (Math.PI * 2);
      const fromFront = Math.abs(b.angles[i] - Math.PI);
      this.frontDelays[i] = fromFront / Math.PI;
      this.sideDelays[i] = Math.abs(fromFront - Math.PI / 2) / (Math.PI / 2);
    }
    // A fixed conservative bound covers maximum amount=2, including long tails.
    // It avoids three bounding-sphere scans every animation frame.
    const reach = Math.max(...b.baseLengths) * 3 + 0.3;
    for (const mesh of this.meshes) mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), Math.hypot(b.radius + b.glowWidth, reach));
    space.getBeatInfo = this.readBeatInfo;
  }

  patternForBeat(index) {
    return this.settings.pattern === 'auto' ? PATTERNS[Math.floor(Math.max(0, index) / this.settings.patternBeats) % 4] : this.settings.pattern;
  }

  spatialMask(i, index, pattern) {
    if (index % 4 === 0 || index % this.settings.patternBeats === 0) return 1;
    if (pattern === 'c') return (this.bars.colors[i * 3] > this.bars.colors[i * 3 + 1]) === (index % 2 === 0) ? 1 : 0;
    if (pattern === 'd') return random(1703 + i * 29 + index * 947) < 1 / 3 ? 1 : 0;
    // After the full-wall downbeat, three bands sweep front→rear / sides→centers.
    const slot = index % 4 - 1;
    const coordinate = pattern === 'a' ? this.frontDelays[i] : this.sideDelays[i];
    const low = slot / 3; const high = (slot + 1) / 3; const feather = 0.03;
    const enter = slot === 0 ? 1 : smooth(clamp((coordinate - low + feather) / (2 * feather)));
    const exit = slot === 2 ? 1 : smooth(clamp((high + feather - coordinate) / (2 * feather)));
    return enter * exit;
  }

  responseAt(i, track, attack, release) {
    const c = this.clock;
    const b = this.bars;
    const history = Math.ceil((this.settings.maxDelaySeconds + attack + release) / c.period);
    let response = 0;
    // Include a delayed tail from the previous beat/bar, but never sum accents.
    for (let index = c.beatIndex; index >= Math.max(0, c.beatIndex - history); index--) {
      const pattern = this.patternForBeat(index);
      const pink = b.colors[i * 3] > b.colors[i * 3 + 1];
      let delay;
      if (pattern === 'a') delay = this.frontDelays[i];
      else if (pattern === 'b') delay = this.sideDelays[i];
      else if (pattern === 'c') delay = pink === (index % 2 === 0) ? 0 : 1;
      else delay = random(901 + i * 17 + index * 733);
      const age = c.sinceBeat + (c.beatIndex - index) * c.period - delay * this.settings.maxDelaySeconds;
      if (age < 0 || age >= attack + release) continue;
      const envelope = age < attack ? smooth(age / attack) : smooth(1 - (age - attack) / release);
      const accent = track.accents?.length ? track.accents[index % track.accents.length] : 1;
      const downbeat = index % 4 === 0 || index % this.settings.patternBeats === 0;
      let weight = downbeat ? 1 : 0.8;
      if (!downbeat) {
        const legacy = pattern === 'c' && pink !== (index % 2 === 0) ? 0.3 : 1;
        const outside = pattern === 'c' ? this.settings.colorOutsideRatio : this.settings.outsideRatio;
        const masked = outside + (1 - outside) * this.spatialMask(i, index, pattern);
        weight *= legacy + this.settings.patternStrength * (masked - legacy);
      }
      response = Math.max(response, envelope * accent * b.amplitudes[i] * weight * this.settings.amount);
    }
    return response;
  }

  update(space, audio, track, active, delta) {
    this.bind(space);
    const c = active && this.bars ? this.clock.update(audio, track) : this.clock.reset();
    const info = this.beatInfo;
    info.active = c.active; info.beatIndex = c.beatIndex; info.phase = c.phase;
    info.sinceBeat = c.sinceBeat; info.period = c.period; info.accent = c.accent;
    info.strengthScale = c.strengthScale; info.pattern = this.patternForBeat(c.beatIndex);
    if (!this.bars) return;
    const b = this.bars;
    const attack = Math.max(0.001, Math.min(this.envelope.attackSeconds, c.period / 2 || 0.05));
    const release = Math.max(0.001, Math.min(this.envelope.returnSeconds, c.period * 0.8 || this.envelope.returnSeconds));
    const settle = Math.exp(-Math.max(0, delta) / 0.08);
    let moving = false;
    for (let i = 0; i < b.count; i++) {
      let response = this.settings.amount === 0 ? 0 : c.active && c.beatIndex >= 0
        ? this.responseAt(i, track, attack, release) : b.responses[i] * settle;
      if (response < 0.0001) response = 0;
      b.responses[i] = response; b.lengths[i] = b.baseLengths[i] * (1 + response);
      moving ||= response > 0;
    }
    if (!moving) { this.restore(); return; }
    const t = this.transform; const color = this.color;
    for (let i = 0; i < b.count; i++) {
      const length = b.lengths[i]; const y = b.topHeights[i] - length / 2;
      const angle = b.angles[i]; const offset = i * 16;
      t.position.set(this.originals[0].matrix[offset + 12], y, this.originals[0].matrix[offset + 14]);
      t.rotation.set(0, angle, 0); t.scale.set(b.width, length, b.depth);
      t.updateMatrix(); b.mesh.setMatrixAt(i, t.matrix);
      t.position.set(this.originals[1].matrix[offset + 12], y, this.originals[1].matrix[offset + 14]);
      t.scale.set(b.coreWidth, length, b.coreDepth); t.updateMatrix(); b.coreMesh.setMatrixAt(i, t.matrix);
      color.fromArray(b.coreColors, i * 3).multiplyScalar(1 + 0.25 * b.responses[i]); b.coreMesh.setColorAt(i, color);
      t.position.set(this.originals[2].matrix[offset + 12], y, this.originals[2].matrix[offset + 14]);
      t.rotation.y = angle + Math.PI; t.scale.set(b.glowWidth, length + 0.3, 1);
      t.updateMatrix(); b.glowMesh.setMatrixAt(i, t.matrix);
      color.fromArray(b.colors, i * 3).multiplyScalar(1 + 0.5 * b.responses[i]); b.glowMesh.setColorAt(i, color);
    }
    for (const mesh of this.meshes) mesh.instanceMatrix.needsUpdate = true;
    b.coreMesh.instanceColor.needsUpdate = true; b.glowMesh.instanceColor.needsUpdate = true;
    this.dirty = true;
  }

  restore() {
    if (!this.bars || !this.dirty) return;
    for (let i = 0; i < this.meshes.length; i++) {
      const mesh = this.meshes[i];
      mesh.instanceMatrix.array.set(this.originals[i].matrix); mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.array.set(this.originals[i].colors); mesh.instanceColor.needsUpdate = true;
    }
    this.bars.responses.fill(0); this.bars.lengths.set(this.bars.baseLengths);
    this.dirty = false;
  }
}

export function setupOutrunBarControls(development, settings) {
  for (const [key, min, max] of [['amount', 0, 2], ['maxDelaySeconds', 0, 0.3],
    ['patternStrength', 0, 1], ['patternBeats', 1, 64], ['outsideRatio', 0.25, 0.35], ['colorOutsideRatio', 0.25, 0.35]]) {
    const field = document.querySelector(`[data-outrun-bars="${key}"]`);
    field.value = settings[key]; field.closest('label').hidden = !development.showControls;
    field.addEventListener('change', () => {
      if (Number.isFinite(field.valueAsNumber)) {
        const value = key === 'patternBeats' ? Math.round(field.valueAsNumber) : field.valueAsNumber;
        settings[key] = Math.min(max, Math.max(min, value));
      }
      field.value = settings[key];
    });
  }
  const select = document.querySelector('[data-outrun-bars="pattern"]');
  select.value = settings.pattern; select.closest('label').hidden = !development.showControls;
  select.addEventListener('change', () => { settings.pattern = ['auto', ...PATTERNS].includes(select.value) ? select.value : 'auto'; select.value = settings.pattern; });
  const autoOption = select.querySelector('[value="auto"]');
  const interval = document.querySelector('[data-outrun-bars="patternBeats"]');
  const describeInterval = () => { autoOption.textContent = `자동 · ${settings.patternBeats}박마다 전환`; };
  interval.addEventListener('change', describeInterval); describeInterval();
}
