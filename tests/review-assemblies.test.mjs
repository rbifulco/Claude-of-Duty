import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { Assembler } from '../src/world/builder.js';
import { attachClaudeOfDutyScene } from '../src/spatial-review.js';
import { worldFixture, worldSnapshot } from './helpers/world-fixture.mjs';

function matrixNear(actual, expected, message) {
  actual.elements.forEach((v, i) => assert.ok(Math.abs(v - expected.elements[i]) < 1e-9, `${message}, element ${i}`));
}

test('full procedural world: source-owned assemblies and unchanged rendering', async t => {
  const regular = await worldFixture(false);
  const expected = worldSnapshot(regular);
  regular.dispose();
  const review = await worldFixture(true);
  const { A, world } = review;
  t.after(() => review.dispose());

  await t.test('all render/collision buffers, instance masks, lights and RNG state are unchanged', () => {
    assert.deepEqual(worldSnapshot(review), expected);
    assert.ok(A.reviewStatics.every(object => object.roots.every(root => root.parent === null)));
    let capturedStaticTris = 0;
    for (const object of A.reviewStatics) object.roots[0].traverse(node => {
      if (node.isMesh && !node.userData.reviewPlacement) capturedStaticTris += node.geometry.index.count / 3;
    });
    assert.equal(capturedStaticTris, A.stats.staticTris, 'every static triangle has one review owner');
  });

  const ownedMeshes = new Map();
  for (const object of A.reviewStatics) {
    object.roots[0].traverse(mesh => {
      const placement = mesh.userData.reviewPlacement;
      if (!placement) return;
      assert.equal(ownedMeshes.has(placement), false, 'placement cannot belong to two assemblies');
      ownedMeshes.set(placement, mesh);
      assert.equal(placement.ownerId, object.id);
    });
  }

  await t.test('each captured placement has one owner and retains its exact original world pose', () => {
    for (const prop of A.reviewProps) for (const placement of prop.placements) {
      assert.equal(ownedMeshes.has(placement), Boolean(placement.ownerId), prop.id);
      if (placement.ownerId) {
        const mesh = ownedMeshes.get(placement);
        assert.equal(mesh.geometry, prop.geometry, 'attached components reuse the prototype');
        matrixNear(mesh.matrixWorld, placement.matrix, prop.id);
      }
    }
  });

  await t.test('authored ownership distinguishes attached services from loose contents and surroundings', () => {
    assert.equal(A.reviewStatics.filter(o => o.id.startsWith('palm-')).length, 7);
    assert.equal(A.reviewStatics.filter(o => o.id.startsWith('lamp-')).length, 5);
    assert.equal(A.reviewStatics.filter(o => o.id.startsWith('sandbags-')).length, 12);
    const attached = ['ac_unit', 'conduit_box', 'sat_dish', 'water_tank', 'roof_vent', 'palm_trunk', 'palm_frond', 'lamp_post', 'lamp_glass'];
    for (const id of attached) {
      const prop = A.reviewProps.find(p => p.id === id);
      assert.ok(prop, `missing prototype ${id}`);
      assert.ok(prop.placements.every(p => p.ownerId), `${prop.id} must belong to an assembly`);
    }
    const gate = A.reviewStatics.find(o => o.id === 'gate').roots[0];
    const ramparts = gate.getObjectByName('Rampart defences');
    assert.equal(ramparts.children.length, 4);
    for (const wall of A.reviewStatics.filter(o => o.id.startsWith('sandbags-'))) {
      assert.ok(wall.roots[0].children.every(c => c.name.startsWith('Course ')));
    }
    const buildingContents = A.reviewProps.flatMap(p => p.placements)
      .filter(p => p.scope.id.startsWith('building-') && !p.ownerId);
    assert.ok(buildingContents.length > 0, 'loose building contents must remain independent');
    const palm = A.reviewStatics.find(o => o.id.startsWith('palm-')).roots[0];
    assert.ok(palm.getObjectByName('Trunk'));
    assert.ok(palm.getObjectByName('Crown'));
  });

  await t.test('moving, rotating, scaling and hiding one building affects only its components', () => {
    const building = A.reviewStatics.find(o => o.id === 'building-be1').roots[0];
    const original = building.matrix.clone();
    const before = new Map();
    building.traverse(node => before.set(node, node.matrixWorld.clone()));
    const neighbor = A.reviewStatics.find(o => o.id === 'building-be2').roots[0];
    const neighborBefore = neighbor.matrixWorld.clone();
    const loose = A.reviewProps.flatMap(p => p.placements).find(p => p.scope.id === 'building-be1' && !p.ownerId);
    const looseBefore = loose.matrix.clone();
    building.position.x += 5;
    building.rotateY(0.25);
    building.scale.set(1.3, 0.8, 1.1);
    building.updateMatrixWorld(true);
    const delta = building.matrixWorld.clone().multiply(original.clone().invert());
    for (const [node, matrix] of before) matrixNear(node.matrixWorld, delta.clone().multiply(matrix), node.name);
    matrixNear(neighbor.matrixWorld, neighborBefore, 'neighbor');
    matrixNear(loose.matrix, looseBefore, 'loose clutter');
    building.visible = false;
    let visible = 0;
    building.traverseVisible(() => visible++);
    assert.equal(visible, 0);
    assert.equal(neighbor.visible, true);
    original.decompose(building.position, building.quaternion, building.scale);
    building.visible = true;
    building.updateMatrixWorld(true);
  });

  await t.test('installed registry has no duplicate actors and exports named, traceable structures', () => {
    const previous = globalThis.window;
    globalThis.window = {
      location: new URL('http://localhost/'), parent: { postMessage() {} }, opener: null,
      setTimeout, addEventListener() {}, removeEventListener() {},
    };
    const bridge = attachClaudeOfDutyScene({ ctx: { get: id => id === 'world' ? world : { agents: [] } } });
    try {
      const actors = bridge.registry.toActors();
      const placementCount = A.reviewProps.reduce((sum, prop) => sum + prop.placements.length, 0);
      assert.equal(bridge.composition.hierarchical, true);
      assert.equal(bridge.composition.assemblies, A.reviewAssemblies.length);
      assert.equal(actors.length, A.reviewStructures.length + placementCount);
      assert.equal(new Set(actors.map(a => a.actorId)).size, actors.length);
      assert.equal(bridge.composition.attachedParts, ownedMeshes.size);
      assert.equal(actors.some(a => a.assetId === 'prop-sat-dish'), true);
      const asset = bridge.registry.toAsset('environment-building-be1', 'review');
      const names = new Set(asset.nodes.map(n => n.name));
      for (const name of ['Foundation', 'Floor 1', 'Facade north', 'Wall', 'Facade services', 'Roof', 'Services']) {
        assert.ok(names.has(name), `missing component ${name}`);
      }
      const sourced = asset.nodes.find(node => node.name === 'Facade services');
      assert.ok(sourced.sourceRef.includes('src/world/layout.js#BUILDINGS.BE1'), sourced.sourceRef);
      assert.ok(sourced.sourceRef.includes(sourced.id), sourced.sourceRef);
      assert.deepEqual(asset.nodes.map(n => n.id), bridge.registry.toAsset(asset.id, 'review').nodes.map(n => n.id));
    } finally {
      bridge.dispose();
      if (previous === undefined) delete globalThis.window;
      else globalThis.window = previous;
    }
  });

  await t.test('published or injected SDK exports transform-only owners and independent shared placements', async () => {
    const sdk = process.env.SPATIAL_REVIEW_SDK_PATH
      ? await import(pathToFileURL(resolve(
        process.env.SPATIAL_REVIEW_SDK_PATH,
        'packages/sdk/dist/index.js',
      )).href)
      : await import('@alterno-dev/spatial-review');
    const sdkThree = process.env.SPATIAL_REVIEW_SDK_PATH
      ? await import(pathToFileURL(resolve(
        process.env.SPATIAL_REVIEW_SDK_PATH,
        'node_modules/three/build/three.module.js',
      )).href)
      : THREE;
    const bridge = attachClaudeOfDutyScene(
      { ctx: { get: id => id === 'world' ? world : { agents: [] } } },
      { SceneAssetRegistry: sdk.SceneAssetRegistry, attachSceneAssetRegistryBridge: () => () => {}, THREE: sdkThree },
    );
    try {
      const deferred = typeof bridge.registry.registerDeferred === 'function';
      const scene = bridge.registry.toScene(true, deferred);
      const placementCount = A.reviewProps.reduce((sum, prop) => sum + prop.placements.length, 0);
      assert.equal(bridge.composition.deferredPropPlacements, deferred ? placementCount : 0);
      assert.equal(scene.ownership.capability, 'scene-assemblies-v1');
      assert.equal(scene.ownership.mode, 'hierarchical');
      assert.equal(scene.assemblies.length, A.reviewAssemblies.length);
      assert.equal(scene.actors.length, A.reviewStructures.length + placementCount);
      assert.equal(new Set([
        ...scene.assemblies.map(item => item.assemblyId),
        ...scene.actors.map(item => item.actorId),
      ]).size, scene.assemblies.length + scene.actors.length);

      const building = scene.assemblies.find(item => item.assemblyId === 'building-be1');
      const structure = scene.actors.find(item => item.actorId === 'building-be1-structure');
      const fixture = scene.actors.find(item => item.actorId.startsWith('building-be1-ac-unit-'));
      const sharedFixture = scene.actors.find(item => item.parentAssemblyId !== 'building-be1'
        && item.assetId === fixture.assetId);
      assert.ok(building);
      assert.equal(structure.parentAssemblyId, building.assemblyId);
      assert.equal(fixture.parentAssemblyId, building.assemblyId);
      assert.equal(fixture.assetId, 'prop-ac-unit');
      assert.ok(sharedFixture, 'the same canonical fixture design is placed under another owner');
      assert.notEqual(sharedFixture.actorId, fixture.actorId);
      if (deferred) {
        const descriptor = bridge.registry.getAssetStreamDescriptor(fixture.assetId, 'review');
        const representation = descriptor.representations.find(item => item.purpose === 'detail');
        const produced = await bridge.registry.produceAssetRepresentation(
          fixture.assetId,
          'review',
          representation.id,
          representation.estimatedBytes,
          'interactive',
          new AbortController().signal,
        );
        assert.ok(produced.asset.nodes.length > 0);
      } else {
        assert.ok(bridge.registry.toAsset(fixture.assetId).nodes.length > 0);
      }
      assert.ok(A.reviewAssemblies.every(item => item.root.children.length === 0), 'owners contain no geometry');

      const flat = bridge.registry.toScene(false, deferred);
      assert.equal(flat.assemblies, undefined);
      assert.equal(flat.ownership.mode, 'flattened');
      assert.equal(flat.actors.length, scene.actors.length);
      assert.ok(flat.actors.every(item => !item.parentAssemblyId && !item.localTransform));

      const owner = A.reviewAssemblies.find(item => item.assemblyId === 'building-be1').root;
      owner.visible = false;
      const hidden = bridge.registry.toScene(false, deferred);
      assert.equal(hidden.actors.some(item => item.actorId === fixture.actorId), false);
      assert.ok(hidden.actors.some(item => item.actorId === sharedFixture.actorId));
      owner.visible = true;
    } finally { bridge.dispose(); }
  });
});

