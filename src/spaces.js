import * as THREE from '../vendor/three/three.module.min.js';
import { createExitGate } from './exit-gate.js';
import { config } from './config.js';

export function createPlaceholderSpace(id, colors) {
  const tint = new THREE.Color(colors[0]).lerp(new THREE.Color(colors[1]), 0.5);
  const root = new THREE.Group();
  root.name = `${id}-placeholder`;
  const geometry = new THREE.PlaneGeometry(160, 160);
  const material = new THREE.MeshBasicMaterial({ color: tint.clone().multiplyScalar(0.045) });
  const floor = new THREE.Mesh(geometry, material);
  floor.rotation.x = -Math.PI / 2;
  root.add(floor);
  const exitGate = createExitGate(id, colors, config.doors, config.exit);
  root.add(exitGate.root);
  const background = tint.clone().multiplyScalar(0.012);
  return { root, background, fog: new THREE.FogExp2(background, 0.035), exitGate,
    dispose() { root.removeFromParent(); exitGate.dispose(); geometry.dispose(); material.dispose(); } };
}

export async function loadSpace(id, colors) {
  if (id === 'beach') {
    const { createBeachSpace } = await import('./spaces/beach.js');
    return createBeachSpace(colors);
  }
  if (id === 'cyberpunk') {
    const { createCyberpunkSpace } = await import('./spaces/cyberpunk.js');
    return createCyberpunkSpace(colors);
  }
  if (id === 'outrun') {
    const { createOutrunSpace } = await import('./spaces/outrun.js');
    return createOutrunSpace(colors);
  }
  return createPlaceholderSpace(id, colors);
}
