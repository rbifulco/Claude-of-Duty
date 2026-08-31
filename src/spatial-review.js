import {
  SceneAssetRegistry,
  SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY,
  attachSceneAssetRegistryBridge,
  attachSpatialReviewDiscoveryBridge,
} from '@alterno-dev/spatial-review';
import * as THREE from 'three';
import { SHOTS } from './dev/shots.js';

// Change when the review catalog's stable actor/asset addressing changes. The
// editor uses this to avoid replacing a saved scene with an identical handoff.
const BUILD_ID = `claude-of-duty-ownership-v7-${import.meta.env?.VITE_GIT_COMMIT || 'development'}`;
export const SPATIAL_REVIEW_SEED = 0x5eed1234;
const AUTHORIZATION_OPTIONS = { allowOfficialEditor: true };
const STREAMING_BRIDGE_OPTIONS = {
  ...AUTHORIZATION_OPTIONS,
  maxGeometryBytes: 64 * 1024 * 1024,
  maxConcurrentAssetRequests: 2,
  maxInFlightBytes: 128 * 1024 * 1024,
  maxQueuedAssetRequests: 32,
  progressIntervalMs: 120,
};
const STREAM_METADATA_HEADROOM = 64 * 1024;
const PROP_CATEGORY_RULES = [
  [/^(palm_|shrub$|weeds$|planter$)/, 'Props / Vegetation'],
  [/^(brick_|rock_|slab_|rebar$|plank_|litter$|pock$|dust_skirt$)/, 'Props / Debris'],
  [/^(sandbag_|jersey$|block_|tyre)/, 'Props / Cover'],
  [/^(table|stall$|shelf$|mattress$|chair$|cabinet$)/, 'Props / Furniture'],
  [/^(ac_unit$|sat_dish$|water_tank$|roof_vent$|lamp_|sign_)/, 'Props / Fixtures'],
];
const REVIEW_SHOTS = [
  ['hero', 'Hero establishing view'],
  ['interior', 'Interior light shafts'],
  ['detail', 'Material detail'],
  ['sunset', 'Sunset atmosphere'],
  ['night', 'Night lighting'],
];

const shotSource = (id, field) =>
  `src/dev/shots.js#SHOTS.${id}${field ? `.${field}` : ''}`;

const title = (value) =>
  value
    .split('_')
    .map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : '')
    .join(' ');

function propCategory(id) {
  return PROP_CATEGORY_RULES.find(([pattern]) => pattern.test(id))?.[1] ?? 'Props / Objects';
}

function transformFromMatrix(matrix) {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, quaternion, scale);
  const rotation = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
  return {
    position: position.toArray(),
    rotation: [rotation.x, rotation.y, rotation.z].map(THREE.MathUtils.radToDeg),
    scale: scale.toArray(),
  };
}

function propBounds(geometry, matrix) {
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const box = geometry.boundingBox.clone().applyMatrix4(matrix);
  return {
    center: box.getCenter(new THREE.Vector3()).toArray(),
    size: box.getSize(new THREE.Vector3()).toArray(),
  };
}

function geometryBytes(geometry, attributes) {
  let bytes = geometry.index?.array.byteLength ?? 0;
  for (const name of attributes) bytes += geometry.getAttribute(name)?.array.byteLength ?? 0;
  return bytes;
}

function streamEstimate(geometryBytes) {
  return Math.min(1024 * 1024 * 1024, geometryBytes + STREAM_METADATA_HEADROOM);
}

function rootsGeometryStats(roots, attributes) {
  const geometries = new Set();
  let bytes = 0;
  let triangles = 0;
  roots.forEach((root) => root.traverse((object) => {
    const geometry = object.geometry;
    if (!geometry?.getAttribute?.('position') || geometries.has(geometry)) return;
    geometries.add(geometry);
    bytes += geometryBytes(geometry, attributes);
    const indexCount = geometry.index?.count ?? geometry.getAttribute('position').count;
    triangles += Math.floor(indexCount / 3);
  }));
  return { bytes, triangles };
}

function rootsBounds(roots, ThreeRuntime) {
  roots.forEach((root) => root.updateWorldMatrix(true, true));
  const box = new ThreeRuntime.Box3();
  roots.forEach((root) => box.expandByObject(root, true));
  if (box.isEmpty()) {
    const center = new ThreeRuntime.Vector3().setFromMatrixPosition(roots[0].matrixWorld);
    return { center: center.toArray(), size: [0, 0, 0] };
  }
  return {
    center: box.getCenter(new ThreeRuntime.Vector3()).toArray(),
    size: box.getSize(new ThreeRuntime.Vector3()).toArray(),
  };
}

