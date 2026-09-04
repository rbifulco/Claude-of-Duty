import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { prepareReviewTextureSources, gateReviewTextureResources, yieldCaptureTask, encodePixels } from '../src/review-texture-export.js';

test('PNG encoding avoids document-idle callbacks and releases the temporary canvas', async t => {
  const canvases = [], pixels = new Uint8Array([255, 0, 0, 17]);
  for (const name of ['ImageData', 'document']) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value: undefined, configurable: true, writable: true });
    t.after(() => descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]);
  }
  globalThis.ImageData = class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } };
  class Canvas {
    constructor(width, height) { Object.assign(this, { width, height }); canvases.push(this); }
    getContext() { return { putImageData(image) { assert.deepEqual([...image.data], [...pixels]); } }; }
    toBlob() { assert.fail('document-idle encoding must not be used'); }
    toDataURL(type) { assert.equal(type, 'image/png'); return 'data:image/png;base64,/wAAEQ=='; }
  }
  globalThis.document = { createElement: () => new Canvas(0, 0) };
  const blob = await encodePixels(pixels, 1, 1);
  assert.equal(blob.type, 'image/png');
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [...pixels]);
  assert.deepEqual([canvases[0].width, canvases[0].height], [0, 0]);
  const broken = new Canvas(0, 0);
  broken.toDataURL = () => 'data:,';
  globalThis.document = { createElement: () => broken };
  await assert.rejects(encodePixels(pixels, 1, 1), /Could not encode/);
  assert.deepEqual([broken.width, broken.height], [0, 0]);
});

test('GPU exports are shared, exact, task-yielded without timer polling, and leave render sources untouched', async () => {
  const target = new THREE.WebGLRenderTarget(2, 2), unused = new THREE.WebGLRenderTarget(2, 2);
  const texture = target.texture, image = texture.source.data;
  texture.colorSpace = THREE.SRGBColorSpace; texture.flipY = false;
  const material = new THREE.MeshStandardMaterial({ map: texture, roughnessMap: texture });
  let reads = 0, encodes = 0;
  const renderer = { readRenderTargetPixelsAsync() { throw new Error('Timer-polling readback must not be used'); }, readRenderTargetPixels(rt, x, y, w, h, bytes) {
    reads++; assert.equal(rt, target); assert.deepEqual([x, y, w, h], [0, 0, 2, 2]);
    bytes.set([255, 0, 0, 17, 0, 255, 0, 255, 0, 0, 255, 32, 255, 255, 255, 64]);
  } };
  const encode = async bytes => { encodes++; assert.equal(bytes[3], 17); assert.equal(bytes[11], 32); return new Blob([bytes], { type: 'image/png' }); };
  assert.equal(await prepareReviewTextureSources(renderer, [target, unused], [material, material], encode), 1);
  assert.equal(await prepareReviewTextureSources(renderer, [target, unused], [material], encode), 0);
  assert.equal(reads, 1); assert.equal(encodes, 1);
  assert.equal(texture.source.data, image); assert.equal(texture.flipY, false); assert.equal(texture.colorSpace, THREE.SRGBColorSpace);
  assert.ok(texture.userData.sourceBlob instanceof Blob);
  assert.equal(JSON.stringify(texture.userData), '{}');
  assert.equal(unused.texture.userData.sourceBlob, undefined);
  target.dispose(); unused.dispose(); material.dispose();
});

test('failed export stays retryable and unsupported dimensions fail before allocating', async () => {
  const target = new THREE.WebGLRenderTarget(1, 1), material = { map: target.texture };
  let reads = 0;
  const renderer = { readRenderTargetPixels() { reads++; } };
  await assert.rejects(prepareReviewTextureSources(renderer, [target], [material], async () => { throw new Error('encode failed'); }), /encode failed/);
  assert.equal(target.texture.userData.sourceBlob, undefined);
  await prepareReviewTextureSources(renderer, [target], [material], async () => new Blob(['png'], { type: 'image/png' }));
  assert.equal(reads, 2);
  delete target.texture.userData.sourceBlob; target.width = 1e8;
  await assert.rejects(prepareReviewTextureSources(renderer, [target], [material]), /Invalid generated texture dimensions/);
  assert.equal(reads, 2); target.dispose();
});

test('only explicit review captures export, and the bridge attaches before awaiting exports', async () => {
  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /const texturePreparation = spatialCapture \? prepareReviewTextureSources/);
  assert.match(main, /attachClaudeOfDutyScene\(engine, \{ texturePreparation \}\)/);
  assert.ok(main.indexOf('const spatialReview = attachClaudeOfDutyScene') < main.indexOf('const exported = await texturePreparation'));
});

test('cooperative capture work yields to a real task without relying on timers', async () => {
  const order = [];
  const promise = yieldCaptureTask().then(() => order.push('task'));
  await Promise.resolve(); order.push('microtask');
  await promise; assert.deepEqual(order, ['microtask', 'task']);
});

test('resource requests wait for exports and preserve resource IDs and byte limits', async () => {
  let resolve; const preparation = new Promise(done => { resolve = done; });
  const calls = [], registry = { async readTextureResource(...args) { calls.push(args); return 'exported'; } };
  gateReviewTextureResources(registry, preparation);
  const a = registry.readTextureResource('texture-a', 16), b = registry.readTextureResource('texture-b', 32);
  await Promise.resolve(); assert.equal(calls.length, 0);
  resolve(); assert.deepEqual(await Promise.all([a, b]), ['exported', 'exported']);
  assert.deepEqual(calls, [['texture-a', 16], ['texture-b', 32]]);
});

test('an early export failure is retained and resource requests receive its actual error', async () => {
  const failure = new Error('GPU context lost'), registry = { readTextureResource() { assert.fail('must not read an unexported source'); } };
  gateReviewTextureResources(registry, Promise.reject(failure));
  await yieldCaptureTask(); // a rejected export before any request is handled
  await assert.rejects(registry.readTextureResource('a', 16), error => error === failure);
});

test('disposal cancels pending resource delivery and abort stops follow-on GPU work', async () => {
  let resolve; const preparation = new Promise(done => { resolve = done; });
  const registry = { readTextureResource() { assert.fail('disposed source must not be read'); } };
  const dispose = gateReviewTextureResources(registry, preparation);
  const pending = registry.readTextureResource('a', 16);
  dispose(); resolve(); await assert.rejects(pending, { name: 'AbortError' });
  const controller = new AbortController();
  const target = new THREE.WebGLRenderTarget(1, 1);
  let reads = 0;
  await assert.rejects(prepareReviewTextureSources({ readRenderTargetPixels() { reads++; } }, [target], [{ map: target.texture }], undefined,
    { signal: controller.signal, yieldTask: async () => controller.abort() }), { name: 'AbortError' });
  assert.equal(reads, 0); assert.equal(target.texture.userData.sourceBlob, undefined);
  target.dispose();
});

test('Pages includes the public discovery document in its uploaded artifact', async () => {
  const workflow = await readFile(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');
  assert.match(workflow, /path: dist\s+include-hidden-files: true/);
});
