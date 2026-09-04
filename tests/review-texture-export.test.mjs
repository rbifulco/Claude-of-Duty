import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { prepareReviewTextureSources } from '../src/review-texture-export.js';

test('GPU exports are shared, exact, asynchronous, and leave render sources untouched', async () => {
  const target = new THREE.WebGLRenderTarget(2, 2), unused = new THREE.WebGLRenderTarget(2, 2);
  const texture = target.texture, image = texture.source.data;
  texture.colorSpace = THREE.SRGBColorSpace; texture.flipY = false;
  const material = new THREE.MeshStandardMaterial({ map: texture, roughnessMap: texture });
  let reads = 0, encodes = 0;
  const renderer = { async readRenderTargetPixelsAsync(rt, x, y, w, h, bytes) {
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

test('only explicit review captures export, before the resource bridge becomes available', async () => {
  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /if \(spatialCapture\) \{\s*const materials[\s\S]*?await prepareReviewTextureSources/);
  assert.ok(main.indexOf('const exported = await prepareReviewTextureSources') < main.indexOf('const spatialReview = attachClaudeOfDutyScene'));
});

test('Pages includes the public discovery document in its uploaded artifact', async () => {
  const workflow = await readFile(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');
  assert.match(workflow, /path: dist\s+include-hidden-files: true/);
});
