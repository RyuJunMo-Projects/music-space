import * as THREE from '../../vendor/three/three.module.min.js';

const smooth = t => t * t * (3 - 2 * t);

// Consume the wall's public beat state, without another clock or per-frame objects.
export class OutrunObjects {
  constructor(settings, envelope) {
    this.settings = settings; this.envelope = envelope; this.space = null;
    this.parts = []; this.groups = [];
    this.hillBuffers = null;
  }

  part(object, scale, brightness, glow, clone = false, height = scale) {
    const originalMaterial = object.material;
    if (clone) object.material = originalMaterial.clone();
    const part = { object, scale, height, brightness, glow, originalMaterial, clone,
      baseScale: object.scale.clone(), baseColor: object.material?.color.clone(),
      baseOpacity: object.material?.opacity };
    this.parts.push(part);
    return part;
  }

  bind(space) {
    if (this.space === space) return;
    this.restoreHills();
    for (const part of this.parts) {
      this.apply(part, 0);
      if (part.clone) { part.object.material.dispose(); part.object.material = part.originalMaterial; }
    }
    this.parts.length = 0; this.groups.length = 0; this.space = space;
    const objects = space?.beatTargets?.objects;
    if (!objects) return;
    const s = this.settings;
    const sun = objects.sun.userData.beatParts;
    this.groups.push({ type: 'sun', delay: 0, response: 0, parts: [
      this.part(objects.sun, s.sunScale, 0, 0),
      this.part(sun.disc, 0, s.sunBrightness, 0),
      this.part(sun.halo, s.sunGlowScale, s.sunBrightness, s.sunGlow),
      this.part(sun.corona, s.sunGlowScale, s.sunBrightness, s.sunGlow),
    ] });
    let front = Infinity; let rear = -Infinity;
    for (const lamp of objects.lamps) {
      front = Math.min(front, lamp.position.z); rear = Math.max(rear, lamp.position.z);
    }
    for (const lamp of objects.lamps) {
      const p = lamp.userData.beatParts;
      this.groups.push({ type: 'lamp', delay: (lamp.position.z - front) / (rear - front || 1), response: 0,
        parts: [this.part(p.disc, s.lampScale, s.lampBrightness, 0, true),
          this.part(p.halo, s.lampScale, s.lampBrightness, s.lampGlow, true)] });
    }
    for (const palm of objects.palms) {
      const p = palm.userData.beatParts;
      this.groups.push({ type: 'palm', delay: 0, response: 0,
        parts: [this.part(palm, 0, 0, 0, false, s.palmHeight),
          this.part(p.leaves, 0, s.palmBrightness, 0, true),
          this.part(p.leavesRim, 0, s.palmBrightness, s.palmGlow, true)] });
    }
    // Scale the existing surface and wire together, keeping their alignment and
    // ground contact. The existing floor reflection supplies the glow.
    for (const prop of objects.props ?? []) {
      const p = prop.userData.beatParts;
      this.groups.push({ type: 'prop', delay: 0, response: 0, parts: [
        this.part(prop, s.propScale, 0, 0),
        this.part(p.surface, 0, s.propBrightness, 0),
        this.part(p.wire, 0, s.propBrightness, s.propGlow),
        this.part(p.reflection, 0, s.propBrightness, s.propGlow),
      ] });
    }
    const hills = objects.hills?.userData.beatParts;
    if (hills?.layers) {
      this.hillBuffers = { surface: this.hillBuffer(hills.surface), wire: this.hillBuffer(hills.wire) };
      for (const range of hills.layers) {
        this.groups.push({ type: 'hill', delay: range.order / (range.count - 1 || 1),
          response: 0, range, parts: [] });
      }
    }
  }

  hillBuffer(mesh) {
    const geometry = mesh.geometry;
    const position = geometry.attributes.position; const color = geometry.attributes.color;
    position.setUsage(THREE.DynamicDrawUsage); color.setUsage(THREE.DynamicDrawUsage);
    geometry.computeBoundingSphere();
    const baseBounds = geometry.boundingSphere.clone();
    let height = 0;
    for (let i = 1; i < position.array.length; i += 3) height = Math.max(height, position.array[i]);
    // A fixed conservative bound covers amount 2 and the 1.25 downbeat boost.
    geometry.boundingSphere.radius += height * this.settings.hillScale * 2.5;
    return { geometry, position, color, basePositions: position.array.slice(), baseColors: color.array.slice(), baseBounds };
  }

