import * as THREE from '../vendor/three/three.module.min.js';

function lightTexture(line = false) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = line ? 256 : 64;
  const context = canvas.getContext('2d');
  const pixels = context.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const u = (x + 0.5) / canvas.width * 2 - 1;
      const v = (y + 0.5) / canvas.height * 2 - 1;
      const alpha = line
        ? Math.exp(-u * u * 9) * (1 - Math.abs(v) ** 8)
        : Math.max(0, Math.exp(-(u * u + v * v) * 4) - Math.exp(-4));
      const index = (y * canvas.width + x) * 4;
      pixels.data.set([255, 255, 255, alpha * 255], index);
    }
  }
  context.putImageData(pixels, 0, 0);
  return new THREE.CanvasTexture(canvas);
}

function mistNoise(x, y, seed, period) {
  const hash = (column, row) => {
    const wrappedRow = ((row % period) + period) % period;
    const value = Math.sin(column * 127.1 + wrappedRow * 311.7 + seed * 73.9) * 43758.5453;
    return value - Math.floor(value);
  };
  const column = Math.floor(x);
  const row = Math.floor(y);
  const sx = x - column;
  const sy = y - row;
  const u = sx * sx * (3 - 2 * sx);
  const v = sy * sy * (3 - 2 * sy);
  const bottom = THREE.MathUtils.lerp(hash(column, row), hash(column + 1, row), u);
  const top = THREE.MathUtils.lerp(hash(column, row + 1), hash(column + 1, row + 1), u);
  return THREE.MathUtils.lerp(bottom, top, v);
}

