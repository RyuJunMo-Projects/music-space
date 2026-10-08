const smooth = t => t * t * (3 - 2 * t);

// Consume the skyline's media-position beat state. All allocations happen at bind.
export class CyberpunkObjects {
  constructor(settings, envelope, beatSettings, start) {
    this.settings = settings; this.envelope = envelope; this.beatSettings = beatSettings;
    this.start = start;
    this.space = null; this.groups = []; this.parts = [];
  }

  part(object, kind) {
    const part = { object, kind, baseColor: object.material.color.clone(),
      baseScale: object.scale.clone(), baseOpacity: object.material.opacity };
    this.parts.push(part); return part;
  }

  bind(space) {
    if (this.space === space) return;
    for (const part of this.parts) this.apply(part, 0);
    this.parts.length = 0; this.groups.length = 0; this.space = space;
    const objects = space?.beatTargets?.objects;
    if (!objects) return;
    const origin = this.start;
    let near = Infinity, far = -Infinity;
    for (const sign of objects.signs) {
      const distance = Math.hypot(sign.group.position.x - origin.x, sign.group.position.z - origin.z);
      near = Math.min(near, distance); far = Math.max(far, distance);
    }
    for (const sign of objects.signs) {
      const distance = Math.hypot(sign.group.position.x - origin.x, sign.group.position.z - origin.z);
      const parts = [];
      // Lit faces have unique materials; the dark face/body share the building material.
      if (sign.type !== 'backOnly') parts.push(this.part(sign.face, 'face'));
      if (sign.type !== 'frontOnly') parts.push(this.part(sign.backFace, 'face'));
      parts.push(this.part(sign.halo, 'halo'), this.part(sign.reflection, 'reflection'));
      this.groups.push({ type: 'sign', sign, distance, delay: (distance - near) / (far - near || 1),
        weight: objects.pulseSigns.includes(sign) ? 1 : 0.5, response: 0, parts });
    }
    this.groups.push({ type: 'vending', delay: 0, weight: 1, response: 0,
      parts: [this.part(objects.vendingFace, 'vending')] });
    for (const person of objects.people) {
      // Resolve the existing rim once; do not alter the static silhouette generator.
      const rim = person.children.find(child => child.geometry?.type === 'TorusGeometry');
      if (rim) this.groups.push({ type: 'umbrella', delay: 0, weight: 1, response: 0,
        parts: [this.part(rim, 'umbrella')] });
    }
  }

  responseAt(beat, track, delay, downbeatOnly) {
    const attack = Math.max(0.001, Math.min(this.envelope.attackSeconds, beat.period / 2));
    const release = Math.max(0.001, Math.min(this.envelope.returnSeconds, beat.period * 0.8));
    const history = Math.ceil((delay + attack + release) / beat.period);
    let response = 0;
    for (let index = beat.beatIndex; index >= Math.max(0, beat.beatIndex - history); index--) {
      if (downbeatOnly && index % 4 !== 0) continue;
      const age = beat.sinceBeat + (beat.beatIndex - index) * beat.period - delay;
      if (age < 0 || age >= attack + release) continue;
      const pulse = age < attack ? smooth(age / attack) : smooth(1 - (age - attack) / release);
      const accent = track.accents?.length ? track.accents[index % track.accents.length] : 1;
      const alternate = this.beatSettings.alternateAccents && index % 2 !== 0 ? this.beatSettings.weakAccent : 1;
      const downbeat = index % 4 === 0 ? this.beatSettings.downbeatBoost : 1;
      response = Math.max(response, pulse * accent * alternate * downbeat);
    }
    return response;
  }

  apply(part, response) {
    const { object, kind, baseColor, baseScale, baseOpacity } = part, s = this.settings;
    object.scale.copy(baseScale); object.material.color.copy(baseColor); object.material.opacity = baseOpacity;
    if (!response) return;
    if (kind === 'face') {
      object.material.color.multiplyScalar(Math.min(s.maxSignBrightness, 1 + s.signBrightness * response));
      // Only the letter planes grow. Even amount 2 stays within the original board.
      object.scale.multiplyScalar(1 + Math.min(s.signScale, s.signScale * response));
    } else if (kind === 'halo') {
      object.scale.multiplyScalar(Math.min(s.maxGlowScale, 1 + 0.16 * s.signGlow * response));
      object.material.opacity = Math.min(Math.max(baseOpacity, s.maxGlowOpacity), baseOpacity * (1 + s.signGlow * response));
    } else {
      const brightness = kind === 'reflection' ? s.reflectionBrightness : kind === 'vending' ? s.vendingBrightness : s.umbrellaGlow;
      const limit = kind === 'reflection' ? s.maxReflectionBrightness : kind === 'vending' ? s.maxVendingBrightness : s.maxUmbrellaBrightness;
      object.material.color.multiplyScalar(Math.min(limit, 1 + brightness * response));
    }
  }

  update(space, track, loopGain) {
    this.bind(space);
    if (!this.groups.length) return;
    const beat = space.getBeatInfo?.();
    const amount = Math.max(0, Math.min(2, this.settings.amount)) * Math.max(0, Math.min(1, loopGain));
    for (const group of this.groups) {
      const delay = group.type === 'sign' ? group.delay * this.settings.signDelaySeconds : 0;
      let response = amount && beat?.active && beat.beatIndex >= 0
        ? this.responseAt(beat, track, delay, group.type === 'umbrella') * amount * group.weight : 0;
      if (response < 0.0001) response = 0;
      if (response !== group.response) for (const part of group.parts) this.apply(part, response);
      group.response = response;
    }
  }
}

// Reuse the existing Outrun listener and input, keeping each space's value.
export function createSharedObjectControls(outrun, cyberpunk, getSpace) {
  const current = () => getSpace() === 'cyberpunk' ? cyberpunk : outrun;
  const settings = new Proxy({}, {
    get: (_target, key) => current()[key],
    set: (_target, key, value) => { current()[key] = value; return true; },
  });
  const input = document.querySelector('#outrun-object-amount');
  let previous = null;
  return { settings, update() {
    const active = current();
    if (active === previous) return;
    previous = active; input.value = active.amount;
  } };
}
