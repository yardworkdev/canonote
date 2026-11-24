#!/usr/bin/env node
/**
 * Opening a note shows that note — or an explicit loading state — never the one
 * the person just left. The server is slowed to 3 s so the window is visible.
 */
import { chromium } from 'playwright';
import { readSecret } from './lib/secrets.mjs';
import { browserExecutable } from './lib/browser.mjs';

const BASE = 'https://canonote.vercel.app';
const SUPABASE = 'https://vcplldetvuezauzwyrkh.supabase.co';
const SERVICE = readSecret('supabase-service-key', 'SUPABASE_SERVICE_KEY');
const CHROME = browserExecutable();

const stamp = Date.now();
const email = `promi-slow-${stamp}@example.com`;
const password = `slow-${stamp}-aaaa`;

let failures = 0;
const line = (ok, label, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(52)} ${detail}`);
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

  await page.route('**/api/notes/*', async (route) => {
    if (route.request().method() === 'GET') await new Promise((resolve) => setTimeout(resolve, 3000));
    return route.continue();
  });
  await page.getByRole('button', { name: /Open note: ONE one one/ }).first().evaluate((el) => el.click());

  const duringLoad = [];
  for (let i = 0; i < 8; i += 1) {
    await page.waitForTimeout(250);
    duringLoad.push(await editor.inputValue().catch(() => '<gone>'));
  }
  line(
    !duringLoad.some((value) => value.includes('TWO')),
    'a slow load never shows the note you left',
    JSON.stringify(duringLoad.map((value) => value.slice(0, 10)))
  );
  await page.waitForTimeout(3500);
  line((await editor.inputValue()).includes('ONE'), 'and the note that arrives is the right one');
  await page.unroute('**/api/notes/*');

  await page.screenshot({ path: '/tmp/slow-load.png' });
} finally {
  await browser.close();
  await fetch(`${SUPABASE}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
}

console.log(failures === 0 ? '\nPASS  a slow load never shows the wrong note\n' : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
