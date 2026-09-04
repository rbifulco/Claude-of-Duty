import { chromium } from 'playwright';
import {writeFileSync} from 'node:fs';
const browser=await chromium.launch({headless:true,args:['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio']});
try{
 const page=await browser.newPage({viewport:{width:960,height:600}});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>m.type()==='error'&&errors.push(m.text()));
 await page.goto('http://127.0.0.1:4312/spatial-review.html');await page.waitForFunction(()=>window.__READY__,null,{timeout:120000});
 await page.screenshot({path:'docs/evidence/capture-preview.png'});
 const report=await page.evaluate(async()=>{
  const {registry,rows,metrics,materialSources}=window.__SPATIAL_REVIEW__;const time=performance.now();
  const catalog=registry.toReviewIndex('scene',false,true,true,true);const catalogMs=performance.now()-time;
  const subjects=[rows.find(r=>r.actorId==='building-BE1-structure')||rows.find(r=>r.actorId.includes('building')&&r.actorId.endsWith('structure')),rows.find(r=>r.assetId==='prop-sat_dish')];
  const results=[];
  for(const subject of subjects){if(!subject)throw new Error('Missing representative subject');const start=performance.now();const result=await registry.produceAssetRepresentation(subject.assetId,'review','detail',64*1024*1024,'interactive',new AbortController().signal);const resources=[];const seen=new Set();
   const inspect=async(value)=>{if(!value||typeof value!=='object')return;if(value.resourceId&&!seen.has(value.resourceId)){seen.add(value.resourceId);const data=await registry.readTextureResource(value.resourceId,16*1024*1024);resources.push({resourceId:value.resourceId,available:!!data,type:data?.contentType,bytes:data?.bytes?.byteLength||data?.data?.byteLength})}for(const v of Object.values(value))if(v&&typeof v==='object'&&!ArrayBuffer.isView(v))await inspect(v)};
   await inspect(result.asset);results.push({subject,ms:performance.now()-start,bytes:result.bytes,asset:result.asset,resources});
  }
  return{metrics,catalogMs,catalog:{schema:catalog.schema,actors:catalog.scene?.actors?.length,assemblies:catalog.scene?.assemblies?.length,assets:catalog.assets?.length},results,materialSources};
 });
 writeFileSync('docs/evidence/capture-check.json',JSON.stringify({...report,errors},(k,v)=>ArrayBuffer.isView(v)?{type:v.constructor.name,length:v.length}:v,2));
 console.log(JSON.stringify({metrics:report.metrics,catalogMs:report.catalogMs,subjects:report.results.map(r=>({id:r.subject.actorId,bytes:r.bytes,ms:r.ms,resourceCount:r.resources.length,allResourcesAvailable:r.resources.every(x=>x.available)})),errors},null,2));
}finally{await browser.close()}