function overviewGeometry(source, ThreeRuntime) {
  const geometry = new ThreeRuntime.BufferGeometry();
  geometry.setAttribute('position', source.getAttribute('position'));
  if (source.index) geometry.setIndex(source.index);
  return geometry;
}

function overviewRoots(roots, ThreeRuntime) {
  return roots.map((source) => {
    const root = source.clone(true);
    root.traverse((object) => {
      if (object.geometry?.getAttribute?.('position')) {
        object.geometry = overviewGeometry(object.geometry, ThreeRuntime);
      }
    });
    return root;
  });
}

function registerDeferredRoots(registry, roots, registration, ThreeRuntime) {
  if (typeof registry.registerDeferred !== 'function'
    || !roots.every((root) => root instanceof ThreeRuntime.Object3D)) return false;

  const overview = rootsGeometryStats(roots, ['position']);
  const detailAttributes = ['position', 'normal', 'uv'].filter((attribute) => roots.some((root) => {
    let found = false;
    root.traverse((object) => { if (object.geometry?.getAttribute?.(attribute)) found = true; });
    return found;
  }));
  const detail = rootsGeometryStats(roots, detailAttributes);
  const revision = `${BUILD_ID}-${registration.assetId}`;
  roots.forEach((root) => root.updateWorldMatrix(true, true));
  registry.registerDeferred({
    ...registration,
    transform: transformFromMatrix(roots[0].matrixWorld),
    bounds: rootsBounds(roots, ThreeRuntime),
    stream: {
      capability: SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY,
      revision,
      representations: [
        {
          id: 'overview',
          purpose: 'overview',
          revision: `${revision}-overview`,
          estimatedBytes: streamEstimate(overview.bytes),
          triangles: overview.triangles,
          attributes: ['position'],
          geometricError: 0,
        },
        {
          id: 'detail',
          purpose: 'detail',
          revision: `${revision}-detail`,
          estimatedBytes: streamEstimate(detail.bytes),
          triangles: detail.triangles,
          attributes: detailAttributes,
          geometricError: 0,
        },
      ],
    },
    produceRepresentation({ representation, signal, reportProgress }) {
      if (signal.aborted) throw new DOMException('Asset request cancelled.', 'AbortError');
      reportProgress({ phase: 'generating', completed: 0, total: 1 });
      const value = representation.purpose === 'overview'
        ? overviewRoots(roots, ThreeRuntime)
        : roots;
      if (signal.aborted) throw new DOMException('Asset request cancelled.', 'AbortError');
      reportProgress({ phase: 'generating', completed: 1, total: 1 });
      return value;
    },
  });
  return true;
}

function createPropMirror(prop, placement, world, ThreeRuntime = THREE, purpose = 'detail') {
  const geometry = purpose === 'overview' ? overviewGeometry(prop.geometry, ThreeRuntime) : prop.geometry;
  const root = new ThreeRuntime.Mesh(geometry, prop.material);
  // Component identity belongs to the design, not whichever placement is
  // first in the catalog. The actor name still identifies placement.
  root.name = prop.id;
  root.matrixAutoUpdate = false;
  root.matrix.copy(placement.matrix);
  root.userData.surface = world.A.surfaceOf(prop.key);
  root.userData.reviewOnly = true;
  root.updateMatrixWorld(true);
  return root;
}

function registerDeferredProp(registry, prop, placement, registration, world, ThreeRuntime) {
  if (typeof registry.registerDeferred !== 'function') return false;
  const indexCount = prop.geometry.index?.count ?? prop.geometry.getAttribute('position')?.count ?? 0;
  const triangles = Math.floor(indexCount / 3);
  const overviewBytes = geometryBytes(prop.geometry, ['position']);
  const detailAttributes = ['position', 'normal', 'uv']
    .filter(name => Boolean(prop.geometry.getAttribute(name)));
  const detailBytes = geometryBytes(prop.geometry, detailAttributes);
  const revision = `${BUILD_ID}-${registration.assetId}`;
  registry.registerDeferred({
    ...registration,
    transform: transformFromMatrix(placement.matrix),
    bounds: propBounds(prop.geometry, placement.matrix),
    stream: {
      capability: SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY,
      revision,
      representations: [
        {
          id: 'overview',
          purpose: 'overview',
          revision: `${revision}-overview`,
          estimatedBytes: streamEstimate(overviewBytes),
          triangles,
          attributes: ['position'],
          geometricError: 0,
        },
        {
          id: 'detail',
          purpose: 'detail',
          revision: `${revision}-detail`,
          estimatedBytes: streamEstimate(detailBytes),
          triangles,
          attributes: detailAttributes,
          geometricError: 0,
        },
      ],
    },
    produceRepresentation({ representation, signal, reportProgress }) {
      if (signal.aborted) throw new DOMException('Prop request cancelled.', 'AbortError');
      reportProgress({ phase: 'generating', completed: 0, total: 1 });
      const root = createPropMirror(prop, placement, world, ThreeRuntime, representation.purpose);
      if (signal.aborted) throw new DOMException('Prop request cancelled.', 'AbortError');
      reportProgress({ phase: 'generating', completed: 1, total: 1 });
      return root;
    },
  });
  return true;
}

