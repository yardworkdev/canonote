/**
 * The whole agent contract, in one command.
 *
 *   node scripts/contract.mjs
 *
 * Boots the reference server on a free port, hands it the keys it printed, and
 * runs every script that treats the API as an agent would: entering, reading,
 * writing against a second author, the per-note switch, presence, and the
 * Node-to-Rust conformance vectors. Fails loudly if any of them fails, because a
 * contract that only half holds is not a contract.
 *
 * The Rust half is skipped when no binary is built; the rest still runs.
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { REPO_ROOT } from './lib/secrets.mjs';

const PORT = 8190;
const BASE = `http://127.0.0.1:${PORT}`;
const RUST_BIN =
  process.env.RUST_BIN || join(REPO_ROOT, 'rust/canonote-agent/target/release/canonote-agent');

const keys = {};
const server = spawn('node', ['scripts/agent-server.mjs', String(PORT)], {
  cwd: process.cwd(),
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`));
server.stdout.on('data', (chunk) => {
  for (const line of String(chunk).split('\n')) {
    const match = line.match(/^(AGENT_KEY|ADMIN_KEY)=(.+)$/);
    if (match) keys[match[1]] = match[2].trim();
  }
});

const stop = () => {
  if (!server.killed) server.kill('SIGTERM');
};
process.on('exit', stop);

// Wait for both keys rather than sleeping a fixed time: the server is ready when
// it has printed them.
for (let i = 0; i < 100 && !(keys.AGENT_KEY && keys.ADMIN_KEY); i += 1) await sleep(100);
if (!keys.AGENT_KEY || !keys.ADMIN_KEY) {
  console.error('FAIL  the reference server never printed its keys');
  stop();
  process.exit(1);
}

const run = (label, command, args, env = {}) =>
  new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...keys, ...env },
    });
    let out = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (out += chunk));
    child.on('close', (code) => {
      const last = out.trim().split('\n').filter(Boolean).pop() || '';
      console.log(`${code === 0 ? 'ok  ' : 'FAIL'}  ${label.padEnd(22)} ${last.slice(0, 90)}`);
      resolve({ label, code, out });
    });
  });

const checks = [
  await run('enter (context cost)', 'node', ['scripts/agent-enter.mjs', BASE]),
  await run('write against a human', 'node', ['scripts/agent-write.mjs', BASE]),
  await run('per-note switch', 'node', ['scripts/agent-access.mjs', BASE, 'note-003']),
  await run('agent presence', 'node', ['scripts/agent-presence.mjs', BASE]),
];

let conformance = { label: 'node <-> rust', code: 0 };
if (existsSync(RUST_BIN)) {
  conformance = await run('node <-> rust', 'node', ['scripts/conformance.mjs'], { RUST_BIN });
} else {
  console.log('--    node <-> rust          skipped: no Rust binary at RUST_BIN');
}

stop();

const failed = [...checks, conformance].filter((result) => result.code !== 0);
console.log(
  failed.length === 0
    ? `\nPASS  the whole agent contract holds (${checks.length + 1} groups)`
    : `\nFAIL  ${failed.map((result) => result.label).join(', ')}`
);
process.exit(failed.length === 0 ? 0 : 1);
