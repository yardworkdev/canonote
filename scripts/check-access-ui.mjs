/**
 * Visual proof for the per-note agent switch: seed a local notebook, load the app,
 * and read the button that the sidebar renders for each note.
 *
 *   node scripts/check-access-ui.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:8180';
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH,
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

await page.addInitScript(() => {
  const cache = [
    { id: 'note-1', title: 'Pricing notes', updated: Date.now(), isPinned: false, folder: 'private', agentAccess: true },
    { id: 'note-2', title: 'Board memo', updated: Date.now(), isPinned: false, folder: 'private', agentAccess: false },
  ];
  localStorage.setItem('local:notes-cache', JSON.stringify(cache));
  localStorage.setItem('local:notes-current-id', 'note-1');
  localStorage.setItem('note-note-1', '# Pricing notes\n\nThree tiers, one of them free.');
  localStorage.setItem('note-note-2', '# Board memo\n\nDo not show this to anybody.');
});

await page.goto(`${BASE}/app/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

const rows = await page.$$eval('button[aria-label^="Block agents from"], button[aria-label^="Allow agents to see"]', (els) =>
  els.map((el) => el.getAttribute('aria-label'))
);

console.log(JSON.stringify({ rows, count: rows.length }, null, 2));
await page.screenshot({ path: '/tmp/access-ui.png' });
await browser.close();

if (!rows.some((r) => r.startsWith('Block agents from: Pricing notes'))) {
  console.error('FAIL  the eye button for an accessible note was not rendered');
  process.exit(1);
}
if (!rows.some((r) => r.startsWith('Allow agents to see: Board memo'))) {
  console.error('FAIL  the off note did not render as blocked');
  process.exit(1);
}
console.log('PASS  sidebar renders one accessible note and one blocked note');
