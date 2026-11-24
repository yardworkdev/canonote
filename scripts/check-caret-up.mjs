#!/usr/bin/env node
/**
 * An agent can see where the person is typing.
 *
 *   node scripts/check-caret-up.mjs [base]
 *
 * The browser's BroadcastChannel never leaves the machine, so until now an agent
 * knew a person was *in* a note and nothing about where. The page now writes the
 * caret to the same function that answers the presence poll, and an agent reads
 * it back from there.
 *
 * Asserts, on the deployed app, with a throwaway person and a real issued token:
 *   1. the page publishes the person's caret with no help from this script;
 *   2. an agent reading presence sees it, at the offset the editor reports;
 *   3. it follows the caret when the person moves it;
 *   4. the person's own poll never lists them as someone else;
 *   5. a caret stops being published when its note is closed (TTL, no goodbye).
 */
import { chromium } from 'playwright';
import { readSecret, shotsDir } from './lib/secrets.mjs';
import { browserExecutable } from './lib/browser.mjs';

const BASE = process.argv[2] || process.env.CANONOTE_BASE || 'https://canonote.vercel.app';
const SUPABASE = 'https://vcplldetvuezauzwyrkh.supabase.co';
const PUBLIC = 'sb_publishable_qB1erd1_XW71j1dJmGi4Lw_-KfNyjQd';
const SERVICE = readSecret('supabase-service-key', 'SUPABASE_SERVICE_KEY');
const SHOTS = shotsDir();

let failures = 0;
const line = (ok, label, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(58)} ${detail}`);
};

const stamp = Date.now();
const email = `promi-caret-${stamp}@example.com`;
const password = `caret-${stamp}-aaaa`;
const bearer = (token) => ({ Authorization: `Bearer ${token}` });

async function api(url, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(url, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

await api(`${SUPABASE}/auth/v1/admin/users`, {
  method: 'POST',
  headers: { apikey: SERVICE, ...bearer(SERVICE) },
  body: { email, password, email_confirm: true },
});
const session = await api(`${SUPABASE}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: PUBLIC, ...bearer(PUBLIC) },
  body: { email, password },
});
const jwt = session.json?.access_token;
line(Boolean(jwt), 'a throwaway person exists and can sign in');

const issued = await api(`${BASE}/api/agent/connections`, {
  method: 'POST',
  headers: bearer(jwt),
  body: { agentLabel: 'Promi', scopes: ['notes:read', 'notes:write'] },
});
const agentToken = issued.json?.data?.token;
line(Boolean(agentToken), 'a real agent token is issued');

const body = Array.from({ length: 30 }, (_, i) => `line ${i + 1} of the note`).join('\n');
const TITLE = `Caret ${stamp}`;
const made = await api(`${BASE}/api/notes`, {
  method: 'POST',
  headers: bearer(jwt),
  body: { noteId: `note-${stamp}-caret`, title: TITLE, content: `${body}\n` },
});
const note = made.json?.data;
line(Boolean(note?.id), 'the person has a note on the server', String(made.status));

/** What an agent sees in the note right now. */
const readAsAgent = async () => {
  const answer = await api(`${BASE}/api/agent/notes/${note.id}/presence`, {
    headers: bearer(agentToken),
  });
  const entries = answer.json?.data?.entries || [];
  return { status: answer.status, entries, person: entries.find((entry) => entry.kind === 'person') };
};

/** Wait for the agent's view to name `offset`, returning how long it took. */
const waitForAgent = async (offset, budgetMs = 8000) => {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < budgetMs) {
    const seen = await readAsAgent();
    last = seen;
    if (seen.person && seen.person.from === offset) {
      return { ok: true, ms: Date.now() - started, seen };
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return { ok: false, ms: Date.now() - started, seen: last };
};

const browser = await chromium.launch({
  executablePath: browserExecutable(),
  args: ['--no-sandbox'],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

try {
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log('     page error:', error.message));
  await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.getByRole('button', { name: /sign in/i }).first().click();
  const editor = page.locator('textarea[aria-label="Note editor"]').first();
  await editor.waitFor({ timeout: 30000 });
  await page.getByText(TITLE, { exact: false }).first().click();
  await page.waitForTimeout(2500);

  // The caret is placed the way a person places it: focus, a selection, and the
  // event the editor listens to. Nothing here calls the presence API.
  const putCaret = async (offset) => {
    await editor.evaluate((node, at) => {
      node.focus();
      node.setSelectionRange(at, at);
      node.dispatchEvent(new Event('select', { bubbles: true }));
    }, offset);
    return editor.evaluate((node) => node.selectionStart);
  };

  const firstAt = body.indexOf('line 7 of') + 3;
  const placed = await putCaret(firstAt);
  line(placed === firstAt, 'the person puts the caret 3 characters into line 7', `offset ${placed}`);

  const first = await waitForAgent(firstAt);
  line(Boolean(first.seen?.person), 'an agent reading presence sees the person at all', `kind=${first.seen?.person?.kind || 'none'}`);
  line(first.ok, 'and at the offset the editor reports', `${first.seen?.person?.from} vs ${firstAt} in ${first.ms}ms`);
  line(first.ms < 4000, 'the caret crosses to the agent within four seconds', `${first.ms}ms`);
  line(
    first.seen?.person?.name === email.slice(0, 24),
    'under the person it belongs to',
    first.seen?.person?.name || 'none'
  );

  // It follows a move: this is a caret, not a one-off "I was here".
  const secondAt = body.indexOf('line 2 of') + 5;
  await putCaret(secondAt);
  const second = await waitForAgent(secondAt);
  line(second.ok, 'the caret follows the person when it moves', `${second.seen?.person?.from} vs ${secondAt} in ${second.ms}ms`);

  // Their own poll must not hand them back to themselves as a stranger.
  const own = await api(`${BASE}/api/agent/notes/${note.id}/presence`, { headers: bearer(jwt) });
  const ownPerson = (own.json?.data?.entries || []).filter((entry) => entry.kind === 'person');
  line(ownPerson.length === 0, 'the person’s own poll does not list them as someone else', `${ownPerson.length} entry`);
  const drawn = await page.evaluate(() => document.querySelectorAll('[data-remote-author]').length);
  line(drawn === 0, 'and no second caret is drawn on their screen', `${drawn} remote caret(s)`);

  await page.screenshot({ path: `${SHOTS}/caret-up.png` });

  // Closing the tab stops the heartbeat; the entry expires without a goodbye.
  await page.close();
  const gone = await (async () => {
    const started = Date.now();
    while (Date.now() - started < 20000) {
      const seen = await readAsAgent();
      if (!seen.person) return Date.now() - started;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return null;
  })();
  line(gone !== null, 'a closed tab stops publishing and the caret expires', gone === null ? 'still there after 20s' : `${gone}ms`);
} finally {
  await browser.close();
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} check(s) failed against ${BASE}`);
process.exit(failures === 0 ? 0 : 1);
