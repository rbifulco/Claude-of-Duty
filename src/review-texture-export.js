const textureSlots = ['map', 'normalMap', 'bumpMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap'];

async function encodePixels(bytes, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('A 2D canvas is required to export review textures.');
    // Readback rows remain in GPU order. The original render-target texture's
    // flipY=false is preserved in the SDK descriptor, so do not flip them here.
    context.putImageData(new ImageData(new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.byteLength), width, height), 0, 0);
    return await new Promise((resolve, reject) => canvas.toBlob(blob => blob
      ? resolve(blob) : reject(new Error('Could not encode a generated review texture.')), 'image/png'));
  } finally { canvas.width = canvas.height = 0; }
}

/** Only the explicit, frozen review capture calls this. Keep gameplay textures
 * GPU-owned, but attach the SDK's supported sourceBlob for the standard maps
 * actually referenced by review materials. Each shared target is read once;
 * one asynchronous readback/encode at a time bounds transient CPU memory. */
export async function prepareReviewTextureSources(renderer, targets, materials, encode = encodePixels) {
  const required = new Set();
  for (const material of materials) for (const slot of textureSlots) {
    if (material?.[slot]?.isTexture) required.add(material[slot]);
  }
  let exported = 0;
  for (const target of targets) {
    const texture = target.texture;
    if (!required.has(texture) || texture.userData.sourceBlob instanceof Blob) continue;
    const { width, height } = target;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width * height > 4096 * 4096) {
      throw new Error(`Invalid generated texture dimensions: ${width} × ${height}.`);
    }
    const bytes = new Uint8Array(width * height * 4);
    if (renderer.readRenderTargetPixelsAsync) await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height, bytes);
    else renderer.readRenderTargetPixels(target, 0, 0, width, height, bytes);
    const blob = await encode(bytes, width, height);
    if (!(blob instanceof Blob) || blob.type !== 'image/png') throw new Error('Generated review texture export did not produce a PNG.');
    // Do not put binary data in JSON-cloned Three.js userData. The resource
    // exporter reads this property directly; serialization remains metadata-only.
    Object.defineProperty(texture.userData, 'sourceBlob', { value: blob, configurable: true, writable: true, enumerable: false });
    exported++;
  }
  return exported;
}