test('capture scopes restore ownership; review disposal does not dispose shared prototypes', () => {
  const material = new THREE.MeshStandardMaterial();
  const A = new Assembler({ reviewEnabled: true, materials: { get: () => material } });
  const geometry = new THREE.BoxGeometry();
  let disposed = 0;
  geometry.addEventListener('dispose', () => disposed++);
  A.proto('fixture', { geo: geometry, key: 'metal_dark' });
  A.setReviewScope({ id: 'street', name: 'Street' });
  const end = A.beginReviewAssembly({ id: 'owner', name: 'Owner' });
  A.withReviewPart('Fixture', () => A.put('fixture', 1, 2, 3));
  assert.throws(() => A.withReviewPart('Failed part', () => { throw new Error('test'); }, { ownProps: false }));
  A.put('fixture', 2, 2, 3);
  end();
  A.put('fixture', 4, 2, 3);
  assert.throws(() => A.beginReviewAssembly({ id: 'owner' }), /Duplicate review assembly/);
  A.finalize(new THREE.Group(), null);
  assert.deepEqual(A.reviewProps[0].placements.map(p => p.ownerId), ['owner', 'owner', null]);
  A.reviewCapture.dispose();
  assert.equal(disposed, 0);
  A.dispose();
  assert.equal(disposed, 1);
  material.dispose();
});

