# Spatial Review integration — assemblies v6, SDK 0.4.0

This is a refinement of the existing integration using the current
[installation procedure](https://github.com/rbifulco/alterno-spatial-review/blob/main/agents/install.md).
The existing official-editor authorization is retained. No production origins,
registered data categories, or framing permissions have been added.

## Inventory and upgrade plan

| Area | Decision / authoritative source |
| --- | --- |
| Dependencies | Replace moving sibling-checkout links with npm SDK/protocol 0.4.0, sharing the game's Three.js 0.180.0. Baseline production build passed. |
| Actors | Explicit source-owned assemblies for buildings, palms, lamps and sandbag walls. Keep loose placements independent; retain broad context zones. |
| Assets | Unique assembly asset IDs for procedural construction. Preserve canonical prototype IDs/variants for loose props. Attached prototypes become named components, not duplicated actors. |
| Navigation | Keep the five-view review tour sourced from `SHOTS` in `src/dev/shots.js`. Linear transitions are a review-only approximation, not a gameplay route. |
| Capture | Use the existing RNG with fixed seed `0x5eed1234`, six boot-pose enemies, one hero-view render, and no running simulation or frame-stat polling. Hide the unposed first-person rig in this snapshot only. Ordinary gameplay remains unchanged. |
| Lifecycle | Discovery starts on the ordinary entry page; the scene bridge starts after construction. Both detach on HMR. Refresh rebuilds the snapshot; SDK 0.4.0 negotiates progressive assets automatically. |

The installed 0.4.0 SDK supports cached transforms/bounds, ref-counted runtime
resources, and negotiated progressive/transferable geometry. Older editors can
still request the complete JSON catalog. This upgrade does not deploy or modify
the editor itself. The v6 ownership refinement follows
[Structuring for review](https://github.com/rbifulco/alterno-spatial-review/blob/main/agents/structuring-for-review.md).

## Assembly ownership

The live scene contract is flat. Categories, layers, tags, or actor-name prefixes
do not establish transform inheritance. We prioritize coordinated assembly edits:
one Scene actor per assembly, with its attached parts available in Asset review.
No protocol extension or custom parent-actor field is used.

| Scene owner | Owned components | Independent surroundings/contents |
| --- | --- | --- |
| Each building | Foundation, floors/facades/bays, roof, interiors, drains, mounted AC/conduit/signage, roof dishes/tanks/vents, attached lines and cloth | Loose roof/balcony/interior/doorway props |
| Market gate | Gatehouses/tower, arch, walkway, aerial, four elevated sandbag runs | Ground sandbag walls, crates, barrels, checkpoint clutter |
| Each palm (7) | Trunk and crown/fronds | Planters, weeds, dirt, litter |
| Each street lamp (5) | Post, lens, optional attached sign | Ground skirts and nearby clutter; lighting is not exported |
| Each freestanding sandbag wall (12) | All bags grouped by course | Ground skirts, spilled grit and adjacent cover props |

Ownership is authored at construction call sites via `beginReviewAssembly` and
`withReviewPart(..., { ownProps: true })`. `setReviewScope` records provenance
but does **not** attach every prop in a region. `src/world/review.js` captures
static construction and owned placements in detached review-only roots. The
adapter skips owned placements in its loose-prop registrations: each captured
piece has exactly one owner. The normal material/instance batches are unchanged.

Buildings now expose construction groups, not just one palette mesh per building:
`Floor 1 / Facade north / Bay 1 door`, `Roof / Services`, `Interiors / Floor 1`,
etc. Palette meshes remain leaves *within* these responsibilities. Attached ACs,
dishes and bags retain separate component transforms and shared prototype buffers.

Assembly asset IDs are placement-specific (`environment-building-be1`,
`environment-palm-west-entry`, etc.). Procedural component counts, materials,
poses and damage can differ, so these assemblies are not falsely declared the
same canonical design. Loose repeated props still share `prop-*` assets. An
attached fixture can be edited locally in Asset, but cannot simultaneously be an
independent Scene actor or a separately shared canonical asset in this flat
representation. Cross-building fixture-design changes belong in the prop factory.

This reduces Scene actor bookkeeping; it does not decimate triangles or promise
lower editor draw counts. Named construction adds detailed component nodes.
Review capture remains opt-in and does not add meshes to the game's render graph.

## Identity and source mapping

`assemblies-v6` identifies the ownership/hierarchy change. Builds may supply
`VITE_GIT_COMMIT`; local fallback is explicitly `development`. Start a fresh v6
baseline and keep older feedback separately. Building actor/asset IDs survive,
but attached actors disappear into components, bounds/pivots change, and generated
component IDs change. Sandbag placement ordinals change with their new owner
scopes. Never replay v5 transforms or component edits without remapping them.

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
- Assembly component references append the generated node ID to the owner's
  `sourceRef`; arbitrary per-node `userData` is not an SDK source-reference
  override. For example, `BUILDINGS.BE1` leads through `buildBuilding` to
  `Floor 1 / Facade north / Wall` in `buildFacade`, and through `dressBuilding`
  to `Facade services / Ac unit N`. The latter's shape is `ac_unit` in
  `registerProps`; its placement is the matching seeded call in `dressBuilding`.
  Palm/lamp tuple IDs resolve through `palms`/`streetLamps`; sandbag IDs through
  `sandbagWall` and its named caller. These are composite locators, not literal
  JavaScript member-expression paths.
- World geometry uses metres, Y up. `Assembler.xform` converts level coordinates
  to world coordinates; `world.worldToLevel` reverses position feedback.
  Orientations/scales must be converted through the full inverse matrix, not
  treated as raw local Euler edits.
- Review roots use `Assembler.xform * authoredAssemblyFrame`: building/gate
  translation, or palm/lamp/wall translation and yaw. Static vertices and owned
  placement matrices are converted by the inverse of that root frame. Every
  owned mesh reproduces its original world pose; no runtime geometry is moved.
  For a component edit, compose its parent transforms back through this frame
  before translating the result into the source generator. Static component
  vertices currently use the assembly frame; their origins are not individual
  part centers. Scene placement edits must update the owning source construction
  and corresponding collision/light placement, not only this detached review graph.
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

Procedural prop factories still return flattened meshes: a dish's mount and bowl
are not separately editable, although each attached dish is now a named building
component. Ground, perimeter structures, and remaining street fixtures/dressing
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
named source-linked component hierarchy; world-space paint in assembly-local
geometry; shared resource disposal and scope restoration. It also covers
separate actor/shared asset identity, progressive descriptors
and typed geometry, cache refresh, bridge origin/window-source restrictions,
transfer-buffer ownership, cleanup, and camera/aim source mappings.

`npm run build` verifies the production bundle. `npm ls` must show registry
packages (not local links) and a single Three.js 0.180.0 runtime. The installed
dependency tree reports an existing `nanoid` advisory in Vite's development
toolchain; it is unrelated to Spatial Review and is not automatically upgraded.

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
