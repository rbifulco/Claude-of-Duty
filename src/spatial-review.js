import {
  SceneAssetRegistry,
  SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY,
  attachSceneAssetRegistryBridge,
  attachSpatialReviewDiscoveryBridge,
} from '@alterno-dev/spatial-review';
import * as THREE from 'three';
import { SHOTS } from './dev/shots.js';
import { gateReviewTextureResources } from './review-texture-export.js';

// Change when the review catalog's stable actor/asset addressing changes. The
// editor uses this to avoid replacing a saved scene with an identical handoff.
const BUILD_ID = `claude-of-duty-ownership-v7-${import.meta.env?.VITE_GIT_COMMIT || 'development'}`;
export const SPATIAL_REVIEW_SEED = 0x5eed1234;
// SDK 0.7 requires an explicit opt-in for the existing cross-port local workflow.
const AUTHORIZATION_OPTIONS = { allowOfficialEditor: true, allowLoopbackPeers: true };
const STREAMING_BRIDGE_OPTIONS = {
  ...AUTHORIZATION_OPTIONS,
  maxGeometryBytes: 64 * 1024 * 1024,
  maxConcurrentAssetRequests: 1,
  maxInFlightBytes: 64 * 1024 * 1024,
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

function overviewGeometry(source, ThreeRuntime) {
  const geometry = new ThreeRuntime.BufferGeometry();
  geometry.setAttribute('position', source.getAttribute('position'));
  if (source.index) geometry.setIndex(source.index);
  return geometry;
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
      registry.register({
        actorId: object.id,
        assetId: object.assetId,
        name: object.name,
        category: object.category,
        sourceRef: object.sourceRef,
        tags: [...object.tags, object.attachedParts ? 'assembly' : 'semantic-static'],
        order: 100 + index,
        roots: object.roots,
        parentAssemblyId: object.parentAssemblyId,
      });
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
    attachedParts: (world.A?.reviewStatics ?? []).reduce((sum, object) => sum + object.attachedParts, 0),
  };
}

function registerAiComposition(registry, ai) {
  const variantCounts = new Map();
  ai.agents.forEach((agent, index) => {
    const variant = agent.variantName ?? 'enemy';
    const number = (variantCounts.get(variant) ?? 0) + 1;
    variantCounts.set(variant, number);
    registry.register({
      actorId: `enemy-${variant}-${number}`,
      assetId: `enemy-${variant}`,
      name: `${title(variant)} enemy ${number}`,
      category: 'Actors / Enemies',
      sourceRef: 'src/ai/index.js#AiSystem.populate',
      tags: ['actor', 'enemy', variant],
      order: 2000 + index,
      root: agent.group,
    });
  });
  return ai.agents.length;
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
  const enemies = registerAiComposition(registry, ai);
  registry.registerNavigationSequence(buildEnvironmentReviewTour());
  registry.setSourceStatus?.({
    phase: 'catalog-ready',
    expectedActors: registry.size,
    readyActors: registry.size - composition.deferredPropPlacements,
    message: composition.deferredPropPlacements
      ? `${composition.deferredPropPlacements} prop placements will be materialized on request.`
      : 'Review geometry is registered and request-driven.',
  });

  console.info(
    `[spatial-review] ${registry.size} actors · ${composition.assemblies} transform-only assemblies · ` +
      `${composition.staticObjects} structure/context placements · ${composition.attachedParts} attached placements · ` +
      `${composition.propPlacements} ${composition.hierarchical ? 'owned and loose' : 'loose'} prop placements from ${composition.propAssets} shared assets · ` +
      `${enemies} enemies · ${registry.navigationSize} path`
  );

  const disposeTextureGate = dependencies.texturePreparation
    ? gateReviewTextureResources(registry, dependencies.texturePreparation) : null;
  const detachBridge = attachRegistryBridge(registry, STREAMING_BRIDGE_OPTIONS);

  return {
    registry,
    composition: { ...composition, enemies },
    dispose() {
      detachBridge();
      disposeTextureGate?.();
      mirrors.length = 0;
    },
  };
}
