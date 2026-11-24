#!/usr/bin/env node
/**
 * Bundle-size budget for the release build.
 *
 * The product promise is a calm notebook: one that is fast to open and light to
 * ship. This check turns that into a number (`npm run check:bundle`, run right
 * after the build) so a fat dependency or an accidentally eager import fails
 * the build instead of quietly shipping.
 *
 * It measures gzip size, because that is what a visitor downloads — raw bytes
 * reward the wrong thing. The entries are read from the built HTML, so the
 * budget tracks the real first load of each surface and cannot go stale when a
 * chunk is renamed.
 *
 * Budgets sit a few points above the measured values (see PERFORMANCE.md); they
 * are a regression tripwire, not a target. Raising one to make a build pass is
 * the thing this exists to prevent.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;

/** Initial payload of each surface, in gzip bytes. */
const ENTRY_BUDGETS = {
  'index.html': 25 * 1024, // the marketing page: HTML + site.css, no JS bundle
  'app.html': 190 * 1024, // the notebook: app + react vendor + icons + app.css
  'demo/index.html': 20 * 1024, // the read-only demo: static, no account, no sync
};

/**
 * The build copies app.html to app/index.html for hosts that do not rewrite
 * /app to /app.html. It is the same surface and must not need a second budget:
 * one surface, one number.
 */
const SURFACE_OF = {
  'app/index.html': 'app.html',
};

/** Largest single JS chunk, in gzip bytes — catches one chunk absorbing a dependency. */
const LARGEST_CHUNK_BUDGET = 110 * 1024;

/** All JS + CSS in dist/, in gzip bytes — the code payload, not binary assets. */
const TOTAL_BUDGET = 260 * 1024;

const gzipSize = (path) => gzipSync(readFileSync(path), { level: 9 }).length;

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

/** Asset refs the browser fetches before the app renders: scripts, modulepreloads, stylesheets. */
const initialAssets = (htmlPath) => {
  const html = readFileSync(htmlPath, 'utf8');
  const refs = new Set();
  const script = /<script[^>]+src="([^"]+)"/g;
  const preload = /<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g;
  const stylesheet = /<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g;
  for (const pattern of [script, preload, stylesheet]) {
    for (const match of html.matchAll(pattern)) {
      if (match[1].startsWith('/')) refs.add(match[1]);
    }
  }
  return [...refs];
};

const failures = [];
const rows = [];

const files = walk(DIST);
// Only the code we control: binary assets (favicons, screenshots) are not code
// and their size cannot regress from a dependency. What the browser actually
// fetches is already covered by the entry budgets above.
const codeFiles = files.filter((file) => file.endsWith('.js') || file.endsWith('.css'));
const totalGzip = codeFiles.reduce((sum, file) => sum + gzipSize(file), 0);

const htmlFiles = files.filter((f) => f.endsWith('.html'));
for (const htmlPath of htmlFiles) {
  const name = relative(DIST, htmlPath).split('\\').join('/');
  const surface = SURFACE_OF[name] || name;
  const budget = ENTRY_BUDGETS[surface];
  const assets = initialAssets(htmlPath);
  // The HTML itself is part of the first load.
  const size = gzipSize(htmlPath) + assets.reduce((sum, ref) => sum + gzipSize(join(DIST, ref)), 0);
  rows.push(
    `${name.padEnd(12)} initial ${kb(size).padStart(9)}  budget ${kb(budget ?? 0).padStart(9)}`
  );
  if (budget === undefined) failures.push(`${name}: no budget declared in ENTRY_BUDGETS`);
  else if (size > budget)
    failures.push(`${name}: initial load ${kb(size)} exceeds the ${kb(budget)} budget`);
}

const jsFiles = files.filter((f) => f.endsWith('.js'));
const largest = jsFiles.reduce(
  (worst, file) => {
    const size = gzipSize(file);
    return size > worst.size ? { name: relative(DIST, file), size } : worst;
  },
  { name: '(none)', size: 0 }
);
rows.push(
  `largest js   ${kb(largest.size).padStart(9)}  budget ${kb(LARGEST_CHUNK_BUDGET).padStart(9)}  (${largest.name})`
);
if (largest.size > LARGEST_CHUNK_BUDGET) {
  failures.push(
    `largest chunk ${largest.name} ${kb(largest.size)} exceeds the ${kb(LARGEST_CHUNK_BUDGET)} budget`
  );
}

rows.push(`js + css     ${kb(totalGzip).padStart(9)}  budget ${kb(TOTAL_BUDGET).padStart(9)}`);
if (totalGzip > TOTAL_BUDGET) {
  failures.push(`js + css total ${kb(totalGzip)} exceeds the ${kb(TOTAL_BUDGET)} budget`);
}

console.log(`Bundle-size budget (gzip; ${files.length} files in dist/)\n${rows.join('\n')}`);

if (failures.length) {
  console.error(`\nFAIL — bundle-size budget violated:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}

console.log('\nOK — every bundle-size budget holds.');
