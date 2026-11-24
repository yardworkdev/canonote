/**
 * One contract, two implementations.
 *
 * The Node server in scripts/agent-server.mjs is the reference; rust/canonote-agent
 * is the compiled one. Both claim the same routes, the same JSON and the same byte
 * budget, and until this script existed nothing checked that claim: they drifted
 * twice (write fields, then the per-note switch) and nobody noticed.
 *
 *   node scripts/conformance.mjs
 *   RUST_BIN=rust/canonote-agent/target/release/canonote-agent node scripts/conformance.mjs
 *
 * What it compares, per request: the status code, the shape of the JSON (every key,
 * recursively, with array lengths) and the response size within 25%. Byte-exact
 * equality is not the bar because the two serialise numbers and keys differently;
 * shape and status are.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const NODE_PORT = Number(process.env.NODE_PORT || 8171);
const RUST_PORT = Number(process.env.RUST_PORT || 8172);
const RUST_BIN =
  process.env.RUST_BIN || 'rust/canonote-agent/target/release/canonote-agent';

if (!existsSync(RUST_BIN)) {
  console.error(`missing ${RUST_BIN}\nBuild it first:  cargo build --release --manifest-path rust/canonote-agent/Cargo.toml`);
  process.exit(2);
}

/** Start one server, wait for its keys, and return everything needed to talk to it. */
async function boot(command, args, port, label) {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const keyOf = (name) => {
    const match = stdout.match(new RegExp(`${name}=(\\S+)`));
    return match ? match[1] : null;
  };

  for (let i = 0; i < 100; i += 1) {
    if (keyOf('AGENT_KEY') && keyOf('ADMIN_KEY')) break;
    if (child.exitCode !== null) {
      throw new Error(`${label} exited before printing keys:\n${stderr || stdout}`);
    }
    await sleep(100);
  }
  if (!keyOf('AGENT_KEY')) throw new Error(`${label} never printed AGENT_KEY`);

  return {
    label,
    base: `http://127.0.0.1:${port}`,
    agent: keyOf('AGENT_KEY'),
    admin: keyOf('ADMIN_KEY'),
    stop: () => child.kill('SIGKILL'),
  };
}

/** Every key path in a JSON value, so two shapes can be compared as strings. */
function shape(value, path = '', out = []) {
  if (Array.isArray(value)) {
    out.push(`${path}[](${value.length})`);
    if (value.length > 0) shape(value[0], `${path}[]`, out);
    return out;
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value).sort()) shape(value[key], path ? `${path}.${key}` : key, out);
    return out;
  }
  out.push(`${path}:${value === null ? 'null' : typeof value}`);
  return out;
}

/** Ids, revisions and timestamps differ between runs; their presence is what matters. */
function normalize(body) {
  return JSON.parse(
    JSON.stringify(body)
      .replace(/"[0-9a-f]{64}"/g, '"<hash>"')
      .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '<ts>')
  );
}

