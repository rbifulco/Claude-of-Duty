import { defineConfig } from 'vite';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const commit = process.env.VITE_GIT_COMMIT || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const reviewModule = '\0virtual:review-build';
function reviewBuildId() {
  const hash = createHash('sha256');
  const visit = (path) => {
    for (const item of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = join(path, item.name);
      if (item.isDirectory()) visit(file); else hash.update(file).update(readFileSync(file));
    }
  };
  visit('src'); hash.update(readFileSync('package-lock.json'));
  return `claude-fresh-v1-${commit}-${hash.digest('hex').slice(0, 16)}`;
}

export default defineConfig({
  plugins: [{
    name: 'source-build-identity',
    resolveId(id) { if (id === 'virtual:review-build') return reviewModule; },
    load(id) { if (id === reviewModule) return `export default ${JSON.stringify(reviewBuildId())}`; },
    handleHotUpdate(ctx) {
      if (!ctx.file.includes('/src/') && !ctx.file.endsWith('/package-lock.json')) return;
      const module = ctx.server.moduleGraph.getModuleById(reviewModule);
      if (module) { ctx.server.moduleGraph.invalidateModule(module); return [...ctx.modules, module]; }
    },
  }],
  // Bind IPv4 explicitly: the default `localhost` binds ::1 only on macOS,
  // which the capture harness (127.0.0.1) cannot reach.
  // `hmr: false` when the capture harness owns the server (OW_NO_HMR=1): a file
  // saved by a concurrently-working agent otherwise reloads the page mid-capture
  // and playwright fails with "Execution context was destroyed".
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    hmr: process.env.OW_NO_HMR ? false : undefined,
  },
  preview: { host: '127.0.0.1' },
  build: { rollupOptions: { input: ['index.html', 'spatial-review.html'] }, target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 4096 },
  // Large binary game assets served verbatim.
  assetsInclude: ['**/*.ktx2', '**/*.hdr', '**/*.exr', '**/*.bin', '**/*.glb'],
});
