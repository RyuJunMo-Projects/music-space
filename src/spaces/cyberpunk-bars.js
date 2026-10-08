import * as THREE from '../../vendor/three/three.module.min.js';
import { BeatClock } from '../audio/beat-clock.js';

const PATTERNS = ['a', 'b', 'c'];
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const random = seed => { const n = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return n - Math.floor(n); };

// Read the existing media clock; never write audio state or animate other art.
export class CyberpunkBars {
  constructor(settings, envelope) {
    this.settings = settings; this.envelope = envelope; this.clock = new BeatClock();
    this.space = null; this.dirty = false;
    this.beatInfo = { active: false, beatIndex: -1, phase: 0, sinceBeat: 0, period: 0,
      accent: 0, strengthScale: 1, pattern: 'a' };
    this.readBeatInfo = () => this.getBeatInfo();
  }
  getBeatInfo() { return this.beatInfo; }
  bind(space) {
    if (space === this.space) return;
    if (this.space) {
      this.restore(); delete this.space.getBeatInfo;
      for (const original of this.originals) original.mesh.boundingSphere = original.sphere;
    }
    this.space = space; this.clock.reset(); this.dirty = false;
    this.bars = space?.beatTargets?.bars ?? null;
    this.originals = null;
    if (!this.bars) return;
    const b = this.bars, count = b.handles.length;
    this.originals = [b.mesh, b.glowMesh].map(mesh => ({ mesh, matrix: mesh.instanceMatrix.array.slice(),
      colors: mesh.instanceColor?.array.slice() ?? null, sphere: mesh.boundingSphere }));
    this.originalGlowOpacity = b.glowMesh.material.opacity;
    this.responses = new Float32Array(count); this.lengths = new Float32Array(count);
    this.amplitudes = new Float32Array(count); this.lateral = new Float32Array(count);
    this.centered = new Float32Array(count); this.depth = new Float32Array(count); this.purple = new Uint8Array(count);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const h of b.handles) { minX = Math.min(minX, h.x); maxX = Math.max(maxX, h.x); minZ = Math.min(minZ, h.z); maxZ = Math.max(maxZ, h.z); }
    for (let i = 0; i < count; i++) {
      const h = b.handles[i];
      this.lengths[i] = this.originals[0].matrix[i * 16 + 5];
      this.amplitudes[i] = 0.6 + 0.4 * random(1703 + i * 29);
      this.lateral[i] = (h.x - minX) / Math.max(0.001, maxX - minX);
      this.centered[i] = Math.abs(this.lateral[i] * 2 - 1);
      this.depth[i] = (maxZ - h.z) / Math.max(0.001, maxZ - minZ);
      this.purple[i] = Number(h.color.r >= 0.4);
    }
    // Conservative once-per-entry bounds include all permitted heights (amount <= 2).
    const bounds = new THREE.Box3(new THREE.Vector3(minX - 1, 0, minZ - 1),
      new THREE.Vector3(maxX + 1, Math.max(this.settings.maxHeight, ...this.lengths), maxZ + 1));
    for (const original of this.originals) {
      // Preserve the transparent layer's sort center; only extend its radius.
      const center = original.sphere.center;
      const dx = Math.max(Math.abs(bounds.min.x - center.x), Math.abs(bounds.max.x - center.x));
      const dy = Math.max(Math.abs(bounds.min.y - center.y), Math.abs(bounds.max.y - center.y));
      const dz = Math.max(Math.abs(bounds.min.z - center.z), Math.abs(bounds.max.z - center.z));
      original.dynamicSphere = new THREE.Sphere(center.clone(), Math.hypot(dx, dy, dz));
    }
    space.getBeatInfo = this.readBeatInfo;
  }
  patternForBeat(index) {
    return this.settings.pattern === 'auto'
      ? PATTERNS[Math.floor(Math.max(0, index) / Math.max(1, this.settings.patternBeats)) % 3]
      : PATTERNS.includes(this.settings.pattern) ? this.settings.pattern : 'a';
  }
  accentForBeat(index, track) {
    const accent = track.accents?.length ? track.accents[index % track.accents.length] : 1;
    return accent * (this.settings.alternateAccents && index % 2 === 1 ? this.settings.weakAccent : 1);
  }
  spatialMask(i, index, pattern) {
    if (index % 4 === 0) return 1;
    if (pattern === 'c') return this.purple[i] === index % 2 ? 1 : 0;
    const slot = index % 4 - 1, low = slot / 3, high = (slot + 1) / 3, feather = 0.03;
    const coordinate = pattern === 'a' ? this.lateral[i] : this.centered[i];
    const enter = slot === 0 ? 1 : smooth((coordinate - low + feather) / (2 * feather));
    const exit = slot === 2 ? 1 : smooth((high + feather - coordinate) / (2 * feather));
    return enter * exit;
  }
  delayAt(i, index, pattern) {
    const coordinate = pattern === 'a' ? this.lateral[i] : pattern === 'b' ? this.centered[i]
      : this.purple[i] === index % 2 ? 0 : 1;
    return (coordinate * 0.85 + this.depth[i] * 0.15) * this.settings.maxDelaySeconds;
  }
  responseAt(i, track, attack, release) {
    const c = this.clock;
    const history = Math.ceil((this.settings.maxDelaySeconds + attack + release) / c.period);
    let response = 0;
    for (let index = c.beatIndex; index >= Math.max(0, c.beatIndex - history); index--) {
      const pattern = this.patternForBeat(index);
      const age = c.sinceBeat + (c.beatIndex - index) * c.period - this.delayAt(i, index, pattern);
      if (age < 0 || age >= attack + release) continue;
      const pulse = age < attack ? smooth(age / attack) : smooth(1 - (age - attack) / release);
      const outside = pattern === 'c' ? this.settings.colorOutsideRatio : this.settings.outsideRatio;
      const weight = 1 - this.settings.patternStrength * (1 - outside) * (1 - this.spatialMask(i, index, pattern));
      const downbeat = index % 4 === 0 ? this.settings.downbeatBoost : 1;
      response = Math.max(response, pulse * this.accentForBeat(index, track) * downbeat
        * this.amplitudes[i] * weight * Math.max(0, Math.min(2, this.settings.amount)));
    }
    return response;
  }
  update(space, audio, track, active) {
    this.bind(space);
    const c = active && this.bars ? this.clock.update(audio, track) : this.clock.reset();
    const info = this.beatInfo;
    info.active = c.active; info.beatIndex = c.beatIndex; info.phase = c.phase; info.sinceBeat = c.sinceBeat;
    info.period = c.period; info.accent = c.beatIndex >= 0 ? this.accentForBeat(c.beatIndex, track) : 0;
    info.strengthScale = c.strengthScale; info.pattern = this.patternForBeat(c.beatIndex);
    if (!this.bars) return;
    if (!c.active || c.beatIndex < 0 || this.settings.amount <= 0) { this.restore(); return; }
    const attack = Math.max(0.001, Math.min(this.envelope.attackSeconds, c.period / 2));
    const release = Math.max(0.001, Math.min(this.envelope.returnSeconds, c.period * 0.8));
    const count = this.bars.handles.length;
    let moving = false, sum = 0;
    for (let i = 0; i < count; i++) {
      let response = this.responseAt(i, track, attack, release);
      if (response < 0.0001) response = 0;
      this.responses[i] = response; sum += response; moving ||= response > 0;
    }
    if (!moving) { this.restore(); return; }
    for (const original of this.originals) {
      original.mesh.boundingSphere = original.dynamicSphere;
      const matrices = original.mesh.instanceMatrix.array, colors = original.mesh.instanceColor?.array;
      for (let i = 0; i < count; i++) {
        const offset = i * 16, baseHeight = original.matrix[offset + 5];
        const length = Math.min(Math.max(baseHeight, this.settings.maxHeight),
          baseHeight * (1 + this.settings.heightAmount * this.responses[i]));
        this.lengths[i] = length;
        matrices[offset + 5] = length; matrices[offset + 13] = this.bars.handles[i].baseY + length / 2;
        if (colors) {
          const brightness = 1 + this.settings.brightnessAmount * this.responses[i];
          for (let channel = 0; channel < 3; channel++) colors[i * 3 + channel] = original.colors[i * 3 + channel] * brightness;
        }
      }
      original.mesh.instanceMatrix.needsUpdate = true;
      if (colors) original.mesh.instanceColor.needsUpdate = true;
    }
    // The existing glow layer has no instanceColor. Keep its resources intact.
    this.bars.glowMesh.material.opacity = Math.min(1, this.originalGlowOpacity * (1 + this.settings.brightnessAmount * sum / count));
    this.dirty = true;
  }
  restore() {
    if (!this.bars || !this.dirty) return;
    for (const original of this.originals) {
      original.mesh.boundingSphere = original.sphere;
      original.mesh.instanceMatrix.array.set(original.matrix); original.mesh.instanceMatrix.needsUpdate = true;
      if (original.colors) { original.mesh.instanceColor.array.set(original.colors); original.mesh.instanceColor.needsUpdate = true; }
    }
    this.bars.glowMesh.material.opacity = this.originalGlowOpacity;
    this.responses.fill(0);
    for (let i = 0; i < this.lengths.length; i++) this.lengths[i] = this.originals[0].matrix[i * 16 + 5];
    this.dirty = false;
  }
}

