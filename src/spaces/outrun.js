import * as THREE from '../../vendor/three/three.module.min.js';
import { membraneTexture } from './outrun-membrane.js';

// Only the two door colors come from config; the remaining art palette lives here.
const ART = {
  floor: 0x281039, wallLow: 0x721046, wallHigh: 0x1b042c,
  ceilingHigh: 0x420059, ceilingMid: 0xd00b78, ceilingLow: 0xff6b32, fog: 0x941c58,
  silhouette: 0x0b0811, sunTop: '#ffdf78', sunBottom: '#ff6c92', lamp: 0xffbd62,
  hotPink: 0xff209e, hotCyan: 0x00f4ea, road: 0x160b27, rim: 0xff8a46,
  hillLow: 0x240938, hillHigh: 0x581552,
};
const ROOM = { radius: 34, height: 10.6, barCount: 280, barWidth: 0.36, glowWidth: 1.44 };
const noise = index => { const n = Math.sin(index * 127.1 + 311.7) * 43758.5453; return n - Math.floor(n); };

function canvasTexture(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function vertexGradient(geometry, low, high, minY, maxY, middle = null) {
  const position = geometry.getAttribute('position');
  const values = new Float32Array(position.count * 3);
  const a = new THREE.Color(low); const b = new THREE.Color(high); const color = new THREE.Color();
  const mid = middle === null ? null : new THREE.Color(middle);
  for (let i = 0; i < position.count; i++) {
    const t = THREE.MathUtils.clamp((position.getY(i) - minY) / (maxY - minY), 0, 1);
    if (mid) color.copy(t < 0.5 ? a : mid).lerp(t < 0.5 ? mid : b, t < 0.5 ? t * 2 : t * 2 - 1);
    else color.copy(a).lerp(b, t);
    color.toArray(values, i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(values, 3));
  return geometry;
}

function palmLeaves() {
  const vertices = []; const rimVertices = [];
  const add = (a, b, c) => vertices.push(...a, ...b, ...c);
  const rimAdd = (a, b, c) => rimVertices.push(...a, ...b, ...c);
  const segments = 32;
  for (let leaf = 0; leaf < 10; leaf++) {
    const angle = leaf * Math.PI * 2 / 10;
    const length = 2.8 + noise(leaf + 40) * 1.0;
    const left = []; const right = []; const rimInside = []; const rimOutside = [];
    for (let segment = 0; segment <= segments; segment++) {
      const t = segment / segments;
      const reach = length * t;
      const y = Math.sin(t * Math.PI) * 1.25 - t * t * 2.2;
      const width = Math.pow(Math.max(0, Math.sin(t * Math.PI)), 0.7) * 0.44;
      const x = Math.cos(angle) * reach; const z = Math.sin(angle) * reach;
      left.push([x - Math.sin(angle) * width, y, z + Math.cos(angle) * width]);
      right.push([x + Math.sin(angle) * width, y, z - Math.cos(angle) * width]);
      const sign = Math.cos(angle) >= 0 ? 1 : -1;
      rimInside.push([x + sign * Math.sin(angle) * width * 1.005, y, z - sign * Math.cos(angle) * width * 1.005]);
      rimOutside.push([x + sign * Math.sin(angle) * width * 1.04, y, z - sign * Math.cos(angle) * width * 1.04]);
    }
    for (let i = 0; i < segments; i++) {
      add(left[i], right[i], left[i + 1]);
      add(right[i], right[i + 1], left[i + 1]);
      rimAdd(rimInside[i], rimOutside[i], rimInside[i + 1]);
      rimAdd(rimOutside[i], rimOutside[i + 1], rimInside[i + 1]);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  const rimGeometry = new THREE.BufferGeometry();
  rimGeometry.setAttribute('position', new THREE.Float32BufferAttribute(rimVertices, 3));
  return { geometry, rimGeometry };
}

function createHills(neonPink) {
  const root = new THREE.Group(); root.name = 'geometric-hills';
  const vertices = []; const faceColors = []; const edges = []; const edgeColors = [];
  // Read-only ranges preserve the merged geometry and its original vertex order.
  const layers = [];
  const beginLayer = (side, order, count) => {
    const layer = { side, order, count, surfaceStart: vertices.length / 3, wireStart: edges.length / 3 };
    layers.push(layer); return layer;
  };
  const endLayer = layer => {
    layer.surfaceCount = vertices.length / 3 - layer.surfaceStart;
    layer.wireCount = edges.length / 3 - layer.wireStart;
    Object.freeze(layer);
  };
  const low = new THREE.Color(ART.hillLow); const high = new THREE.Color(ART.hillHigh);
  const color = new THREE.Color();
  const fitWall = point => {
    const r = Math.hypot(point[0], point[2]);
    if (r > 33.5) { point[0] *= 33.5 / r; point[2] *= 33.5 / r; }
    return point;
  };
  const mound = (a, b, z, height, shade) => {
    const points = [fitWall([a, 0, z + 1]), fitWall([b, 0, z + 1]),
      fitWall([b, 0, z - 1]), fitWall([a, 0, z - 1]), fitWall([(a + b) / 2, height, z - 0.25])];
    for (const face of [[0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]]) {
      for (const index of face) {
        vertices.push(...points[index]);
        color.copy(low).lerp(high, points[index][1] / height).multiplyScalar(shade);
        color.toArray(faceColors, faceColors.length);
      }
    }
    for (const [aIndex, bIndex] of [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [1, 4], [2, 4], [3, 4]]) {
      for (const index of [aIndex, bIndex]) {
        edges.push(...points[index]);
        neonPink.clone().multiplyScalar(shade * 0.7).toArray(edgeColors, edgeColors.length);
      }
    }
  };
  for (let layer = 0; layer < 4; layer++) {
    const range = beginLayer('front', layer, 4);
    const z = -23.2 - layer * 2.4;
    const inner = 10.2 - layer * 0.9;
    const outer = Math.sqrt(33.5 ** 2 - z ** 2) - 0.5;
    const count = layer < 2 ? 2 : 1;
    for (const sign of [-1, 1]) {
      for (let i = 0; i < count; i++) {
        const a = inner + (outer - inner) * i / count;
        const b = inner + (outer - inner) * (i + 1) / count;
        mound(sign * a, sign * b, z, 4.2 + layer * 1.8 + noise(i + layer * 7) * 0.4, 1 - layer * 0.18);
      }
    }
    endLayer(range);
  }
  const rearNear = beginLayer('rear', 0, 3);
  mound(-19, -9, 26.5, 3.6, 0.55); mound(10, 21, 25.6, 4.2, 0.5);
  endLayer(rearNear);
  // Rear layers stay outside the walking radius, lower and sparser than the front.
  const rearMiddle = beginLayer('rear', 1, 3);
  mound(-17, -8, 29.2, 4.6, 0.38); mound(8.5, 17.5, 28.6, 3.8, 0.36);
  endLayer(rearMiddle);
  const rearFar = beginLayer('rear', 2, 3);
  mound(-12, -5.8, 31.8, 5.2, 0.24); mound(6.4, 12.5, 31.2, 4.5, 0.23);
  endLayer(rearFar);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(faceColors, 3));
  geometry.computeVertexNormals();
  const surface = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  const edgeGeometry = new THREE.BufferGeometry();
  edgeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(edges, 3));
  edgeGeometry.setAttribute('color', new THREE.Float32BufferAttribute(edgeColors, 3));
  const wire = new THREE.LineSegments(edgeGeometry, new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  root.add(surface, wire); root.userData.beatParts = { surface, wire, layers: Object.freeze(layers) };
  root.userData.frontLayers = 4;
  root.userData.rearLayers = 3;
  return root;
}

export function createOutrunSpace(colors) {
  const root = new THREE.Group();
  root.name = 'outrun';
  const pink = new THREE.Color(colors[0]); const cyan = new THREE.Color(colors[1]);
  const neonPink = pink.clone().lerp(new THREE.Color(ART.hotPink), 0.7);
  const neonCyan = cyan.clone().lerp(new THREE.Color(ART.hotCyan), 0.6);
  const textures = new Set();
  const texture = (width, height, draw) => {
    const value = canvasTexture(width, height, draw); textures.add(value); return value;
  };
  const glow = texture(128, 128, (ctx, w, h) => {
    const gradient = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gradient.addColorStop(0, '#ffffffff'); gradient.addColorStop(0.2, '#ffffffc0');
    gradient.addColorStop(0.5, '#ffffff50'); gradient.addColorStop(0.8, '#ffffff0c');
    gradient.addColorStop(1, '#ffffff00');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h);
  });
  const barGlow = texture(64, 128, (ctx, w, h) => {
    const gradient = ctx.createLinearGradient(0, 0, w, 0);
    gradient.addColorStop(0, '#ffffff00'); gradient.addColorStop(0.2, '#ffffff1c');
    gradient.addColorStop(0.4, '#ffffff88'); gradient.addColorStop(0.5, '#ffffffd0');
    gradient.addColorStop(0.6, '#ffffff88'); gradient.addColorStop(0.8, '#ffffff1c');
    gradient.addColorStop(1, '#ffffff00');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'destination-in';
    const ends = ctx.createLinearGradient(0, 0, 0, h);
    ends.addColorStop(0, '#ffffff00'); ends.addColorStop(0.08, '#fff');
    ends.addColorStop(0.92, '#fff'); ends.addColorStop(1, '#ffffff00');
    ctx.fillStyle = ends; ctx.fillRect(0, 0, w, h);
  });
  const additive = (color, map = glow, opacity = 0.3) => new THREE.MeshBasicMaterial({
    color, map, transparent: true, opacity, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const luminous = (color, map = glow, opacity = 0.5) => {
    const material = additive(color, map, opacity); material.fog = false; return material;
  };
  const floor = new THREE.Mesh(new THREE.CircleGeometry(ROOM.radius + 0.5, 96),
    new THREE.MeshBasicMaterial({ color: ART.floor }));
  floor.rotation.x = -Math.PI / 2;
  root.add(floor);
  const gridTexture = texture(128, 128, (ctx, w, h) => {
    for (const [width, alpha] of [[18, 0.025], [10, 0.07], [4, 0.16], [1.4, 0.8]]) {
      ctx.strokeStyle = `rgba(255,255,255,${alpha})`; ctx.lineWidth = width;
      for (const edge of [0, w]) {
        ctx.beginPath(); ctx.moveTo(edge, 0); ctx.lineTo(edge, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, edge); ctx.lineTo(w, edge); ctx.stroke();
      }
    }
  });
  gridTexture.wrapS = gridTexture.wrapT = THREE.RepeatWrapping;
  gridTexture.repeat.set(34.5, 34.5);
  const gridMaterial = additive(neonPink.clone().lerp(new THREE.Color(0xffffff), 0.15), gridTexture, 1);
  // Static color lift toward the sunset; no frame update or audio input.
  gridMaterial.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGridWorld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGridWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vGridWorld;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= 1.0 + 0.8 * exp(-abs(vGridWorld.x) / 9.0) * smoothstep(0.0, 30.0, -vGridWorld.z);');
  };
  gridMaterial.customProgramCacheKey = () => 'outrun-sunset-grid';
  const grid = new THREE.Mesh(new THREE.CircleGeometry(ROOM.radius + 0.5, 96), gridMaterial);
  grid.rotation.x = -Math.PI / 2; grid.position.y = 0.012; root.add(grid);
  // Cheap reflected color pools, without a mirror camera or lighting pass.
  const poolGeometry = new THREE.PlaneGeometry(1, 1);
  const floorPool = (x, z, width, length, color, opacity) => {
    const pool = new THREE.Mesh(poolGeometry, additive(color, glow, opacity));
    pool.rotation.x = -Math.PI / 2; pool.position.set(x, 0.048, z); pool.scale.set(width, length, 1);
    root.add(pool); return pool;
  };
  const reflection = floorPool(0, -17, 6.8, 38, 0xff913e, 0.7);
  const reflectionWide = floorPool(0, -19, 14, 32, neonPink, 0.32);
  floorPool(-16, 0, 13, 38, neonPink, 0.22); floorPool(16, 0, 13, 38, neonPink, 0.22);

  const wallGeometry = vertexGradient(new THREE.CylinderGeometry(ROOM.radius + 0.3,
    ROOM.radius + 0.3, ROOM.height, 96, 12, true), ART.wallLow, ART.wallHigh, -ROOM.height / 2, ROOM.height / 2);
  const wall = new THREE.Mesh(wallGeometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide }));
  wall.position.y = ROOM.height / 2; root.add(wall);
  // Place the dome's equator at the wall tops, rather than across the room below them.
  const skyGeometry = new THREE.SphereGeometry(ROOM.radius + 0.3, 96, 24, 0, Math.PI * 2, 0, Math.PI / 2);
  vertexGradient(skyGeometry, ART.ceilingLow, ART.ceilingHigh, 0, 24, ART.ceilingMid);
  const sky = new THREE.Mesh(skyGeometry, new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false,
  }));
  sky.scale.y = 0.24; sky.position.y = ROOM.height; root.add(sky);

  const barMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), ROOM.barCount);
  const coreMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), ROOM.barCount);
  const glowMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), luminous(0xffffff, barGlow, 0.85), ROOM.barCount);
  barMesh.name = 'hanging-neon-bars'; glowMesh.name = 'hanging-neon-glows';
  coreMesh.name = 'hanging-neon-cores';
  barMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  coreMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  glowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const bars = { mesh: barMesh, coreMesh, glowMesh, count: ROOM.barCount, radius: ROOM.radius,
    width: ROOM.barWidth, coreWidth: ROOM.barWidth * 0.38, glowWidth: ROOM.glowWidth,
    depth: 0.15, coreDepth: 0.06, coreRadius: ROOM.radius - 0.13, glowRadius: ROOM.radius - 0.22,
    angles: new Float32Array(ROOM.barCount), positions: new Float32Array(ROOM.barCount * 3),
    topHeights: new Float32Array(ROOM.barCount), baseLengths: new Float32Array(ROOM.barCount),
    colors: new Float32Array(ROOM.barCount * 3), coreColors: new Float32Array(ROOM.barCount * 3),
    phase: new Float32Array(ROOM.barCount) };
  const transform = new THREE.Object3D();
  const white = new THREE.Color(0xffffff);
  for (let i = 0; i < ROOM.barCount; i++) {
    const angle = i / ROOM.barCount * Math.PI * 2;
    const top = ROOM.height - 0.12 - noise(i + 7) * 0.4;
    const length = ROOM.height * (0.4 + Math.sqrt(noise(i + 19)) * 0.45);
    const color = i % 5 < 3 ? neonPink : neonCyan;
    const coreColor = color.clone().lerp(white, 0.8);
    bars.angles[i] = angle; bars.topHeights[i] = top; bars.baseLengths[i] = length;
    bars.phase[i] = noise(i + 90) * Math.PI * 2; color.toArray(bars.colors, i * 3);
    coreColor.toArray(bars.coreColors, i * 3);
    bars.positions.set([Math.sin(angle) * ROOM.radius, top, Math.cos(angle) * ROOM.radius], i * 3);
    transform.position.set(bars.positions[i * 3], top - length / 2, bars.positions[i * 3 + 2]);
    transform.rotation.set(0, angle, 0); transform.scale.set(ROOM.barWidth, length, 0.15);
    transform.updateMatrix(); barMesh.setMatrixAt(i, transform.matrix); barMesh.setColorAt(i, color);
    transform.position.set(Math.sin(angle) * (ROOM.radius - 0.13), top - length / 2, Math.cos(angle) * (ROOM.radius - 0.13));
    transform.scale.set(bars.coreWidth, length, 0.06);
    transform.updateMatrix(); coreMesh.setMatrixAt(i, transform.matrix); coreMesh.setColorAt(i, coreColor);
    transform.position.set(Math.sin(angle) * (ROOM.radius - 0.22), top - length / 2, Math.cos(angle) * (ROOM.radius - 0.22));
    transform.rotation.y = angle + Math.PI; transform.scale.set(ROOM.glowWidth, length + 0.3, 1);
    transform.updateMatrix(); glowMesh.setMatrixAt(i, transform.matrix); glowMesh.setColorAt(i, color);
  }
  barMesh.computeBoundingSphere(); coreMesh.computeBoundingSphere(); glowMesh.computeBoundingSphere();
  barMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  coreMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  glowMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  root.add(barMesh, coreMesh, glowMesh);

  const hazeMap = texture(128, 64, (ctx, w, h) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, '#ffffff00'); gradient.addColorStop(0.35, '#ffffff50');
    gradient.addColorStop(0.65, '#ffffff90'); gradient.addColorStop(1, '#ffffff00');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'destination-in';
    const ends = ctx.createLinearGradient(0, 0, w, 0);
    ends.addColorStop(0, '#ffffff00'); ends.addColorStop(0.15, '#fff');
    ends.addColorStop(0.85, '#fff'); ends.addColorStop(1, '#ffffff00');
    ctx.fillStyle = ends; ctx.fillRect(0, 0, w, h);
  });
  const ringHazeMap = texture(16, 128, (ctx, w, h) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, '#ffffff00'); gradient.addColorStop(0.3, '#ffffff30');
    gradient.addColorStop(0.65, '#ffffff90'); gradient.addColorStop(1, '#ffffff00');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h);
  });
  const hazeRing = (name, y, height, color, opacity) => {
    const radius = ROOM.radius - 1;
    const material = luminous(color, ringHazeMap, opacity); material.side = THREE.BackSide;
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 128, 1, true), material);
    mesh.name = name;
    mesh.position.y = y; root.add(mesh); return mesh;
  };
  hazeRing('horizon-haze', 0.9, 4.6, neonPink, 0.6);
  hazeRing('ceiling-seam-haze', ROOM.height - 0.1, 2.8, 0xff4d83, 0.25);

  const sun = new THREE.Group(); sun.name = 'sun'; sun.position.set(0, 0, -31.6);
  const sunMap = texture(512, 512, (ctx, w, h) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, h / 2);
    gradient.addColorStop(0, ART.sunTop); gradient.addColorStop(1, ART.sunBottom);
    ctx.shadowColor = '#ffaf65'; ctx.shadowBlur = 20;
    ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - 10, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    for (const [y, gap] of [[170, 5], [196, 7], [222, 9], [247, 11]]) ctx.clearRect(0, y, w, gap);
  });
  const sunDisc = new THREE.Mesh(new THREE.PlaneGeometry(17, 17),
    new THREE.MeshBasicMaterial({ map: sunMap, transparent: true, alphaTest: 0.05, depthWrite: true, fog: false }));
  const sunHalo = new THREE.Mesh(new THREE.PlaneGeometry(32, 26), luminous(0xff7f52, glow, 0.8));
  sunHalo.position.set(0, 2, -0.04);
  const sunCorona = new THREE.Mesh(new THREE.PlaneGeometry(49, 33), luminous(neonPink, glow, 0.55));
  sunCorona.position.set(0, 2.2, -0.1);
  const frontHaze = new THREE.Mesh(new THREE.PlaneGeometry(62, 7), luminous(0xff743e, hazeMap, 0.35));
  frontHaze.position.set(0, 0.5, -29.5); root.add(frontHaze);
  sun.add(sunCorona, sunHalo, sunDisc); root.add(sun);
  sun.userData.beatParts = { disc: sunDisc, halo: sunHalo, corona: sunCorona };

  const highway = new THREE.Group(); highway.name = 'highway';
  const road = new THREE.Mesh(new THREE.PlaneGeometry(7.6, 32), new THREE.MeshBasicMaterial({ color: ART.road }));
  road.rotation.x = -Math.PI / 2; road.position.set(0, 0.03, -16); highway.add(road);
  const laneGeometry = new THREE.PlaneGeometry(1, 1);
  const roadEdges = new THREE.InstancedMesh(laneGeometry, new THREE.MeshBasicMaterial({ color: neonPink }), 2);
  const roadEdgeGlow = new THREE.InstancedMesh(laneGeometry, luminous(neonPink, barGlow, 0.65), 2);
  for (let i = 0; i < 2; i++) {
    transform.position.set(i === 0 ? -3.8 : 3.8, 0.065, -16);
    transform.rotation.set(-Math.PI / 2, 0, 0); transform.scale.set(0.065, 32, 1);
    transform.updateMatrix(); roadEdges.setMatrixAt(i, transform.matrix);
    transform.position.y = 0.07; transform.scale.x = 0.55; transform.updateMatrix();
    roadEdgeGlow.setMatrixAt(i, transform.matrix);
  }
  const dashes = new THREE.InstancedMesh(laneGeometry,
    new THREE.MeshBasicMaterial({ color: neonCyan.clone().lerp(white, 0.7) }), 7);
  for (let i = 0; i < 7; i++) {
    transform.position.set(0, 0.065, -1 - i * 5);
    transform.scale.set(0.16, 2, 1); transform.updateMatrix(); dashes.setMatrixAt(i, transform.matrix);
  }
  roadEdges.name = 'highway-edges'; roadEdgeGlow.name = 'highway-edge-glows'; dashes.name = 'highway-dashes';
  for (const mesh of [roadEdges, roadEdgeGlow, dashes]) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.computeBoundingSphere();
  }
  highway.add(roadEdges, roadEdgeGlow, dashes); root.add(highway);
  highway.userData.beatParts = { road, edges: roadEdges, edgeGlow: roadEdgeGlow, dashes, reflection, reflectionWide };
  // Keep the approved front meshes intact; append the positive-z half of the road.
  const rearRoad = road.clone(); rearRoad.position.z = 16;
  const rearEdges = new THREE.InstancedMesh(laneGeometry, roadEdges.material, 2);
  const rearEdgeGlow = new THREE.InstancedMesh(laneGeometry, roadEdgeGlow.material, 2);
  const rearDashes = new THREE.InstancedMesh(laneGeometry, dashes.material, 6);
  rearRoad.name = 'highway-rear-road'; rearEdges.name = 'highway-rear-edges';
  rearEdgeGlow.name = 'highway-rear-edge-glows'; rearDashes.name = 'highway-rear-dashes';
  for (let i = 0; i < 2; i++) {
    transform.position.set(i === 0 ? -3.8 : 3.8, 0.065, 16);
    transform.rotation.set(-Math.PI / 2, 0, 0); transform.scale.set(0.065, 32, 1);
    transform.updateMatrix(); rearEdges.setMatrixAt(i, transform.matrix);
    transform.position.y = 0.07; transform.scale.x = 0.55; transform.updateMatrix();
    rearEdgeGlow.setMatrixAt(i, transform.matrix);
  }
  for (let i = 0; i < 6; i++) {
    transform.position.set(0, 0.065, 4 + i * 5); transform.scale.set(0.16, 2, 1);
    transform.updateMatrix(); rearDashes.setMatrixAt(i, transform.matrix);
  }
  for (const mesh of [rearEdges, rearEdgeGlow, rearDashes]) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.computeBoundingSphere();
  }
  highway.add(rearRoad, rearEdges, rearEdgeGlow, rearDashes);
  highway.userData.beatParts.rear = { road: rearRoad, edges: rearEdges, edgeGlow: rearEdgeGlow, dashes: rearDashes };
  const hills = createHills(neonPink); root.add(hills);

  const black = new THREE.MeshBasicMaterial({ color: ART.silhouette, side: THREE.DoubleSide });
  const poleGeometry = new THREE.CylinderGeometry(0.07, 0.11, 1, 10);
  const baseGeometry = new THREE.CylinderGeometry(0.23, 0.28, 0.3, 10);
  const capGeometry = new THREE.CylinderGeometry(0.72, 0.64, 0.16, 24);
  const lampGeometry = new THREE.CylinderGeometry(0.63, 0.63, 0.06, 24);
  const lampMaterial = new THREE.MeshBasicMaterial({ color: ART.lamp });
  const lampHaloMaterial = new THREE.SpriteMaterial({ color: ART.lamp, map: glow,
    transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const lamps = [];
  for (const [i, [x, z, height]] of [[-5.5, -12, 5.6], [5.5, -12.8, 5.4], [-5.5, -21, 4.7],
    [5.5, -21.8, 4.5], [-5.5, -30, 4.1], [5.5, -30.8, 4.0],
    [-5.5, 10, 5.1], [5.5, 10.8, 5.3], [-5.5, 19, 4.5], [5.5, 19.8, 4.3],
    [-5.5, 28, 3.8], [5.5, 28.8, 4.0]].entries()) {
    const lamp = new THREE.Group(); lamp.name = `lamp-${i}`; lamp.position.set(x, 0, z);
    const pole = new THREE.Mesh(poleGeometry, black); pole.scale.y = height; pole.position.y = height / 2;
    const base = new THREE.Mesh(baseGeometry, black); base.position.y = 0.15;
    const cap = new THREE.Mesh(capGeometry, black); cap.position.y = height;
    const disc = new THREE.Mesh(lampGeometry, lampMaterial); disc.position.y = height - 0.12;
    const halo = new THREE.Sprite(lampHaloMaterial); halo.position.y = height - 0.14; halo.scale.set(5.4, 3.6, 1);
    lamp.add(pole, base, cap, disc, halo); lamp.userData.beatParts = { disc, halo };
    root.add(lamp); lamps.push(lamp);
    floorPool(x, z, 5, 9, ART.lamp, 0.24);
  }
  const leafParts = palmLeaves(); const leavesGeometry = leafParts.geometry; const palms = [];
  const rimMaterial = new THREE.MeshBasicMaterial({ color: ART.rim, transparent: true,
    opacity: 0.16, side: THREE.DoubleSide, depthWrite: false });
  for (const [i, [x, z, height, bend]] of [[-15, -16, 6.8, 0.8], [15.5, -17, 7.0, -0.7],
    [-18, -24, 6.1, 0.55], [18, -25, 6.5, -0.8], [-13, 26, 6.0, 0.8], [14, 25, 6.2, -0.9],
    [-11.8, 12.5, 5.5, -0.6], [13.4, 14.8, 5.9, 0.7], [-20.5, 22, 4.8, 0.5]].entries()) {
    const palm = new THREE.Group(); palm.name = `palm-${i}`; palm.position.set(x, 0, z);
    palm.scale.setScalar(1.3);
    const curve = new THREE.CubicBezierCurve3(new THREE.Vector3(), new THREE.Vector3(bend * 0.12, height * 0.35, 0),
      new THREE.Vector3(bend * 0.55, height * 0.8, 0), new THREE.Vector3(bend, height, 0));
    const trunk = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 0.16, 8, false), black);
    const leaves = new THREE.Mesh(leavesGeometry, black); leaves.position.set(bend, height, 0); leaves.rotation.y = i * 0.71;
    const trunkRim = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 0.18, 8, false), rimMaterial);
    trunkRim.position.z = -0.04;
    const leavesRim = new THREE.Mesh(leafParts.rimGeometry, rimMaterial); leavesRim.position.copy(leaves.position);
    leavesRim.rotation.copy(leaves.rotation);
    palm.add(trunkRim, leavesRim, trunk, leaves); palm.userData.beatParts = { trunk, leaves, trunkRim, leavesRim };
    root.add(palm); palms.push(palm);
  }
  const gate = new THREE.Group(); gate.name = 'rear-gate';
  gate.position.set(0, 0, 27.5); gate.rotation.y = Math.PI;
  const gateWidth = 8.4; const gateHeight = 7.8;
  const frameGeometry = new THREE.BoxGeometry(1, 1, 0.18);
  const frameParts = new THREE.InstancedMesh(frameGeometry, new THREE.MeshBasicMaterial({ color: white, fog: false }), 12);
  const frameCores = new THREE.InstancedMesh(frameGeometry, new THREE.MeshBasicMaterial({ color: white, fog: false }), 12);
  const gateGlows = new THREE.InstancedMesh(laneGeometry, luminous(white, barGlow, 0.75), 12);
  frameParts.name = 'rear-gate-frames'; frameCores.name = 'rear-gate-cores'; gateGlows.name = 'rear-gate-glows';
  let gateBarIndex = 0;
  const gateBar = (x, y, width, height, side, depth, strength) => {
    const color = side ? neonCyan : neonPink;
    transform.rotation.set(0, 0, 0); transform.position.set(x, y, depth); transform.scale.set(width, height, 1);
    transform.updateMatrix(); frameParts.setMatrixAt(gateBarIndex, transform.matrix); frameParts.setColorAt(gateBarIndex, color);
    transform.position.z = depth + 0.1; transform.scale.set(width * 0.34, height, 0.2);
    transform.updateMatrix(); frameCores.setMatrixAt(gateBarIndex, transform.matrix);
    frameCores.setColorAt(gateBarIndex, color.clone().lerp(white, 0.8));
    transform.position.z = depth + 0.13;
    if (width > height) { transform.rotation.z = Math.PI / 2; transform.scale.set(height * 7 * strength, width + 0.6, 1); }
    else transform.scale.set(width * 7 * strength, height + 0.6, 1);
    transform.updateMatrix(); gateGlows.setMatrixAt(gateBarIndex, transform.matrix); gateGlows.setColorAt(gateBarIndex, color);
    gateBarIndex++;
  };
  // Nested static frames and a receding floor suggest a passage beyond the mist.
  for (const [depth, width, height, thickness] of [[0, gateWidth, gateHeight, 0.18], [-2.1, 7.9, 7.5, 0.09], [-4.4, 7.4, 7.2, 0.065]]) {
    for (const side of [0, 1]) {
      gateBar((side ? 1 : -1) * width / 2, height / 2, thickness, height, side, depth, depth === 0 ? 1 : 0.65);
      gateBar((side ? 1 : -1) * width / 4, height, width / 2, thickness, side, depth, depth === 0 ? 1 : 0.65);
    }
  }
  for (const mesh of [frameParts, frameCores, gateGlows]) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.computeBoundingSphere(); gate.add(mesh);
  }
  const mist = membraneTexture(pink, cyan, 1); textures.add(mist);
  const membrane = new THREE.Mesh(new THREE.PlaneGeometry(gateWidth - 0.18, gateHeight - 0.18),
    new THREE.MeshBasicMaterial({ map: mist, transparent: true, opacity: 0.48, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  membrane.name = 'rear-gate-membrane'; membrane.position.set(0, gateHeight / 2, 0.02); gate.add(membrane);
  const passageMap = texture(256, 256, (ctx, w, h) => {
    const gradient = ctx.createRadialGradient(w / 2, h * 0.56, 2, w / 2, h * 0.56, w * 0.72);
    gradient.addColorStop(0, '#030518'); gradient.addColorStop(1, '#32103e');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h);
    const vanish = [w / 2, h * 0.56];
    ctx.lineWidth = 1;
    for (const [side, color] of [[0, '#ff329c'], [1, '#27dbdc']]) {
      ctx.strokeStyle = color;
      for (const bottom of [h, h * 0.89, h * 0.76, h * 0.65]) {
        const t = (bottom - vanish[1]) / (h - vanish[1]);
        const half = w * 0.47 * t;
        ctx.globalAlpha = t * 0.52;
        ctx.strokeRect(vanish[0] - half, vanish[1] * (1 - t), half * 2, bottom - vanish[1] * (1 - t));
      }
      ctx.globalAlpha = 0.65; ctx.beginPath(); ctx.moveTo(vanish[0], vanish[1]);
      ctx.lineTo(side ? w : 0, h); ctx.stroke();
    }
    ctx.globalAlpha = 0.5; ctx.strokeStyle = '#b1ffef'; ctx.setLineDash([5, 9]);
    ctx.beginPath(); ctx.moveTo(...vanish); ctx.lineTo(w / 2, h); ctx.stroke();
  });
  const passage = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 7.4),
    new THREE.MeshBasicMaterial({ map: passageMap, fog: false }));
  passage.position.set(0, 3.7, -5.5); gate.add(passage);
  const gateReflection = floorPool(0, 27, 8.8, 10, neonPink, 0.24);
  gate.userData.beatParts = { frames: frameParts, cores: frameCores, glows: gateGlows, membrane, passage, reflection: gateReflection };
  gate.userData.visualOnly = true; root.add(gate);

  const props = [];
  for (const [i, [x, z, height, pyramid]] of [[-14, 3, 1.9, true], [-21, 11, 1.5, false],
    [15, 4, 1.6, false], [22, 13, 2.2, true]].entries()) {
    const prop = new THREE.Group(); prop.name = `neon-prop-${i}`; prop.position.set(x, 0, z);
    prop.rotation.y = i * 0.43 + 0.2;
    const geometry = pyramid ? new THREE.ConeGeometry(1.55, height, 4) : new THREE.BoxGeometry(2.1, height, 2.1);
    const surface = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: ART.hillLow }));
    surface.position.y = height / 2;
    const wire = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({
      color: i % 2 ? neonCyan : neonPink, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    wire.position.copy(surface.position);
    const pool = floorPool(x, z, 5, 4, i % 2 ? neonCyan : neonPink, 0.2);
    prop.add(surface, wire); prop.userData.beatParts = { surface, wire, reflection: pool };
    root.add(prop); props.push(prop);
  }
  let disposed = false;
  return { root, background: new THREE.Color(ART.ceilingHigh), fog: new THREE.FogExp2(ART.fog, 0.017),
    beatTargets: { bars, objects: { sun, lamps, palms, highway, hills, gate, props } },
    dispose() {
      if (disposed) return;
      disposed = true; root.removeFromParent();
      const geometries = new Set(); const materials = new Set();
      root.traverse(object => {
        // Sprite's quad belongs to THREE globally, not to this space.
        if (object.geometry && !object.isSprite) geometries.add(object.geometry);
        if (object.material) {
          const list = Array.isArray(object.material) ? object.material : [object.material];
          list.forEach(material => materials.add(material));
        }
        if (object.isInstancedMesh) object.dispose();
      });
      geometries.forEach(geometry => geometry.dispose());
      materials.forEach(material => material.dispose());
      textures.forEach(value => value.dispose());
      root.clear();
    } };
}
