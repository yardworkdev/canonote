#!/usr/bin/env node
/**
 * The band stays on the agent's words when the note is long enough to scroll.
 *
 *   node scripts/check-band-scroll.mjs
 *
 * The band is painted in a backdrop div that mirrors the textarea. On a short
 * note the two boxes are identical and nothing can drift, which is why every
 * earlier proof of the band passed. Measured on a long note, both halves of the
 * mirror were wrong:
 *
 *   1. the textarea is an inline element, so the wrapper was 6px taller than it
 *      (730 vs 724). The mirror's content box was 6px shorter, so at maximum
 *      scroll it could only reach 186 while the text sat at 192 — the band was
 *      permanently 6px low, and no scroll event could fix it;
 *   2. the mirror followed the textarea only on `scroll`. Opening a long note
 *      scrolls to the caret with no scroll event reaching the backdrop, which
 *      mounts later — measured scrollTop 192 vs 0, and the whole mark was drawn
 *      below the fold while the paragraph was on screen.
 *
 * A third fault ran underneath both: the mirror was a scroll container of its own,
 * so it clamped at its own content height and answered every scroll event one frame
 * late — the band visibly bounced behind the words. It is translated now, which has
 * nothing to clamp.
 *
 * This check drives all three on a note long enough to scroll: the mirror wraps where
 * the editor wraps, its offset equals the editor's scroll at load, after a wheel and at
 * maximum scroll, the band keeps the same distance from its words throughout, and it
 * is inside the editor's visible area — i.e. over the words, not off-screen.
 */
import { chromium } from 'playwright';
import { readSecret } from './lib/secrets.mjs';
import { browserExecutable } from './lib/browser.mjs';

const BASE = process.env.CANONOTE_BASE || 'https://canonote.vercel.app';
const SUPABASE = 'https://vcplldetvuezauzwyrkh.supabase.co';
const SERVICE = readSecret('supabase-service-key', 'SUPABASE_SERVICE_KEY');

let failures = 0;
const line = (ok, label, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(58)} ${detail}`);
};

const stamp = Date.now();
const email = `promi-band-scroll-${stamp}@example.com`;
const password = `bandscroll-${stamp}-aaaa`;

const api = async (url, { method = 'GET', body, headers = {} } = {}) => {
  const response = await fetch(url, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
};

const created = await api(`${SUPABASE}/auth/v1/admin/users`, {
  method: 'POST',
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  body: { email, password, email_confirm: true },
});
line(created.status === 200 || created.status === 201, 'a throwaway person exists', String(created.status));

const session = await api(`${SUPABASE}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  body: { email, password },
});
const jwt = session.json?.access_token;
line(Boolean(jwt), 'and can sign in');

