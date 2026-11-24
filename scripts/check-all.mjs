/**
 * Every proof in this repo, in one command.
 *
 *   node scripts/check-all.mjs            # all of them
 *   node scripts/check-all.mjs live-      # only the names containing "live-"
 *   node scripts/check-all.mjs --fast     # skip the ones that drive a browser locally
 *
 * Each check is its own process with its own timeout, so one hang cannot hide
 * the rest. The summary prints every check, its exit code and its wall time, and
 * the script exits non-zero if any of them failed. A check that is not listed
 * here does not exist as a proof.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FILTER = process.argv.slice(2).find((arg) => !arg.startsWith('--')) || '';
const TIMEOUT_MS = 240000;

// One suite at a time. Every check drives the same production app with throwaway
// accounts, so two suites running side by side collide: measured 25/27 with
// check:attribution and check:plus-focus failing, both green when re-run alone.
// A whole run that has to be re-run to know whether it was true is not a gate.
const LOCK = path.join(os.tmpdir(), 'canonote-check-all.lock');
const holder = Number(fs.existsSync(LOCK) ? fs.readFileSync(LOCK, 'utf8').trim() : 0);
const alive = (pid) => {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
if (alive(holder) && holder !== process.pid) {
  console.error(
    `check:all is already running (pid ${holder}). Every check drives the deployed app, so a ` +
      'second run would collide with it and produce failures that are not real. Wait for it to finish, ' +
      `or remove ${LOCK} if that process is gone.`
  );
  process.exit(2);
}
fs.writeFileSync(LOCK, String(process.pid));
const release = () => {
  try {
    if (Number(fs.readFileSync(LOCK, 'utf8').trim()) === process.pid) fs.unlinkSync(LOCK);
  } catch {
    /* already gone */
  }
};
process.on('exit', release);
process.on('SIGINT', () => {
  release();
  process.exit(130);
});
process.on('SIGTERM', () => {
  release();
  process.exit(143);
});

const scripts = Object.entries(JSON.parse(fs.readFileSync('package.json', 'utf8')).scripts)
  .filter(([name]) => name.startsWith('check:') && name !== 'check:all')
  .filter(([name]) => name.includes(FILTER));

const run = (command) =>
  new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, command.split(' ').slice(1), { stdio: 'pipe' });
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += chunk;
    });
    child.stderr.on('data', (chunk) => {
      out += chunk;
    });
    const timer = setTimeout(() => child.kill('SIGTERM'), TIMEOUT_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, ms: Date.now() - started, out });
    });
  });

const results = [];
for (const [name, command] of scripts) {
  process.stdout.write(`${name} … `);
  const { code, ms, out } = await run(command);
  const pass = code === 0;
  results.push({ name, pass, ms, out });
  console.log(`${pass ? 'PASS' : `FAIL (${code})`} ${Math.round(ms / 1000)}s`);
  if (!pass) console.log(out.trim().split('\n').slice(-6).map((l) => `    ${l}`).join('\n'));
}

const failed = results.filter((result) => !result.pass);
console.log(
  `\n${results.length - failed.length}/${results.length} checks passed` +
    (failed.length ? `; failed: ${failed.map((f) => f.name).join(', ')}` : '')
);
process.exit(failed.length ? 1 : 0);
