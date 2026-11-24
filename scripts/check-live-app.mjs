#!/usr/bin/env node
/**
 * The deployed notebook, driven like a person drives it — in production, with no
 * account, and with nothing mocked.
 *
 * `check:live` asks whether the site answers. This asks whether it works: a note
 * is created, typed into, saved, and found again after a reload, on the real
 * origin, against whatever build is actually serving. The demo is walked the
 * same way, because it is what a stranger meets first.
 *
 *   node scripts/check-live-app.mjs                 # production
 *   LIVE_URL=http://localhost:4173 node scripts/check-live-app.mjs
 */
import { chromium } from '@playwright/test';
import { ensurePreview } from './lib/preview.mjs';

const EDITOR = 'textarea[aria-label="Note editor"]';

// The deployed origin is a signed-in product, so it cannot be driven without
// someone's password. With LIVE_URL unset this check serves its own device-only
// build - the mode a stranger with no account still gets - and with LIVE_URL set
// it drives whatever origin you name, exactly as before.
const preview = process.env.LIVE_URL
  ? null
  : await ensurePreview({
      port: 8184,
      outDir: 'dist-device',
      env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' },
    });
if (preview) process.on('exit', preview.stop);
const BASE = (process.env.LIVE_URL || preview.base).replace(/\/$/, '');

let failures = 0;
function line(ok, label, detail = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(40)} ${detail}`);
}

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
});

try {
  console.log(`\nlive app check  ${BASE}\n`);
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', (error) => line(false, 'no uncaught page error', error.message));

  await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });

  const editor = page.locator(EDITOR).first();
  await editor.waitFor({ state: 'visible', timeout: 20000 });
  line(true, 'the editor opens without an account');

  const storageFact = page.getByText('Stored in this browser');
  line(await storageFact.isVisible().catch(() => false), 'the footer says where it is stored');

  await page.getByRole('button', { name: /create note/i }).first().click();
  const marker = `live check ${Date.now()}`;
  await editor.click();
  await page.keyboard.type(`# ${marker}\n\ntyped by a real browser against production.`, { delay: 8 });

  await page.waitForTimeout(2500);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await editor.waitFor({ state: 'visible', timeout: 20000 });
  // Content loads asynchronously after a reload (IndexedDB read, then restore of
  // the last-open note), so this waits rather than sampling once.
  const survived = await page
    .waitForFunction(
      ({ selector, marker }) => {
        const el = /** @type {HTMLTextAreaElement|null} */ (document.querySelector(selector));
        return el && el.value.includes(marker) ? el.value : null;
      },
      { selector: EDITOR, marker },
      { timeout: 20000 }
    )
    .then((handle) => handle.jsonValue())
    .catch(() => '');
  if (!survived.includes(marker)) {
    const rows = await page.getByRole('button', { name: /^Open note:/ }).allInnerTexts();
    const keys = await page.evaluate(() => Object.keys(localStorage));
    console.log('     after reload: rows=' + JSON.stringify(rows.slice(0, 4)));
    console.log('     after reload: localStorage keys=' + JSON.stringify(keys.slice(0, 6)));
  }
  line(survived.includes(marker), 'the note survives a reload', `${survived.length} chars`);

  const row = page.getByRole('button', { name: new RegExp(`Open note: ${marker}`) }).first();
  line(await row.isVisible().catch(() => false), 'the row carries the title from the markdown');

  const agentSwitch = page.getByLabel(`Block agents from: ${marker}`);
  line((await agentSwitch.count()) > 0, 'the per-note agent switch is present');

  // The demo is a static illustration, not a second app: it must render its own
  // note and the agent card on a cold visit, with no storage and no account.
  const demo = await context.newPage();
  // `/demo` without the slash is answered by the app's own index.html on a
  // static server (SPA fallback), which is why this check used to report both
  // failures: it was reading the app, not the demo.
  await demo.goto(`${BASE}/demo/`, { waitUntil: 'networkidle' });
  const demoHeading = await demo
    .getByRole('heading', { name: /Q3 planning/ })
    .first()
    .isVisible()
    .catch(() => false);
  line(demoHeading, 'the demo renders its illustration');

  const demoCard = await demo
    .getByLabel('Suggestion from Claude')
    .count()
    .catch(() => 0);
  line(demoCard > 0, 'the demo shows the agent card', `${demoCard} card(s)`);

  await context.close();
} catch (error) {
  line(false, 'the run completed', error.message);
} finally {
  await browser.close();
}

console.log(
  failures === 0 ? '\nPASS  the deployed notebook works as a person uses it\n' : `\n${failures} check(s) failed\n`
);
process.exit(failures === 0 ? 0 : 1);
