import * as THREE from '../vendor/three/three.module.min.js';
import { createDoorways } from './doors.js';

export function createExitGate(id, colors, doorSettings, exitSettings) {
  const owner = new THREE.Scene();
  const visual = createDoorways(owner, { ...doorSettings, radius: 0, spaces: [{ id, label: '로비로 돌아가기', colors }] }, exitSettings.position);
  const door = visual.doors[0];
  door.group.rotation.y = Math.PI;
  return { root: visual.root, group: door.group, width: doorSettings.width, height: doorSettings.height,
    membrane: door.membrane, update: delta => visual.update(delta),
    dispose() {
      const geometries = new Set(); const materials = new Set(); const textures = new Set();
      visual.root.traverse(object => {
        if (object.geometry && !object.isSprite) geometries.add(object.geometry);
        if (object.material) { materials.add(object.material); if (object.material.map) textures.add(object.material.map); }
      });
      geometries.forEach(value => value.dispose()); materials.forEach(value => value.dispose()); textures.forEach(value => value.dispose());
      visual.root.removeFromParent(); visual.root.clear();
    } };
}

// One reusable, non-rendered hitbox implements all three exit gates.
export class ExitGateInteraction {
  constructor(settings) {
    this.settings = settings;
    this.raycaster = new THREE.Raycaster(); this.center = new THREE.Vector2();
    this.hitbox = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    this.target = { isExit: true, label: '로비로 돌아가기', group: null, width: 0, height: 0 };
  }
  update(delta, space) {
    space?.exitGate?.update(delta);
    if (!space) this.target.group = null;
  }
  pick(camera, space) {
    const gate = space?.exitGate;
    const group = gate?.group ?? space?.beatTargets?.objects.gate;
    if (!group) return null;
    if (Math.hypot(camera.position.x - group.position.x, camera.position.z - group.position.z) > this.settings.activationDistance) return null;
    const width = gate?.width ?? this.settings.outrunWidth;
    const height = gate?.height ?? this.settings.outrunHeight;
    group.updateWorldMatrix(true, false); camera.updateMatrixWorld();
    this.hitbox.position.set(0, height / 2, 0); this.hitbox.scale.set(width, height, 0.2);
    this.hitbox.updateMatrix(); this.hitbox.matrixWorld.multiplyMatrices(group.matrixWorld, this.hitbox.matrix);
    this.raycaster.setFromCamera(this.center, camera);
    if (!this.raycaster.intersectObject(this.hitbox, false).length) return null;
    this.target.group = group; this.target.width = width; this.target.height = height;
    return this.target;
  }
}
