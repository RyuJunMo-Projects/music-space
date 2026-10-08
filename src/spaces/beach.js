import * as THREE from '../../vendor/three/three.module.min.js';
import { config } from '../config.js';
import { createExitGate } from '../exit-gate.js';
import { createBeachResort } from './beach-resort.js';

const noise = i => { const n = Math.sin(i * 127.1 + 311.7) * 43758.5453; return n - Math.floor(n); };
const smooth = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

// Static scenery. Wave matrices and separate object materials are reserved for 10-B/C.
export function createBeachSpace(colors) {
  const s = config.spaces.beach, root = new THREE.Group(); root.name = 'daylight-beach';
  const geometries = new Set(), materials = new Set(), textures = new Set();
  const geometry = value => { geometries.add(value); return value; };
  const material = value => { materials.add(value); return value; };
  const basic = (color, options = {}) => material(new THREE.MeshBasicMaterial({ color, ...options }));
  const lit = (color, options = {}) => material(new THREE.MeshLambertMaterial({ color, ...options }));
  const mesh = (shape, mat, parent = root) => { const value = new THREE.Mesh(shape, mat); parent.add(value); return value; };
  const tex = (size, draw) => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
    draw(canvas.getContext('2d'), size);
    const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
    textures.add(map); return map;
  };
  const shoreline = x => s.shoreZ + s.shoreCurve * Math.sin(x * 0.055) + 0.35 * Math.sin(x * 0.16);
  const heightAt = (x, z) => {
    const side = smooth((Math.abs(x) - (s.bounds.maxX - 3)) / s.duneSlopeWidth);
    const rear = smooth((z - (s.bounds.maxZ - 4)) / s.duneSlopeWidth);
    const variation = 0.8 + 0.18 * Math.sin(z * 0.12 + x * 0.06) + 0.12 * Math.sin(x * 0.17);
    return s.duneHeight * Math.max(side, rear) * variation;
  };
  root.add(new THREE.AmbientLight(0xf4f5e9, s.ambientIntensity));
  const daylight = new THREE.DirectionalLight(0xfff1db, s.sunlightIntensity); daylight.position.set(-35, 65, -45); root.add(daylight);

  // A sky color pass has no enclosing world geometry, dome, or visible wall.
  const skyMaterial = material(new THREE.ShaderMaterial({ depthWrite: false, depthTest: false, fog: false,
    uniforms: { projectionInverse: { value: new THREE.Matrix4() }, cameraWorld: { value: new THREE.Matrix4() },
      horizon: { value: new THREE.Color(s.skyHorizon) }, zenith: { value: new THREE.Color(s.skyTop) } },
    vertexShader: `uniform mat4 projectionInverse; uniform mat4 cameraWorld; varying vec3 direction;
      void main(){vec4 ray=projectionInverse*vec4(position.xy,1.0,1.0);
        direction=(cameraWorld*vec4(ray.xyz/ray.w,0.0)).xyz;gl_Position=vec4(position.xy,1.0,1.0);}`,
    fragmentShader: `uniform vec3 horizon; uniform vec3 zenith; varying vec3 direction;
      void main(){float altitude=clamp(normalize(direction).y,0.0,1.0);
        gl_FragColor=vec4(mix(horizon,zenith,pow(altitude,0.55)),1.0);
        #include <colorspace_fragment>
      }` }));
  const sky = mesh(geometry(new THREE.PlaneGeometry(2, 2)), skyMaterial);
  sky.name = 'open-sky'; sky.frustumCulled = false; sky.renderOrder = -1000;
  sky.onBeforeRender = (_renderer, _scene, camera) => {
    skyMaterial.uniforms.projectionInverse.value.copy(camera.projectionMatrixInverse);
    skyMaterial.uniforms.cameraWorld.value.copy(camera.matrixWorld);
  };

  const sandMap = tex(64, (ctx, size) => {
    ctx.fillStyle = '#f4f1e8'; ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 520; i++) {
      const v = 232 + Math.floor(noise(i) * 20); ctx.fillStyle = `rgb(${v},${v},${v - 4})`;
      ctx.fillRect(noise(i + 27) * size, noise(i + 78) * size, 1, 1);
    }
  });
  sandMap.wrapS = sandMap.wrapT = THREE.RepeatWrapping; sandMap.repeat.set(65, 53);
  const sand = geometry(new THREE.PlaneGeometry(s.sandWidth, s.sandDepth, 80, 65));
  sand.rotateX(-Math.PI / 2); sand.translate(0, 0, s.shoreZ + s.sandDepth / 2);
  const sandPositions = sand.attributes.position, sandColors = [], dry = new THREE.Color(s.sandColor), wet = new THREE.Color(s.wetSandColor), color = new THREE.Color();
  for (let i = 0; i < sandPositions.count; i++) {
    const x = sandPositions.getX(i), z = sandPositions.getZ(i), edge = shoreline(x);
    const landZ = edge + (z - s.shoreZ);
    sandPositions.setXYZ(i, x, heightAt(x, landZ), landZ);
    color.copy(wet).lerp(dry, smooth((landZ - edge) / 4)); sandColors.push(color.r, color.g, color.b);
  }
  sand.setAttribute('color', new THREE.Float32BufferAttribute(sandColors, 3)); sand.computeVertexNormals();
  const beach = mesh(sand, lit(0xffffff, { vertexColors: true, map: sandMap, flatShading: true })); beach.name = 'sand-and-dunes';

  const ocean = geometry(new THREE.PlaneGeometry(s.seaWidth, s.seaDepth, 96, 32));
  ocean.rotateX(-Math.PI / 2); ocean.translate(0, -0.045, s.shoreZ - s.seaDepth / 2);
  const oceanPositions = ocean.attributes.position, oceanColors = [], shallow = new THREE.Color(s.waterNear), deep = new THREE.Color(s.waterFar);
  for (let i = 0; i < oceanPositions.count; i++) {
    const x = oceanPositions.getX(i), z = oceanPositions.getZ(i), edge = shoreline(x), distance = s.shoreZ - z;
    oceanPositions.setZ(i, edge - distance);
    color.copy(shallow).lerp(deep, smooth(distance / 125)).multiplyScalar(0.97 + 0.03 * Math.sin(x * 0.045 + distance * 0.1));
    oceanColors.push(color.r, color.g, color.b);
  }
  ocean.setAttribute('color', new THREE.Float32BufferAttribute(oceanColors, 3));
  const water = mesh(ocean, basic(0xffffff, { vertexColors: true })); water.name = 'still-sea';
  const rippleVertices = [];
  for (let i = 0; i < 180; i++) {
    const x = (noise(i + 2000) - 0.5) * 145, z = s.shoreZ - 3 - noise(i + 2100) * 105;
    const width = 0.45 + noise(i + 2200) * 2.8;
    rippleVertices.push(x - width / 2, -0.015, z, x, -0.015, z - 0.05,
      x, -0.015, z - 0.05, x + width / 2, -0.015, z);
  }
  const rippleShape = geometry(new THREE.BufferGeometry()); rippleShape.setAttribute('position', new THREE.Float32BufferAttribute(rippleVertices, 3));
  const ripples = new THREE.LineSegments(rippleShape, material(new THREE.LineBasicMaterial({ color: s.foamColor,
    transparent: true, opacity: s.waterRippleOpacity, depthWrite: false }))); ripples.name = 'still-water-ripples'; root.add(ripples);
  const foamVertices = [];
  for (let layer = 0; layer < 3; layer++) for (let i = 0; i < 160; i++) {
    const x = -s.sandWidth / 2 + s.sandWidth * i / 160, next = x + s.sandWidth / 160;
    const offset = -layer * 1.05, width = layer === 0 ? 0.65 : 0.12;
    const a = shoreline(x) + offset + 0.12 * Math.sin(x * 0.8 + layer), b = shoreline(next) + offset + 0.12 * Math.sin(next * 0.8 + layer);
    foamVertices.push(x, 0.012, a, next, 0.012, b, next, 0.012, b - width,
      x, 0.012, a, next, 0.012, b - width, x, 0.012, a - width);
  }
  const foam = geometry(new THREE.BufferGeometry()); foam.setAttribute('position', new THREE.Float32BufferAttribute(foamVertices, 3));
  mesh(foam, basic(s.foamColor, { side: THREE.DoubleSide })).name = 'shore-foam';

  const transform = new THREE.Object3D(), rockShape = geometry(new THREE.DodecahedronGeometry(1, 0));
  const rocks = new THREE.InstancedMesh(rockShape, lit(s.rockColor, { flatShading: true }), 38);
  for (let i = 0; i < 38; i++) {
    const side = i < 24 ? (i % 2 ? -1 : 1) : 0;
    const x = side ? side * (18 + noise(i + 101) * 13) : -30 + (i - 24) * 4.7;
    const z = side ? -15 + Math.floor(i / 2) * 5.7 : 26 + noise(i + 200) * 10;
    transform.position.set(x, heightAt(x, z) + 0.35, z);
    transform.rotation.set(noise(i) * 0.4, noise(i + 4) * Math.PI, 0);
    transform.scale.set(1.3 + noise(i + 7) * 1.6, 0.8 + noise(i + 8) * 0.7, 1.1 + noise(i + 9) * 1.4);
    transform.updateMatrix(); rocks.setMatrixAt(i, transform.matrix);
    color.setScalar(0.86 + 0.14 * noise(i + 55)); rocks.setColorAt(i, color);
  }
  rocks.name = 'dune-rocks'; rocks.computeBoundingSphere(); root.add(rocks);
  const grassShape = geometry(new THREE.ConeGeometry(1, 1, 3));
  const grass = new THREE.InstancedMesh(grassShape, lit(s.grassColor, { flatShading: true }), 360);
  for (let i = 0; i < 360; i++) {
    const cluster = Math.floor(i / 3), side = cluster < 80 ? (cluster % 2 ? -1 : 1) : 0;
    const x = (side ? side * (16.9 + noise(cluster + 300) * 22) : (noise(cluster + 400) - 0.5) * 78) + (i % 3 - 1) * 0.18;
    const z = side ? -18 + noise(cluster + 500) * 84 : 25 + noise(cluster + 600) * 34;
    const height = 0.35 + noise(i + 800) * 0.5;
    transform.position.set(x, heightAt(x, z) + height / 2 - 0.05, z);
    transform.rotation.set(0, noise(i) * Math.PI, (noise(i + 70) - 0.5) * 0.3);
    transform.scale.set(0.12, height, 0.15); transform.updateMatrix(); grass.setMatrixAt(i, transform.matrix);
    color.setScalar(0.8 + 0.2 * noise(i + 90)); grass.setColorAt(i, color);
  }
  grass.name = 'dune-grass'; grass.computeBoundingSphere(); root.add(grass);

  const waveShape = geometry(new THREE.BoxGeometry(1, 1, 1));
  for (let i = 0; i < waveShape.attributes.position.count; i++) {
    if (waveShape.attributes.position.getY(i) > 0) waveShape.attributes.position.setZ(i, waveShape.attributes.position.getZ(i) * 0.35);
  }
  waveShape.setAttribute('crestBrightness', new THREE.InstancedBufferAttribute(new Float32Array(s.waveCount).fill(1), 1));
  const waveMaterial = basic(0xffffff);
  waveMaterial.onBeforeCompile = shader => {
    shader.uniforms.lowerWaterColor = { value: new THREE.Color(s.waterNear) };
    shader.vertexShader = shader.vertexShader.replace('#include <common>',
      '#include <common>\nattribute float crestBrightness; varying float crestGain; varying float crestWeight;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ncrestGain=crestBrightness; crestWeight=smoothstep(0.0,0.8,position.y+0.5);');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
      '#include <common>\nuniform vec3 lowerWaterColor; varying float crestGain; varying float crestWeight;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb=mix(lowerWaterColor,diffuseColor.rgb*crestGain,crestWeight);');
  };
  waveMaterial.customProgramCacheKey = () => 'beach-crest-gradient';
  const waveMesh = new THREE.InstancedMesh(waveShape, waveMaterial, s.waveCount), handles = [];
  const wavesPerRow = Math.ceil(s.waveCount / s.waveRows.length), blue = new THREE.Color(s.waveColors[0]), white = new THREE.Color(s.waveColors[1]);
  for (let i = 0; i < s.waveCount; i++) {
    const row = Math.floor(i / wavesPerRow), column = i % wavesPerRow;
    const x = -s.waveSpan / 2 + s.waveSpan * column / (wavesPerRow - 1 || 1), z = s.waveRows[row] + 1.2 * Math.sin(x * 0.1 + row * 1.5);
    const height = s.waveBaseHeight + s.waveHeight * (0.5 + 0.5 * Math.sin(x * 0.18 + row * 1.7));
    transform.position.set(x, height / 2 - 0.025, z); transform.rotation.set(0, 0, 0);
    transform.scale.set(s.waveWidth, height, s.waveDepth); transform.updateMatrix(); waveMesh.setMatrixAt(i, transform.matrix);
    color.copy(blue).lerp(white, 0.25 + 0.65 * noise(i + 1700)); waveMesh.setColorAt(i, color);
    handles.push({ index: i, row, column, x, z, baseY: -0.025, baseHeight: height, width: s.waveWidth, depth: s.waveDepth, color: color.clone() });
  }
  waveMesh.name = 'wave-bars'; waveMesh.computeBoundingSphere(); root.add(waveMesh);
  const waveBars = { mesh: waveMesh, handles, crestBrightness: waveShape.attributes.crestBrightness };

  const poleShape = geometry(new THREE.CylinderGeometry(0.045, 0.055, 1, 8)), shadowShape = geometry(new THREE.CircleGeometry(1, 24));
  const shadows = new THREE.InstancedMesh(shadowShape, basic(0x747a70, { transparent: true, opacity: 0.13, depthWrite: false }), s.parasols.length + s.balls.length);
  const parasols = [], balls = []; let shadowIndex = 0;
  const shadow = (x, z, radius, stretch) => {
    transform.position.set(x + radius * 0.25, 0.018, z + radius * 0.4); transform.rotation.set(-Math.PI / 2, 0, 0);
    transform.scale.set(radius, radius * stretch, 1); transform.updateMatrix(); shadows.setMatrixAt(shadowIndex++, transform.matrix);
  };
  for (const spec of s.parasols) {
    const parasol = new THREE.Group(); parasol.position.set(spec.x, 0, spec.z); root.add(parasol);
    const vertices = [], shades = [], colored = new THREE.Color(spec.color), cream = new THREE.Color(0xf1eadb);
    for (let sector = 0; sector < 12; sector++) {
      const a = sector / 12 * Math.PI * 2, b = (sector + 1) / 12 * Math.PI * 2;
      for (let ring = 0; ring < 3; ring++) {
        const radius = [0, 0.6, 1, 1.035], y = [0.55, 0.33, 0, -0.10];
        const point = (angle, r) => [Math.cos(angle) * spec.radius * radius[r], y[r], Math.sin(angle) * spec.radius * radius[r]];
        const p = point(a, ring), q = point(b, ring), r = point(b, ring + 1), t = point(a, ring + 1);
        const points = ring === 0 ? [p, r, t] : [p, q, r, p, r, t];
        color.copy(sector % 2 ? cream : colored);
        for (const value of points) { vertices.push(...value); shades.push(color.r, color.g, color.b); }
      }
    }
    const canopyShape = geometry(new THREE.BufferGeometry()); canopyShape.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    canopyShape.setAttribute('color', new THREE.Float32BufferAttribute(shades, 3)); canopyShape.computeVertexNormals();
    const canopy = mesh(canopyShape, lit(0xffffff, { vertexColors: true, side: THREE.DoubleSide, flatShading: true }), parasol); canopy.position.y = spec.height;
    const pole = mesh(poleShape, lit(0xb29b7b), parasol); pole.position.y = spec.height / 2; pole.scale.y = spec.height;
    parasol.userData.beatParts = { canopy, pole }; parasol.name = 'parasol'; parasols.push(parasol); shadow(spec.x, spec.z, spec.radius, 0.75);
  }
  const ballShape = geometry(new THREE.SphereGeometry(1, 18, 10).toNonIndexed()), ballPositions = ballShape.attributes.position, ballColors = [];
  for (let i = 0; i < ballPositions.count; i += 3) {
    let x = 0, z = 0; for (let j = 0; j < 3; j++) { x += ballPositions.getX(i + j); z += ballPositions.getZ(i + j); }
    const stripe = Math.floor((Math.atan2(z, x) + Math.PI) / (Math.PI * 2) * s.ballColors.length) % s.ballColors.length;
    color.set(s.ballColors[stripe]); for (let j = 0; j < 3; j++) ballColors.push(color.r, color.g, color.b);
  }
  ballShape.setAttribute('color', new THREE.Float32BufferAttribute(ballColors, 3));
  for (const spec of s.balls) {
    const ball = mesh(ballShape, lit(0xffffff, { vertexColors: true, flatShading: true })); ball.position.set(spec.x, spec.radius * 0.95, spec.z);
    ball.scale.setScalar(spec.radius); ball.rotation.set(0.15, noise(balls.length + 33) * Math.PI, 0.25);
    ball.name = 'beach-ball'; balls.push(ball); shadow(spec.x, spec.z, spec.radius * 1.15, 0.7);
  }
  shadows.name = 'still-sand-shadows'; shadows.computeBoundingSphere(); root.add(shadows);

  const haloMap = tex(64, (ctx, size) => {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, '#ffffff66'); g.addColorStop(1, '#ffffff00'); ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  });
  const sun = new THREE.Group(); sun.position.set(s.sun.x, s.sun.y, s.sun.z); sun.name = 'day-sun'; root.add(sun);
  const sunDisc = mesh(geometry(new THREE.CircleGeometry(s.sun.radius, 32)), basic(s.sun.color, { fog: false, side: THREE.DoubleSide }), sun);
  sunDisc.lookAt(0, config.player.eyeHeight, 0);
  const sunHalo = new THREE.Sprite(material(new THREE.SpriteMaterial({ map: haloMap, color: s.sun.color, opacity: s.sun.haloOpacity, transparent: true, depthWrite: false, fog: false })));
  sunHalo.scale.setScalar(s.sun.radius * 5); sun.add(sunHalo); sun.userData.beatParts = { disc: sunDisc, halo: sunHalo };
  const cloudMap = tex(64, (ctx, size) => {
    ctx.fillStyle = '#ffffff'; ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 3;
    for (const [x, y, rx, ry] of [[.22,.58,.18,.14],[.4,.45,.2,.22],[.63,.5,.2,.18],[.79,.59,.14,.12]]) {
      ctx.beginPath(); ctx.ellipse(x * size, y * size, rx * size, ry * size, 0, 0, Math.PI * 2); ctx.fill();
    }
  });
  const cloudMaterial = material(new THREE.SpriteMaterial({ map: cloudMap, color: 0xf0f1e6, transparent: true, opacity: 0.68, depthWrite: false, fog: false }));
  for (const [x, y, z, width, height] of s.clouds) {
    const cloud = new THREE.Sprite(cloudMaterial); cloud.position.set(x, y, z); cloud.scale.set(width, height, 1); root.add(cloud);
  }
  const resort = createBeachResort(s.resort, heightAt); root.add(resort.root);
  const exitGate = createExitGate('beach', colors, config.doors, config.exit); root.add(exitGate.root);
  // Override only this gate's uniquely owned canvas/materials; shared defaults stay intact.
  const membraneMap = exitGate.membrane.material.map, canvas = membraneMap.image, ctx = canvas.getContext('2d');
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height), mistColor = new THREE.Color(s.exit.mistColor), membraneColor = new THREE.Color(s.exit.membraneColor);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const cloud = Math.min(1, Math.max(0, (Math.max(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]) / 255 - 0.1) / 0.32));
    color.copy(membraneColor).lerp(mistColor, 0.15 + s.exit.mistContrast * cloud).multiplyScalar(s.exit.membraneBrightness).convertLinearToSRGB();
    pixels.data[i] = color.r * 255; pixels.data[i + 1] = color.g * 255; pixels.data[i + 2] = color.b * 255;
  }
  ctx.putImageData(pixels, 0, 0); membraneMap.needsUpdate = true;
  exitGate.group.traverse(value => {
    const mat = value.material;
    if (!mat || mat.colorWrite === false || value === exitGate.membrane) return;
    if (value.isSprite) mat.opacity = s.exit.haloOpacity;
    else if (mat.map) mat.opacity = value.parent.name === 'door-pulse-beach' ? s.exit.edgeGlowOpacity : s.exit.spillOpacity;
    else if (mat.vertexColors) mat.color.setScalar(s.exit.frameBrightness);
  });
  let disposed = false;
  return { root, background: new THREE.Color(s.skyHorizon), fog: new THREE.Fog(s.skyHorizon, s.fogNear, s.fogFar), exitGate,
    beatTargets: { bars: waveBars, objects: { waveBars, parasols, balls, sun, ...resort.handles } },
    dispose() {
      if (disposed) return; disposed = true; root.removeFromParent(); exitGate.dispose(); resort.dispose();
      root.traverse(value => { if (value.isInstancedMesh) value.dispose(); });
      geometries.forEach(value => value.dispose()); materials.forEach(value => value.dispose()); textures.forEach(value => value.dispose()); root.clear();
    } };
}
