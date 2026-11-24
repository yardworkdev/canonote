#!/usr/bin/env node
/**
 * The copy report — every string the reader sees, and every one that breaks the
 * tone standard. The rules live in `src/services/copy-audit.js` and the unit
 * gate runs the same code, so this script is how the audit is read rather than a
 * second implementation of it.
 *
 *   node scripts/audit-copy.mjs            # violations and counts
 *   node scripts/audit-copy.mjs --all      # the whole inventory, file by file
 *
 * Exits non-zero when anything violates the standard, so it can be run in a
 * session or a hook without reading the output to know the answer.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { COPY_AUDIT_SKIP, COPY_RULES, auditCopy, extractCopy } from '../src/services/copy-audit.js';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const SHOW_ALL = process.argv.includes('--all');

const sourceFiles = (dir) => {
  const found = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
      continue;
    }
    if (!/\.(js|jsx)$/.test(name)) continue;
    if (/\.test\.(js|jsx)$/.test(name)) continue;
    if (COPY_AUDIT_SKIP.has(name)) continue;
    found.push(path);
  }
  return found;
};

const files = sourceFiles(SRC).sort();
const perFile = files.map((path) => {
  const source = readFileSync(path, 'utf8');
  const entries = extractCopy(source, { jsx: path.endsWith('.jsx') });
  return { path: relative(ROOT, path), entries, violations: auditCopy(entries) };
});

const strings = perFile.reduce((total, file) => total + file.entries.length, 0);
const violations = perFile.flatMap((file) =>
  file.violations.map((violation) => ({ file: file.path, ...violation }))
);

console.log('The copy audit — every string the reader sees, held to the tone standard');
console.log(`Files: ${files.length}   Strings read: ${strings}   Violations: ${violations.length}`);
console.log('');
console.log('Rules:');
for (const { id, rule } of COPY_RULES) console.log(`  ${id}: ${rule}`);
console.log('');

if (violations.length) {
  console.log('Violations:');
  for (const { file, line, kind, text, rules } of violations) {
    console.log(`  ${file}:${line} [${kind}] ${rules.join(', ')}`);
    console.log(`    ${text}`);
  }
  console.log('');
}

if (SHOW_ALL) {
  console.log('The inventory:');
  for (const file of perFile) {
    console.log(`\n${file.path} (${file.entries.length})`);
    for (const { line, kind, text } of file.entries) {
      console.log(`  ${line} [${kind}] ${text}`);
    }
  }
} else {
  console.log('Strings per file (--all prints them):');
  for (const file of perFile) {
    console.log(`  ${file.entries.length}\t${file.path}`);
  }
}

process.exit(violations.length ? 1 : 0);
