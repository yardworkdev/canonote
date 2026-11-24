// Audit the built artifact as a static host would serve it: every local href/src must
// resolve to a file, and the routes the product promises must exist.
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const root = "dist";
const htmlFiles = [];

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (entry.name.endsWith(".html")) htmlFiles.push(p);
  }
}
walk(root);

const problems = [];
const checked = new Set();

for (const file of htmlFiles) {
  const html = readFileSync(file, "utf8");
  const refs = [...html.matchAll(/(?:href|src)\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
  for (const ref of refs) {
    if (/^(https?:|mailto:|data:|#)/.test(ref)) continue;
    const clean = ref.split("?")[0].split("#")[0];
    const abs = clean.startsWith("/")
      ? join(root, clean)
      : resolve(dirname(file), clean);
    const key = `${file} -> ${ref}`;
    if (checked.has(key)) continue;
    checked.add(key);

    const exists = existsSync(abs) || existsSync(join(abs, "index.html"));
    if (!exists) problems.push(`missing ${key}`);
  }
}

// Routes the product promises, and the files a static host needs.
const required = [
  "index.html",
  "app.html",
  "app/index.html",
  "og.png",
  "shots/app.png",
  "favicon.ico",
  "favicon-32x32.png",
];
for (const rel of required) {
  if (!existsSync(join(root, rel))) problems.push(`route missing: /${rel}`);
}

const og = statSync(join(root, "og.png"));
console.log(
  JSON.stringify(
    {
      htmlFiles: htmlFiles.length,
      refsChecked: checked.size,
      requiredFiles: required.length,
      ogBytes: og.size,
      problems,
    },
    null,
    1,
  ),
);
process.exit(problems.length ? 1 : 0);
