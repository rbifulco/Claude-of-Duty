# Spatial Review integration — SDK 0.4.0

This is a refinement of the existing integration using the current
[installation procedure](https://github.com/rbifulco/alterno-spatial-review/blob/main/agents/install.md).
The existing official-editor authorization is retained. No production origins,
registered data categories, or framing permissions have been added.

## Inventory and upgrade plan

| Area | Decision / authoritative source |
| --- | --- |
| Dependencies | Replace moving sibling-checkout links with npm SDK/protocol 0.4.0, sharing the game's Three.js 0.180.0. Baseline production build passed. |
| Actors | Preserve semantic static scopes in `src/world/index.js`, per-building dressing scopes, and independent prop placements captured by `Assembler.place`. |
| Assets | Preserve canonical prototype IDs and variants in `props.js` / `dressing.js`. Name prop review roots after the prototype rather than its first placement. |
| Navigation | Keep the five-view review tour sourced from `SHOTS` in `src/dev/shots.js`. Linear transitions are a review-only approximation, not a gameplay route. |
| Capture | Use the existing RNG with fixed seed `0x5eed1234`, six boot-pose enemies, one hero-view render, and no running simulation or frame-stat polling. Hide the unposed first-person rig in this snapshot only. Ordinary gameplay remains unchanged. |
| Lifecycle | Discovery starts on the ordinary entry page; the scene bridge starts after construction. Both detach on HMR. Refresh rebuilds the snapshot; SDK 0.4.0 negotiates progressive assets automatically. |

The installed 0.4.0 SDK supports cached transforms/bounds, ref-counted runtime
resources, and negotiated progressive/transferable geometry. Older editors can
still request the complete JSON catalog. This upgrade does not deploy or modify
the editor itself.

## Identity and source mapping

`semantic-v5` identifies the seeded-capture/component-name change. Builds may
supply `VITE_GIT_COMMIT`; local fallback is explicitly `development`. Existing v4
feedback should be retained separately and re-imported against a new baseline,
not assumed to refer to the same randomized placement layout.

- Static scopes use authored building IDs or named environment zones. Materials
  within each scope are review-only meshes; the real game still batches by palette.
- Prop actors use scope + prototype + ordinal within that scope/prototype. These
  remain stable for unchanged source and seed, but inserting an earlier placement
  in the same scope/prototype requires accounting for shifted feedback targets.
- Shared `prop-*` asset IDs resolve to the prototype factory in `props.js` or
  `registerDressingProps`. Actor IDs additionally identify the owning placement
  scope in `index.js` / `dressing.js`; exported component suffixes identify the
  canonical mesh, not an automatically discovered source symbol.
- World geometry uses metres, Y up. `Assembler.xform` converts level coordinates
  to world coordinates; `world.worldToLevel` reverses position feedback.
  Orientations/scales must be converted through the full inverse matrix, not
  treated as raw local Euler edits.
- The scene editor uses a world-aligned, bounds-centered actor frame. Apply a
  scene edit's delta through its imported frame to the original source transform.
  Exported dimensions are not `Object3D.scale`, and the bounds center is not
  necessarily the source pivot. Asset edits use parent-local coordinates.
- Tour camera/aim/FOV values are already world-space values in `SHOTS`. Shared
  stop IDs connect adjacent segment endpoints. Timing/interpolation changes apply
  to the review adapter, not a nonexistent gameplay camera rail.

## Scope and known limitations

Ground/street micro-scatter, bullet pocks, and generated contact fillets remain
excluded, as in v4. Weapons, UI, transient combat effects, collision helpers, and
other unregistered content are not added by this upgrade.

Procedural prop factories currently return flattened meshes. Detailed review can
target a canonical mesh/material/surface, but cannot independently edit parts
such as a dish's mount versus its bowl. Building components remain palette
submeshes within a semantic building. Reconstructing construction-level hierarchy
is a separate source-model refactor, not claimed complete by this package upgrade.

The editor does not reproduce the game's custom shaders, procedural vertex-mask
weathering, lighting, or postprocessing. Texture/material fidelity and the tour's
time-of-day changes must be checked in the game. The normal page remains playable;
the advertised capture page is an intentionally frozen boot-state snapshot.

## Verification

`npm run test:spatial-review` tests render-batch neutrality on representative
builder geometry, separate actor/shared asset identity, progressive descriptors
and typed geometry, cache refresh, bridge origin/window-source restrictions,
transfer-buffer ownership, cleanup, and camera/aim source mappings.

`npm run build` verifies the production bundle. `npm ls` must show registry
packages (not local links) and a single Three.js 0.180.0 runtime. The installed
dependency tree reports an existing `nanoid` advisory in Vite's development
toolchain; it is unrelated to Spatial Review and is not automatically upgraded.

### Local verification, 2026-08-28

- All six integration tests, the production build, and `git diff --check` passed.
  SDK and protocol resolve to registry tarballs at 0.4.0, with one shared Three.js.
- A separate editor origin (`127.0.0.1:5178`) discovered the game on port 5174.
  No existing reviews on the user's editor origin were modified.
- The live scene exported 3,216 actors: 26 semantic static objects, 3,184 prop
  placements using 58 shared prop assets, and six enemies. The detailed catalog
  contained 87 assets. A refreshed capture reproduced the actor count.
- Scene: a Building BE1 comment and position edit exported with actor
  `building-be1`, asset `environment-building-be1`, and the layout source reference.
  Refresh preserved both feedback and the edited position.
- Paths: all five stops/four transitions loaded; changing hero FOV from 75 to 74
  and adding a journey observation exported `set-stop-fov` with stop `hero` and
  source `src/dev/shots.js#SHOTS.hero`. These are test feedback, not source edits.
- Assets: descriptors displayed “Loads on selection”; selecting the dish loaded
  its detailed 436-triangle mesh. Its canonical component reference was
  `prop-sat-dish-sat-dish-1`. An asset observation exported with `prop-sat-dish`
  and `src/world/props.js#registerProps.sat_dish`.
- No browser warnings/errors were reported during these editor checks. The
  frozen capture rendered successfully and ordinary gameplay booted separately.

Not verified: a successful asset gizmo transform (the browser drag checks did
not move the part), surface-pin round trips, every asset's geometry/material
fidelity, production framing/CORS, or application of exported edits back to
source. The Scene UI initially resolved 3,173/3,216 asset meshes; complete
geometry coverage was not audited. These checks establish installation and
representative handoffs, not exhaustive full-loop or visual-fidelity acceptance.
Test observations remain isolated in the temporary editor origin's local state.