function registerWorldComposition(registry, world, mirrors, ThreeRuntime = THREE) {
  const hierarchical = typeof registry.registerAssembly === 'function';
  const staticObjects = [...(hierarchical ? world.A?.reviewStructures ?? [] : world.A?.reviewStatics ?? [])]
    .sort((left, right) => left.id.localeCompare(right.id));
  const assemblies = [...(world.A?.reviewAssemblies ?? [])]
    .sort((left, right) => left.assemblyId.localeCompare(right.assemblyId));
  const propAssets = [...(world.A?.reviewProps ?? [])]
    .sort((left, right) => left.id.localeCompare(right.id));
  let propPlacements = 0;
  let deferredPropPlacements = 0;
  let deferredStaticObjects = 0;

  if (hierarchical) assemblies.forEach((assembly) => {
    mirrors.push(assembly.root);
    registry.registerAssembly({
      assemblyId: assembly.assemblyId,
      name: assembly.name,
      sourceRef: assembly.sourceRef,
      root: assembly.root,
    });
  });

  staticObjects.forEach((object, index) => {
    mirrors.push(...object.roots);
    const registration = {
      actorId: object.id,
      assetId: object.assetId,
      name: object.name,
      category: object.category,
      sourceRef: object.sourceRef,
      tags: [...object.tags, object.attachedParts ? 'assembly' : 'semantic-static'],
      order: 100 + index,
      parentAssemblyId: object.parentAssemblyId,
    };
    if (registerDeferredRoots(registry, object.roots, registration, ThreeRuntime)) {
      deferredStaticObjects++;
    } else {
      registry.register({ ...registration, roots: object.roots });
    }
  });

  propAssets.forEach((prop, assetIndex) => {
    const propSlug = prop.id.replaceAll('_', '-');
    prop.placements.forEach((placement) => {
      if (placement.ownerId && !hierarchical) return; // represented inside the legacy composite actor
      propPlacements++;
      const registration = {
        actorId: `${placement.scope.id}-${propSlug}-${placement.ordinal}`,
        assetId: `prop-${propSlug}`,
        name: `${title(prop.id)} · ${placement.scope.name} · ${placement.ordinal}`,
        category: propCategory(prop.id),
        sourceRef: prop.sourceRef,
        tags: [
          'level',
          'procedural',
          'prop-placement',
          prop.id,
          placement.scope.id,
        ],
        order: 1000 + assetIndex * 10000 + propPlacements,
        parentAssemblyId: placement.ownerId ?? undefined,
      };
      if (registerDeferredProp(registry, prop, placement, registration, world, ThreeRuntime)) {
        deferredPropPlacements++;
      } else {
        const root = createPropMirror(prop, placement, world, ThreeRuntime);
        mirrors.push(root);
        registry.register({ ...registration, root });
      }
    });
  });

  return {
    assemblies: hierarchical ? assemblies.length : 0,
    hierarchical,
    staticObjects: staticObjects.length,
    propAssets: propAssets.filter(prop => prop.placements.some(p => hierarchical || !p.ownerId)).length,
    propPlacements,
    deferredPropPlacements,
    deferredStaticObjects,
    attachedParts: (world.A?.reviewStatics ?? []).reduce((sum, object) => sum + object.attachedParts, 0),
  };
}

function registerAiComposition(registry, ai, ThreeRuntime = THREE) {
  const variantCounts = new Map();
  let deferredEnemies = 0;
  ai.agents.forEach((agent, index) => {
    const variant = agent.variantName ?? 'enemy';
    const number = (variantCounts.get(variant) ?? 0) + 1;
    variantCounts.set(variant, number);
    const registration = {
      actorId: `enemy-${variant}-${number}`,
      assetId: `enemy-${variant}`,
      name: `${title(variant)} enemy ${number}`,
      category: 'Actors / Enemies',
      sourceRef: 'src/ai/index.js#AiSystem.populate',
      tags: ['actor', 'enemy', variant],
      order: 2000 + index,
    };
    if (registerDeferredRoots(registry, [agent.group], registration, ThreeRuntime)) {
      deferredEnemies++;
    } else {
      registry.register({ ...registration, root: agent.group });
    }
  });
  return { count: ai.agents.length, deferred: deferredEnemies };
}

/**
 * Expose the authored environment-review cameras as a navigable editor tour.
 * The capture harness remains the authority for every position, target and FOV;
 * the straight transitions are review-only interpolation between those views.
 */
