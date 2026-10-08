import { BeatClock } from '../audio/beat-clock.js';
import { createSharedBarControls } from './cyberpunk-bars.js';

const patterns = ['a', 'b', 'c'];
const smooth = t => t * t * (3 - 2 * t);
const random = seed => { const n = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return n - Math.floor(n); };

export class BeachBars {
  constructor(settings) {
    this.settings = settings; this.clock = new BeatClock(); this.space = null; this.bars = null; this.dirty = false;
    this.beatInfo = { active: false, beatIndex: -1, phase: 0, sinceBeat: 0, period: 0, accent: 0, strengthScale: 1, pattern: 'a' };
    this.readBeatInfo = () => this.beatInfo;
  }
  bind(space) {
    if (space === this.space) return;
    if (this.space) { this.restore(); delete this.space.getBeatInfo; }
    this.space = space; this.clock.reset(); this.bars = space?.beatTargets?.bars ?? null; this.original = null;
    if (!this.bars) { this.responses = this.lengths = this.amplitudes = this.lateral = this.centered = this.incoming = null; return; }
    const b = this.bars, count = b.handles.length;
    this.original = { matrix: b.mesh.instanceMatrix.array.slice(), crest: b.crestBrightness.array.slice() };
    this.responses = new Float32Array(count); this.lengths = new Float32Array(count); this.amplitudes = new Float32Array(count);
    this.lateral = new Float32Array(count); this.centered = new Float32Array(count); this.incoming = new Float32Array(count);
    let minX = Infinity, maxX = -Infinity, maxRow = 0;
    for (const h of b.handles) { minX = Math.min(minX, h.x); maxX = Math.max(maxX, h.x); maxRow = Math.max(maxRow, h.row); }
    for (let i = 0; i < count; i++) {
      const h = b.handles[i]; this.lengths[i] = this.original.matrix[i * 16 + 5];
      this.amplitudes[i] = 0.9 + 0.2 * random(2729 + i * 31);
      this.lateral[i] = (h.x - minX) / (maxX - minX || 1); this.centered[i] = Math.abs(this.lateral[i] * 2 - 1);
      this.incoming[i] = 1 - h.row / (maxRow || 1);
    }
    // Keep the original sort center, extending only the radius for the permitted rise.
    this.original.sphere = b.mesh.boundingSphere; this.dynamicSphere = b.mesh.boundingSphere.clone(); this.dynamicSphere.radius += this.settings.maxHeight;
    space.getBeatInfo = this.readBeatInfo;
  }
  patternForBeat(index) {
    return patterns.includes(this.settings.pattern) ? this.settings.pattern
      : patterns[Math.floor(Math.max(0, index) / Math.max(1, this.settings.patternBeats)) % 3];
  }
  delayAt(i, pattern) {
    const coordinate = pattern === 'a' ? this.incoming[i] : pattern === 'b' ? this.lateral[i] : this.centered[i];
    return coordinate * this.settings.maxDelaySeconds * this.settings.patternStrength;
  }
  accentForBeat(index, track) {
    const accent = track.accents?.length ? track.accents[index % track.accents.length] : 1;
    return accent * (this.settings.alternateAccents && index % 2 !== 0 ? this.settings.weakAccent : 1);
  }
  responseAt(i, track) {
    const c = this.clock, s = this.settings, attack = Math.max(0.001, Math.min(s.attackSeconds, c.period / 2));
    const release = Math.max(0.001, Math.min(s.returnSeconds, c.period * 0.8)), history = Math.ceil((s.maxDelaySeconds + attack + release) / c.period);
    let response = 0;
    for (let index = c.beatIndex; index >= Math.max(0, c.beatIndex - history); index--) {
      const age = c.sinceBeat + (c.beatIndex - index) * c.period - this.delayAt(i, this.patternForBeat(index));
      if (age < 0 || age >= attack + release) continue;
      const pulse = age < attack ? smooth(age / attack) : smooth(1 - (age - attack) / release);
      response = Math.max(response, pulse * this.accentForBeat(index, track) * (index % 4 === 0 ? s.downbeatBoost : 1)
        * this.amplitudes[i] * Math.max(0, Math.min(2, s.amount)));
    }
    return response;
  }
  update(space, audio, track, active) {
    this.bind(space);
    const c = active && this.bars ? this.clock.update(audio, track) : this.clock.reset(), info = this.beatInfo;
    info.active = c.active; info.beatIndex = c.beatIndex; info.phase = c.phase; info.sinceBeat = c.sinceBeat; info.period = c.period;
    info.accent = c.beatIndex >= 0 ? this.accentForBeat(c.beatIndex, track) : 0; info.strengthScale = c.strengthScale; info.pattern = this.patternForBeat(c.beatIndex);
    if (!this.bars) return;
    if (!c.active || c.beatIndex < 0 || this.settings.amount <= 0) { this.restore(); return; }
    let moving = false;
    for (let i = 0; i < this.responses.length; i++) { const response = this.responseAt(i, track); this.responses[i] = response < 0.0001 ? 0 : response; moving ||= this.responses[i] > 0; }
    if (!moving) { this.restore(); return; }
    const b = this.bars, matrix = b.mesh.instanceMatrix.array, crest = b.crestBrightness.array, s = this.settings;
    b.mesh.boundingSphere = this.dynamicSphere;
    for (let i = 0; i < this.responses.length; i++) {
      const length = Math.min(Math.max(this.original.matrix[i * 16 + 5], s.maxHeight), this.original.matrix[i * 16 + 5] * (1 + s.heightAmount * this.responses[i]));
      this.lengths[i] = length; matrix[i * 16 + 5] = length; matrix[i * 16 + 13] = b.handles[i].baseY + length / 2;
      crest[i] = Math.min(s.maxBrightness, 1 + s.brightnessAmount * this.responses[i]);
    }
    b.mesh.instanceMatrix.needsUpdate = true; b.crestBrightness.needsUpdate = true; this.dirty = true;
  }
  restore() {
    if (!this.bars || !this.dirty) return;
    const b = this.bars; b.mesh.boundingSphere = this.original.sphere;
    b.mesh.instanceMatrix.array.set(this.original.matrix); b.crestBrightness.array.set(this.original.crest);
    b.mesh.instanceMatrix.needsUpdate = true; b.crestBrightness.needsUpdate = true; this.responses.fill(0);
    for (let i = 0; i < this.lengths.length; i++) this.lengths[i] = this.original.matrix[i * 16 + 5];
    this.dirty = false;
  }
}

