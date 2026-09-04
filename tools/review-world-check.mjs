import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {WorldSystem} from '../src/world/index.js';
import {ReviewCollector} from '../src/review/collector.js';
import {Rng} from '../src/core/rng.js';
const materialCache=new Map();
const materials={get(name,opts){const key=name+JSON.stringify(opts);if(!materialCache.has(key))materialCache.set(key,new THREE.MeshStandardMaterial({name:key}));return materialCache.get(key)},setGroundLevel(){}};
async function build(System,reviewCapture){const world=new System();const rng=new Rng(0x5eed1234);rng.fork();rng.fork();await world.init({scene:new THREE.Scene(),rng,reviewCapture,get:()=>materials,peek:()=>null});const hash=createHash('sha256');let triangles=0;for(const mesh of [...world.A.meshes,...world.A.collisionRoot.children]){hash.update(mesh.name);for(const attr of Object.values(mesh.geometry.attributes))hash.update(new Uint8Array(attr.array.buffer));if(mesh.geometry.index)hash.update(new Uint8Array(mesh.geometry.index.array.buffer));if(mesh.instanceMatrix)hash.update(new Uint8Array(mesh.instanceMatrix.array.buffer));if(mesh.instanceColor)hash.update(new Uint8Array(mesh.instanceColor.array.buffer));triangles+=(mesh.geometry.index?.count||mesh.geometry.attributes.position.count)/3;}return{world,result:{hash:hash.digest('hex'),stats:world.stats,rng:[rng.s0,rng.s1,rng.s2,rng.s3],lights:world.A.lights.map(({light})=>light.position.toArray()),triangles}}}
const ordinary=await build(WorldSystem);const collector=new ReviewCollector();const capture=await build(WorldSystem,collector);assert.deepEqual(capture.result,ordinary.result);
let baseline;try{const {WorldSystem:Original}=await import('../../Claude-of-Duty/src/world/index.js');baseline=await build(Original);assert.deepEqual(ordinary.result,baseline.result)}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error}
const parts=[...collector.scopes.values()].flatMap(s=>[...s.parts.values()]);const triangleCount=parts.reduce((n,acc)=>{const g=acc.build();const count=g.index.count/3;g.dispose();return n+count},0);assert.equal(triangleCount,ordinary.result.stats.staticTris);
const props=[...collector.scopes.values()].flatMap(s=>s.props);assert.equal(props.length,ordinary.result.stats.instances);assert.equal(new Set(props.map(p=>p.id)).size,props.length);
const result={originalCompared:!!baseline,ordinary:capture.result,staticTrianglesCaptured:triangleCount,independentPropPlacements:props.length,prototypeCounts:Object.fromEntries([...new Set(props.map(p=>p.prototype.id))].map(id=>[id,props.filter(p=>p.prototype.id===id).length])),scopes:[...collector.scopes.values()].map(s=>({id:s.id,parts:s.parts.size,props:s.props.length}))};writeFileSync('docs/evidence/world-check.json',JSON.stringify(result,null,2));console.log(JSON.stringify({...result,scopes:result.scopes.length},null,2));
ordinary.world.dispose();capture.world.dispose();baseline?.world.dispose();
