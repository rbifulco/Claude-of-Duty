import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
const label = process.argv[2] || 'baseline';
const url = process.argv[3] || 'http://127.0.0.1:4312/';
mkdirSync('docs/evidence',{recursive:true});
const browser = await chromium.launch({headless:true,args:['--use-angle=metal','--ignore-gpu-blocklist','--force-color-profile=srgb','--mute-audio']});
try {
 const page = await browser.newPage({viewport:{width:960,height:600},deviceScaleFactor:1});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url+'?capture=1&lockstep=1&q=medium');
 await page.waitForFunction(()=>window.__READY__,null,{timeout:120000});
 const readyMs = await page.evaluate(()=>performance.now());
 await page.evaluate(()=>window.__APPLY_SHOT__('hero'));
 await page.evaluate(()=>window.__PUMP__(12));
 await page.screenshot({path:`docs/evidence/${label}-hero.png`});
 const rendering=await page.evaluate(()=>({info:window.__RENDER_INFO__,world:window.__ENGINE__.ctx.get('world').stats}));
 const before=await page.evaluate(()=>{const e=window.__ENGINE__;e.input.enabled=true;e.input.frozen=false;e.ctx.get('player').setControlEnabled(true);return e.camera.position.toArray()});
 const start=Date.now();await page.keyboard.down('w');await page.evaluate(()=>window.__PUMP__(30));await page.keyboard.up('w');
 const interactionMs=Date.now()-start;
 const after=await page.evaluate(()=>window.__ENGINE__.camera.position.toArray());
 const fire=await page.evaluate(async()=>{const e=window.__ENGINE__;let n=0;const off=e.events.on('weapon:fire',()=>n++);e.ctx.get('weapons').debugPose('fire',{grabFrame:1});await window.__PUMP__(15);off();return n});
 const report={label,url,readyMs,interactionMs,before,after,moved:Math.hypot(...after.map((n,i)=>n-before[i])),fire,rendering,errors};
 writeFileSync(`docs/evidence/${label}-parity.json`,JSON.stringify(report,null,2));console.log(report);
} finally {await browser.close()}
