import * as THREE from 'three';
import { Accum } from '../world/util.js';

/** Copies actual generator output before batching destroys semantic boundaries. */
export class ReviewCollector {
  constructor() { this.scopes = new Map(); this.scope('world', 'World', 'src/world/index.js#WorldSystem'); }
  scope(id, name, sourceRef, pivot = new THREE.Vector3()) {
    if (!this.scopes.has(id)) this.scopes.set(id, { id, name, sourceRef, pivot: pivot.clone(), parts: new Map(), props: [], ordinals: new Map() });
    this.current = this.scopes.get(id); this.part('Structure');
  }
  part(name) { this.partName = name; }
  add(key, geometry, matrix, opts) {
    const id = `${this.partName}|${key}`;
    let acc = this.current.parts.get(id);
    if (!acc) this.current.parts.set(id, acc = new Accum(id));
    acc.add(geometry, matrix, opts);
  }
  place(prototype, matrix, masks) {
    const ordinal = (this.current.ordinals.get(prototype.id) || 0) + 1;
    this.current.ordinals.set(prototype.id, ordinal);
    this.current.props.push({ prototype, matrix: matrix.clone(), masks, id: `${this.current.id}-${prototype.id}-${ordinal}` });
  }
}
