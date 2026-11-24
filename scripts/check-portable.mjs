#!/usr/bin/env node
/**
 * A clone can run the gates that need credentials.
 *
 *   node scripts/check-portable.mjs
 *
 * Every hosted-layer check reads its key through scripts/lib/secrets.mjs. That
 * only helps if the resolver really obeys, in order: <NAME>_FILE, then <NAME>,
 * then <repo>/.secrets/<file>. And it only stays true if no script goes back to
 * an absolute path on the machine it was written on — the bug this check exists
 * for: one readFileSync() on the author's home directory made every live gate
 * fail in a clone, with an ENOENT that named a directory the reader never had.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { REPO_ROOT, readSecret, secretPath, shotsDir } from './lib/secrets.mjs';

let failures = 0;
const line = (ok, label, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(62)} ${detail}`);
};

const scratch = mkdtempSync(join(tmpdir(), 'canonote-portable-'));
const saved = {};
for (const name of [
  'CANONOTE_SECRETS_DIR',
  'PORTABLE_PROBE',
  'PORTABLE_PROBE_FILE',
  'CANONOTE_SHOTS',
]) {
  saved[name] = process.env[name];
}

try {
  // 1. a secret file in the configured directory is found by name
  const dir = join(scratch, 'secrets');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'portable-probe'), 'from-the-directory\n');
  process.env.CANONOTE_SECRETS_DIR = dir;
  line(
    secretPath('portable-probe') === join(dir, 'portable-probe'),
    'the secrets directory follows CANONOTE_SECRETS_DIR',
    dir
  );
  line(
    readSecret('portable-probe', 'PORTABLE_PROBE') === 'from-the-directory',
    'a key is read from <secrets>/<file>'
  );

  // 2. <NAME> beats the file
  process.env.PORTABLE_PROBE = 'from-the-environment';
  line(
    readSecret('portable-probe', 'PORTABLE_PROBE') === 'from-the-environment',
    '<NAME> beats the file on disk'
  );

  // 3. <NAME>_FILE beats <NAME>
  const explicit = join(scratch, 'explicit-key');
  writeFileSync(explicit, 'from-the-file-variable\n');
  process.env.PORTABLE_PROBE_FILE = explicit;
  line(
    readSecret('portable-probe', 'PORTABLE_PROBE') === 'from-the-file-variable',
    '<NAME>_FILE beats <NAME>'
  );

  // 4. a missing secret says where it looked, all three ways
  delete process.env.PORTABLE_PROBE;
  delete process.env.PORTABLE_PROBE_FILE;
  let message = '';
  try {
    readSecret('portable-probe-missing', 'PORTABLE_PROBE');
  } catch (error) {
    message = error.message;
  }
  line(
    message.includes(join(dir, 'portable-probe-missing')) &&
      message.includes('PORTABLE_PROBE_FILE') &&
      message.includes('PORTABLE_PROBE'),
    'a missing key names all three places it looked',
    message ? `${message.length} chars` : 'no error'
  );

  // 5. the screenshot directory exists once asked for
  process.env.CANONOTE_SHOTS = join(scratch, 'shots');
  line(
    shotsDir() === join(scratch, 'shots') && existsSync(join(scratch, 'shots')),
    'shotsDir follows CANONOTE_SHOTS and creates it'
  );

  // 6. no script reaches outside the repository for a credential.
  // Prose may name the path; code may not. A comment cannot open a file, and a
  // gate that forbids explaining the bug it exists for is a gate people delete —
  // which is how this check failed on its own branch the first time it ran.
  const hardcoded = (text) => {
    if (/^\s*(\*|\/\/|\/\*)/.test(text)) return null;
    const match = text.match(/['"`](\/(?:home|Users|workspace|srv|root)\/[^'"`\s]*)['"`]/);
    return match ? match[1] : null;
  };
  // The fixture is assembled, not written out: a quoted absolute path here would
  // be exactly what the scan below reports.
  const probe = `/${['workspace', 'someone', '.secrets', 'key'].join('/')}`;
  line(
    hardcoded(`readFileSync('${probe}')`) === probe,
    'a read from a hardcoded path is a violation'
  );
  line(
    hardcoded(` *   readFileSync('${probe}')`) === null,
    'the same path inside a comment is not'
  );
  const tracked = execFileSync('git', ['ls-files', 'scripts'], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((p) => p.endsWith('.mjs') || p.endsWith('.js'));
  const outside = [];
  for (const file of tracked) {
    if (relative(REPO_ROOT, file) === 'scripts/lib/secrets.mjs') continue;
    readFileSync(join(REPO_ROOT, file), 'utf8')
      .split('\n')
      .forEach((text, i) => {
        const found = hardcoded(text);
        if (found) outside.push(`${file}:${i + 1}: ${found}`);
      });
  }
  line(
    outside.length === 0,
    'no script hardcodes a path on the machine it was written on',
    outside.join('; ') || `${tracked.length} scripts`
  );
} finally {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  rmSync(scratch, { recursive: true, force: true });
}

console.log(
  failures === 0 ? '\nPASS — the gates run from a clone' : `\nFAIL — ${failures} check(s)`
);
process.exit(failures === 0 ? 0 : 1);
