import * as THREE from '../../vendor/three/three.module.min.js';
import { config } from '../config.js';
import { createExitGate } from '../exit-gate.js';

const noise = i => { const n = Math.sin(i * 127.1 + 311.7) * 43758.5453; return n - Math.floor(n); };

// Static art only. Future consumers can use the skyline and pulse candidate handles.
export function createCyberpunkSpace(colors) {
  const settings = config.spaces.cyberpunk;
  const root = new THREE.Group(); root.name = 'cyberpunk-alley';
  const geometries = new Set(), materials = new Set(), textures = new Set();
  const geometry = value => { geometries.add(value); return value; };
  const material = value => { materials.add(value); return value; };
  const box = geometry(new THREE.BoxGeometry(1, 1, 1));
  const plane = geometry(new THREE.PlaneGeometry(1, 1));
  const basic = color => material(new THREE.MeshBasicMaterial({ color }));
  const dark = basic(settings.buildingColor), shutter = basic(0x172436), steel = basic(0x273c53);
  const black = basic(0x050912);
  const tex = (width, height, draw) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    draw(canvas.getContext('2d'), width, height);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    textures.add(texture); return texture;
  };
  const mesh = (shape, mat, x, y, z, sx, sy, sz = 1, parent = root) => {
    const value = new THREE.Mesh(shape, mat); value.position.set(x, y, z); value.scale.set(sx, sy, sz);
    parent.add(value); return value;
  };
  const glowMap = tex(128, 256, (ctx, w, h) => {
    ctx.scale(1, h / w);
    const gradient = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    gradient.addColorStop(0, '#ffffff'); gradient.addColorStop(0.3, '#ffffff66'); gradient.addColorStop(1, '#ffffff00');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, w);
  });
  const additive = (color, map, opacity) => material(new THREE.MeshBasicMaterial({ color, map,
    transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  const glow = (color, x, y, z, width, height) => {
    const value = new THREE.Sprite(material(new THREE.SpriteMaterial({ color, map: glowMap,
      transparent: true, opacity: settings.glowOpacity, blending: THREE.AdditiveBlending, depthWrite: false })));
    value.position.set(x, y, z); value.scale.set(width, height, 1); root.add(value); return value;
  };
  const reflectionMap = tex(128, 512, (ctx, w, h) => {
    for (let y = 0; y < h; y += 2) {
      const fade = Math.pow(Math.sin(Math.PI * y / h), 1.2);
      const width = 15 + noise(y + 80) * 70;
      const gradient = ctx.createLinearGradient(w / 2 - width / 2, 0, w / 2 + width / 2, 0);
      gradient.addColorStop(0, '#ffffff00'); gradient.addColorStop(0.5, '#ffffff'); gradient.addColorStop(1, '#ffffff00');
      ctx.globalAlpha = fade * (0.15 + noise(y + 190) * 0.75); ctx.fillStyle = gradient;
      ctx.fillRect(w / 2 - width / 2 + (noise(y + 250) - 0.5) * 15, y, width, 2);
    }
  });
  const asphaltMap = tex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#111827'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 15000; i++) {
      const v = 13 + Math.floor(noise(i + 1) * 20); ctx.fillStyle = `rgb(${v},${v + 5},${v + 11})`;
      ctx.fillRect(noise(i + 7) * w, noise(i + 29) * h, 1, noise(i + 43) * 3 + 1);
    }
  });
  asphaltMap.wrapS = asphaltMap.wrapT = THREE.RepeatWrapping; asphaltMap.repeat.set(6, 32);
  mesh(plane, material(new THREE.MeshBasicMaterial({ map: asphaltMap, color: 0x63708e })), 0, 0, -10, 30, 110).rotation.x = -Math.PI / 2;

  const batches = new Map();
  const blocks = (mat, x, y, z, sx, sy, sz) => {
    if (!batches.has(mat)) batches.set(mat, []);
    batches.get(mat).push([x, y, z, sx, sy, sz]);
  };
  const lineVertices = [];
  const line = (a, b) => lineVertices.push(...a, ...b);
  // Include the rear section from day one; all solids stay outside the walking width.
  for (const side of [-1, 1]) for (let i = 0; i < 10; i++) {
    const z = 24 - i * 7.5, height = 13 + noise(i + (side + 1) * 15) * 9;
    blocks(dark, side * 8.6, height / 2, z, 6, height, 7.3);
    blocks(shutter, side * 5.55, 2, z, 0.12, 3.8, 5.4);
    for (let row = 0; row < 19; row++) line([side * 5.46, 0.2 + row * 0.2, z - 2.7], [side * 5.46, 0.2 + row * 0.2, z + 2.7]);
    for (const edge of [-3.2, 3.2]) {
      blocks(steel, side * 5.15, 7, z + edge, 0.11, 14, 0.11);
      line([side * 5.07, 0, z + edge], [side * 5.07, 14, z + edge]);
    }
    for (let level = 0; level < 4; level++) {
      const y = 1 + level * 3.6;
      blocks(steel, side * 5.15, y, z, 0.12, 0.12, 6.5);
      line([side * 5.07, y, z - 3.2], [side * 5.07, y + 3.6, z + 3.2]);
      line([side * 5.07, y, z + 3.2], [side * 5.07, y + 3.6, z - 3.2]);
    }
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
      blocks(black, side * 5.54, 6 + row * 3.3, z - 2.2 + col * 2.2, 0.16, 1.5, 1.05);
      if (noise(i * 17 + row * 3 + col) > 0.82) blocks(steel, side * 5.43, 6 + row * 3.3, z - 2.2 + col * 2.2, 0.04, 1.1, 0.8);
    }
  }
  for (const z of [12, -10, -28]) {
    for (const y of [8.3, 9]) blocks(steel, 0, y, z, 11, 0.16, 0.18);
    for (let x = -5; x < 5; x += 1.25) line([x, 8.3, z], [x + 1.25, 9, z]);
  }
  for (let i = 0; i < 7; i++) {
    const z = 17 - i * 8;
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-5.4, 10 + i % 3, z),
      new THREE.Vector3(0, 6.2 + i % 3, z - 1.2), new THREE.Vector3(5.4, 10.5 + i % 3, z - 2));
    const points = curve.getPoints(24);
    for (let j = 1; j < points.length; j++) line(points[j - 1].toArray(), points[j].toArray());
  }
  const lineGeo = geometry(new THREE.BufferGeometry());
  lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(lineVertices, 3));
  root.add(new THREE.LineSegments(lineGeo, material(new THREE.LineBasicMaterial({ color: settings.rimColor,
    transparent: true, opacity: settings.rimOpacity }))));

  const signSpecs = [[-1, -3, 5.2, 0x4ee6fa], [1, -8, 4.8, 0xff6ebf],
    [-1, -17, 7.3, 0xff9862], [1, -24, 6.8, 0x65b9ff],
    [-1, 8, 4.6, 0x50dbef], [1, 13, 6, 0xae83ff]];
  const signs = [];
  const signTextures = new Map();
  const signTexture = (text, direction) => {
    const key = `${text}:${direction}`;
    if (signTextures.has(key)) return signTextures.get(key);
    const map = tex(128, 448, (ctx, w, h) => {
      ctx.fillStyle = '#081426'; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = '#a3c2cd'; ctx.lineWidth = 4;
      ctx.strokeRect(5, 5, w - 10, h - 10); ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const characters = [...text];
      const cellHeight = (h - 60) / Math.max(1, characters.length);
      const fontSize = Math.min(84, cellHeight * 0.86, w * 0.72);
      const mixedScript = /[가-힣ァ-ヺー]/u.test(text);
      ctx.font = `${mixedScript ? '900' : 'bold'} ${fontSize}px "Malgun Gothic", "Yu Gothic", "Meiryo", sans-serif`;
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = mixedScript ? 1.3 : 0;
      characters.forEach((character, i) => {
        ctx.save(); ctx.translate(w / 2, 30 + cellHeight * (i + 0.5));
        // Japanese prolonged sound marks turn upright in vertical writing.
        if (character === 'ー') ctx.rotate(Math.PI / 2);
        if (mixedScript) ctx.strokeText(character, 0, 0, w - 24);
        ctx.fillText(character, 0, 0, w - 24); ctx.restore();
      });
    });
    signTextures.set(key, map); return map;
  };
  signSpecs.forEach(([side, z, y, color], index) => {
    const text = String(settings.signTexts?.[index] ?? '');
    const type = ['both', 'frontOnly', 'backOnly'].includes(settings.signTypes?.[index])
      ? settings.signTypes[index] : 'both';
    const group = new THREE.Group(); group.position.set(side * 4.85, y, z); root.add(group);
    mesh(box, black, 0, 0, 0, 0.95, 3.4, 0.2, group);
    const faceMaterial = direction => material(new THREE.MeshBasicMaterial({ map: signTexture(text, direction),
      color: new THREE.Color(color).multiplyScalar(settings.signBrightness), side: THREE.FrontSide }));
    const face = mesh(plane, type === 'backOnly' ? black : faceMaterial('front'), 0, 0, 0.115, 0.85, 3.25, 1, group);
    const backFace = mesh(plane, type === 'frontOnly' ? black : faceMaterial('back'), 0, 0, -0.115, 0.85, 3.25, 1, group);
    // Turn the back plane outward so its own texture reads normally from -Z.
    backFace.rotation.y = Math.PI;
    const halo = glow(color, side * 4.65, y, z, 4, 7);
    const reflection = mesh(plane, additive(color, reflectionMap, settings.reflectionOpacity), side * 3.2, 0.014, z + 2, 2.8, 12);
    reflection.name = 'wet-overlay';
    reflection.rotation.x = -Math.PI / 2;
    signs.push({ group, face, backFace, type, text, halo, reflection, baseScale: group.scale.clone() });
  });
  for (let i = 0; i < 4; i++) {
    const pool = mesh(geometry(new THREE.CircleGeometry(1, 24)), additive(0x577399, glowMap, 0.12),
      (noise(i + 60) - 0.5) * 6, 0.008, 10 - i * 12, 1.5 + noise(i + 65), 3.1);
    pool.rotation.x = -Math.PI / 2;
    pool.name = 'wet-overlay';
  }
  const vendingMachine = new THREE.Group(); vendingMachine.position.set(5, 0, 3); root.add(vendingMachine);
  mesh(box, steel, 0, 1.3, 0, 0.8, 2.6, 1.3, vendingMachine);
  const vendingFace = mesh(box, basic(0x75d5ef), -0.42, 1.6, 0, 0.025, 1.65, 0.95, vendingMachine);
  for (let row = 0; row < 3; row++) for (let col = 0; col < 4; col++)
    mesh(box, dark, -0.445, 1.05 + row * 0.45, -0.33 + col * 0.22, 0.025, 0.27, 0.12, vendingMachine);
  mesh(box, black, -0.44, 0.4, 0, 0.03, 0.25, 0.7, vendingMachine);
  glow(0x65dfff, 4.55, 1.5, 3, 3, 4);
  const people = [];
  const umbrellaGeo = geometry(new THREE.ConeGeometry(0.95, 0.3, 16));
  const bodyGeo = geometry(new THREE.CylinderGeometry(0.17, 0.3, 0.95, 8));
  const headGeo = geometry(new THREE.SphereGeometry(0.16, 8, 6));
  for (const [x, z] of [[-2.5, -13], [2.6, -27]]) {
    const person = new THREE.Group(); person.position.set(x, 0, z); root.add(person);
    mesh(bodyGeo, black, 0, 0.97, 0, 1, 1, 1, person);
    mesh(headGeo, black, 0, 1.6, 0, 1, 1, 1, person);
    for (const dx of [-0.12, 0.12]) mesh(box, black, dx, 0.3, 0, 0.12, 0.6, 0.13, person);
    mesh(box, steel, 0.3, 1.5, 0, 0.025, 1, 0.025, person);
    mesh(umbrellaGeo, dark, 0.2, 2.06, 0, 1, 1, 1, person);
    const rim = mesh(geometry(new THREE.TorusGeometry(0.95, 0.012, 4, 32)), basic(0x438498), 0.2, 1.91, 0, 1, 1, 1, person);
    rim.rotation.x = Math.PI / 2; people.push(person);
  }
  for (const [mat, entries] of batches) {
    const batch = new THREE.InstancedMesh(box, mat, entries.length), transform = new THREE.Object3D();
    entries.forEach(([x, y, z, sx, sy, sz], i) => {
      transform.position.set(x, y, z); transform.scale.set(sx, sy, sz); transform.updateMatrix(); batch.setMatrixAt(i, transform.matrix);
    }); batch.computeBoundingSphere(); root.add(batch);
  }
  const count = settings.skylineCount;
  const skyline = new THREE.InstancedMesh(box, basic(0x9aaaff), count);
  const skylineGlow = new THREE.InstancedMesh(box, additive(0x506aff, null, 0.07), count);
  const handles = [], transform = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const x = -28 + 56 * i / count, z = -48 - noise(i + 710) * 10, height = 3 + noise(i + 800) * 21;
    transform.position.set(x, height / 2, z); transform.scale.set(0.11, height, 0.13); transform.updateMatrix(); skyline.setMatrixAt(i, transform.matrix);
    const color = new THREE.Color().setRGB(0.25 + noise(i) * 0.3, 0.3, 0.9); skyline.setColorAt(i, color);
    transform.scale.x = 0.65; transform.updateMatrix(); skylineGlow.setMatrixAt(i, transform.matrix);
    handles.push({ index: i, x, z, baseHeight: height, baseY: 0, color });
  }
  skyline.computeBoundingSphere(); skylineGlow.computeBoundingSphere(); root.add(skyline, skylineGlow);
  const rainVertices = [];
  for (let i = 0; i < 650; i++) {
    const x = (noise(i + 900) - 0.5) * 10, y = noise(i + 1800) * 14, z = 24 - noise(i + 2700) * 66;
    rainVertices.push(x, y, z, x - 0.035, y - 0.25 - noise(i + 3600) * 0.25, z);
  }
  const rainGeo = geometry(new THREE.BufferGeometry()); rainGeo.setAttribute('position', new THREE.Float32BufferAttribute(rainVertices, 3));
  const rain = new THREE.LineSegments(rainGeo, material(new THREE.LineBasicMaterial({ color: 0x7593bd,
    transparent: true, opacity: settings.rainStrength * 0.35, depthWrite: false })));
  rain.visible = settings.rainStrength > 0; root.add(rain);
  const exitGate = createExitGate('cyberpunk', colors, config.doors, config.exit); root.add(exitGate.root);
  let disposed = false;
  return { root, background: new THREE.Color(settings.fogColor), fog: new THREE.FogExp2(settings.fogColor, settings.fogDensity), exitGate,
    beatTargets: { bars: { mesh: skyline, glowMesh: skylineGlow, handles },
      objects: { signs, pulseSigns: signs.slice(0, 3), vendingMachine, vendingFace, people } }, rain,
    dispose() {
      if (disposed) return; disposed = true; root.removeFromParent(); exitGate.dispose();
      root.traverse(value => { if (value.isInstancedMesh) value.dispose(); });
      geometries.forEach(value => value.dispose()); materials.forEach(value => value.dispose()); textures.forEach(value => value.dispose()); root.clear();
    } };
}
