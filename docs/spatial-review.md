# Spatial Review integration — ownership v7

This is a refinement of the existing integration using the current
[installation procedure](https://github.com/rbifulco/alterno-spatial-review/blob/main/agents/install.md).
The existing official-editor authorization is retained. No production origins,
registered data categories, or framing permissions have been added.

## Inventory and upgrade plan

| Area | Decision / authoritative source |
| --- | --- |
| Dependencies | Pin the published npm SDK/protocol 0.6.0 release, sharing the game's Three.js 0.180.0. Cross-repository validation can still inject a sibling SDK build explicitly for pre-release changes. |
| Actors | Transform-only owners for buildings, palms, lamps, sandbag walls, and the gate. Register structure and attached fixtures as independent child placements. Keep loose placements at World; retain broad context zones. |
| Assets | Preserve placement-specific procedural structure assets. Every repeated prop, attached or loose, references its canonical `prop-*` prototype asset. Stream structures, enemies, and repeated props through the same request-driven path so the initial catalog is metadata-only. |
| Navigation | Keep the five-view review tour sourced from `SHOTS` in `src/dev/shots.js`. Linear transitions are a review-only approximation, not a gameplay route. |
| Capture | Use the existing RNG with fixed seed `0x5eed1234`, six boot-pose enemies, and no running simulation, gameplay render, or frame-stat polling. The hidden resource frame omits sky, player/weapons, combat FX, HUD, and audio systems and uses a small deterministic AI texture bake because none of those resources enter the review catalog. Ordinary gameplay remains unchanged. |
| Performance | Publish project-relative discovery, keep the frozen one-frame capture, and permit two concurrent 64 MiB geometry requests within a 128 MiB aggregate reservation and 32-request queue. With `asset-stream-v1`, publish all prop transforms/bounds immediately and construct the 3,206 review-only placement mirrors only when their shared asset is requested. |
| Lifecycle | Discovery starts on the ordinary entry page; an unflagged editor iframe serves only that lightweight bridge so cold game boot cannot starve the handshake. The scene bridge starts after construction in top-level play or the explicitly flagged live-capture iframe. Both detach on HMR. Refresh rebuilds the snapshot; SDK 0.6.0 adds deferred representations, status, cancellation, typed instances, and bounded streaming. The compatibility path retains eager geometry for SDKs without `registerDeferred`; current catalogs require `asset-stream-v1` for scene geometry. |

The installed 0.6.0 SDK supports cached transforms/bounds, ref-counted runtime
resources, negotiated progressive/transferable geometry, deferred asset
representations, bounded streaming, and transform-only
assemblies. Hierarchy-aware editors receive the v7 ownership graph; consumers
that do not negotiate hierarchy receive a flattened world-space catalog. The
adapter retains `registerAssembly` feature detection so an explicitly installed
0.4.0 SDK still receives the existing composite flat graph. This upgrade does
not deploy or modify the editor itself. The ownership refinement follows
[Structuring for review](https://github.com/rbifulco/alterno-spatial-review/blob/main/agents/structuring-for-review.md).

The bridge also advertises `.well-known/spatial-review.json` under the GitHub
Pages project path. New clients resolve that project-relative locator without
probing only the origin root; the browser bridge remains the fallback. Streaming
limits are intentionally conservative because the editor can keep multiple
source frames alive: two active 64 MiB families, a 128 MiB aggregate reservation,
and 32 queued requests per frame. Two families prevent the initial overview stream
from being serialized behind a single slow asset while retaining bounded memory.

With SDK 0.6.0, `registerDeferred` lets every placement publish accurate world
transforms and geometry-derived bounds before its geometry is serialized. Repeated
prop factories are materialized only for a requested overview/detail family;
existing structure and enemy roots are serialized through that same bounded path.
All producers report progress and honor cancellation. The adapter's older-SDK and
cross-runtime compatibility paths still register geometry eagerly.

## Assembly ownership

The accepted live scene contract uses explicit `scene-assemblies-v1` ownership.
Categories, layers, tags, actor-name prefixes, and render batches do not establish
transform inheritance. Each authored owner is a geometry-free assembly; its
structure and fixtures remain independently selectable placements.

| Scene owner | Owned placements | World-level surroundings/contents |
| --- | --- | --- |
| Each building | Foundation, floors/facades/bays, roof, interiors, drains, mounted AC/conduit/signage, roof dishes/tanks/vents, attached lines and cloth | Loose roof/balcony/interior/doorway props |
| Market gate | Gatehouses/tower, arch, walkway, aerial, four elevated sandbag runs | Ground sandbag walls, crates, barrels, checkpoint clutter |
| Each palm (7) | Trunk and crown/fronds | Planters, weeds, dirt, litter |
| Each street lamp (5) | Post, lens, optional attached sign | Ground skirts and nearby clutter; lighting is not exported |
| Each freestanding sandbag wall (12) | All bags grouped by course | Ground skirts, spilled grit and adjacent cover props |

Ownership is authored at construction call sites via `beginReviewAssembly` and
`withReviewPart(..., { ownProps: true })`. `setReviewScope` records provenance
but does **not** attach every prop in a region. `src/world/review.js` captures
static construction, geometry-free pivots, and placements in detached review-only
roots. The adapter registers each owned prop once with `parentAssemblyId`; each
captured piece has exactly one owner. It also retains separate composite roots
only for the older-SDK flat fallback. The normal material/instance batches are unchanged.

Building structure assets expose construction groups, not just one palette mesh:
`Floor 1 / Facade north / Bay 1 door`, `Roof / Services`, `Interiors / Floor 1`,
etc. Palette meshes remain leaves *within* these responsibilities. Attached ACs,
dishes and bags are separate Scene placements with shared prototype buffers and
canonical `prop-*` asset IDs.

Structure asset IDs are placement-specific (`environment-building-be1`, etc.).
Procedural construction, materials, and damage can differ, so those structures
are not falsely declared the same canonical design. Repeated attached and loose
props share `prop-*` assets: an AC can be edited as one placement in Scene, while
shared-design changes remain attached to `prop-ac-unit` in Asset Review.

This reduces Scene actor bookkeeping; it does not decimate triangles or promise
lower editor draw counts. Named construction adds detailed component nodes.
Review capture remains opt-in and does not add meshes to the game's render graph.
The editor reconstructs the review viewport from streamed geometry; the hidden
capture iframe deliberately does not compile or present a gameplay frame.

## Identity and source mapping

`ownership-v7` identifies the accepted ownership/hierarchy change. Builds may supply
`VITE_GIT_COMMIT`; local fallback is explicitly `development`. Start a fresh v7
baseline and keep older feedback separately. A former composite actor ID such as
`building-be1` now identifies the assembly; its geometry placement is
`building-be1-structure`. Attached prop placement IDs become Scene targets again,
and their shared design uses the existing `prop-*` asset ID. Never replay v6
composite transforms or component edits without an explicit mapping.

- Assembly scopes use authored building IDs or stable IDs appended to the
  `SET_PIECES` tuples in `layout.js`. Additional sandbag IDs are explicit at the
  `coverClusters` and `buildGate` call sites in `dressing.js`.
- Prop actors use scope + prototype + ordinal within that scope/prototype. These
  remain stable for unchanged source and seed, but inserting an earlier placement
  in the same scope/prototype requires accounting for shifted feedback targets.
- Shared `prop-*` asset IDs resolve to the prototype factory in `props.js` or
  `registerDressingProps`. Actor IDs additionally identify the owning placement
  scope in `index.js` / `dressing.js`; exported component suffixes identify the
  canonical mesh, not an automatically discovered source symbol.
- Structure component references append the generated node ID to the structure's
  `sourceRef`; arbitrary per-node `userData` is not an SDK source-reference
  override. For example, `BUILDINGS.BE1` leads through `buildBuilding` to
  `Floor 1 / Facade north / Wall` in `buildFacade`, and through `dressBuilding`
  Attached fixture placements use the matching seeded `ac_unit` call in
  `dressBuilding`; their canonical design maps to `registerProps`.
  Palm/lamp tuple IDs resolve through `palms`/`streetLamps`; sandbag IDs through
  `sandbagWall` and its named caller. These are composite locators, not literal
  JavaScript member-expression paths.
- World geometry uses metres, Y up. `Assembler.xform` converts level coordinates
  to world coordinates; `world.worldToLevel` reverses position feedback.
  Orientations/scales must be converted through the full inverse matrix, not
  treated as raw local Euler edits.
- Assembly pivots use `Assembler.xform * authoredAssemblyFrame`: building/gate
  translation, or palm/lamp/wall translation and yaw. Static structure vertices
  are converted by the inverse of that frame; owned placement roots retain their
  exact original world matrices and the SDK derives parent-local poses. No runtime
  geometry is moved. For a placement edit, compose its local transform through
  the assembly frame before translating the result into the source generator. Static
  component
  vertices currently use the assembly frame; their origins are not individual
  part centers. Scene placement edits must update the owning source construction
  and corresponding collision/light placement, not only this detached review graph.
- The scene editor keeps each owned placement's source root as its editing pivot
  and stores geometry bounds separately. Apply parent-local placement feedback
  through the assembly frame. Exported dimensions are not `Object3D.scale`, and
  the bounds center is not necessarily the source pivot. Asset edits remain
  asset-local.
- Tour camera/aim/FOV values are already world-space values in `SHOTS`. Shared
  stop IDs connect adjacent segment endpoints. Timing/interpolation changes apply
  to the review adapter, not a nonexistent gameplay camera rail.

## Scope and known limitations

Ground/street micro-scatter, bullet pocks, and generated contact fillets remain
excluded, as in v4. Weapons, UI, transient combat effects, collision helpers, and
other unregistered content are not added by this upgrade.

Procedural prop factories still return flattened meshes: a dish's mount and bowl
are not separately editable inside the canonical dish asset, although each
attached dish is an independent Scene placement. Ground, perimeter structures,
and remaining street fixtures/dressing
retain broad context scopes. This change does not split every market stall,
perimeter structure, weathering mark or decorative fragment into a new assembly.
There are no new lightweight geometry proxies or automatic scene layers/locks.

The editor does not reproduce the game's custom shaders, procedural vertex-mask
weathering, lighting, or postprocessing. Texture/material fidelity and the tour's
time-of-day changes must be checked in the game. The normal page remains playable;
the advertised capture page is an intentionally frozen boot-state snapshot.

## Verification

`npm run test:spatial-review` tests full-world render/collision buffer, instance
mask, light and RNG neutrality; exact owned-placement world poses; explicit
ownership counts; owner move/rotate/scale/hide isolation; no duplicate actors;
named source-linked structure hierarchy; transform-only ownership, independent
shared child placements, flat fallback; world-space paint in assembly-local
geometry; shared resource disposal and scope restoration. It also covers
separate actor/shared asset identity, progressive descriptors
and typed geometry, cache refresh, bridge origin/window-source restrictions,
transfer-buffer ownership, project-relative discovery, cleanup, and camera/aim
source mappings. With `SPATIAL_REVIEW_SDK_PATH`, it additionally verifies that
all prop actors remain present in streamed catalogs, mirrors are deferred, and a
requested canonical detail representation is generated on demand.

`npm run build` verifies the production bundle. `npm ls` must show registry
packages (not local links) and a single Three.js 0.180.0 runtime. The installed
dependency tree reports an existing `nanoid` advisory in Vite's development
toolchain; it is unrelated to Spatial Review and is not automatically upgraded.
For pre-release SDK development, run a sibling build in a browser without
changing the production dependency:

```sh
SPATIAL_REVIEW_SDK_PATH=/absolute/path/to/alterno-spatial-review \
  npm run dev -- --config tests/vite.ownership.config.js
```

Connect a local editor to `http://127.0.0.1:5174/`. The test-only alias is not
used by ordinary builds or the deployed Pages branch.

### Ownership-first migration verification (v7, 2026-08-29)

- All 17 adapter tests pass with the published registry SDK/protocol 0.5.0; the
  optional sibling-build injection exercises the same ownership assertions for
  pre-release SDK changes. The deterministic harness exports 45 transform-only
  assemblies, 26 structure/context placements, and 3,206 owned or World-level
  prop placements referencing 58 canonical prop assets.
- Owners contain no geometry. Building BE1's structure and attached AC placements
  point to `building-be1`; ACs under other buildings retain distinct actor IDs and
  the same `prop-ac-unit` asset ID.
- Hierarchical and flattened exports contain the same visible placements; the
  flat form has no dangling owners or local transforms. Hiding BE1 removes only
  its descendants from flat fallback.
- The same run compares the capture-enabled world with an ordinary build and
  retains identical render/collision buffers, instance masks, lights, RNG state,
  211 draw calls, and original placement world matrices.
- Browser validation from a fresh loopback editor origin resolved all 3,216 live
  asset meshes with no warnings or errors. The Ownership tree showed Building BE1
  as a transform-only owner with 14 children; its structure and AC placements
  were independently focusable, and the selected AC reported its shared design
  across 110 placements. The discovery-only iframe gate also kept a cold game
  boot from consuming the editor's handshake window.
- Published SDK/protocol 0.5.0 activate the ownership-capable v7 capture. The
  adapter's explicit 0.4.0 compatibility path passed the migration fallback suite;
  consumers that do not negotiate hierarchy still receive a flattened export.

### Assembly refinement verification (v6, 2026-08-28)

- All 15 integration tests, the production build with `/Claude-of-Duty/` base,
  the Pages path/build-identity check, and `git diff --check` passed.
- A separate full-world comparison against pre-change commit `d4d0357` found
  byte-identical render/collision buffers, instance masks, light placements and
  final RNG state. The fixture has 211 draw calls, unchanged with capture enabled.
- A fresh editor origin (`127.0.0.1:5179`) connected to the game on port 5174:
  2,497 actors (previously 3,216), comprising 50 assemblies/context objects,
  2,441 loose placements from 47 shared prop assets, and six enemies. There are
  743 attached components and 100 catalog assets. The standalone test harness
  uses a different subsystem RNG entry state, so its totals differ from the game.
- Building BE1 loaded 28,932 triangles and 283 hierarchy nodes. Expanding
  `Facade services` exposed independently selectable AC components; `Ac unit 1`
  showed the owner source reference plus `environment-building-be1-ac-unit-1-1-1-6`,
  parent-local pose, normals, UV0, and its assigned material. Construction is
  visibly intact in wireframe.
- Scene accepted a BE1 position edit and auto-captured one change; Hide/Show
  toggled the actor's visibility state. Exact descendant transform/hide
  inheritance and unrelated-owner isolation are covered by automated tests,
  not an exhaustive visual audit of every editor mesh.
- Palm west-entry loaded 17 nodes with distinct Trunk and Crown groups. Hiding
  Crown visibly removed the fronds while retaining the trunk.
- No browser warnings/errors were reported in these checks. Detailed textured
  building preview appeared dark; wireframe and texture-disabled albedo were
  used for geometry inspection. Shader/material fidelity remains unverified.
  The Scene UI reported 2,488/2,497 resolved meshes; complete editor geometry
  loading, asset gizmo edits and surface-pin round trips are not claimed tested.
  Test feedback is isolated to the temporary editor origin; no source placement
  or user's existing review was changed by those UI edits.

### Earlier SDK upgrade verification (v5 baseline, 2026-08-28)

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
