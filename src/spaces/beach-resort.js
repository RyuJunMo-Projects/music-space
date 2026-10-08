import * as THREE from '../../vendor/three/three.module.min.js';

// Static additions only. Batch ranges are exposed for a possible later consumer.
export function createBeachResort(settings, heightAt) {
  const root = new THREE.Group(); root.name = 'beach-resort';
  const geometries = new Set(), materials = new Set();
  const geometry = value => { geometries.add(value); return value; };
  const material = (color, options = {}) => {
    const value = new THREE.MeshLambertMaterial({ color, ...options }); materials.add(value); return value;
  };
  const mesh = (shape, mat, count) => {
    const value = count ? new THREE.InstancedMesh(shape, mat, count) : new THREE.Mesh(shape, mat);
    root.add(value); return value;
  };
  const transform = new THREE.Object3D(), up = new THREE.Vector3(0, 1, 0), start = new THREE.Vector3(), end = new THREE.Vector3(), direction = new THREE.Vector3();
  const trunks = mesh(geometry(new THREE.CylinderGeometry(0.8, 1, 1, 7)), material(settings.trunkColor, { flatShading: true }), settings.palms.length * 4);
  const leafVertices = [];
  for (let i = 0; i < 4; i++) {
    const point = (t, side) => [t, 0.18 * Math.sin(t * Math.PI) - 0.3 * t * t, side * 0.22 * Math.sin(t * Math.PI)];
    const a = point(i / 4, -1), b = point(i / 4, 1), c = point((i + 1) / 4, 1), d = point((i + 1) / 4, -1);
    leafVertices.push(...a, ...c, ...b, ...a, ...d, ...c);
  }
  const leafShape = geometry(new THREE.BufferGeometry()); leafShape.setAttribute('position', new THREE.Float32BufferAttribute(leafVertices, 3)); leafShape.computeVertexNormals();
  const leaves = mesh(leafShape, material(settings.leafColor, { side: THREE.DoubleSide, flatShading: true }), settings.palms.length * 6);
  const palms = [];
  settings.palms.forEach(([x, z, height], index) => {
    const baseY = heightAt(x, z), bend = 0.32 + index % 3 * 0.13, angle = index * 2.1;
    const point = (v, t) => v.set(x + Math.cos(angle) * bend * t * t, baseY + height * t, z + Math.sin(angle) * bend * t * t);
    for (let segment = 0; segment < 4; segment++) {
      point(start, segment / 4); point(end, (segment + 1) / 4); direction.subVectors(end, start);
      const length = direction.length(), radius = 0.13 - segment * 0.015;
      transform.position.copy(start).add(end).multiplyScalar(0.5);
      transform.quaternion.setFromUnitVectors(up, direction.normalize()); transform.scale.set(radius, length + 0.03, radius);
      transform.updateMatrix(); trunks.setMatrixAt(index * 4 + segment, transform.matrix);
    }
    point(end, 1);
    for (let leaf = 0; leaf < 6; leaf++) {
      transform.position.copy(end); transform.rotation.set(0, leaf * Math.PI / 3 + angle, 0.1 - (leaf % 2) * 0.1);
      transform.scale.set(1.6 + index % 3 * 0.17, 1, 1.1); transform.updateMatrix(); leaves.setMatrixAt(index * 6 + leaf, transform.matrix);
    }
    palms.push({ index, x, z, baseY, height, top: end.clone(), trunkStart: index * 4, trunkCount: 4, leafStart: index * 6, leafCount: 6, trunks, leaves });
  });
  trunks.computeBoundingSphere(); leaves.computeBoundingSphere(); trunks.name = 'palm-trunks'; leaves.name = 'palm-leaves';

  const hammock = new THREE.Group(); hammock.name = 'hammock'; root.add(hammock);
  const a = palms[0], b = palms[1], dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz), normalX = -dz / length, normalZ = dx / length;
  const clothVertices = [];
  const clothPoint = (t, side) => {
    const inset = 0.1 + 0.8 * t;
    return [a.x + dx * inset + normalX * side * 0.45,
      a.baseY + (b.baseY - a.baseY) * inset + 1.6 - 0.6 * Math.sin(t * Math.PI),
      a.z + dz * inset + normalZ * side * 0.45];
  };
  for (let i = 0; i < 10; i++) {
    const p = clothPoint(i / 10, -1), q = clothPoint(i / 10, 1), r = clothPoint((i + 1) / 10, 1), t = clothPoint((i + 1) / 10, -1);
    clothVertices.push(...p, ...r, ...q, ...p, ...t, ...r);
  }
  const clothShape = geometry(new THREE.BufferGeometry()); clothShape.setAttribute('position', new THREE.Float32BufferAttribute(clothVertices, 3)); clothShape.computeVertexNormals();
  const cloth = new THREE.Mesh(clothShape, material(settings.hammockColor, { side: THREE.DoubleSide })); hammock.add(cloth);
  const ropeVertices = [];
  for (const side of [-1, 1]) ropeVertices.push(a.x, a.baseY + 1.6, a.z, ...clothPoint(0, side), b.x, b.baseY + 1.6, b.z, ...clothPoint(1, side));
  const ropeShape = geometry(new THREE.BufferGeometry()); ropeShape.setAttribute('position', new THREE.Float32BufferAttribute(ropeVertices, 3));
  const ropeMaterial = new THREE.LineBasicMaterial({ color: settings.trunkColor }); materials.add(ropeMaterial);
  const ropes = new THREE.LineSegments(ropeShape, ropeMaterial); hammock.add(ropes); hammock.userData.beatParts = { cloth, ropes };

  const box = geometry(new THREE.BoxGeometry(1, 1, 1));
  const frames = mesh(box, material(settings.loungerFrameColor), settings.loungers.length * 6);
  const cushions = mesh(box, material(settings.loungerCushionColor), settings.loungers.length * 2), loungers = [];
  const write = (batch, index, spec, x, y, z, sx, sy, sz, pitch = 0) => {
    const [originX, originZ, yaw] = spec;
    transform.position.set(originX + x * Math.cos(yaw) + z * Math.sin(yaw), y, originZ - x * Math.sin(yaw) + z * Math.cos(yaw));
    transform.rotation.set(pitch, yaw, 0); transform.scale.set(sx, sy, sz); transform.updateMatrix(); batch.setMatrixAt(index, transform.matrix);
  };
  settings.loungers.forEach((spec, index) => {
    let part = index * 6;
    for (const x of [-0.3, 0.3]) for (const z of [-0.65, 0.65]) write(frames, part++, spec, x, 0.15, z, 0.055, 0.3, 0.055);
    write(frames, part++, spec, 0, 0.3, -0.2, 0.8, 0.08, 1.45);
    write(frames, part, spec, 0, 0.48, 0.68, 0.8, 0.08, 0.7, -0.45);
    write(cushions, index * 2, spec, 0, 0.36, -0.2, 0.72, 0.06, 1.35);
    write(cushions, index * 2 + 1, spec, 0, 0.54, 0.68, 0.72, 0.06, 0.64, -0.45);
    loungers.push({ x: spec[0], z: spec[1], yaw: spec[2], frames, cushions, frameStart: index * 6, cushionStart: index * 2 });
  });
  frames.computeBoundingSphere(); cushions.computeBoundingSphere(); frames.name = 'sunbed-frames'; cushions.name = 'sunbed-cushions';
  const towels = mesh(geometry(new THREE.PlaneGeometry(1, 1)), material(settings.towelColor, { side: THREE.DoubleSide }), settings.towels.length);
  settings.towels.forEach(([x, z, yaw], index) => {
    transform.position.set(x, 0.025, z); transform.rotation.set(-Math.PI / 2, 0, yaw); transform.scale.set(0.9, 1.65, 1);
    transform.updateMatrix(); towels.setMatrixAt(index, transform.matrix);
  });
  towels.name = 'beach-towels'; towels.computeBoundingSphere();
  let disposed = false;
  return { root, handles: { palms, hammock, loungers, towels }, dispose() {
    if (disposed) return; disposed = true; root.removeFromParent();
    root.traverse(value => { if (value.isInstancedMesh) value.dispose(); });
    geometries.forEach(value => value.dispose()); materials.forEach(value => value.dispose()); root.clear();
  } };
}