// Route the existing control listeners through one settings view. No new fields.
export function createSharedBarControls(outrun, cyberpunk, getSpace) {
  const current = () => getSpace() === 'cyberpunk' ? cyberpunk : outrun;
  const settings = new Proxy({}, {
    get: (_target, key) => current()[key],
    set: (_target, key, value) => {
      current()[key] = current() === cyberpunk && key === 'pattern' && value === 'd' ? 'auto' : value;
      return true;
    },
  });
  const fields = Array.from(document.querySelectorAll('[data-outrun-bars]'));
  const select = document.querySelector('[data-outrun-bars="pattern"]');
  const originalLabels = Array.from(select.options, option => option.textContent);
  const cyberLabels = ['자동', '가 · 좌→우 물결', '나 · 가운데→양옆', '다 · 푸른·보라 교대'];
  const amount = document.querySelector('[data-outrun-bars="amount"]');
  const amountLabel = amount.closest('label').firstChild;
  const originalAmountLabel = amountLabel.textContent;
  let lastSpace = null;
  return { settings, update() {
    const space = getSpace() === 'cyberpunk' ? 'cyberpunk' : 'outrun';
    if (space === lastSpace) return;
    lastSpace = space;
    const cyber = space === 'cyberpunk';
    for (const field of fields) field.value = settings[field.dataset.outrunBars];
    for (let i = 0; i < select.options.length; i++) {
      const option = select.options[i];
      option.hidden = option.disabled = cyber && i === 4;
      option.textContent = cyber ? cyberLabels[i] ?? originalLabels[i] : originalLabels[i];
    }
    select.options[0].textContent = `자동 · ${settings.patternBeats}박마다 전환`;
    amountLabel.textContent = cyber ? '사이버펑크 막대 반응량 ' : originalAmountLabel;
    amount.setAttribute('aria-label', cyber ? '사이버펑크 막대 반응량' : '아웃런 막대 반응량');
  } };
}