  restoreHills() {
    if (!this.hillBuffers) return;
    for (const buffer of [this.hillBuffers.surface, this.hillBuffers.wire]) {
      buffer.position.array.set(buffer.basePositions); buffer.color.array.set(buffer.baseColors);
      buffer.position.needsUpdate = true; buffer.color.needsUpdate = true;
      buffer.geometry.boundingSphere.copy(buffer.baseBounds);
    }
    this.hillBuffers = null;
  }

  applyHill(group, response) {
    const range = group.range; const s = this.settings;
    const height = 1 + s.hillScale * response;
    const brightness = 1 + s.hillBrightness * response;
    // The existing additive wire supplies the glow, with no extra draw pass.
    this.writeHill(this.hillBuffers.surface, range.surfaceStart, range.surfaceCount, height, brightness);
    this.writeHill(this.hillBuffers.wire, range.wireStart, range.wireCount, height, brightness * (1 + s.hillGlow * response));
  }

  writeHill(buffer, start, count, height, brightness) {
    const position = buffer.position.array; const color = buffer.color.array;
    for (let i = start * 3, end = (start + count) * 3; i < end; i += 3) {
      position[i + 1] = buffer.basePositions[i + 1] * height;
      color[i] = buffer.baseColors[i] * brightness;
      color[i + 1] = buffer.baseColors[i + 1] * brightness;
      color[i + 2] = buffer.baseColors[i + 2] * brightness;
    }
  }

  apply(part, response) {
    part.object.scale.set(part.baseScale.x * (1 + part.scale * response),
      part.baseScale.y * (1 + part.height * response), part.baseScale.z * (1 + part.scale * response));
    if (!part.baseColor) return;
    part.object.material.color.copy(part.baseColor).multiplyScalar(1 + part.brightness * response);
    part.object.material.opacity = Math.min(1, part.baseOpacity * (1 + part.glow * response));
  }

  responseAt(beat, track, delay, type) {
    const attack = Math.max(0.001, Math.min(this.envelope.attackSeconds, beat.period / 2));
    const release = Math.max(0.001, Math.min(this.envelope.returnSeconds, beat.period * 0.8));
    const history = Math.ceil((delay + attack + release) / beat.period);
    let response = 0;
    for (let index = beat.beatIndex; index >= Math.max(0, beat.beatIndex - history); index--) {
      const age = beat.sinceBeat + (beat.beatIndex - index) * beat.period - delay;
      if (age < 0 || age >= attack + release) continue;
      const envelope = age < attack ? smooth(age / attack) : smooth(1 - (age - attack) / release);
      const accent = track.accents?.length ? track.accents[index % track.accents.length] : 1;
      const weight = type === 'sun' && index % 4 !== 0 ? 0.8
        : (type === 'prop' || type === 'palm' || type === 'hill') && index % 4 === 0 ? 1.25 : 1;
      response = Math.max(response, envelope * accent * weight);
    }
    return response;
  }

  update(space, track, loopGain, delta) {
    this.bind(space);
    if (!this.groups.length) return;
    const beat = space.getBeatInfo?.();
    const amount = this.settings.amount * loopGain;
    const settle = Math.exp(-Math.max(0, delta) / 0.08);
    let hillsChanged = false;
    for (const group of this.groups) {
      const delay = group.type === 'lamp' ? group.delay * this.settings.lampDelaySeconds
        : group.type === 'hill' ? group.delay * this.settings.hillDelaySeconds : 0;
      let response = amount === 0 ? 0 : beat?.active && beat.beatIndex >= 0
        ? this.responseAt(beat, track, delay, group.type) * amount : group.response * settle;
      if (response < 0.0001) response = 0;
      if (group.type === 'hill') {
        if (response !== group.response) { this.applyHill(group, response); hillsChanged = true; }
      } else for (const part of group.parts) this.apply(part, response);
      group.response = response;
    }
    if (hillsChanged) {
      this.hillBuffers.surface.position.needsUpdate = true; this.hillBuffers.surface.color.needsUpdate = true;
      this.hillBuffers.wire.position.needsUpdate = true; this.hillBuffers.wire.color.needsUpdate = true;
    }
  }
}

export function setupObjectControls(development, settings) {
  if (!development.showControls) return;
  const input = document.querySelector('#outrun-object-amount');
  input.value = settings.amount;
  input.addEventListener('input', () => {
    if (Number.isFinite(input.valueAsNumber)) settings.amount = Math.max(0, Math.min(2, input.valueAsNumber));
  });
  input.addEventListener('change', () => { input.value = settings.amount; });
}
