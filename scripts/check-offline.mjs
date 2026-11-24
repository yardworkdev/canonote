// Proves the promise this notebook makes about itself: once the app has been
// opened with the network, closing the laptop's lid or losing Wi-Fi does not
// take the notebook away. The notes were never in the network; the shell was.
//
//   npm run check:offline
//
// Boots the production build behind `vite preview` on a port of its own, opens
// /app in a real Chromium, writes a note, waits for "Saved", waits for the
// service worker to control the page, then cuts the network, reloads, and reads
// the text back out of the editor.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright-core";
import { browserExecutable } from './lib/browser.mjs';

const PORT = Number(process.env.OFFLINE_PORT ?? 4175);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = browserExecutable();

if (!existsSync("dist/sw.js")) {
  console.error("dist/sw.js is missing — run `npm run build` first (it writes the worker).");
  process.exit(2);
}

const preview = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
  stdio: ["ignore", "pipe", "pipe"],
});
let previewOutput = "";
preview.stdout.on("data", (chunk) => (previewOutput += chunk));
preview.stderr.on("data", (chunk) => (previewOutput += chunk));

const stop = () => {
  if (!preview.killed) preview.kill("SIGTERM");
};
process.on("exit", stop);

let up = false;
for (let attempt = 0; attempt < 40; attempt += 1) {
  try {
    const response = await fetch(`${BASE}/app`);
    if (response.ok) {
      up = true;
      break;
    }
  } catch {
    /* not listening yet */
  }
  await sleep(500);
}
if (!up) {
  console.error(`preview never answered on ${BASE}\n${previewOutput}`);
  process.exit(2);
}

const browser = await chromium.launch({
  executablePath: existsSync(CHROME) ? CHROME : undefined,
  args: ["--no-sandbox"],
});
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

try {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const editor = page.locator('textarea[aria-label="Note editor"]').first();

  await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.evaluate(
    () => new Promise((resolve) => {
      const request = indexedDB.deleteDatabase("canonote");
      request.onsuccess = request.onerror = request.onblocked = resolve;
    }),
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await editor.waitFor();

  await page.getByRole("button", { name: /create note/i }).first().click();
  const text = `# Offline note\n\nwritten ${new Date().toISOString()}`;
  await editor.click();
  await page.keyboard.type(text, { delay: 5 });
  await page.getByText("Saved", { exact: true }).waitFor();
  check("a note is written and saved while online", true);

  const installed = await page.evaluate(async () => {
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((resolve) => setTimeout(() => resolve(null), 10000)),
    ]);
    return Boolean(registration?.active);
  });
  check("the offline shell is installed", installed);
  // A worker cannot intercept the page that registered it until that page
  // reloads, so one online reload is what puts it in control.
  if (installed) {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page
      .waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 15000 })
      .catch(() => {});
    await editor.waitFor();
  }
  const controlling = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
  check("it is in control of the page", controlling);

  await sleep(1500);
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });

  let rendered = true;
  await editor.waitFor({ timeout: 20000 }).catch(() => (rendered = false));
  check("the app opens with no network", rendered);

  let value = "";
  for (let attempt = 0; attempt < 24 && !value; attempt += 1) {
    value = await editor.inputValue().catch(() => "");
    if (!value) await sleep(250);
  }
  check("the note is still there after the offline reload", value === text, `${value.length} chars`);

  await context.setOffline(false).catch(() => {});
  await context.close().catch(() => {});
} finally {
  await browser.close();
  stop();
}

console.log(failures === 0 ? "\noffline shell works." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
