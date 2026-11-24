#!/usr/bin/env node
/**
 * Where a check script reads its credentials from.
 *
 * A gate that hardcodes the author's home directory cannot run anywhere but
 * the author's machine, which is the one place it never needs to. Every script
 * now resolves a secret the same way, in this order:
 *
 *   1. <NAME>_FILE — an explicit path to a file holding it
 *   2. <NAME>      — the value itself (CI, a shell you already exported it in)
 *   3. <repo>/.secrets/<file> — the documented local layout, `.gitignore`d
 *
 * A missing secret fails with the three places it looked and how to set one,
 * because the first run of a check is the only documentation anyone reads.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Directory holding the local secret files; override with CANONOTE_SECRETS_DIR. Read per call, not at import. */
export const secretsDir = () => process.env.CANONOTE_SECRETS_DIR || join(REPO_ROOT, '.secrets');

/** Absolute path of a secret file in the configured secrets directory. */
export const secretPath = (file) => join(secretsDir(), file);

/**
 * Read a secret: `<NAME>_FILE`, then `<NAME>`, then <secretsDir()>/<file>.
 * @param {string} file    file name inside the secrets directory
 * @param {string} envName environment variable base name (e.g. SUPABASE_SERVICE_KEY)
 */
export function readSecret(file, envName) {
  const name = envName || file.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  const fromFile = process.env[`${name}_FILE`];
  if (fromFile) return readFileSync(fromFile, 'utf8').trim();
  if (process.env[name]) return process.env[name].trim();
  const path = secretPath(file);
  if (!existsSync(path)) {
    throw new Error(
      `${name} is not set. Put it in ${path}, or set ${name}_FILE to a file holding it, ` +
        `or set ${name} itself. ${file} is only needed by the checks that talk to the hosted layer.`
    );
  }
  return readFileSync(path, 'utf8').trim();
}

/** A scratch directory for screenshots and dumps; override with CANONOTE_SHOTS. Created on demand. */
export const shotsDir = () => {
  const dir = process.env.CANONOTE_SHOTS || join(REPO_ROOT, 'test-results/shots');
  mkdirSync(dir, { recursive: true });
  return dir;
};