function membraneTexture(left, right, seed) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  const pixels = context.createImageData(canvas.width, canvas.height);
  const color = new THREE.Color();
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const u = (x + 0.5) / canvas.width;
      const v = (y + 0.5) / canvas.height;
      const cloud = mistNoise(u * 4, v * 8, seed, 8) * 0.6
        + mistNoise(u * 9, v * 18, seed + 1, 18) * 0.28
        + mistNoise(u * 19, v * 38, seed + 2, 38) * 0.12;
      color.copy(left).lerp(right, u)
        .multiplyScalar(0.055 + 0.13 * cloud).convertLinearToSRGB();
      const index = (y * canvas.width + x) * 4;
      pixels.data.set([color.r * 255, color.g * 255, color.b * 255, 255], index);
    }
  }
  context.putImageData(pixels, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

export function doorPulseEnvelope(clock, settings) {
  if (!clock.active || clock.beatIndex < 0) return 0;
  const attack = Math.min(settings.attackSeconds, clock.period / 2);
  const release = Math.min(settings.returnSeconds, clock.period * 0.8);
  const age = clock.sinceBeat;
  if (age >= attack + release) return 0;
  const t = age < attack ? age / attack : 1 - (age - attack) / release;
  return t * t * (3 - 2 * t) * clock.accent * clock.strengthScale;
}

export function createDoorways(scene, settings, startPosition) {
  const root = new THREE.Group();
  root.name = 'lobby-doorways';
  scene.add(root);
  const lineGlow = lightTexture(true);
  const softGlow = lightTexture();
  const raycaster = new THREE.Raycaster();
  const center = new THREE.Vector2(0, 0);
  const hitboxes = [];
  const membranes = [];
  const doors = settings.spaces.map((space, index) => {
    const angle = index * Math.PI * 2 / settings.spaces.length;
    const group = new THREE.Group();
    group.name = `door-${space.id}`;
    group.position.set(startPosition.x + Math.sin(angle) * settings.radius, 0,
      startPosition.z - Math.cos(angle) * settings.radius);
    group.rotation.y = Math.atan2(startPosition.x - group.position.x, startPosition.z - group.position.z);
    root.add(group);
    const [left, right] = space.colors.map(color => new THREE.Color(color));
    const { width, height, frameThickness: thickness } = settings;
    const pulseFrame = new THREE.Group();
    pulseFrame.name = `door-pulse-${space.id}`;
    pulseFrame.position.y = height / 2;
    group.add(pulseFrame);
    const barMaterials = [];
    const glowMaterials = [];

    function bar(x, y, w, h) {
      const geometry = new THREE.BoxGeometry(w, h, thickness);
      const vertices = geometry.getAttribute('position');
      const colors = [];
      for (let i = 0; i < vertices.count; i++) {
        const fraction = THREE.MathUtils.clamp((vertices.getX(i) + x) / width + 0.5, 0, 1);
        const color = left.clone().lerp(right, fraction).lerp(new THREE.Color(0xffffff), 0.18);
        colors.push(color.r, color.g, color.b);
      }
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
      mesh.position.set(x, y - height / 2, 0);
      pulseFrame.add(mesh);
      barMaterials.push({ material: mesh.material, color: mesh.material.color.clone() });
    }
    bar(-width / 2, height / 2, thickness, height);
    bar(width / 2, height / 2, thickness, height);
    bar(0, height, width + thickness, thickness);
    bar(0, 0.025, width + thickness, thickness * 0.5);

    // A dim colored veil blocks the background inside the frame. Only the mist
    // texture drifts; frame colors and the surrounding lobby stay as before.
    const veilTexture = membraneTexture(left, right, index + 1);
    const veil = new THREE.Mesh(new THREE.PlaneGeometry(width - thickness, height - thickness),
      new THREE.MeshBasicMaterial({ map: veilTexture, side: THREE.DoubleSide, fog: false }));
    veil.name = `door-membrane-${space.id}`;
    veil.position.set(0, height / 2, 0);
    group.add(veil);
    membranes.push(veilTexture);

    function glow(x, y, length, color, horizontal = false) {
      const material = new THREE.MeshBasicMaterial({ map: lineGlow, color,
        transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.DoubleSide, fog: false });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.65, length + 0.5), material);
      mesh.position.set(x, y - height / 2, 0);
      if (horizontal) mesh.rotation.z = Math.PI / 2;
      pulseFrame.add(mesh);
      glowMaterials.push({ material, opacity: material.opacity });
    }
    glow(-width / 2, height / 2, height, left);
    glow(width / 2, height / 2, height, right);
    glow(-width / 4, height, width / 2, left, true);
    glow(width / 4, height, width / 2, right, true);

    // A broad, faint halo remains visible from oblique angles, without postprocessing.
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: softGlow,
      color: left.clone().lerp(right, 0.5), transparent: true, opacity: 0.035,
      depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    halo.scale.set(width + 3.5, height + 2.5, 1);
    pulseFrame.add(halo);
    glowMaterials.push({ material: halo.material, opacity: halo.material.opacity });
    for (const [x, color] of [[-width / 2, left], [width / 2, right]]) {
      const spill = new THREE.Mesh(new THREE.PlaneGeometry(4, 5.5), new THREE.MeshBasicMaterial({
        map: softGlow, color, transparent: true, opacity: 0.15,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: true,
      }));
      spill.rotation.x = -Math.PI / 2;
      spill.position.set(x, 0.008, 0);
      group.add(spill);
    }

    // The invisible box makes the entire doorway clickable within the threshold.
    const hitbox = new THREE.Mesh(new THREE.BoxGeometry(width + 0.16, height + 0.08, 0.16),
      new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    hitbox.position.y = height / 2;
    group.add(hitbox);
    const door = { ...space, group, hitbox, pulseFrame, barMaterials, glowMaterials, membrane: veil };
    hitbox.userData.door = door;
    hitboxes.push(hitbox);
    return door;
  });
  root.updateMatrixWorld(true);
  let mistOffset = 0;
  return {
    root,
    doors,
    update(delta) {
      mistOffset = (mistOffset + delta * 0.012) % 1;
      membranes.forEach(texture => { texture.offset.y = mistOffset; });
    },
    setPulse(id, envelope, proximity) {
      for (const door of doors) {
        const amount = door.id === id ? settings.pulse.strength * envelope * proximity : 0;
        door.pulseFrame.scale.setScalar(1 + settings.pulse.scaleAmount * amount);
        for (const bar of door.barMaterials) {
          bar.material.color.copy(bar.color).multiplyScalar(1 + settings.pulse.brightnessAmount * amount);
        }
        for (const glow of door.glowMaterials) {
          glow.material.opacity = glow.opacity * (1 + settings.pulse.glowAmount * amount);
        }
      }
    },
    pick(camera) {
      if (scene.userData.space !== 'lobby') return null;
      camera.updateMatrixWorld();
      raycaster.setFromCamera(center, camera);
      const door = raycaster.intersectObjects(hitboxes, false)[0]?.object.userData.door;
      if (!door) return null;
      // Ground-plane center distance also defines the future song-preview radius.
      const distance = Math.hypot(camera.position.x - door.group.position.x,
        camera.position.z - door.group.position.z);
      return distance <= settings.activationDistance ? door : null;
    },
  };
}
