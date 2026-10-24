import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createReviewMaterialResolver } from '../src/review-materials.js';

test('review preserves authored colour materials and treats OW RGB masks as shader data', () => {
  const mask = new THREE.MeshStandardMaterial({vertexColors: true});
  mask.defines = {OW_VCOL_MASKS: ''};
  const texture = new THREE.Texture();mask.map = texture;
  const colour = new THREE.MeshStandardMaterial({vertexColors: true});
  const geometry = new THREE.BoxGeometry();
  const root = new THREE.Group();
  const a = new THREE.Mesh(geometry,mask), b = new THREE.Mesh(geometry,[mask,colour]);root.add(a,b);
  const resolver = createReviewMaterialResolver();resolver.apply(root);
  assert.notEqual(a.material,mask);assert.equal(a.material.vertexColors,false);
  assert.equal(b.material[0],a.material,'review placements share one material clone');
  assert.equal(b.material[1],colour,'true vertex-coloured materials remain unchanged');
  assert.equal(mask.vertexColors,true,'source rendering is unchanged');
  assert.equal(a.material.map,texture,'review reuses the original exported texture');
  let disposed=0,textureDisposed=0;a.material.addEventListener('dispose',()=>disposed++);texture.addEventListener('dispose',()=>textureDisposed++);
  resolver.dispose();assert.equal(disposed,1);assert.equal(textureDisposed,0);
  geometry.dispose();mask.dispose();colour.dispose();texture.dispose();
});
