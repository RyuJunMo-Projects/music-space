import * as THREE from '../../vendor/three/three.module.min.js';

// Identical lobby membrane generator; doors.js stays read-only in this stage.
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

export function membraneTexture(left, right, seed) {
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


