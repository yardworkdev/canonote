#!/usr/bin/env node
/**
 * Two things the person must be told, not left to guess:
 *  - opening a note shows that note (or an explicit loading state), never the one
 *    they just left;
 *  - a save that never answers ends in a sentence, not "Saving…" for ever.
 */
import { chromium } from 'playwright';
import { readSecret } from './lib/secrets.mjs';
import { browserExecutable } from './lib/browser.mjs';

const BASE = 'https://canonote.vercel.app';
const SUPABASE = 'https://vcplldetvuezauzwyrkh.supabase.co';
const SERVICE = readSecret('supabase-service-key', 'SUPABASE_SERVICE_KEY');
const CHROME = browserExecutable();

const stamp = Date.now();
const email = `promi-load-${stamp}@example.com`;
const password = `load-${stamp}-aaaa`;

let failures = 0;
const line = (ok, label, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(58)} ${detail}`);
};

const created = await fetch(`${SUPABASE}/auth/v1/admin/users`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  body: JSON.stringify({ email, password, email_confirm: true }),
});
const userId = (await created.json()).id;

const browser = await chromium.launch({ executablePath: CHROME });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${BASE}/app`, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForTimeout(3500);

  const editor = page.locator('main textarea').first();
  await editor.click();
  await page.keyboard.type('ONE one one');
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: 'Create new note' }).first().click();
  await page.waitForTimeout(1500);
  await editor.click();
  await page.keyboard.type('TWO two two');
  await page.waitForTimeout(2500);

  // --- switching notes while the load is slow
  await page.route('**/api/notes/*', async (route) => {
    if (route.request().method() === 'GET') {
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    await route.continue();
  });
  const oneRow = page.getByRole('button', { name: /Open note: ONE one one/ }).first();
  await oneRow.waitFor({ timeout: 15000 }).catch(async () => {
    console.log('sidebar was:', (await page.locator('nav').innerText()).slice(0, 300));
  });
  await oneRow.evaluate((el) => el.click());
  const duringLoad = [];
  for (let i = 0; i < 8; i += 1) {
    await page.waitForTimeout(250);
    duringLoad.push(await editor.inputValue().catch(() => '<gone>'));
  }
  line(
    !duringLoad.some((value) => value.includes('TWO')),
    'a slow load never shows the note you left',
    JSON.stringify(duringLoad.map((value) => value.slice(0, 12)))
  );
  await page.waitForTimeout(3500);
  line((await editor.inputValue()).includes('ONE'), 'and the note that arrives is the right one');
  await page.unroute('**/api/notes/*');

  // --- a save that never answers
  await page.route('**/api/notes/*', async (route) => {
    if (route.request().method() === 'PATCH') {
      // Held past the client's own 15 s deadline, then failed. The point is what
      // the person is told, not how the socket ends.
      await new Promise((resolve) => setTimeout(resolve, 20000));
      return route.abort('timedout');
    }
    await route.continue();
  });
  await editor.click();
  await page.keyboard.type(' and a save that hangs');
  const footer = page.locator('footer').first();
  let told = '';
  for (let i = 0; i < 40; i += 1) {
    await page.waitForTimeout(500);
    told = await footer.innerText().catch(() => '');
    if (/could not be saved|not saved|failed|retry/i.test(told)) break;
  }
  line(/could not be saved|not saved|failed|retry/i.test(told), 'a hung save ends in a sentence', JSON.stringify(told.slice(-90)));
  await page.unroute('**/api/notes/*');

  await page.screenshot({ path: '/tmp/loading-and-timeout.png' });
} finally {
  await browser.close();
  await fetch(`${SUPABASE}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
}

console.log(failures === 0 ? '\nPASS  the notebook says what it is doing\n' : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
