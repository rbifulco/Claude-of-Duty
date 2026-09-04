const textureSlots = ['map', 'normalMap', 'bumpMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap'];

export function yieldCaptureTask() {
  return new Promise(resolve => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close(); channel.port2.close(); resolve();
    };
    channel.port2.postMessage(null);
  });
}

export async function encodePixels(bytes, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('A 2D canvas is required to export review textures.');
    // Readback rows remain in GPU order. The original render-target texture's
    // flipY=false is preserved in the SDK descriptor, so do not flip them here.
    context.putImageData(new ImageData(new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.byteLength), width, height), 0, 0);
    // Both toBlob and OffscreenCanvas.convertToBlob can defer completion by
    // a second per image in hidden cross-site frames. Use one bounded encode
    // between task yields instead of waiting on those throttled callbacks.
    const data = canvas.toDataURL('image/png');
    if (!data.startsWith('data:image/png;base64,')) throw new Error('Could not encode a generated review texture.');
    return new Blob([Uint8Array.from(atob(data.slice(data.indexOf(',') + 1)), char => char.charCodeAt(0))], { type: 'image/png' });
  } finally { canvas.width = canvas.height = 0; }
}

/** Only the explicit, frozen review capture calls this. Keep gameplay textures
 * GPU-owned, but attach the SDK's supported sourceBlob for the standard maps
 * actually referenced by review materials. Each shared target is read once;
 * one readback/encode at a time bounds transient CPU memory. */
export async function prepareReviewTextureSources(renderer, targets, materials, encode = encodePixels,
  { signal, yieldTask = yieldCaptureTask } = {}) {
  const required = new Set();
  for (const material of materials) for (const slot of textureSlots) {
    if (material?.[slot]?.isTexture) required.add(material[slot]);
  }
  let exported = 0;
  for (const target of targets) {
    signal?.throwIfAborted();
    const texture = target.texture;
    if (!required.has(texture) || texture.userData.sourceBlob instanceof Blob) continue;
    // Give the catalog/resource bridge a task before each bounded readback.
    // Three's async readback polls a GPU fence with setTimeout; hidden cross-site
    // frames throttle those timers, potentially adding seconds per texture.
    await yieldTask();
    signal?.throwIfAborted();
    const { width, height } = target;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width * height > 4096 * 4096) {
      throw new Error(`Invalid generated texture dimensions: ${width} × ${height}.`);
    }
    const bytes = new Uint8Array(width * height * 4);
    renderer.readRenderTargetPixels(target, 0, 0, width, height, bytes);
    const blob = await encode(bytes, width, height);
    signal?.throwIfAborted();
    if (!(blob instanceof Blob) || blob.type !== 'image/png') throw new Error('Generated review texture export did not produce a PNG.');
    // Do not put binary data in JSON-cloned Three.js userData. The resource
    // exporter reads this property directly; serialization remains metadata-only.
    Object.defineProperty(texture.userData, 'sourceBlob', { value: blob, configurable: true, writable: true, enumerable: false });
    exported++;
  }
  return exported;
}

/** Catalog and geometry remain immediately available. Resource requests wait
 * for the frozen capture's exports instead of failing on GPU-only sources.
 * The SDK still performs peer authorization, registration and byte-limit checks. */
export function gateReviewTextureResources(registry, preparation) {
  const read = registry.readTextureResource.bind(registry);
  let disposed = false;
  // Consume early rejections even if the editor has not requested a texture yet.
  const settled = Promise.resolve(preparation).then(() => ({}), error => ({ error }));
  registry.readTextureResource = async (...args) => {
    const result = await settled;
    if (disposed) throw new DOMException('Review capture was disposed.', 'AbortError');
    if ('error' in result) throw result.error;
    return read(...args);
  };
  return () => { disposed = true; };
}