test('static component geometry and paint retain world-space evidence in a local assembly frame', () => {
  const material = new THREE.MeshStandardMaterial();
  const A = new Assembler({ reviewEnabled: true, materials: { get: () => material } });
  A.setTransform(0.3, 0.9, 1.34);
  A.setReviewScope({ id: 'building', name: 'Building', frame: new THREE.Matrix4().makeTranslation(10, 0, 5) });
  const geometry = new THREE.BoxGeometry(2, 3, 4);
  A.withReviewPart('Facade', () => A.add('concrete', geometry, new THREE.Matrix4().makeTranslation(11, 2, 5), {
    paint(x, y, z, nx, ny, nz, out) { out[0] = x; out[1] = y; out[2] = z; },
  }));
  A.finalize(new THREE.Group(), null);
  try {
    const root = A.reviewStatics[0].roots[0];
    const component = root.getObjectByName('Concrete');
    const rendered = A.meshes[0].geometry;
    assert.deepEqual(component.geometry.attributes.color.array, rendered.attributes.color.array);
    const position = new THREE.Vector3();
    const expected = new THREE.Vector3();
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(component.matrixWorld);
    for (let i = 0; i < rendered.attributes.position.count; i++) {
      position.fromBufferAttribute(component.geometry.attributes.position, i).applyMatrix4(component.matrixWorld);
      expected.fromBufferAttribute(rendered.attributes.position, i);
      assert.ok(position.distanceTo(expected) < 1e-5);
      position.fromBufferAttribute(component.geometry.attributes.normal, i).applyMatrix3(normalMatrix).normalize();
      expected.fromBufferAttribute(rendered.attributes.normal, i);
      assert.ok(position.distanceTo(expected) < 1e-6);
    }
  } finally { A.dispose(); geometry.dispose(); material.dispose(); }
});
