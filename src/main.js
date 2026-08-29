import { Engine } from './core/engine.js';
import { createConfig } from './core/config.js';

import { RenderSystem } from './render/index.js';
import { MaterialSystem } from './materials/index.js';
import { SkySystem } from './sky/index.js';
import { WorldSystem } from './world/index.js';
import { PhysicsSystem } from './physics/index.js';
import { PlayerSystem } from './player/index.js';
import { WeaponSystem } from './weapons/index.js';
import { FxSystem } from './fx/index.js';
import { AiSystem } from './ai/index.js';
import { UiSystem } from './ui/index.js';
import { AudioSystem } from './audio/index.js';

import { installShotApi, SHOTS } from './dev/shots.js';
import { prewarm } from './core/prewarm.js';
import {
  attachClaudeOfDutyDiscovery,
  attachClaudeOfDutyScene,
  shouldBootClaudeOfDutyPage,
  SPATIAL_REVIEW_SEED,
} from './spatial-review.js';

const params = new URLSearchParams(location.search);
const capture = params.get('capture') === '1';
const spatialCapture = params.get('spatial-review-capture') === '1';
// Deterministic shutter for the pixel gate: the engine does not schedule its own
// frames, the driver advances exactly N of them through window.__PUMP__. Opt-in,
// because tools that measure real frame pacing (tools/perf.mjs) need the loop to
// free-run. See the long comment in src/dev/shots.js.
const lockstep = capture && params.get('lockstep') === '1';
const detachSpatialReviewDiscovery = attachClaudeOfDutyDiscovery();

// The editor discovers integrations through a hidden iframe. That frame only
// needs the lightweight discovery bridge: booting the full procedural game can
// occupy the event loop longer than the handshake timeout on a cold browser.
// Gameplay runs top-level; the explicitly flagged live capture may run in the
// editor's resource iframe.
if (shouldBootClaudeOfDutyPage({ embedded: window.parent !== window, spatialCapture })) {
  const config = createConfig({
    quality: params.get('q') ?? 'ultra',
    deterministic: capture,
  });

  const canvas = document.getElementById('game');

  const engine = new Engine({ canvas, config });
  // Seed the existing stream before any subsystem forks it. Unlike screenshot
  // mode, this keeps the normal six-enemy garrison in the review inventory.
  if (spatialCapture) engine.rng.seed(SPATIAL_REVIEW_SEED);

  // Registration order is irrelevant — Registry topo-sorts on static deps.
  engine
    .add(RenderSystem)
    .add(MaterialSystem)
    .add(SkySystem)
    .add(WorldSystem)
    .add(PhysicsSystem)
    .add(PlayerSystem)
    .add(WeaponSystem)
    .add(FxSystem)
    .add(AiSystem)
    .add(UiSystem)
    .add(AudioSystem);

  try {
    await engine.init();
  } catch (err) {
    console.error('[boot] init failed', err);
    document.body.insertAdjacentHTML(
      'beforeend',
      `<pre style="position:fixed;inset:0;padding:2rem;color:#f66;background:#000;
         font:12px/1.5 ui-monospace,monospace;overflow:auto;z-index:9999;white-space:pre-wrap">
  BOOT FAILURE\n\n${err.stack ?? err.message}</pre>`
    );
    throw err;
  }

  const shotApi = installShotApi(engine, { capture, lockstep: lockstep || spatialCapture });

  // Compile every shader permutation before the frame loop starts. Measured: without
  // this, 86 programs compile lazily during play, up to 30 on one frame, producing
  // 3.1-3.9 SECOND stalls. See src/core/prewarm.js.
  //
  // ON BY DEFAULT since the capture path was made frame-deterministic; opt out with
  // `?prewarm=0`. It is now PROVEN pixel-neutral: `tools/baseline.mjs` with
  // `--query=prewarm=0` vs `--query=prewarm=1` reports identical:true on all 11
  // shots (0 changed pixels, maxDelta 0). The two things that previously made the
  // ~1.4 s pre-warm spend look like a visual change were both boot-duration
  // couplings OUTSIDE the subsystems: (1) the shutter frame index was latency-bound
  // because the engine kept stepping through the driver's round trips — fixed by
  // lockstep in src/dev/shots.js; (2) `will-change: transform` on the compass strip
  // cached a composited-layer raster taken at a wall-clock-dependent moment — fixed
  // in src/ui/style.js.
  const warmup = spatialCapture || params.get('prewarm') === '0'
    ? { ok: false, reason: spatialCapture ? 'static spatial review capture' : 'disabled by ?prewarm=0' }
    : await prewarm(engine);
  console.info('[boot] prewarm', warmup);
  window.__PREWARM__ = warmup;

  // Register after boot and pre-warm so a review catalog request cannot race the
  // level builder or shader compiler. Serialization remains lazy until an editor
  // explicitly asks for the scene.
  const spatialReview = attachClaudeOfDutyScene(engine);
  window.__SPATIAL_REVIEW__ = spatialReview;

  if (!spatialCapture) engine.start();

  // Capture harness handshake: only flag ready once a frame has actually landed.
  //
  // BOOT_FRAMES is deliberately a frame COUNT, not a rAF race. In lockstep mode the
  // engine has no loop of its own, so we hand-pump exactly this many frames and only
  // then raise __READY__; the shot is therefore always applied at engine frame 3, no
  // matter how long boot (or pre-warm) took in wall-clock terms.
  const BOOT_FRAMES = 3;
  if (spatialCapture) {
    // Keep the resource bridge alive without running combat behind the editor.
    // No simulation step occurs: catalog requests see the same authored boot pose.
    engine.input.frozen = true;
    engine.input.enabled = false;
    // The player has not run an update, so explicitly pose the camera instead of
    // rendering from the engine's initial origin. This does not move any actors.
    engine.camera.position.fromArray(SHOTS.hero.pos);
    engine.camera.lookAt(...SHOTS.hero.look);
    engine.camera.fov = SHOTS.hero.fov;
    engine.camera.updateProjectionMatrix();
    // The unregistered first-person rig also has not been posed by its update.
    engine.ctx.get('weapons').viewmodel.anchor.visible = false;
    engine.ctx.get('render').render(engine.ctx);
    window.__READY__ = true;
  } else if (lockstep) {
    await shotApi.pump(BOOT_FRAMES);
    window.__READY__ = true;
  } else {
    let warm = 0;
    const readyProbe = () => {
      if (++warm >= BOOT_FRAMES) {
        window.__READY__ = true;
        return;
      }
      requestAnimationFrame(readyProbe);
    };
    requestAnimationFrame(readyProbe);
  }

  window.__ENGINE__ = engine;

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      spatialReview.dispose();
      detachSpatialReviewDiscovery();
      delete window.__SPATIAL_REVIEW__;
      engine.dispose();
    });
  }
}