// The existing two-space adapter remains intact; its second settings view switches
// between Cyberpunk and Beach. Legacy listeners still own every input.
export function createSharedBeachBarControls(outrun, cyberpunk, beach, getSpace) {
  const other = new Proxy({}, {
    get: (_target, key) => (getSpace() === 'beach' ? beach : cyberpunk)[key],
    set: (_target, key, value) => { (getSpace() === 'beach' ? beach : cyberpunk)[key] = value; return true; },
  });
  const legacy = createSharedBarControls(outrun, other, () => getSpace() === 'beach' ? 'cyberpunk' : getSpace());
  const fields = Array.from(document.querySelectorAll('[data-outrun-bars]')), select = document.querySelector('[data-outrun-bars="pattern"]');
  const amount = document.querySelector('[data-outrun-bars="amount"]');
  const outsideFields = fields.filter(field => ['outsideRatio', 'colorOutsideRatio'].includes(field.dataset.outrunBars));
  let previous = null, outsideHidden = null;
  return { settings: legacy.settings, update() {
    legacy.update(); const id = getSpace() === 'beach' ? 'beach' : getSpace() === 'cyberpunk' ? 'cyberpunk' : 'outrun';
    if (id === previous) return;
    if (previous === 'beach') outsideFields.forEach((field, i) => { field.closest('label').hidden = outsideHidden[i]; });
    if (id === 'beach') {
      outsideHidden = outsideFields.map(field => field.closest('label').hidden);
      outsideFields.forEach(field => { field.closest('label').hidden = true; });
    }
    previous = id;
    if (id === 'outrun') return;
    for (const field of fields) field.value = legacy.settings[field.dataset.outrunBars];
    const labels = id === 'beach' ? ['자동', '가 · 먼 줄→물가 파도', '나 · 좌→우 물결', '다 · 가운데→양옆']
      : ['자동', '가 · 좌→우 물결', '나 · 가운데→양옆', '다 · 푸른·보라 교대'];
    for (let i = 0; i < 4; i++) select.options[i].textContent = labels[i];
    select.options[0].textContent = `자동 · ${legacy.settings.patternBeats}박마다 전환`;
    const label = `${id === 'beach' ? '해변' : '사이버펑크'} 막대 반응량`;
    amount.closest('label').firstChild.textContent = `${label} `; amount.setAttribute('aria-label', label);
  } };
}