const issued = await api(`${BASE}/api/agent/connections`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${jwt}` },
  body: {
    agentLabel: 'Promi',
    scopes: ['notes:read', 'notes:write'],
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  },
});
const agentToken = issued.json?.data?.token;
line(Boolean(agentToken), 'a one-hour agent token is issued');

const TITLE = `Band scroll ${stamp}`;
const lines = Array.from({ length: 28 }, (_, i) => `Line ${i + 1} of the person's note, written before the agent arrived.`);
const made = await api(`${BASE}/api/notes`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${jwt}` },
  body: { noteId: `note-${stamp}-band-scroll`, title: TITLE, content: `${lines.join('\n')}\n` },
});
const note = made.json?.data;
line(Boolean(note?.id), 'the person has a long note on the server', String(made.status));

const paragraph =
  'The agent wrote this paragraph at the end of a long note, through the agent API, so the ' +
  'editor has to scroll before the words it wrote are on screen at all.';
const appended = `${note.content}${paragraph}\n`;
const written = await api(`${BASE}/api/agent/notes/${note.id}`, {
  method: 'PATCH',
  headers: { Authorization: `Bearer ${agentToken}` },
  body: { content: appended, ifRevision: note.revision },
});
line(written.status === 200, 'the agent appends a paragraph below the fold', String(written.status));

const browser = await chromium.launch({
  executablePath: browserExecutable(),
  args: ['--no-sandbox'],
});

const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
await context.addInitScript(`localStorage.setItem('app-theme', 'midnight')`);
const page = await context.newPage();
await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });
const emailInput = page.locator('input[type="email"]').first();
await emailInput.waitFor({ timeout: 25000 });
await emailInput.fill(email);
await page.locator('input[type="password"]').first().fill(password);
await page.getByRole('button', { name: /sign in/i }).first().click();
await page.locator('textarea[aria-label="Note editor"]').first().waitFor({ timeout: 30000 });
const row = page.getByText(TITLE, { exact: false }).first();
await row.waitFor({ timeout: 25000 });
await row.click();
await page.locator('[data-agent-highlights] [data-agent-span]').first().waitFor({ timeout: 20000 });
await page.waitForTimeout(600); // let the caret scroll and the next frame sync settle

const read = () => page.evaluate(() => {
  const ta = document.querySelector('textarea[aria-label="Note editor"]');
  const bd = document.querySelector('[data-agent-highlights]');
  const band = document.querySelector('[data-agent-highlights] [data-agent-span]');
  const taRect = ta.getBoundingClientRect();
  const rects = Array.from(band.getClientRects())
    .filter((r) => r.width > 0 && r.height > 0)
    .map((r) => ({ top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) }));
  return {
    ta: {
      clientWidth: ta.clientWidth, clientHeight: ta.clientHeight, scrollWidth: ta.scrollWidth,
      scrollHeight: ta.scrollHeight, scrollTop: ta.scrollTop, maxScroll: ta.scrollHeight - ta.clientHeight,
      top: Math.round(taRect.top), bottom: Math.round(taRect.bottom),
    },
    bd: {
      clientWidth: bd.clientWidth,
      // The mirror is not a scroll container any more: it is translated. Two
      // scroll boxes clamp at different heights and every event lands a frame
      // late, which is what made the band bounce behind the words.
      offset: (() => {
        const m = /matrix\(1, 0, 0, 1, (-?[\d.]+), (-?[\d.]+)\)/.exec(getComputedStyle(bd).transform);
        return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: 0, y: 0 };
      })(),
    },
    rects,
  };
});

const inside = (rect, ta) => rect.top >= ta.top - 1 && rect.bottom <= ta.bottom + 1;

// The band is a fixed distance from the words it marks. That distance is the
// whole proof: if it changes while the note scrolls, the band bounces or drifts.
// In content coordinates: where the band sits relative to the editor's own top,
// independent of how far the text has been scrolled.
const offsets = (state) =>
  state.rects.map((r) => ({ top: r.top - state.ta.top + state.ta.scrollTop, left: r.left }));

// --- the boxes themselves -------------------------------------------------
const atLoad = await read();
line(
  atLoad.bd.clientWidth === atLoad.ta.clientWidth,
  'the mirror wraps where the editor wraps',
  `mirror ${atLoad.bd.clientWidth} vs editor ${atLoad.ta.clientWidth}`,
);
line(atLoad.ta.maxScroll > 0, 'the note is long enough to scroll', `max scroll ${atLoad.ta.maxScroll}px`);

// --- opening the note -----------------------------------------------------
line(
  atLoad.bd.offset.y === -atLoad.ta.scrollTop,
  'opening a long note leaves the mirror on the same line',
  `mirror ${atLoad.bd.offset.y} vs editor -${atLoad.ta.scrollTop}`,
);
const visibleAtLoad = atLoad.rects.filter((r) => inside(r, atLoad.ta));
line(
  atLoad.rects.length > 0 && visibleAtLoad.length === atLoad.rects.length,
  'the band is on screen, not drawn below the fold',
  `${visibleAtLoad.length}/${atLoad.rects.length} fragments inside the editor`,
);

// --- a person scrolls with the wheel --------------------------------------
const box = await page.locator('textarea[aria-label="Note editor"]').first().boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.wheel(0, -300);
await page.waitForTimeout(400);
const afterWheel = await read();
line(
  afterWheel.bd.offset.y === -afterWheel.ta.scrollTop,
  'a wheel scroll moves the mirror by the same amount',
  `mirror ${afterWheel.bd.offset.y} vs editor -${afterWheel.ta.scrollTop}`,
);
line(
  JSON.stringify(offsets(afterWheel)) === JSON.stringify(offsets(atLoad)),
  'the band keeps the same distance from the words while scrolling',
  `${JSON.stringify(offsets(atLoad))} → ${JSON.stringify(offsets(afterWheel))}`,
);

// --- all the way to the end, where the 6px box gap used to show -----------
await page.evaluate(() => {
  const ta = document.querySelector('textarea[aria-label="Note editor"]');
  ta.scrollTop = ta.scrollHeight;
});
await page.waitForTimeout(400);
const atBottom = await read();
line(
  atBottom.bd.offset.y === -atBottom.ta.scrollTop,
  'at the very end the mirror reaches the same line',
  `mirror ${atBottom.bd.offset.y} vs editor -${atBottom.ta.scrollTop}`,
);
line(
  JSON.stringify(offsets(atBottom)) === JSON.stringify(offsets(atLoad)),
  'the band does not drift when the note runs out of scroll',
  `${JSON.stringify(offsets(atBottom))} vs ${JSON.stringify(offsets(atLoad))}`,
);
const visibleAtBottom = atBottom.rects.filter((r) => inside(r, atBottom.ta));
line(
  atBottom.rects.length > 0 && visibleAtBottom.length === atBottom.rects.length,
  'the band sits over the words at the end of the note',
  `${visibleAtBottom.length}/${atBottom.rects.length} fragments inside the editor`,
);

await browser.close();
console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} check(s) failed against ${BASE}`);
process.exit(failures === 0 ? 0 : 1);
