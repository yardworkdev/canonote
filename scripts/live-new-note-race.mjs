#!/usr/bin/env node
/**
 * Pressing "+" while a save is still in flight must not bring the old text back.
 *
 * The window: the pane is cleared, the create request is out, and the pane still
 * carries the previous note's id — so the save of that note answers "saved" and a
 * late load repaints its text. Typing then writes into the previous note, and the
 * screen wipes to blank when the new note finally arrives. Silent, and it eats
 * text.
 *
 * This presses + 800 ms after a keystroke (inside the save's debounce) and watches
 * the pane for three seconds instead of sampling once.
 */
import { chromium } from 'playwright';
import { readSecret } from './lib/secrets.mjs';
import { browserExecutable } from './lib/browser.mjs';

const BASE = 'https://canonote.vercel.app';
const SUPABASE = 'https://vcplldetvuezauzwyrkh.supabase.co';
const SERVICE = readSecret('supabase-service-key', 'SUPABASE_SERVICE_KEY');
const CHROME = browserExecutable();

const stamp = Date.now();
const email = `promi-race-${stamp}@example.com`;
const password = `race-${stamp}-aaaa`;
const first = 'Alpha text that must not leak';

let failures = 0;
const line = (ok, label, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(56)} ${detail}`);
};

const created = await fetch(`${SUPABASE}/auth/v1/admin/users`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  body: JSON.stringify({ email, password, email_confirm: true }),
});
const userId = (await created.json()).id;

const rows = async () => {
  const res = await fetch(
    `${SUPABASE}/rest/v1/notes?user_id=eq.${userId}&deleted_at=is.null&select=note_id,content`,
    { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } }
  );
  return res.json();
};

const browser = await chromium.launch({ executablePath: CHROME });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('request', (req) => {
    const u = req.url();
    if (!u.includes('/api/notes')) return;
    console.log('REQ', req.method(), u.replace(/^https:\/\/canonote\.vercel\.app\/api\/notes/, ''), (req.postData() || '').slice(0, 90));
  });
  page.on('response', (res) => {
    const u = res.url();
    if (!u.includes('/api/notes') || res.request().method() === 'GET') return;
    console.log('RES', res.status(), u.replace(/^https:\/\/canonote\.vercel\.app\/api\/notes/, ''));
  });
  await page.goto(`${BASE}/app`, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForTimeout(3500);

  const editor = page.locator('main textarea').first();
  await editor.click();
  await page.keyboard.type(first);
  // 800 ms: the local write has fired, the server save is still queued.
  await page.waitForTimeout(800);

  await page.getByRole('button', { name: 'Create new note' }).first().click();

  const samples = [];
  // Sampled from the click: the pane must go blank immediately, not after the
  // flush. It used to repaint the old text for half a second when a read that was
  // already in flight for the note being left answered late.
  for (let i = 0; i < 15; i += 1) {
    await page.waitForTimeout(200);
    samples.push(await editor.inputValue().catch(() => '<gone>'));
  }
  const nonEmpty = samples.filter((value) => value !== '');
  line(
    nonEmpty.length === 0,
    'the pane stays empty for three seconds after +',
    nonEmpty.length ? `came back: ${JSON.stringify(nonEmpty.slice(0, 3))}` : `${samples.length} samples empty`
  );

  // Type once the pane is ready for text — while the note is being made it is
  // read-only and says "Creating note…", so anything typed then is deliberately
  // refused rather than accepted and lost.
  for (let i = 0; i < 25; i += 1) {
    const writable = await page.evaluate(() => !document.querySelector('main textarea')?.readOnly);
    if (writable) break;
    await page.waitForTimeout(200);
  }
  await editor.click();
  await page.keyboard.type('TYPED AFTER THE SWITCH');
  // Poll instead of guessing a delay: the save is debounced, and a fixed wait
  // made this check fail on a slow deploy while the text was still on its way.
  let stored = [];
  for (let i = 0; i < 20; i += 1) {
    await page.waitForTimeout(500);
    stored = await rows();
    if ((stored || []).some((row) => (row.content || '').includes('TYPED AFTER THE SWITCH'))) break;
  }
  const bodies = (stored || []).map((row) => row.content || '');
  const leakedIntoOld = bodies.some((body) => body.includes(first) && body.includes('TYPED AFTER'));
  line(!leakedIntoOld, 'the typed text did not land in the previous note', `${bodies.length} row(s)`);
  line(
    bodies.some((body) => body.includes('TYPED AFTER THE SWITCH') && !body.includes(first)),
    'and it landed in the note the pane is showing',
    JSON.stringify(bodies.map((body) => body.slice(0, 20)))
  );

  await page.screenshot({ path: '/tmp/new-note-race.png' });
} finally {
  await browser.close();
  await fetch(`${SUPABASE}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
}

console.log(failures === 0 ? '\nPASS  a new note cannot inherit the old one\n' : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
