import * as THREE from 'three';
import buildId from 'virtual:review-build';
import { SceneAssetRegistry, attachSceneAssetRegistryBridge, createSpatialReviewEditorAuthorization } from '@alterno-dev/spatial-review';
import { WorldSystem } from '../world/index.js';
import { MaterialSystem } from '../materials/index.js';
import { Rng } from '../core/rng.js';
import { PALETTE } from '../world/palette.js';
import { resolveName } from '../materials/library.js';
import { SHOTS } from '../dev/shots.js';
import { ReviewCollector } from './collector.js';

const status = document.querySelector('#status');
const renderer = new THREE.WebGLRenderer({canvas:document.querySelector('#review'), antialias:true});
renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(1);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0xa9b9bd);
const camera = new THREE.PerspectiveCamera(SHOTS.hero.fov,innerWidth/innerHeight,0.1,400);
camera.position.fromArray(SHOTS.hero.pos);camera.lookAt(...SHOTS.hero.look);
scene.add(new THREE.HemisphereLight(0xc9e5ff,0x736346,2));
const sun = new THREE.DirectionalLight(0xffe1b0,3);sun.position.set(30,60,10);scene.add(sun);
const collector = new ReviewCollector();
const materials = new MaterialSystem({renderer});
const systems={materials,render:{renderer}};
const ctx={scene,camera,rng:new Rng(0x5eed1234),config:{quality:'medium',q:{anisotropy:4}},reviewCapture:collector,get:id=>systems[id],peek:id=>systems[id]};
// Match deterministic main.js initialization: RenderSystem then PhysicsSystem
// each fork ctx.rng once before WorldSystem (see their init methods).
ctx.rng.fork(); ctx.rng.fork();
const t0=performance.now();
await materials.init(ctx);
const world=new WorldSystem();systems.world=world;
await world.init(ctx);
const registry=new SceneAssetRegistry(buildId);
const ownedGeometry=new Set(), ownedMaterials=new Set(), ownedTextures=new Set();
const textureCache=new Map(), materialCache=new Map();
const targets=new Map(materials._forge._owned.map(rt=>[rt.texture,rt]));
const materialSources={};
const averageColors=new Map();
const yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0));
function mapTexture(source, mode = 'raw', threshold = 0.45) {
 if (!source) return null;
 const cacheKey=`${source.uuid}:${mode}:${threshold}`;
 if(textureCache.has(cacheKey))return textureCache.get(cacheKey);
 const rt=targets.get(source);if(!rt)throw new Error(`No exportable generated texture: ${source.name}`);
 const bytes=new Uint8Array(rt.width*rt.height*4);renderer.readRenderTargetPixels(rt,0,0,rt.width,rt.height,bytes);
 if(mode==='alpha')for(let i=0;i<bytes.length;i+=4){const a=bytes[i+3]/255>=threshold?255:0;bytes[i]=a;bytes[i+1]=a;bytes[i+2]=a;bytes[i+3]=255}
 if(mode==='albedo')for(let i=3;i<bytes.length;i+=4)bytes[i]=255;
 const canvas=document.createElement('canvas');canvas.width=rt.width;canvas.height=rt.height;
 const context=canvas.getContext('2d');context.putImageData(new ImageData(new Uint8ClampedArray(bytes.buffer),rt.width,rt.height),0,0);
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=mode==='alpha'?THREE.NoColorSpace:source.colorSpace;texture.wrapS=source.wrapS;texture.wrapT=source.wrapT;texture.flipY=false;
 texture.name=source.name;textureCache.set(cacheKey,texture);ownedTextures.add(texture);return texture;
}
function sourceAverageColor(source) {
 if (!source) return new THREE.Color(0xb2a28d);
 if (averageColors.has(source)) return averageColors.get(source).clone();
 const rt=targets.get(source);if(!rt)return new THREE.Color(0xb2a28d);
 const bytes=new Uint8Array(rt.width*rt.height*4);renderer.readRenderTargetPixels(rt,0,0,rt.width,rt.height,bytes);
 let r=0,g=0,b=0,n=0;for(let i=0;i<bytes.length;i+=64){r+=bytes[i];g+=bytes[i+1];b+=bytes[i+2];n++;}
 const color=new THREE.Color(r/n/255,g/n/255,b/n/255);if(source.colorSpace===THREE.SRGBColorSpace)color.convertSRGBToLinear();
 averageColors.set(source,color);return color.clone();
}
function reviewMaterial(key,detail) {
 const cacheKey=`${key}:${detail}`;if(materialCache.has(cacheKey))return materialCache.get(cacheKey);
 const live=world.A.mat(key);const palette=PALETTE[key];
 const m=new THREE.MeshStandardMaterial({name:`palette-${key}`,side:live.side,roughness:live.roughness,metalness:live.metalness,transparent:live.transparent,opacity:live.opacity,alphaTest:live.alphaTest});
 m.color.copy(sourceAverageColor(live.map));if(live.userData.owParams?.tint)m.color.multiply(new THREE.Color(live.userData.owParams.tint));
 if(detail){m.color.copy(live.color);if(live.userData.owParams?.tint)m.color.multiply(new THREE.Color(live.userData.owParams.tint));m.map=mapTexture(live.map,'albedo');if(live.alphaTest>0||live.userData.owParams?.alphaMask)m.alphaMap=mapTexture(live.map,'alpha',live.alphaTest||0.45);m.normalMap=mapTexture(live.normalMap);m.roughnessMap=mapTexture(live.roughnessMap);m.metalnessMap=m.roughnessMap;m.normalScale.copy(live.normalScale);}
 m.emissive.copy(live.emissive);m.emissiveIntensity=live.emissiveIntensity;
 materialSources[m.name]={palette:`src/world/palette.js#${key}`,library:`src/materials/library.js#${resolveName(palette.name)}`,generator:'src/materials/generator.js#TextureForge',shader:'src/materials/shader.js#DEFAULT_PARAMS'};
 ownedMaterials.add(m);materialCache.set(cacheKey,m);return m;
}
function mappedGeometry(source,key,worldMatrix) {
 const g=source.clone();ownedGeometry.add(g);
 const params=world.A.mat(key).userData.owParams||{};
 if(params.uvMode!=='mesh'){
  const pos=g.getAttribute('position'),norm=g.getAttribute('normal'),uv=new Float32Array(pos.count*2);
  const p=new THREE.Vector3(),n=new THREE.Vector3(),nm=new THREE.Matrix3().getNormalMatrix(worldMatrix);
  for(let i=0;i<pos.count;i++){p.fromBufferAttribute(pos,i);n.fromBufferAttribute(norm,i);if(!params.localSpace){p.applyMatrix4(worldMatrix);n.applyMatrix3(nm).normalize()}
   const a=[Math.abs(n.x),Math.abs(n.y),Math.abs(n.z)],scale=1/(params.scale||2);let u,v;
   if(a[0]>a[1]&&a[0]>a[2]){u=p.z;v=p.y}else if(a[1]>a[2]){u=p.x;v=p.z}else{u=p.x;v=p.y}
   uv[i*2]=u*scale+(params.offset?.[0]||0);uv[i*2+1]=v*scale+(params.offset?.[1]||0);
  }g.setAttribute('uv',new THREE.BufferAttribute(uv,2));
 }
 return g;
}
function transform(matrix){const p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();matrix.decompose(p,q,s);const e=new THREE.Euler().setFromQuaternion(q,'XYZ');return{position:p.toArray(),rotation:[e.x,e.y,e.z].map(v=>THREE.MathUtils.radToDeg(v)),scale:s.toArray()}}
const rows=[];
const representationRoots=new Map();
function deferred({actorId,assetId,name,sourceRef,parentAssemblyId,entries,matrix}){
 const bounds=new THREE.Box3();let triangles=0,bytes=0;
 for(const entry of entries){entry.geo.computeBoundingBox();for(const instance of entry.instances||[new THREE.Matrix4()])bounds.union(entry.geo.boundingBox.clone().applyMatrix4(matrix.clone().multiply(instance)));triangles+=(entry.geo.index?.count||entry.geo.attributes.position.count)/3*(entry.instances?.length||1);bytes+=Object.values(entry.geo.attributes).reduce((n,a)=>n+a.array.byteLength,0)+(entry.geo.index?.array.byteLength||0)+(entry.instances?.length||0)*64}
 const center=bounds.getCenter(new THREE.Vector3()).toArray(),size=bounds.getSize(new THREE.Vector3()).toArray();
 registry.registerDeferred({actorId,assetId,name,category:parentAssemblyId?.startsWith('building-')?'Architecture':'Environment',sourceRef,parentAssemblyId,transform:transform(matrix),bounds:{center,size},stream:{capability:'asset-stream-v1',revision:buildId,representations:['overview','detail'].map(id=>({id,purpose:id,revision:`${buildId}-${assetId}-${id}`,estimatedBytes:bytes*2,triangles,attributes:id==='detail'?['position','normal','uv']:['position'],geometricError:0}))},
 async produceRepresentation({representation,signal,reportProgress}){
  const cacheKey=`${assetId}:${representation.purpose}`;
  if(representationRoots.has(cacheKey))return representationRoots.get(cacheKey);
  const root=new THREE.Group();root.name=name;const groups=new Map();const generated=[];let complete=false;
  try {
  for(let i=0;i<entries.length;i++){
   signal.throwIfAborted();const entry=entries[i];const detail=representation.purpose==='detail';
   const geo=detail?mappedGeometry(entry.geo,entry.key,matrix):entry.geo;if(detail)generated.push(geo);
   const material=reviewMaterial(entry.key,detail);
   const mesh=entry.instances?new THREE.InstancedMesh(geo,material,entry.instances.length):new THREE.Mesh(geo,material);
   if(entry.instances){entry.instances.forEach((m,i)=>mesh.setMatrixAt(i,m));mesh.instanceMatrix.needsUpdate=true;}
   mesh.name=entry.key;
   let group=groups.get(entry.part);if(!group){group=new THREE.Group();group.name=entry.part;groups.set(entry.part,group);root.add(group)}group.add(mesh);
   reportProgress({phase:'generating',completed:i+1,total:entries.length});await yieldTask();
  }signal.throwIfAborted();representationRoots.set(cacheKey,root);complete=true;return root;
  } finally {if(!complete)for(const geo of generated){geo.dispose();ownedGeometry.delete(geo)}}
 }});rows.push({actorId,assetId,sourceRef,parentAssemblyId,triangles,bytes});
}
for(const scope of collector.scopes.values()){
 if(!scope.parts.size&&!scope.props.length)continue;
 const owner=scope.id;
 const matrix=new THREE.Matrix4().makeTranslation(...scope.pivot.toArray());
 registry.registerAssembly({assemblyId:owner,name:scope.name,sourceRef:scope.sourceRef,localTransform:transform(matrix)});
 const entries=[];
 for(const [id,acc]of scope.parts){if(acc.empty)continue;const [part,key]=id.split('|');const geo=acc.build();geo.translate(-scope.pivot.x,-scope.pivot.y,-scope.pivot.z);ownedGeometry.add(geo);entries.push({part,key,geo})}
 if(entries.length)deferred({actorId:`${owner}-structure`,assetId:`${owner}-design`,name:`${scope.name} structure`,sourceRef:scope.sourceRef,parentAssemblyId:owner,entries,matrix});
 scope.parts.clear(); // Release copied JS accumulators after typed geometry is retained.
 const microKeys=new Set(['dust_skirt','pock','rock_a','rock_b','litter','weeds']);
 const micro=new Map();
 for(const prop of scope.props){const p=prop.prototype;if(microKeys.has(p.id)){if(!micro.has(p.id))micro.set(p.id,[]);micro.get(p.id).push(prop);continue;}deferred({actorId:prop.id,assetId:`prop-${p.id}`,name:p.id.replaceAll('_',' '),sourceRef:`${scope.sourceRef} / src/world/props.js#${p.id} / src/world/dressing.js#${p.id}`,parentAssemblyId:owner,entries:[{part:p.id,key:p.key,geo:p.geo}],matrix:prop.matrix})}
 for(const [key,placements]of micro){const p=placements[0].prototype;const inverse=matrix.clone().invert();
  deferred({actorId:`${owner}-context-${key}`,assetId:`${owner}-context-${key}-design`,name:`${scope.name} / ${key.replaceAll('_',' ')} context`,sourceRef:scope.sourceRef,parentAssemblyId:owner,entries:[{part:`${key} instances`,key:p.key,geo:p.geo,instances:placements.map(item=>inverse.clone().multiply(item.matrix))}],matrix});
 }
 await yieldTask();
}
// Capture never rebuilds render/collision batches: release their construction arrays.
world.A._static.clear();world.A._collide.clear();
const loopback=['localhost','127.0.0.1','[::1]'].includes(location.hostname);
const authorization=createSpatialReviewEditorAuthorization({allowOfficialEditor:true,allowedOrigins:[],allowLoopbackPeers:loopback});
const detach=attachSceneAssetRegistryBridge(registry,{authorization,maxGeometryBytes:64*1024*1024,maxConcurrentAssetRequests:1,maxInFlightBytes:64*1024*1024,maxQueuedAssetRequests:32});
// Capture preview uses the actual website materials and complete generated world.
renderer.render(scene,camera);
status.textContent=`Source review ready · ${registry.size.toLocaleString()} placements · select Scene or Asset in the editor`;
window.__SPATIAL_REVIEW__={registry,rows,materialSources,world,collector,metrics:{readyMs:performance.now()-t0,actors:registry.size,assemblies:registry.assemblySize,world:world.stats},dispose};
window.__READY__=true;
function dispose(){detach();world.dispose();materials.dispose();for(const g of ownedGeometry)g.dispose();for(const m of ownedMaterials)m.dispose();for(const t of ownedTextures)t.dispose();renderer.dispose();textureCache.clear();materialCache.clear();representationRoots.clear();averageColors.clear()}
addEventListener('pagehide',dispose,{once:true});if(import.meta.hot)import.meta.hot.dispose(dispose);
