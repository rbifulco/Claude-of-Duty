import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import {
  SceneAssetRegistry,
  SPATIAL_REVIEW_REQUEST,
  SPATIAL_REVIEW_CATALOG,
  SPATIAL_REVIEW_DISCOVERY_REQUEST,
  SPATIAL_REVIEW_ASSET_REQUEST,
  SPATIAL_REVIEW_ASSET_RESPONSE,
  SPATIAL_REVIEW_RESOURCE_REQUEST,
  SPATIAL_REVIEW_GEOMETRY_TRANSFER_CAPABILITY,
} from '@alterno-dev/spatial-review';
import { Assembler } from '../src/world/builder.js';
import { Rng } from '../src/core/rng.js';
import { SHOTS } from '../src/dev/shots.js';
import {
  attachClaudeOfDutyDiscovery,
  attachClaudeOfDutyScene,
  buildEnvironmentReviewTour,
  shouldBootClaudeOfDutyPage,
  SPATIAL_REVIEW_SEED,
} from '../src/spatial-review.js';

function fixture(reviewEnabled = true, scopeId = 'building-w1') {
  const materials = [];
  const A = new Assembler({
    reviewEnabled,
    rng: new Rng(SPATIAL_REVIEW_SEED),
    materials: { get(name) {
      const material = new THREE.MeshStandardMaterial({ name });
      materials.push(material);
      return material;
    } },
  });
  const root = new THREE.Group();
  A.setTransform(0.3, 0.9, 1.34);
  A.setReviewScope({ id: scopeId, name: 'Building W1', category: 'Buildings',
    sourceRef: 'src/world/layout.js#BUILDINGS.W1', tags: ['building'] });
  const shell = new THREE.BoxGeometry(4, 5, 3);
  A.add('concrete', shell, new THREE.Matrix4().makeTranslation(0, 2.5, 0));
  shell.dispose();
  A.proto('sat_dish', { geo: new THREE.BoxGeometry(1, 1, 0.2), key: 'metal_dark',
    sourceRef: 'src/world/props.js#registerProps.sat_dish' });
  A.put('sat_dish', 0, 5, 0);
  A.put('sat_dish', 2, 5, 0, 0.5);
  A.proto('dust_skirt', { geo: new THREE.BoxGeometry(1, 0.1, 1), key: 'sand', review: false });
  A.put('dust_skirt', 0, 0, 0);
  A.setReviewScope({ id: 'street-debris', name: 'Street debris', reviewProps: false });
  A.put('sat_dish', 3, 0, 0); // synthetic scatter to exercise scope exclusion
  A.finalize(root, null);
  const world = { A, root };
  const engine = { ctx: { get: (id) => id === 'world' ? world : { agents: [] } } };
  return { A, root, engine, dispose() { A.dispose(); materials.forEach(m => m.dispose()); } };
}

