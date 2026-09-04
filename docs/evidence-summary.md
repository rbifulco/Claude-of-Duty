# Fresh Claude of Duty integration — acceptance record

Status: **not yet accepted or published**. The fresh producer passes source, build, gameplay parity and representative live-resource checks. The actual local editor stops during asset preparation with a React update-depth error; Scene/Asset feedback export and refreshed-source review remain unverified.

## Source and dependency provenance

- Original: `d9b237b75c9304ab8d9ef4cfa0c3568c7c11a853`, exactly `main` and `upstream/main`.
- New isolated branch/worktree: `spatial-review-fresh` / `Claude-of-Duty-spatial-review-fresh`.
- Published npm SDK/protocol: **0.7.0**, exact SDK pin with registry integrity lock; Three.js **0.180.0**, deduplicated.
- Existing publication remains https://rbifulco.github.io/Claude-of-Duty/ at rollback source `1d6a08f3b72d936b10c3be7f3ba1bb07c8b1d06c`. Neither old branch/worktree nor remote Pages configuration has been changed.

## Passed checks

- Pre-change original build, new Pages-base build and `npm run test:spatial-review`.
- Exact original render/collision buffer, instance matrix/mask, light and RNG equality, with observer inactive and active. Digest: `ddc640540487b2eaf82ba0e24de51bf2c8cfd0bb6ccb0aff1b3c3a79840785b6`.
- Ordinary screenshot: zero changed RGBA channels. Same 2.07052065m movement, 7 fire events, 220 world draw calls and rendering resource counts. Both tests used new browser contexts at 960×600/DPR1 with deterministic medium-quality lockstep input. Driver shader caches warmed across the session; startup samples are not evidence of a cold-start speedup.
- Final capture retains **606,374 static triangles and all 8,008 original prop instances**, represented as **3,070 actors and 26 owners**. Small rocks, pocks, dust, litter and weeds use exact instanced geometry context families; no coarse proxies or decimation.
- Final capture bootstrap 1.27s, metadata catalog 24.8ms in the warm sample. BE1 detail 1,931,381 bytes; satellite dish detail 31,431 bytes. Thirty BE1 and three dish unique texture resources returned valid PNG bytes through the live SDK resource path, without a direct URL or credential-bearing source string.
- Static project-relative discovery resolves from the ordinary website URL to `/Claude-of-Duty/spatial-review.html`; the local actual editor found that integration and accepted its final catalog.

## Unmet acceptance checks

- Actual local editor reached asset preparation, then failed: `Could not prepare Building E2 / rock b context: Maximum update depth exceeded`. One visible UI Retry progressed to 144/168 prepared assets and returned the same terminal failure. Browser closed; publication held.
- Error evidence: `evidence/local-editor-failure.txt`, `evidence/local-editor-failure.png`, and `evidence/local-editor-retry-failure.txt/.png`. Debugger logs captured the prior request's expected cancellation but not the original React stack; they do not establish causation.
- Read-only consumer source trace: Scene uses `warmAssetTextures` with no preview callback. That function synchronously notifies texture listeners even for an empty map list; a listener's React error can be caught as an asset preparation error. This is an investigation lead, not a proven fix.
- Actual Scene/Asset review, editor-produced feedback IDs/source references, unresolved feedback retention and source-change/refresh round trip remain unverified. The source fixture's IDs are not presented as editor feedback evidence.
- Hosted editor with local producer was rejected by automatic approval review. No workaround was attempted. Existing-public-URL verification is separately authorized by the user's prior explicit request naming that official editor and public page, but must follow successful local acceptance and publication.

## Fidelity and scope

Exact environment construction is exported. Custom weathering, triplanar blending, parallax, normal amplitude, physical-material extensions, game lighting and postprocessing remain unsuitable for final appearance signoff in the editor. Scene uses sampled source-albedo colors and omits maps by protocol; foliage cutout/occlusion review requires Asset detail, whose source-derived alphaMap compensates for the SDK's omitted alphaTest field. Ordinary game appearance is unchanged.

Compared with the older production integration, six AI boot-pose actors are intentionally excluded from this environment-focused new baseline. Canonical props preserve their original fused mesh construction; the integration does not invent separate subpart geometry. Small-instance placement editing is outside scope; exact instance context remains visible. See the integration plan for coordinate inversion, source mapping, lifecycle, permission and migration details.

## Bounded consumer diagnosis

The exact E2 rock-b source family contains one 20-triangle instance, finite source matrices and no texture maps. It passes the current consumer's `liveCatalogWithinLimits` validator when serialized from the actual source geometry (`evidence/e2-source-validation.json`). A GPU-disabled isolated React diagnostic using the real `useWorkspaceAssets` and texture notifier prepared 168 no-texture assets successfully, with 168 texture notifications and no error (`evidence/no-texture-react-diagnostic-before.json`). Therefore the simple notification-count hypothesis did **not** reproduce the complete UI failure, and no speculative editor patch is presented as a fix.

Local editor source was clean at `d9576b2e0cd3ee5e215e762b2ded39ad83f3c60c`. The public editor entry bundle is `app-CHcQrd-n.js`, while the existing local dist has `app-BCFjpmuv.js`; no public source-revision metadata was found. Those artifacts do not establish that production is the same source revision. Public producer verification remains unrun. The existing live site remains untouched.
