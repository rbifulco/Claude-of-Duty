import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const base = `${process.env.PAGES_BASE_PATH ?? '/Claude-of-Duty'}/`;
const dist = new URL('../dist/', import.meta.url);

test('Pages entry loads the built bundle from the project subpath', async () => {
  const html = await readFile(new URL('index.html', dist), 'utf8');
  const script = html.match(/<script\b[^>]*\bsrc="([^"]+)"/);
  assert.ok(script, 'the production HTML must reference a script');
  assert.ok(script[1].startsWith(`${base}assets/`), `expected ${base}assets/, got ${script[1]}`);
  assert.ok(!html.includes('/src/main.js'), 'raw source must not be deployed as the entry');
  const bundle = await readFile(new URL(script[1].slice(base.length), dist), 'utf8');
  assert.ok(bundle.includes('@alterno-dev/spatial-review') || bundle.includes('spatial-review'),
    'the integration must be included in the production bundle');
  if (process.env.VITE_GIT_COMMIT) {
    assert.ok(bundle.includes(process.env.VITE_GIT_COMMIT), 'review build identity must include the deployed commit');
  }
});
