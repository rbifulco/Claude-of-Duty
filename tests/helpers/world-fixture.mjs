import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { WorldSystem } from '../../src/world/index.js';
import { Rng } from '../../src/core/rng.js';

/** Real procedural world, without WebGL, textures, or gameplay subsystems. */
export async function worldFixture(reviewEnabled, World = WorldSystem) {
  const previous = globalThis.window;
  globalThis.window = { location: new URL(`http://localhost/?spatial-review-capture=${reviewEnabled ? 1 : 0}`) };
  const materials = [];
  const world = new World();
  try {
    await world.init({
      rng: new Rng(0x5eed1234), scene: new THREE.Scene(), peek: () => null,
      get: () => ({ get(name) {
        const material = new THREE.MeshStandardMaterial({ name });
        materials.push(material);
        return material;
      } }),
    });
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
  return {
    world, A: world.A,
    dispose() { world.A.dispose(); world.root.removeFromParent(); materials.forEach(m => m.dispose()); },
  };
}

function digest(array) {
  return array ? createHash('sha256').update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength)).digest('hex') : null;
}

/** All render attributes, collisions, lights, LOD settings and final RNG state. */
export function worldSnapshot({ world, A }) {
  const mesh = value => ({
    name: value.name,
    attributes: Object.fromEntries(Object.entries(value.geometry.attributes).map(([id, attr]) => [id, digest(attr.array)])),
    index: digest(value.geometry.index?.array),
    instances: digest(value.instanceMatrix?.array), colors: digest(value.instanceColor?.array),
    matrix: value.matrix.toArray(), castShadow: value.castShadow, receiveShadow: value.receiveShadow,
    userData: value.userData,
  });
  return {
    stats: { ...A.stats }, meshes: A.meshes.map(mesh),
    collision: A.collisionRoot.children.map(mesh),
    lights: A.lights.map(({ light, opts }) => ({ position: light.position.toArray(), color: light.color.toArray(), intensity: light.intensity, opts })),
    rng: { ...world.rng },
  };
}
