#!/usr/bin/env node
/**
 * A save that never answers must end in a sentence the person can read.
 *
 * The request is held for 20 s while the client's own deadline is 15 s; the end
 * of the socket is not the point, what the footer says is.
 */
import { chromium } from 'playwright';
import { readSecret } from './lib/secrets.mjs';
import { browserExecutable } from './lib/browser.mjs';

const BASE = 'https://canonote.vercel.app';
const SUPABASE = 'https://vcplldetvuezauzwyrkh.supabase.co';
const SERVICE = readSecret('supabase-service-key', 'SUPABASE_SERVICE_KEY');
const CHROME = browserExecutable();

const stamp = Date.now();
const email = `promi-hang-${stamp}@example.com`;
const password = `hang-${stamp}-aaaa`;
let failures = 0;
const line = (ok, label, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(46)} ${detail}`);
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
  let patchCount = 0;
  page.on('request', (req) => { if (req.url().includes('/api/notes') && req.method() === 'PATCH') patchCount += 1; });
  page.on('crash', () => console.log('PAGE CRASHED'));
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.log('NAVIGATED', f.url().slice(0, 80)); });
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message.slice(0, 120)));
  await page.goto(`${BASE}/app`, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForTimeout(3500);

  const editor = page.locator('main textarea').first();
  await editor.click();
  await page.keyboard.type('A note that will hang');
  await page.waitForTimeout(2500);

  await page.route('**/api/notes/*', async (route) => {
    if (route.request().method() === 'PATCH') {
      await new Promise((resolve) => setTimeout(resolve, 20000));
      return route.abort('timedout');
    }
    return route.continue();
  });

  await editor.click();
  await page.keyboard.type(' plus more');
  const started = Date.now();
  let told = '';
  for (let i = 0; i < 34; i += 1) {
    await page.waitForTimeout(500);
    told = await page.evaluate(() => document.body.innerText.slice(-400)).catch(() => '');
    if (/could not be saved|not saved|failed|retry|offline/i.test(told)) break;
  }
  const waited = Math.round((Date.now() - started) / 100) / 10;
  const match = told.match(/[^\n]*(could not be saved|not saved|failed|retry|offline)[^\n]*/i);
  line(Boolean(match), `a hung save ends in a sentence (${waited}s)`, JSON.stringify(match ? match[0] : told.slice(-100)));

  // The toast is transient by design; the footer is the lasting answer.
  const footerText = await page.evaluate(() => document.body.innerText.slice(-200)).catch(() => '');
  const stillSaving = /Saving\.\.\./.test(footerText);
  line(!stillSaving, 'and the footer stops saying "Saving…"', JSON.stringify(footerText.replace(/\n/g, ' | ').slice(-90)));
  const hasRetry = /Save failed[\s\S]*Retry/i.test(footerText);
  line(hasRetry, 'with a Retry to act on', hasRetry ? 'present' : 'absent');
  line(patchCount <= 2, 'and it is not retried in a loop', `${patchCount} PATCH in ${waited}s`);

  await page.screenshot({ path: '/tmp/hung-save.png' });
} finally {
  await browser.close();
  await fetch(`${SUPABASE}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
}

console.log(failures === 0 ? '\nPASS  a hung save is reported\n' : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
