#!/usr/bin/env node
/**
 * Presence is one store, not one process's memory.
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_KEY=… node scripts/check-presence-shared.mjs
 *
 * Starts two API processes — the way Vercel runs two warm instances of a function
 * — and announces a caret to the first. A person's caret written to process A must
 * be readable from process B, through both the agent route and the notes route.
 *
 * Before this gate existed, process B answered "nobody here" for a caret process A
 * had just accepted, and the notes route answered that even inside process A. The
 * failure was silent: presence is a courtesy, so nothing errored and no note was
 * ever wrong — the caret simply was not there.
 */
import { spawn } from 'node:child_process';
import { readSecret } from './lib/secrets.mjs';

const SUPABASE = process.env.SUPABASE_URL || 'https://vcplldetvuezauzwyrkh.supabase.co';
const SERVICE = readSecret('supabase-service-key', 'SUPABASE_SERVICE_KEY');
const PUBLIC = process.env.SUPABASE_ANON_KEY || 'sb_publishable_qB1erd1_XW71j1dJmGi4Lw_-KfNyjQd';

const PORT_A = Number(process.env.PRESENCE_PORT_A || 8131);
const PORT_B = Number(process.env.PRESENCE_PORT_B || 8132);
const A = `http://127.0.0.1:${PORT_A}`;
const B = `http://127.0.0.1:${PORT_B}`;

if (!SERVICE) {
  console.error('FAIL  no service key: set SUPABASE_SERVICE_KEY, SUPABASE_SERVICE_KEY_FILE, or .secrets/supabase-service-key');
  process.exit(2);
}

let failures = 0;
const line = (ok, label, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(62)} ${detail}`);
};

const stamp = Date.now();
const email = `promi-shared-${stamp}@example.com`;
const password = `shared-${stamp}-aaaa`;
const bearer = (token) => ({ Authorization: `Bearer ${token}` });

async function api(url, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(url, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: response.status, json };
}

const children = [];
function start(port) {
  const child = spawn(process.execPath, ['scripts/presence-server.mjs', String(port)], {
    env: { ...process.env, SUPABASE_URL: SUPABASE, SUPABASE_SERVICE_KEY: SERVICE },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => process.stdout.write(`  [${port}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stdout.write(`  [${port}] ${chunk}`));
  children.push(child);
  return child;
}

async function waitFor(base, budgetMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < budgetMs) {
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

try {
  start(PORT_A);
  start(PORT_B);
  line(await waitFor(A), 'process A answers');
  line(await waitFor(B), 'process B answers');

  const created = await api(`${SUPABASE}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE, ...bearer(SERVICE) },
    body: { email, password, email_confirm: true },
  });
  line(created.status === 200, 'a throwaway person exists', String(created.status));

  const session = await api(`${SUPABASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: PUBLIC, ...bearer(PUBLIC) },
    body: { email, password },
  });
  const jwt = session.json?.access_token;
  line(Boolean(jwt), 'and can sign in', String(session.status));

  const made = await api(`${A}/api/notes`, {
    method: 'POST',
    headers: bearer(jwt),
    body: { noteId: `note-${stamp}-shared`, title: `Shared ${stamp}`, content: 'where is everyone\n' },
  });
  const noteId = made.json?.data?.id;
  line(Boolean(noteId), 'the note is on process A', String(made.status));

  const issued = await api(`${A}/api/agent/connections`, {
    method: 'POST',
    headers: bearer(jwt),
    body: { agentLabel: 'Promi', scopes: ['notes:read', 'notes:write'] },
  });
  const agentToken = issued.json?.data?.token;
  line(Boolean(agentToken), 'an agent token is issued', String(issued.status));

  // The person's caret, announced to process A exactly as the page announces it.
  const announced = await api(`${A}/api/agent/notes/${noteId}/presence`, {
    method: 'POST',
    headers: bearer(jwt),
    body: { from: 42, to: 42 },
  });
  line(announced.status === 200, 'the person\u2019s caret is accepted by process A', String(announced.status));

  const personOn = async (base, path, token) => {
    const answer = await api(`${base}${path}`, { headers: bearer(token) });
    const entries = answer.json?.data?.entries || [];
    return { status: answer.status, entries, person: entries.find((entry) => entry.kind === 'person') };
  };

  const sameProcess = await personOn(A, `/api/agent/notes/${noteId}/presence`, agentToken);
  line(sameProcess.person?.from === 42, 'process A reads the caret it accepted', `from=${sameProcess.person?.from ?? 'none'}`);

  const otherProcess = await personOn(B, `/api/agent/notes/${noteId}/presence`, agentToken);
  line(
    otherProcess.person?.from === 42,
    'process B reads the caret process A accepted',
    `from=${otherProcess.person?.from ?? 'none'} status=${otherProcess.status}`
  );

  // The other direction, which is the one a person actually sees: a caret an
  // agent announced to process A, read by the person's own route on process B.
  // (The notes route is person-only — it refuses anything but a user session —
  // and it never shows a person their own caret, so the person's caret from
  // above must not appear here. The agent route is where an agent reads it.)
  const agentAnnounced = await api(`${A}/api/agent/notes/${noteId}/presence`, {
    method: 'POST',
    headers: bearer(agentToken),
    body: { mode: 'writing', from: 77, to: 77 },
  });
  line(agentAnnounced.status === 200, 'an agent announces a caret to process A', String(agentAnnounced.status));

  const otherFunction = await personOn(B, `/api/notes/${noteId}/presence`, jwt);
  const agentThere = otherFunction.entries.find((entry) => entry.kind === 'agent');
  line(
    agentThere?.from === 77,
    'the notes route reads the caret the agent announced to A',
    `from=${agentThere?.from ?? 'none'} status=${otherFunction.status}`
  );
  line(
    !otherFunction.entries.some((entry) => entry.kind === 'person'),
    'and it does not hand the person their own caret',
    `${otherFunction.entries.length} entr${otherFunction.entries.length === 1 ? 'y' : 'ies'}`
  );

  console.log(failures === 0 ? '\nPASS — presence is shared by every process' : `\nFAILED — ${failures} check(s)`);
} finally {
  for (const child of children) child.kill('SIGTERM');
}

process.exit(failures === 0 ? 0 : 1);
