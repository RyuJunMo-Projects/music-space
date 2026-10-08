import * as THREE from '../vendor/three/three.module.min.js';

// Repeatable positions keep visual reviews comparable between reloads.
function randomSource(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function glowTexture(sharp = false) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.15, sharp ? 'rgba(255,255,255,1)' : 'rgba(255,255,255,0.65)');
  gradient.addColorStop(0.5, sharp ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.12)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

export function createLobby(scene, settings) {
  scene.userData.space = 'lobby';
  scene.background = new THREE.Color(settings.background);
  scene.fog = new THREE.FogExp2(settings.background, settings.fogDensity);
  const root = new THREE.Group();
  root.name = 'lobby';
  scene.add(root);
  const random = randomSource(20261003);
  const glow = glowTexture();
  const starGlow = glowTexture(true);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(settings.gridSize, settings.gridSize),
    new THREE.MeshBasicMaterial({ color: settings.background }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.015;
  root.add(floor);
  const grid = new THREE.GridHelper(settings.gridSize, settings.gridSize / settings.gridSpacing,
    settings.gridColor, settings.gridColor);
  grid.material.transparent = true;
  grid.material.opacity = settings.gridOpacity;
  grid.material.depthWrite = false;
  root.add(grid);

  const sky = new THREE.Group();
  sky.name = 'distant-stars';
  root.add(sky);
  for (let layer = 0; layer < 2; layer++) {
    const count = layer === 0 ? settings.starCount : Math.floor(settings.starCount / 12);
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const azimuth = random() * Math.PI * 2;
      const elevation = 0.012 + random() * 0.988;
      const radius = settings.starRadius;
      const horizontal = Math.sqrt(1 - elevation * elevation);
      positions.set([Math.cos(azimuth) * horizontal * radius, elevation * radius,
        Math.sin(azimuth) * horizontal * radius], i * 3);
      const brightness = 0.35 + random() * 0.65;
      const tint = random();
      colors.set([brightness * (tint < 0.5 ? 0.73 : 0.95), brightness * 0.85, brightness], i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    sky.add(new THREE.Points(geometry, new THREE.PointsMaterial({
      map: starGlow, size: layer === 0 ? 2 : 3.5, sizeAttenuation: false,
      vertexColors: true, transparent: true, opacity: layer === 0 ? 0.9 : 1,
      depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
    })));
  }

  // Soft, low horizontal layers suggest mist without volumetric rendering.
  const haze = new THREE.Group();
  haze.name = 'low-haze';
  root.add(haze);
  const hazeMaterial = new THREE.SpriteMaterial({ map: glow, color: 0x79869e,
    transparent: true, opacity: settings.hazeOpacity, depthWrite: false,
    fog: false, blending: THREE.AdditiveBlending });
  for (let i = 0; i < settings.hazeCount; i++) {
    const angle = i / settings.hazeCount * Math.PI * 2;
    const radius = 38 + random() * 20;
    const sprite = new THREE.Sprite(hazeMaterial);
    sprite.position.set(Math.cos(angle) * radius, 0.3 + random() * 0.8, Math.sin(angle) * radius);
    sprite.scale.set(22 + random() * 16, 2 + random() * 3, 1);
    haze.add(sprite);
  }

  const dustPositions = new Float32Array(settings.dustCount * 3);
  for (let i = 0; i < settings.dustCount; i++) {
    dustPositions.set([(random() - 0.5) * 64, 0.4 + random() * 6, (random() - 0.5) * 64], i * 3);
  }
  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
  const dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({ map: glow,
    color: 0x8799ae, size: 0.065, transparent: true, opacity: 0.24,
    depthWrite: false, blending: THREE.AdditiveBlending }));
  dust.name = 'near-dust';
  root.add(dust);

  let elapsed = 0;
  return {
    root,
    update(delta, camera) {
      elapsed += delta;
      // Sky follows translation only; dust and floor remain anchored in the world.
      sky.position.copy(camera.position);
      dust.position.y = Math.sin(elapsed * 0.18) * 0.13;
    },
  };
}