export function buildEnvironmentReviewTour() {
  const stops = REVIEW_SHOTS.map(([id, name]) => {
    const shot = SHOTS[id];
    return {
      id,
      name,
      camera: [...shot.pos],
      target: [...shot.look],
      fov: shot.fov,
      sourceRef: shotSource(id),
    };
  });

  const segments = REVIEW_SHOTS.slice(0, -1).map(([fromId], index) => {
    const toId = REVIEW_SHOTS[index + 1][0];
    const from = SHOTS[fromId];
    const to = SHOTS[toId];
    return {
      id: `${fromId}--${toId}`,
      fromStopId: fromId,
      toStopId: toId,
      sourceRef: 'src/spatial-review.js#buildEnvironmentReviewTour',
      weight: 1,
      lensStart: 0.35,
      camera: {
        kind: 'line',
        points: [
          {
            id: `${fromId}-camera`,
            role: 'stop',
            stopId: fromId,
            position: [...from.pos],
            sourceRef: shotSource(fromId, 'pos'),
          },
          {
            id: `${toId}-camera`,
            role: 'stop',
            stopId: toId,
            position: [...to.pos],
            sourceRef: shotSource(toId, 'pos'),
          },
        ],
      },
      aim: {
        kind: 'curve',
        curve: {
          kind: 'line',
          points: [
            {
              id: `${fromId}-target`,
              role: 'control',
              stopId: fromId,
              position: [...from.look],
              sourceRef: shotSource(fromId, 'look'),
            },
            {
              id: `${toId}-target`,
              role: 'control',
              stopId: toId,
              position: [...to.look],
              sourceRef: shotSource(toId, 'look'),
            },
          ],
        },
      },
    };
  });

  return {
    id: 'environment-review-tour',
    name: 'Environment review tour',
    category: 'Review harness',
    sourceRef: 'src/dev/shots.js#SHOTS',
    stops,
    segments,
  };
}

export function shouldBootClaudeOfDutyPage({ embedded, spatialCapture }) {
  return !embedded || spatialCapture;
}

export function attachClaudeOfDutyDiscovery() {
  const websiteUrl = new URL(window.location.href);
  websiteUrl.hash = '';
  websiteUrl.search = '';

  const liveCapture = new URL(websiteUrl);
  liveCapture.searchParams.set('spatial-review-capture', '1');
  // Review serialization does not render gameplay frames, so compiling every
  // gameplay shader permutation only delays the editor handshake.
  liveCapture.searchParams.set('prewarm', '0');

  return attachSpatialReviewDiscoveryBridge(
    {
      name: 'Claude of Duty',
      websiteUrl: websiteUrl.href,
      discoveryUrl: '.well-known/spatial-review.json',
      liveCapture: liveCapture.href,
    },
    AUTHORIZATION_OPTIONS,
  );
}

export function attachClaudeOfDutyScene(engine, dependencies = {}) {
  const world = engine.ctx.get('world');
  const ai = engine.ctx.get('ai');
  const Registry = dependencies.SceneAssetRegistry ?? SceneAssetRegistry;
  const attachRegistryBridge = dependencies.attachSceneAssetRegistryBridge ?? attachSceneAssetRegistryBridge;
  const ThreeRuntime = dependencies.THREE ?? THREE;
  const registry = new Registry(BUILD_ID);
  const mirrors = [];

  const composition = registerWorldComposition(registry, world, mirrors, ThreeRuntime);
  const enemies = registerAiComposition(registry, ai, ThreeRuntime);
  registry.registerNavigationSequence(buildEnvironmentReviewTour());
  const deferredActors = composition.deferredPropPlacements
    + composition.deferredStaticObjects
    + enemies.deferred;
  registry.setSourceStatus?.({
    phase: 'catalog-ready',
    expectedActors: registry.size,
    readyActors: registry.size - deferredActors,
    message: deferredActors
      ? `${deferredActors} scene placements will be materialized on request.`
      : 'Review geometry is registered and request-driven.',
  });

  console.info(
    `[spatial-review] ${registry.size} actors · ${composition.assemblies} transform-only assemblies · ` +
      `${composition.staticObjects} structure/context placements · ${composition.attachedParts} attached placements · ` +
      `${composition.propPlacements} ${composition.hierarchical ? 'owned and loose' : 'loose'} prop placements from ${composition.propAssets} shared assets · ` +
      `${enemies.count} enemies · ${registry.navigationSize} path`
  );

  const detachBridge = attachRegistryBridge(registry, STREAMING_BRIDGE_OPTIONS);

  return {
    registry,
    composition: { ...composition, enemies: enemies.count, deferredEnemies: enemies.deferred },
    dispose() {
      detachBridge();
      mirrors.length = 0;
    },
  };
}