function fakeWindow(href = 'http://127.0.0.1:5174/') {
  const previous = globalThis.window;
  const listeners = new Map();
  const messages = [];
  const peer = { postMessage(value, origin, transfer = []) {
    messages.push({ value: structuredClone(value, { transfer }), origin });
  } };
  globalThis.window = {
    location: new URL(href),
    parent: peer,
    opener: null,
    setTimeout,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
  };
  return {
    peer, messages, listeners,
    restore() {
      if (previous === undefined) delete globalThis.window;
      else globalThis.window = previous;
    },
    send(data, origin = 'https://spatial-review.alterno.dev', source = peer) {
      for (const listener of listeners.get('message') ?? []) listener({ data, origin, source });
    },
  };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

test('embedded discovery skips game boot while an explicit live capture still boots', () => {
  assert.equal(shouldBootClaudeOfDutyPage({ embedded: false, spatialCapture: false }), true);
  assert.equal(shouldBootClaudeOfDutyPage({ embedded: true, spatialCapture: false }), false);
  assert.equal(shouldBootClaudeOfDutyPage({ embedded: true, spatialCapture: true }), true);
});

test('discovery preserves the GitHub Pages project path', (t) => {
  const page = fakeWindow('https://rbifulco.github.io/Claude-of-Duty/?q=high#play');
  const detach = attachClaudeOfDutyDiscovery();
  t.after(() => { try { detach(); } finally { page.restore(); } });
  page.messages.length = 0;
  page.send({ type: SPATIAL_REVIEW_DISCOVERY_REQUEST, requestId: 'pages-discovery' });
  const discovery = page.messages[0].value.discovery;
  assert.equal(discovery.websiteUrl, 'https://rbifulco.github.io/Claude-of-Duty/');
  const capture = new URL(discovery.liveCapture);
  assert.equal(capture.origin, 'https://rbifulco.github.io');
  assert.equal(capture.pathname, '/Claude-of-Duty/');
  assert.equal(capture.searchParams.get('spatial-review-capture'), '1');
  assert.equal(capture.searchParams.get('prewarm'), '0');
  assert.equal(capture.searchParams.has('q'), false);
  assert.equal(capture.hash, '');
});

test('review metadata does not change renderer geometry, instances, or draw counts', () => {
  const regular = fixture(false);
  const review = fixture(true);
  try {
    assert.deepEqual(review.A.stats, regular.A.stats);
    assert.equal(regular.A.reviewStatics.length, 0);
    assert.equal(review.A.reviewStatics.length, 1);
    assert.equal(review.A.reviewProps[0].placements.length, 2);
    for (let i = 0; i < regular.A.meshes.length; i++) {
      const actual = review.A.meshes[i];
      const expected = regular.A.meshes[i];
      assert.equal(actual.name, expected.name);
      assert.deepEqual(actual.geometry.attributes.position.array, expected.geometry.attributes.position.array);
      assert.deepEqual(actual.geometry.index?.array, expected.geometry.index?.array);
      assert.deepEqual(actual.instanceMatrix?.array, expected.instanceMatrix?.array);
    }
    assert.ok(review.A.reviewStatics.every(object => object.roots.every(root => root.parent === null)));
  } finally { regular.dispose(); review.dispose(); }
});

test('adapter preserves separate actors, canonical asset IDs and progressive descriptors', (t) => {
  const page = fakeWindow();
  const value = fixture();
  const review = attachClaudeOfDutyScene(value.engine);
  t.after(() => { try { review.dispose(); value.dispose(); } finally { page.restore(); } });
  const index = review.registry.toReviewIndex('scene');
  assert.equal(index.scene.actors.length, 3);
  assert.equal(index.assetCatalog.assets.length, 2);
  const dishes = index.scene.actors.filter(actor => actor.assetId === 'prop-sat-dish');
  assert.equal(dishes.length, 2);
  assert.notEqual(dishes[0].actorId, dishes[1].actorId);
  assert.notDeepEqual(dishes[0].transform.position, dishes[1].transform.position);
  assert.ok(index.scene.actors.every(actor => index.assetCatalog.assets.some(asset => actor.assetId === asset.id)));
  assert.equal(index.scene.navigationSequences.length, 1);
  const metadata = review.registry.toReviewIndex('scene', false, true);
  assert.ok(metadata.assetCatalog.assets.every(asset => asset.nodes.length === 0 && !asset.geometries));
  const compact = review.registry.toAsset('prop-sat-dish', 'review', true);
  assert.ok(ArrayBuffer.isView(compact.geometries[0].geometry.positions));
  assert.ok(compact.nodes.some(node => node.name === 'sat_dish'));
});

test('canonical component IDs do not depend on the first placement scope', (t) => {
  const page = fakeWindow();
  const a = fixture(true, 'building-w1');
  const b = fixture(true, 'building-e1');
  const left = attachClaudeOfDutyScene(a.engine);
  const right = attachClaudeOfDutyScene(b.engine);
  t.after(() => { try { left.dispose(); right.dispose(); a.dispose(); b.dispose(); } finally { page.restore(); } });
  assert.deepEqual(
    left.registry.toAsset('prop-sat-dish').nodes.map(node => node.id),
    right.registry.toAsset('prop-sat-dish').nodes.map(node => node.id),
  );
});

test('installed SDK refreshes transformed actors without changing their identity', (t) => {
  const registry = new SceneAssetRegistry('cache-test');
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  t.after(() => { mesh.geometry.dispose(); mesh.material.dispose(); });
  registry.register({ actorId: 'dish-a', assetId: 'dish', name: 'Dish', category: 'Fixtures',
    sourceRef: 'fixture', root: mesh });
  const before = registry.toActors()[0];
  registry.toActors();
  assert.equal(registry.cacheMetrics.bounds, 0);
  mesh.position.x = 7;
  const after = registry.toActors()[0];
  assert.equal(after.actorId, before.actorId);
  assert.equal(after.transform.position[0], 7);
  assert.equal(after.bounds.center[0], 7);
  assert.equal(registry.unregister('dish-a'), true);
  assert.equal(registry.size, 0);
});

test('both bridges enforce origin/source checks and negotiate progressive geometry', async (t) => {
  const page = fakeWindow();
  const value = fixture();
  const detachDiscovery = attachClaudeOfDutyDiscovery();
  const review = attachClaudeOfDutyScene(value.engine);
  t.after(() => { try { detachDiscovery(); review.dispose(); value.dispose(); } finally { page.restore(); } });
  page.messages.length = 0;
  const request = { type: SPATIAL_REVIEW_REQUEST, requestId: 'catalog', profile: 'scene',
    progressive: true, geometryTransfer: { capability: SPATIAL_REVIEW_GEOMETRY_TRANSFER_CAPABILITY, maxBytes: 1024 * 1024 } };
  for (const origin of ['https://unlisted.example', 'https://spatial-review.alterno.dev.evil.example']) {
    page.send({ type: SPATIAL_REVIEW_DISCOVERY_REQUEST, requestId: 'discovery' }, origin);
    page.send(request, origin);
    page.send({ type: SPATIAL_REVIEW_RESOURCE_REQUEST, requestId: 'texture', resourceId: 'private' }, origin);
    page.send({ type: SPATIAL_REVIEW_ASSET_REQUEST, requestId: 'asset', assetId: 'prop-sat-dish', buildId: review.registry.buildId }, origin);
  }
  page.send(request, undefined, {}); // correct origin, unrelated window
  await settle();
  assert.equal(page.messages.length, 0);
  page.send({ type: SPATIAL_REVIEW_DISCOVERY_REQUEST, requestId: 'discovery' });
  assert.match(page.messages[0].value.discovery.liveCapture, /spatial-review-capture=1/);
  page.send(request);
  await settle();
  const catalog = page.messages.find(message => message.value.type === SPATIAL_REVIEW_CATALOG)?.value;
  assert.equal(catalog.progressive, true);
  assert.equal(catalog.payload.scene.actors.length, 3);
  assert.ok(catalog.payload.assetCatalog.assets.every(asset => asset.nodes.length === 0));
  page.send({ type: SPATIAL_REVIEW_ASSET_REQUEST, requestId: 'asset-1', assetId: 'prop-sat-dish',
    buildId: review.registry.buildId, profile: 'scene' });
  await settle();
  const asset = page.messages.find(message => message.value.type === SPATIAL_REVIEW_ASSET_RESPONSE)?.value;
  assert.equal(asset.ok, true);
  assert.equal(asset.asset.id, 'prop-sat-dish');
  // Transferring the response must not detach the registry's reusable buffers.
  assert.ok(review.registry.toAsset('prop-sat-dish', 'scene', true).geometries[0].geometry.positions.length > 0);
  detachDiscovery(); review.dispose();
  assert.equal(page.listeners.get('message').size, 0);
});

test('tour stops and shared camera/aim endpoints match their authoritative shots', () => {
  const sequence = buildEnvironmentReviewTour();
  assert.equal(sequence.stops.length, 5);
  assert.equal(sequence.segments.length, 4);
  for (const stop of sequence.stops) {
    assert.deepEqual(stop.camera, SHOTS[stop.id].pos);
    assert.deepEqual(stop.target, SHOTS[stop.id].look);
    assert.equal(stop.fov, SHOTS[stop.id].fov);
  }
  for (const segment of sequence.segments) {
    assert.equal(segment.camera.points[0].stopId, segment.fromStopId);
    assert.equal(segment.camera.points[1].stopId, segment.toStopId);
    assert.equal(segment.aim.curve.points[0].stopId, segment.fromStopId);
    assert.equal(segment.aim.curve.points[1].stopId, segment.toStopId);
  }
  sequence.stops[0].camera[0] += 1;
  assert.notEqual(sequence.stops[0].camera[0], SHOTS.hero.pos[0]);
});
