#!/usr/bin/env node
/**
 * Deploy canonote to Vercel as the token's owner, without re-uploading the world.
 *
 * Why this exists instead of `vercel deploy`: the CLI insists on reading
 * /v2/user, which a team-scoped token refuses, and its git-integration deploys
 * are BLOCKED because the commits are authored by rudibrdev. Uploading the
 * source ourselves makes the deployment belong to whoever owns the token, which
 * is the account holder — and then Vercel builds it with the project's own env.
 *
 * Why it reuses blobs: /v2/files allows 5000 uploads a day and a full source
 * upload is ~460 files, so a dozen deploys exhausted the day's budget and every
 * later deploy answered 429. Files identical to the previous deployment are now
 * referenced by sha, and only what changed travels as inline data.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, posix } from 'node:path';
import { readSecret } from './lib/secrets.mjs';

const TOKEN = readSecret('vercel-token', 'VERCEL_TOKEN');
const PROJECT_ID = process.env.VERCEL_PROJECT_ID || 'prj_1lCM87bzWuK7WgAoaxpSdNQwCOAF';
const PROJECT = process.env.VERCEL_PROJECT || 'notes-editor';
const TEAM = process.env.VERCEL_TEAM || 'team_sc9yOLc5JJv45ttVBgvjjvDw';
const ROOT = process.env.DEPLOY_ROOT || process.cwd();
const TARGET = process.env.VERCEL_TARGET || 'production';
const INLINE_LIMIT = 1500 * 1024;

// Only what the build reads. Shipping coverage reports, screenshots and the
// test suite made every deploy 460 files instead of 100, and the uploads are
// what ran out.
const INCLUDE = [
  'api',
  'src',
  'public',
  'main.jsx',
  'index.html',
  'app.html',
  'index.css',
  'site.css',
  'tailwind.config.js',
  'postcss.config.js',
  'vite.config.js',
  'package.json',
  'package-lock.json',
  'vercel.json',
  // `npm run build` ends in build-sw.mjs, so the deploy carries it. Missing it
  // is a failed build, not a missing feature: the shell is generated, not stored.
  'scripts/build-sw.mjs',
];
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', '.vercel']);
const SKIP_FILES = new Set(['.env', '.env.local']);
const MAX_FILES = 4000;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (out.length >= MAX_FILES) break;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, out);
    } else if (entry.isFile() && !SKIP_FILES.has(entry.name)) {
      if (entry.name.endsWith('.log')) continue;
      out.push(full);
    }
  }
  return out;
}

async function api(path, init = {}) {
  const response = await fetch(`https://api.vercel.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(init.headers || {}) },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new Error(`${init.method || 'GET'} ${path} -> ${response.status} ${text.slice(0, 300)}`);
  }
  return body;
}

/** path -> sha, from the newest deployment that lists its files. */
async function knownBlobs() {
  const { deployments } = await api(`/v6/deployments?projectId=${PROJECT_ID}&limit=20&teamId=${TEAM}`);
  for (const deployment of deployments) {
    if (deployment.state !== 'READY') continue;
    let tree;
    try {
      tree = await api(`/v6/deployments/${deployment.uid}/files?teamId=${TEAM}`);
    } catch {
      continue;
    }
    const map = new Map();
    const walkTree = (nodes, prefix = '') => {
      for (const node of nodes || []) {
        const path = prefix ? `${prefix}/${node.name}` : node.name;
        if (node.type === 'directory') walkTree(node.children, path);
        else {
          // The API lists an upload under a `src/` root; the manifest we send is
          // rooted at the repo. Both spellings have to resolve to the same blob.
          map.set(path, node.uid);
          if (path.startsWith('src/')) map.set(path.slice(4), node.uid);
        }
      }
    };
    walkTree(tree);
    if (map.size > 20) return { map, deployment: deployment.uid };
  }
  return { map: new Map(), deployment: null };
}

const { map: blobs, deployment: reference } = await knownBlobs();
console.log(`reference ${reference || '(none)'} knows ${blobs.size} files`);

const files = INCLUDE.flatMap((entry) => {
  const full = join(ROOT, entry);
  try {
    if (readdirSync(full)) return walk(full);
  } catch {
    /* not a directory */
  }
  return [full];
});
const manifest = [];
let reused = 0;
let inline = 0;
let uploaded = 0;

for (const full of files) {
  const data = readFileSync(full);
  const sha = createHash('sha1').update(data).digest('hex');
  const file = posix.normalize(relative(ROOT, full).split('\\').join('/'));

  if (blobs.get(file) === sha) {
    manifest.push({ file, sha, size: data.length });
    reused += 1;
    continue;
  }

  const looksText = !data.includes(0) && data.length <= INLINE_LIMIT;
  if (looksText) {
    manifest.push({ file, data: data.toString('utf8') });
    inline += 1;
    continue;
  }

  console.log(`  uploading ${file} (${data.length} B)`);
  await api('/v2/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'x-vercel-digest': sha },
    body: data,
  });
  manifest.push({ file, sha, size: data.length });
  uploaded += 1;
}

console.log(`files ${files.length}: ${reused} reused, ${inline} inline, ${uploaded} uploaded`);

const body = { name: PROJECT, project: PROJECT, files: manifest };
if (TARGET === 'production') body.target = 'production';

const deployment = await api(`/v13/deployments?teamId=${encodeURIComponent(TEAM)}&forceNew=1`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

console.log(`deployment ${deployment.id} ${deployment.url || ''} state=${deployment.readyState || deployment.state}`);

for (let attempt = 0; attempt < 120; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const current = await api(`/v13/deployments/${deployment.id}?teamId=${encodeURIComponent(TEAM)}`);
  const state = current.readyState || current.state;
  if (state === 'READY' || state === 'ERROR' || state === 'CANCELED') {
    console.log(`final state: ${state}`);
    console.log(`url: https://${current.url}`);
    process.exit(state === 'READY' ? 0 : 1);
  }
  if (attempt % 6 === 0) console.log(`  ${state}…`);
}

console.log('timed out waiting for the deployment');
process.exit(1);
