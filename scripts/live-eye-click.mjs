#!/usr/bin/env node
/**
 * The per-note agent switch, clicked the way a person clicks it: with a mouse.
 *
 * This was broken for months of use and invisible in every keyboard test: the
 * eye sits inside a Tooltip, and the overlay that floats over the sidebar row
 * only re-enabled pointer events for *direct* button children, so the eye's
 * clicks went to the row underneath. A keyboard test passed because focus()
 * does not care about pointer-events.
 */
import { chromium } from 'playwright';
import { readSecret } from './lib/secrets.mjs';
import { browserExecutable } from './lib/browser.mjs';

const BASE = 'https://canonote.vercel.app';
const SUPABASE = 'https://vcplldetvuezauzwyrkh.supabase.co';
const SERVICE = readSecret('supabase-service-key', 'SUPABASE_SERVICE_KEY');
const PUBLIC = 'sb_publishable_qB1erd1_XW71j1dJmGi4Lw_-KfNyjQd';
const CHROME = browserExecutable();

const stamp = Date.now();
const email = `promi-eye-${stamp}@example.com`;
const password = `eye-${stamp}-aaaa`;

let failures = 0;
const line = (ok, label, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(52)} ${detail}`);
};

const form = (body) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  body: JSON.stringify(body),
});

const created = await fetch(`${SUPABASE}/auth/v1/admin/users`, form({ email, password, email_confirm: true }));
const userId = (await created.json()).id;

const browser = await chromium.launch({ executablePath: CHROME });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${BASE}/app`, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForTimeout(3500);

  // A new user's first note is written into the placeholder, which nothing
  // creates yet (REVIEW.md step 4), so this proof makes the note explicitly.
  await page.getByRole('button', { name: 'Create new note' }).first().click();
  await page.waitForTimeout(1200);
  await page.locator('main textarea').first().click();
  await page.keyboard.type('A note with a switch.');
  await page.waitForTimeout(3000);

  const nav = page.getByRole('navigation', { name: 'Notes' });
  const row = nav.locator('button', { hasText: 'A note with a switch' }).first();
  await row.hover();
  const eye = nav.locator('button[aria-label^="Block agents"]').first();
  await eye.waitFor({ state: 'attached' });

  const before = await eye.getAttribute('aria-label');
  // Click where the switch actually is: a locator click resolves the element, but
  // this bug was never about resolution — it was about the point under the mouse.
  const box = await eye.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(2000);
  const after = await nav.locator('button[aria-label^="Allow agents"]').count();

  line(Boolean(before) && before.startsWith('Block agents'), 'the switch starts open', before || '');
  line(after > 0, 'a mouse click closes it', after > 0 ? 'label flipped' : 'nothing changed');

  await page.screenshot({ path: '/tmp/eye-click.png' });
} finally {
  await browser.close();
  await fetch(`${SUPABASE}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
}

console.log(failures === 0 ? '\nPASS  the eye answers a mouse\n' : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