async function call(server, { method = 'GET', path, body, as = 'agent' }) {
  const key = as === 'agent' ? server.agent : as === 'admin' ? server.admin : null;
  const res = await fetch(`${server.base}${path}`, {
    method,
    headers: {
      ...(key ? { authorization: `Bearer ${key}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, bytes: Buffer.byteLength(text, 'utf8'), shape: json ? shape(normalize(json)).join('|') : null, json };
}

/** The same walk through both servers, in the same order, mutating the same state. */
async function walk(server) {
  const out = [];
  const step = async (name, request) => {
    const result = await call(server, request);
    out.push({ name, status: result.status, shape: result.shape, bytes: result.bytes, json: result.json });
    return result;
  };

  await step('manifest without a key', { path: '/api/agent', as: 'none' });
  await step('manifest', { path: '/api/agent' });
  await step('list five ids', { path: '/api/agent/notes?limit=5&fields=id,title,updated' });
  await step('list since', { path: '/api/agent/notes?since=2026-10-20T00:00:00Z&limit=5' });
  await step('meta', { path: '/api/agent/notes/note-003?part=meta' });
  const body = await step('capped body', { path: '/api/agent/notes/note-003?part=body&maxBytes=300' });
  await step('missing note', { path: '/api/agent/notes/note-999' });
  await step('search', { path: '/api/agent/search?q=the&limit=5' });

  const created = await step('create', {
    method: 'POST',
    path: '/api/agent/notes',
    body: { title: 'Conformance', content: 'first line\nsecond line' },
  });
  const createdId = created.json?.id;
  await step('append', {
    method: 'PATCH',
    path: `/api/agent/notes/${createdId}`,
    body: { op: 'append', content: 'appended by the agent' },
  });
  await step('replace without revision', {
    method: 'PATCH',
    path: `/api/agent/notes/${createdId}`,
    body: { op: 'replace', content: 'replaced' },
  });
  await step('replace with stale revision', {
    method: 'PATCH',
    path: `/api/agent/notes/${createdId}`,
    body: { op: 'replace', content: 'replaced again', ifRevision: body.json?.rev },
  });

  await step('agent announces presence', {
    method: 'POST',
    path: '/api/agent/notes/note-004/presence',
    body: { mode: 'writing', from: 120, to: 180 },
  });
  await step('presence is readable', { path: '/api/human/notes/note-004/presence', as: 'admin' });

  await step('switch off', { method: 'POST', path: '/api/agent/switch', as: 'admin', body: { enabled: false } });
  await step('list while off', { path: '/api/agent/notes?limit=5' });
  await step('switch on', { method: 'POST', path: '/api/agent/switch', as: 'admin', body: { enabled: true } });

  await step('note access off', {
    method: 'POST',
    path: '/api/human/notes/access',
    as: 'admin',
    body: { id: 'note-003', agentAccess: false },
  });
  await step('list without the hidden note', { path: '/api/agent/notes?limit=5' });
  await step('hidden note is 404', { path: '/api/agent/notes/note-003?part=meta' });
  await step('hidden note cannot be written', {
    method: 'PATCH',
    path: '/api/agent/notes/note-003',
    body: { op: 'append', content: 'should not land' },
  });
  await step('hidden note cannot announce presence', {
    method: 'POST',
    path: '/api/agent/notes/note-003/presence',
    body: { mode: 'reading' },
  });
  await step('note access on', {
    method: 'POST',
    path: '/api/human/notes/access',
    as: 'admin',
    body: { id: 'note-003', agentAccess: true },
  });
  await step('meta is back', { path: '/api/agent/notes/note-003?part=meta' });

  return out;
}

const node = await boot(process.execPath, ['scripts/agent-server.mjs', String(NODE_PORT)], NODE_PORT, 'node');
const rust = await boot(RUST_BIN, [String(RUST_PORT)], RUST_PORT, 'rust');

let failures = 0;
try {
  const a = await walk(node);
  const b = await walk(rust);

  console.log(`\n${'vector'.padEnd(34)} ${'node'.padEnd(18)} ${'rust'.padEnd(18)} size`);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const left = a[i];
    const right = b[i];
    const same = left && right && left.status === right.status && left.shape === right.shape;
    const ratio = left && right ? right.bytes / Math.max(left.bytes, 1) : NaN;
    const sizeOk = !left || !right || (ratio > 0.75 && ratio < 1.25);
    if (!same || !sizeOk) failures += 1;
    const mark = same && sizeOk ? 'ok  ' : 'FAIL';
    console.log(
      `${mark} ${String(left?.name || right?.name).padEnd(30)} ${String(left?.status ?? '-').padEnd(6)} ${String(left?.bytes ?? '-').padStart(5)}B  ${String(right?.status ?? '-').padEnd(6)} ${String(right?.bytes ?? '-').padStart(5)}B  ${sizeOk ? '' : `${ratio.toFixed(2)}x`}`
    );
    if (!same) {
      console.log(`     node ${left?.shape}\n     rust ${right?.shape}`);
    }
  }
} finally {
  node.stop();
  rust.stop();
}

console.log(failures === 0 ? '\nPASS  one contract, two implementations' : `\nFAIL  ${failures} vector(s) drift`);
process.exit(failures === 0 ? 0 : 1);
