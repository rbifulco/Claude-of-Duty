import * as THREE from 'three';
import { Accum } from './util.js';

const IDENTITY = new THREE.Matrix4();
const label = id => id.replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());

/**
 * Source-owned review graph, independent of material batches in the renderer.
 * Scope is provenance; only an explicit ownProps region makes a prop a component.
 * Every captured part has exactly one owner. Nothing here is added to the game.
 */
export class ReviewCapture {
  constructor(assembler) {
    this.assembler = assembler;
    this.scopes = new Map();
    this.scope = null;
    this.path = [];
    this.ownProps = false;
    this.geometries = new Set();
    this.objects = [];
  }

  setScope(metadata) {
    this.path = [];
    this.ownProps = metadata?.ownProps === true;
    if (!metadata) { this.scope = null; return; }
    let scope = this.scopes.get(metadata.id);
    if (!scope) {
      const worldMatrix = this.assembler.xform.clone().multiply(metadata.frame ?? IDENTITY);
      scope = {
        ...metadata, tags: [...(metadata.tags ?? [])], worldMatrix,
        inverse: worldMatrix.clone().invert(), parts: new Map(), placementCounts: new Map(),
      };
      this.scopes.set(scope.id, scope);
    }
    this.scope = scope;
  }

  activeScope() {
    if (!this.scope) this.setScope({
      id: 'world', name: 'World dressing', category: 'Environment / Dressing',
      sourceRef: 'src/world/index.js#WorldSystem.init', tags: ['level', 'procedural'],
    });
    return this.scope;
  }

  beginPart(name, { ownProps = this.ownProps } = {}) {
    const previousPath = this.path;
    const previousOwnership = this.ownProps;
    this.path = [...this.path, ...(Array.isArray(name) ? name : [name])];
    this.ownProps = ownProps;
    return () => { this.path = previousPath; this.ownProps = previousOwnership; };
  }

  beginAssembly(metadata) {
    if (this.scopes.has(metadata.id)) throw new Error(`Duplicate review assembly: ${metadata.id}`);
    return this.beginScope({ ...metadata, ownProps: true });
  }

  beginScope(metadata) {
    const { scope, path, ownProps } = this;
    this.setScope(metadata);
    return () => { this.scope = scope; this.path = path; this.ownProps = ownProps; };
  }

  add(key, geometry, worldMatrix, options) {
    const scope = this.activeScope();
    const path = this.path.length ? this.path : ['Structure'];
    const id = JSON.stringify(path);
    let part = scope.parts.get(id);
    if (!part) scope.parts.set(id, part = { path: [...path], materials: new Map() });
    let accumulator = part.materials.get(key);
    if (!accumulator) part.materials.set(key, accumulator = new Accum(`review:${scope.id}:${id}:${key}`));
    // Copy after the renderer has consumed its matrix. Never mutate shared
    // assembler scratch matrices or the geometry used by normal rendering.
    const local = scope.inverse.clone().multiply(worldMatrix ?? IDENTITY);
    let localOptions = options;
    if (options?.paint) {
      // Paint callbacks consume world coordinates in the renderer. Preserve
      // that contract even though review vertices use the assembly's frame.
      const position = new THREE.Vector3();
      const normal = new THREE.Vector3();
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(scope.worldMatrix);
      localOptions = { ...options, paint(x, y, z, nx, ny, nz, out) {
        position.set(x, y, z).applyMatrix4(scope.worldMatrix);
        normal.set(nx, ny, nz).applyMatrix3(normalMatrix).normalize();
        options.paint(position.x, position.y, position.z, normal.x, normal.y, normal.z, out);
      } };
    }
    accumulator.add(geometry, local, localOptions);
  }

  place(id, matrix) {
    const scope = this.activeScope();
    if (scope.reviewProps === false) return null;
    const ordinal = (scope.placementCounts.get(id) ?? 0) + 1;
    scope.placementCounts.set(id, ordinal);
    return {
      matrix, scope, ordinal,
      ownerId: this.ownProps ? scope.id : null,
      componentPath: this.ownProps ? [...this.path] : [],
    };
  }

  finalize(prototypes) {
    for (const scope of this.scopes.values()) {
      const root = new THREE.Group();
      root.name = scope.name;
      scope.worldMatrix.decompose(root.position, root.quaternion, root.scale);
      root.updateMatrix();
      const groups = new Map([['[]', root]]);
      const groupAt = path => {
        let parent = root;
        path.forEach((name, i) => {
          const key = JSON.stringify(path.slice(0, i + 1));
          let group = groups.get(key);
          if (!group) {
            group = new THREE.Group();
            group.name = name;
            parent.add(group);
            groups.set(key, group);
          }
          parent = group;
        });
        return parent;
      };
      for (const [, part] of [...scope.parts].sort(([a], [b]) => a.localeCompare(b))) {
        for (const [key, accumulator] of [...part.materials].sort(([a], [b]) => a.localeCompare(b))) {
          if (accumulator.empty) continue;
          const geometry = accumulator.build();
          this.geometries.add(geometry);
          const mesh = new THREE.Mesh(geometry, this.assembler.mat(key));
          mesh.name = label(key);
          mesh.userData.surface = this.assembler.surfaceOf(key);
          mesh.userData.reviewOnly = true;
          groupAt(part.path).add(mesh);
        }
      }
      scope.parts.clear();
      let attachedParts = 0;
      for (const prop of [...prototypes].sort((a, b) => a.id.localeCompare(b.id))) {
        for (const placement of prop.placements) {
          if (placement.ownerId !== scope.id) continue;
          const mesh = new THREE.Mesh(prop.geometry, prop.material);
          mesh.name = `${label(prop.id)} ${placement.ordinal}`;
          mesh.matrix.copy(scope.inverse).multiply(placement.matrix);
          mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
          mesh.matrixAutoUpdate = false;
          mesh.userData.surface = this.assembler.surfaceOf(prop.key);
          mesh.userData.reviewOnly = true;
          // Local diagnostics/source provenance; the SDK derives exported
          // component references from the assembly sourceRef + component ID.
          mesh.userData.reviewPlacement = placement;
          mesh.userData.reviewPrototype = prop.id;
          groupAt(placement.componentPath.length ? placement.componentPath : ['Parts']).add(mesh);
          attachedParts++;
        }
      }
      if (root.children.length === 0) continue;
      root.updateMatrixWorld(true);
      this.objects.push({
        id: scope.id, assetId: scope.assetId ?? `environment-${scope.id}`,
        name: scope.name, category: scope.category, sourceRef: scope.sourceRef,
        tags: scope.tags, roots: [root], attachedParts,
      });
    }
    return this.objects;
  }

  dispose() {
    for (const geometry of this.geometries) geometry.dispose();
    this.geometries.clear();
    this.objects.length = 0;
    this.scopes.clear();
    this.scope = null;
  }
}
