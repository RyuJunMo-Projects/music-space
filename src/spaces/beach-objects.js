const smooth = t => t * t * (3 - 2 * t);

// Read BeachBars' shared media-position state. No clock, audio writes, or new art.
export class BeachObjects {
  constructor(settings, beatSettings, start) {
    this.settings = settings; this.beatSettings = beatSettings; this.start = start;
    this.space = null; this.groups = []; this.parts = []; this.palmBuffers = [];
  }
  part(object, kind) {
    object.updateMatrix();
    const part = { object, kind, baseColor: object.material.color.clone(), baseScale: object.scale.clone(),
      baseOpacity: object.material.opacity, baseMatrix: object.matrix.clone(), baseAutoUpdate: object.matrixAutoUpdate };
    this.parts.push(part); return part;
  }
  palmBuffer(mesh, extension) {
    let buffer = this.palmBuffers.find(value => value.mesh === mesh);
    if (buffer) return buffer;
    const sphere = mesh.boundingSphere, dynamicSphere = sphere.clone(); dynamicSphere.radius += extension;
    buffer = { mesh, original: mesh.instanceMatrix.array.slice(), sphere, dynamicSphere, changed: false };
    this.palmBuffers.push(buffer); return buffer;
  }
  bind(space) {
    if (space === this.space) return;
    this.restore(); this.groups.length = 0; this.parts.length = 0; this.palmBuffers.length = 0; this.space = space;
    const objects = space?.beatTargets?.objects;
    if (!objects) return;
    const add = (type, index, position, parts, palm = null, ranges = null) => {
      this.groups.push({ type, index, weightKey: `${type}Weight`, distance: Math.hypot(position.x - this.start.x, position.z - this.start.z),
        delay: 0, response: 0, parts, palm, ranges });
    };
    objects.parasols.forEach((parasol, i) => add('parasol', i, parasol.position, [this.part(parasol.userData.beatParts.canopy, 'canopy')]));
    objects.balls.forEach((ball, i) => add('ball', i, ball.position, [this.part(ball, 'ball')]));
    add('sun', 0, objects.sun.position, [this.part(objects.sun.userData.beatParts.disc, 'sunDisc'), this.part(objects.sun.userData.beatParts.halo, 'sunHalo')]);
    let extension = 0;
    for (const palm of objects.palms) extension = Math.max(extension, (palm.height + 1) * (this.settings.maxPalmStretch - 1));
    objects.palms.forEach((palm, i) => add('palm', i, palm, [], palm, [
      { buffer: this.palmBuffer(palm.trunks, extension), start: palm.trunkStart, count: palm.trunkCount },
      { buffer: this.palmBuffer(palm.leaves, extension), start: palm.leafStart, count: palm.leafCount },
    ]));
    // Spread distinct distance ranks evenly; the distant sun must not compress
    // all ground objects into the first few milliseconds. Equal distances tie.
    const distances = Array.from(new Set(this.groups.map(group => group.distance))).sort((a, b) => a - b);
    for (const group of this.groups) group.delay = distances.indexOf(group.distance) / (distances.length - 1 || 1);
  }
  responseAt(beat, track, delay) {
    const s = this.settings, attack = Math.max(0.001, Math.min(s.attackSeconds, beat.period / 2));
    const release = Math.max(0.001, Math.min(s.returnSeconds, beat.period * 0.8));
    const history = Math.ceil((delay + attack + release) / beat.period);
    let response = 0;
    for (let index = beat.beatIndex; index >= Math.max(0, beat.beatIndex - history); index--) {
      const age = beat.sinceBeat + (beat.beatIndex - index) * beat.period - delay;
      if (age < 0 || age >= attack + release) continue;
      const pulse = age < attack ? smooth(age / attack) : smooth(1 - (age - attack) / release);
      const accent = track.accents?.length ? track.accents[index % track.accents.length] : 1;
      const alternate = this.beatSettings.alternateAccents && index % 2 !== 0 ? this.beatSettings.weakAccent : 1;
      response = Math.max(response, pulse * accent * alternate * (index % 4 === 0 ? this.beatSettings.downbeatBoost : 1));
    }
    return response;
  }
  apply(part, response) {
    const { object, kind, baseColor, baseScale, baseOpacity } = part, s = this.settings;
    object.material.color.copy(baseColor); object.material.opacity = baseOpacity; object.scale.copy(baseScale);
    if (kind === 'ball') {
      object.matrix.copy(part.baseMatrix); object.matrixAutoUpdate = response ? false : part.baseAutoUpdate;
      if (response) {
        const squash = 1 - Math.min(s.maxBallSquash, s.ballSquash * response), bounce = Math.min(s.maxBallBounce, s.ballBounce * response);
        const matrix = object.matrix.elements, base = part.baseMatrix.elements;
        // Scale world Y about the ground, rather than a rotated local sphere axis.
        matrix[1] = base[1] * squash; matrix[5] = base[5] * squash; matrix[9] = base[9] * squash;
        matrix[13] = base[13] * squash + bounce;
        object.material.color.multiplyScalar(Math.min(s.maxBallBrightness, 1 + s.ballBrightness * response));
      }
      object.matrixWorldNeedsUpdate = true;
    } else if (response && kind === 'canopy') {
      object.scale.multiplyScalar(Math.min(s.maxParasolScale, 1 + s.parasolScale * response));
      object.material.color.multiplyScalar(Math.min(s.maxParasolBrightness, 1 + s.parasolBrightness * response));
    } else if (response && kind === 'sunDisc') {
      object.material.color.multiplyScalar(Math.min(s.maxSunBrightness, 1 + s.sunBrightness * response));
    } else if (response && kind === 'sunHalo') {
      object.scale.multiplyScalar(Math.min(s.maxSunGlowScale, 1 + s.sunGlow * response));
      object.material.opacity = Math.min(Math.max(baseOpacity, s.maxSunGlowOpacity), baseOpacity * (1 + s.sunGlow * response));
    }
    if (kind !== 'ball') {
      if (response) object.updateMatrix();
      else { object.matrix.copy(part.baseMatrix); object.matrixWorldNeedsUpdate = true; }
    }
  }
  applyPalm(group, response) {
    const stretch = Math.min(this.settings.maxPalmStretch, 1 + this.settings.palmStretch * response), ground = group.palm.baseY;
    for (const range of group.ranges) {
      const buffer = range.buffer, matrix = buffer.mesh.instanceMatrix.array, base = buffer.original;
      for (let i = range.start * 16, end = (range.start + range.count) * 16; i < end; i += 16) {
        matrix[i + 1] = base[i + 1] * stretch; matrix[i + 5] = base[i + 5] * stretch; matrix[i + 9] = base[i + 9] * stretch;
        matrix[i + 13] = ground + (base[i + 13] - ground) * stretch;
      }
      buffer.changed = true;
    }
  }
  update(space, track, loopGain) {
    this.bind(space); if (!this.groups.length) return;
    const beat = space.getBeatInfo?.(), s = this.settings;
    const amount = Math.max(0, Math.min(2, s.amount)) * Math.max(0, Math.min(1, loopGain));
    let palmsMoving = false;
    for (const group of this.groups) {
      let response = amount && beat?.active && beat.beatIndex >= 0
        ? this.responseAt(beat, track, group.delay * s.delaySeconds) * amount * s[group.weightKey] : 0;
      if (response < 0.0001) response = 0;
      if (response !== group.response) {
        if (group.type === 'palm') this.applyPalm(group, response);
        else for (const part of group.parts) this.apply(part, response);
      }
      if (group.type === 'palm') palmsMoving ||= response > 0;
      group.response = response;
    }
    // Two small buffers (5.6 KiB total) upload once each, only if a range changed.
    for (const buffer of this.palmBuffers) {
      buffer.mesh.boundingSphere = palmsMoving ? buffer.dynamicSphere : buffer.sphere;
      if (buffer.changed) { buffer.mesh.instanceMatrix.needsUpdate = true; buffer.changed = false; }
    }
  }
  restore() {
    for (const part of this.parts) this.apply(part, 0);
    for (const buffer of this.palmBuffers) {
      buffer.mesh.instanceMatrix.array.set(buffer.original); buffer.mesh.instanceMatrix.needsUpdate = true;
      buffer.mesh.boundingSphere = buffer.sphere; buffer.changed = false;
    }
    for (const group of this.groups) group.response = 0;
  }
}

export function createSharedBeachObjectControls(outrun, cyberpunk, beach, getSpace) {
  const current = () => getSpace() === 'beach' ? beach : getSpace() === 'cyberpunk' ? cyberpunk : outrun;
  const settings = new Proxy({}, {
    get: (_target, key) => current()[key],
    set: (_target, key, value) => { current()[key] = value; return true; },
  });
  const input = document.querySelector('#outrun-object-amount'); let previous = null;
  return { settings, update() {
    const active = current(); if (active === previous) return;
    previous = active; input.value = active.amount;
  } };
}
