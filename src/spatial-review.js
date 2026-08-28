import {
  SceneAssetRegistry,
  attachSceneAssetRegistryBridge,
  attachSpatialReviewDiscoveryBridge,
} from '@alterno-dev/spatial-review';
import * as THREE from 'three';
import { SHOTS } from './dev/shots.js';

// Change when the review catalog's stable actor/asset addressing changes. The
// editor uses this to avoid replacing a saved scene with an identical handoff.
const BUILD_ID = `claude-of-duty-semantic-v5-${import.meta.env?.VITE_GIT_COMMIT || 'development'}`;
export const SPATIAL_REVIEW_SEED = 0x5eed1234;
const BRIDGE_OPTIONS = { allowOfficialEditor: true };
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

function registerWorldComposition(registry, world, mirrors) {
  const staticObjects = [...(world.A?.reviewStatics ?? [])]
    .sort((left, right) => left.id.localeCompare(right.id));
  const propAssets = [...(world.A?.reviewProps ?? [])]
    .sort((left, right) => left.id.localeCompare(right.id));
  let propPlacements = 0;

  staticObjects.forEach((object, index) => {
      mirrors.push(...object.roots);
      registry.register({
        actorId: object.id,
        assetId: `environment-${object.id}`,
        name: object.name,
        category: object.category,
        sourceRef: object.sourceRef,
        tags: [...object.tags, 'semantic-static'],
        order: 100 + index,
        roots: object.roots,
      });
    });

  propAssets.forEach((prop, assetIndex) => {
    const propSlug = prop.id.replaceAll('_', '-');
    prop.placements.forEach((placement) => {
      const root = new THREE.Mesh(prop.geometry, prop.material);
      // Component identity belongs to the design, not whichever placement is
      // first in the catalog. The actor name below still identifies placement.
      root.name = prop.id;
      root.matrixAutoUpdate = false;
      root.matrix.copy(placement.matrix);
      root.userData.surface = world.A.surfaceOf(prop.key);
      root.userData.reviewOnly = true;
      root.updateMatrixWorld(true);
      mirrors.push(root);
      propPlacements++;
      registry.register({
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
        root,
      });
    });
  });

  return {
    staticObjects: staticObjects.length,
    propAssets: propAssets.length,
    propPlacements,
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
      liveCapture: liveCapture.href,
    },
    BRIDGE_OPTIONS,
  );
}

export function attachClaudeOfDutyScene(engine) {
  const world = engine.ctx.get('world');
  const ai = engine.ctx.get('ai');
  const registry = new SceneAssetRegistry(BUILD_ID);
  const mirrors = [];

  const composition = registerWorldComposition(registry, world, mirrors);
  const enemies = registerAiComposition(registry, ai);
  registry.registerNavigationSequence(buildEnvironmentReviewTour());

  console.info(
    `[spatial-review] ${registry.size} actors · ${composition.staticObjects} semantic static objects · ` +
      `${composition.propPlacements} prop placements from ${composition.propAssets} shared assets · ` +
      `${enemies} enemies · ${registry.navigationSize} path`
  );

  const detachBridge = attachSceneAssetRegistryBridge(registry, BRIDGE_OPTIONS);

  return {
    registry,
    composition: { ...composition, enemies },
    dispose() {
      detachBridge();
      mirrors.length = 0;
    },
  };
}
