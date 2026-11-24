/**
 * Two tabs, one note, and a wait: does each see the other?
 *
 *   node scripts/check-presence.mjs
 *
 * Presence is the kind of feature that looks finished in a unit test and is dead
 * in the browser, because the channel name, the storage key or the mount point
 * quietly differ. This drives the built app the way a person would: two tabs on
 * the same note, then read the footer back.
 */
import { chromium } from 'playwright';
import { ensurePreview } from './lib/preview.mjs';

// Presence runs in device-only mode (no account, no server env), so the app is
// served from a local preview rather than the deployed origin: production is a
// signed-in product now, and a check that needs someone's password is not a
// check. This one owns its server.
const PORT = 8183;
const BASE = process.env.BASE || `http://127.0.0.1:${PORT}`;
const SEED = () => {
  const cache = [
    { id: 'note-p1', title: 'Presence test', updated: Date.now(), isPinned: false, folder: 'private', agentAccess: true },
  ];
  localStorage.setItem('local:notes-cache', JSON.stringify(cache));
  localStorage.setItem('local:notes-current-id', 'note-p1');
  localStorage.setItem('note-note-p1', '# Presence test\n\nTwo tabs, one note.');
};

const preview = await ensurePreview({
  port: PORT,
  outDir: 'dist-device',
  base: process.env.BASE,
  env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' },
});
process.on('exit', preview.stop);

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH,
  args: ['--no-sandbox'],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await context.addInitScript(SEED);

const open = async (label) => {
  const page = await context.newPage();
  await page.goto(`${BASE}/app/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const editor = page.locator('textarea').first();
  await editor.click();
  await page.keyboard.press('End');
  return { page, label };
};

const first = await open('a');
await first.page.waitForTimeout(300);
const second = await open('b');

// one heartbeat is 4 s; give it two so a missed beat is not a false pass
await second.page.waitForTimeout(8600);

const entries = async (page) =>
  page.locator('[data-presence-entry]').evaluateAll((els) => els.map((el) => el.textContent.trim()));

const aNames = await entries(first.page);
const bNames = await entries(second.page);

console.log(JSON.stringify({ a: aNames, b: bNames }, null, 2));

await second.page.screenshot({ path: '/tmp/presence-b.png' });

// A closed tab has to disappear on its own: no goodbye message is required,
// twelve seconds of silence is the whole contract.
await second.page.close();
await first.page.waitForTimeout(13_500);
const afterClose = await entries(first.page);
console.log(JSON.stringify({ afterClose }, null, 2));

if (aNames.length === 0 || bNames.length === 0) {
  console.error('FAIL  the two tabs did not see each other');
  process.exit(1);
}
if (aNames.length !== 1 || bNames.length !== 1) {
  console.error('FAIL  presence doubled up: each tab should show exactly one other person');
  process.exit(1);
}
if (afterClose.length !== 0) {
  console.error('FAIL  a closed tab is still shown as present');
  process.exit(1);
}
await browser.close();
console.log(`PASS  each tab shows the other (${aNames[0]}), and a closed tab is gone in 12 s`);
