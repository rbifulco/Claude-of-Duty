import { defineConfig, mergeConfig } from 'vite';
import { resolve } from 'node:path';
import base from '../vite.config.js';

const sdkPath = process.env.SPATIAL_REVIEW_SDK_PATH;
if (!sdkPath) throw new Error('SPATIAL_REVIEW_SDK_PATH is required for ownership-first browser validation.');

export default mergeConfig(base, defineConfig({
  resolve: { alias: [
    { find: '@alterno-dev/spatial-review', replacement: resolve(sdkPath, 'packages/sdk/dist/index.js') },
    { find: '@alterno-dev/spatial-review-protocol', replacement: resolve(sdkPath, 'packages/protocol/dist/index.js') },
  ] },
  server: { port: 5174, strictPort: true, hmr: false },
}));
