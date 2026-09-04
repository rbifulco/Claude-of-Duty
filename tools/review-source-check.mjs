import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeSpatialReviewDiscovery } from '@alterno-dev/spatial-review';
const discovery=JSON.parse(readFileSync('public/.well-known/spatial-review.json'));
const normalized=normalizeSpatialReviewDiscovery(discovery, "https://rbifulco.github.io/Claude-of-Duty/.well-known/spatial-review.json");assert.equal(normalized.websiteUrl,"https://rbifulco.github.io/Claude-of-Duty/");assert.equal(normalized.liveCapture,"https://rbifulco.github.io/Claude-of-Duty/spatial-review.html");
const main=readFileSync('src/main.js','utf8');assert(!main.includes('spatial-review'));assert(!main.includes('review/capture'));
const pkg=JSON.parse(readFileSync('package.json'));assert.equal(pkg.dependencies['@alterno-dev/spatial-review'],'0.7.0');
const lock=JSON.parse(readFileSync('package-lock.json'));assert(lock.packages['node_modules/@alterno-dev/spatial-review'].resolved.startsWith('https://registry.npmjs.org/'));
console.log('Release package, ordinary-page boundary and discovery schema passed');
