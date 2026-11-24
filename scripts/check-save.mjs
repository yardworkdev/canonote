/**
 * Does a note survive being typed, saved and reloaded?
 *
 *   node scripts/check-save.mjs
 *
 * The save pipeline is the most fragile part of the app and the one place where a
 * unit test cannot tell you the truth: it needs a real browser, a real
 * requestIdleCallback and a real reload. This drives all three in local mode.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { chromium } from 'playwright';

const PORT = 8187;
const BASE = process.env.BASE || `http://127.0.0.1:${PORT}`;
const TYPED = 'A line typed by the save check, ' + Date.now();

const answers = async (url) => {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    return response.ok;
  } catch {
    return false;
  }
};

// The check owns its launch. It used to assume a server on 8187 was already
// running, so on a clean checkout it failed with ERR_CONNECTION_REFUSED and
// proved nothing — a check that cannot run is a check that lies.
let server = null;
if (!(await answers(`${BASE}/app/`))) {
  if (!fs.existsSync('dist/index.html')) {
    const build = spawnSync('npm', ['run', 'build'], { stdio: 'inherit' });
    if (build.status !== 0) {
      console.error('FAIL  the build did not finish, so there was nothing to serve');
      process.exit(1);
    }
  }
  // The binary itself, not `npx`: killing an npx wrapper leaves the server it
  // spawned running, and the next run then meets its own port already taken.
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], {
    stdio: 'ignore',
  });
  // A server that outlives its check turns a pass into a hang: the event loop
  // stays alive and the script never exits. Unref it and stop it on the way out.
  server.unref();
  process.on('exit', () => server?.kill('SIGTERM'));
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline && !(await answers(`${BASE}/app/`))) {
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  if (!(await answers(`${BASE}/app/`))) {
    console.error(`FAIL  no preview server came up on ${BASE}`);
    process.exit(1);
  }
}

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH,
  args: ['--no-sandbox'],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await context.addInitScript(() => {
  if (localStorage.getItem('save-check-seeded')) return;
  localStorage.setItem(
    'local:notes-cache',
    JSON.stringify([
      { id: 'note-s1', title: 'Save check', updated: Date.now(), isPinned: false, folder: 'private', agentAccess: true },
    ])
  );
  localStorage.setItem('local:notes-current-id', 'note-s1');
  localStorage.setItem('save-check-seeded', '1');
});

const page = await context.newPage();
await page.goto(`${BASE}/app/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

const editor = page.locator('textarea').first();
await editor.click();
await page.keyboard.press('Control+End');
await page.keyboard.type(`\n\n${TYPED}`, { delay: 5 });

// The pipeline writes on requestIdleCallback (with a 1.5 s fallback) and then
// shows "Saved" for two seconds; give the whole cycle room.
await page
  .locator('text=Saved')
  .first()
  .waitFor({ timeout: 9000 })
  .catch(() => {});

const statusText = await page
  .locator('div')
  .filter({ hasText: /Saved|Saving|Error/ })
  .last()
  .innerText()
  .catch(() => '');

// Where the bytes land is the storage adapter's business (IndexedDB when it is
// available, localStorage otherwise). What matters is that the app says "Saved"
// and that the text is still there after a reload.

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const afterReload = await page.locator('textarea').first().inputValue();

await page.screenshot({ path: '/tmp/save-check.png' });
await browser.close();

const saidSaved = /Saved/.test(statusText);
const survivedReload = afterReload.includes(TYPED.trim());

console.log(
  JSON.stringify(
    {
      footer: statusText.replace(/\s+/g, ' ').slice(0, 80),
      saidSaved,
      survivedReload,
    },
    null,
    2
  )
);

if (!saidSaved) {
  console.error('FAIL  the app never reported the note as saved');
  process.exit(1);
}
if (!survivedReload) {
  console.error('FAIL  the text was stored but did not come back after a reload');
  process.exit(1);
}
console.log('PASS  typed text was saved, survived a reload, and came back in the editor');
server?.kill('SIGTERM');
process.exit(0);
