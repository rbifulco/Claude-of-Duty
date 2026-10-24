/** Standard-material review cannot run the game's OW weathering shader.
 * That shader uses RGB as wear/grime/AO masks and explicitly replaces Three's
 * colour multiplication. Keep the data, but do not display masks as RGB tint. */
export function createReviewMaterialResolver() {
  const clones = new Map();
  const resolve = source => {
    if (Array.isArray(source)) return source.map(resolve);
    if (!source || !Object.hasOwn(source.defines ?? {}, 'OW_VCOL_MASKS')) return source;
    if (!clones.has(source)) {
      const material = source.clone();
      material.vertexColors = false;
      clones.set(source, material);
    }
    return clones.get(source);
  };
  return {
    apply(root) {
      root.traverse(object => { if (object.material) object.material = resolve(object.material); });
      return root;
    },
    dispose() {
      // Clones share textures with the source; release only owned materials.
      clones.forEach(material => material.dispose());
      clones.clear();
    },
  };
}
