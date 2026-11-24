// Proves the offline promise on the *deployed* site, not on a local preview.
//
//   npm run check:offline-live
//   OFFLINE_LIVE_BASE=https://canonote.vercel.app npm run check:offline-live
//
// check-offline.mjs runs the production build behind `vite preview`, which proves
// the worker it wrote is correct. It cannot tell you whether the deployment
// actually carries that worker: a deploy that skips scripts/build-sw.mjs builds
// green and ships a site with no shell at all. This one asks the real host.
//
// What it asserts, in the order the promise is made:
//   1. /sw.js is served, and names the build it caches;
//   2. the worker installs and takes control of the page;
//   3. its cache holds the entry documents, not just the assets;
//   4. with the network cut, a reload still lands in the notebook.
//
// It does not write a note: that needs a signed-in session, and the shell is the
// part that was missing from the network.
import { existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright-core";
import { browserExecutable } from './lib/browser.mjs';

const BASE = (process.env.OFFLINE_LIVE_BASE ?? "https://canonote.vercel.app").replace(/\/$/, "");
const CHROME = browserExecutable();

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const worker = await fetch(`${BASE}/sw.js`).catch((error) => ({ ok: false, text: () => String(error) }));
const workerText = worker.ok ? await worker.text() : "";
check("the deployed site serves a service worker", worker.ok, `${BASE}/sw.js`);
const version = /const VERSION = "([^"]+)"/.exec(workerText)?.[1] ?? "";
check("it is versioned by a build", Boolean(version), version || "no VERSION line");
const precache = /const PRECACHE = \[([\s\S]*?)\];/.exec(workerText)?.[1] ?? "";
check("it precaches the app shell", /"\/app\/index\.html"|\/app\.html/.test(precache),
  `${(precache.match(/"/g) || []).length / 2} entries`);
check("it does not cache the agent API", !/"\/api\//.test(precache));

const browser = await chromium.launch({
  executablePath: existsSync(CHROME) ? CHROME : undefined,
  args: ["--no-sandbox"],
});

try {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(25000);
  const editor = page.locator('textarea[aria-label="Note editor"]').first();

  const app = await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
  check("the app answers", app?.status() === 200, `HTTP ${app?.status()}`);

  const installed = await page.evaluate(async () => {
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((resolve) => setTimeout(() => resolve(null), 15000)),
    ]);
    return Boolean(registration?.active);
  });
  check("the worker installs on the live site", installed);

  if (installed) {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page
      .waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 20000 })
      .catch(() => {});
  }
  const controlling = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
  check("it controls the page", controlling);

  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const store = await caches.open(names[0]);
    const keys = (await store.keys()).map((request) => new URL(request.url).pathname);
    return { name: names[0] ?? "", keys };
  });
  check("its cache carries the shell", cached.keys.includes("/app/index.html") || cached.keys.includes("/app.html"),
    `${cached.name}: ${cached.keys.length} entries`);
  check("its cache carries the entry bundle", cached.keys.some((key) => /\/assets\/app-.*\.js$/.test(key)));

  await sleep(1500);
  await context.setOffline(true);
  const offline = await page.reload({ waitUntil: "domcontentloaded" }).catch(() => null);
  let rendered = true;
  await editor.waitFor({ timeout: 25000 }).catch(() => (rendered = false));
  check("with the network cut, a reload lands in the notebook", rendered,
    offline ? `HTTP ${offline.status()}` : "no response (served from cache)");

  await context.setOffline(false).catch(() => {});
  await context.close().catch(() => {});
} finally {
  await browser.close();
}

console.log(failures === 0 ? `\nthe deployed site opens offline (${BASE}).` : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
