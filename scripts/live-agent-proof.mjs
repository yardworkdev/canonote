#!/usr/bin/env node
/**
 * A real agent, against the real deployment, with a real account.
 *
 * This is the seam no test could reach before: the browser and the agent are two
 * clients of one deployed notebook. It creates a throwaway account, mints a
 * delegated token the way the panel does, then has the agent enter cheaply, read,
 * write under its own name, leave a caret — and finally checks that the human
 * side sees all three. Everything it created is deleted before it exits.
 *
 *   node scripts/live-agent-proof.mjs
 */
import { readSecret } from './lib/secrets.mjs';

const BASE = (process.env.LIVE_URL || 'https://canonote.vercel.app').replace(/\/$/, '');
const SUPABASE = process.env.SUPABASE_URL || 'https://vcplldetvuezauzwyrkh.supabase.co';
const SERVICE = readSecret('supabase-service-key', 'SUPABASE_SERVICE_KEY');
const PUBLIC = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_qB1erd1_XW71j1dJmGi4Lw_-KfNyjQd';

let failures = 0;
function line(ok, label, detail = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(42)} ${detail}`);
}

const stamp = Date.now();
const email = `promi-proof-${stamp}@example.com`;
const password = `proof-${stamp}-${Math.random().toString(36).slice(2)}`;

async function call(url, { method = 'GET', body, token, headers = {} } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* keep raw */
  }
  return { status: response.status, json, text, bytes: Buffer.byteLength(text) };
}

const created = { noteId: null, connectionId: null, userId: null };

try {
  console.log(`\nlive agent proof  ${BASE}\n`);

  const admin = await call(`${SUPABASE}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE },
    body: { email, password, email_confirm: true },
  });
  const userId = admin.json?.id || admin.json?.user?.id;
  created.userId = userId || null;
  line(Boolean(userId), 'a throwaway account exists', `${admin.status}`);

  const session = await call(`${SUPABASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: PUBLIC },
    body: { email, password },
  });
  const jwt = session.json?.access_token;
  line(Boolean(jwt), 'the account signs in', `${session.status}`);

  const note = await call(`${BASE}/api/notes`, {
    method: 'POST',
    token: jwt,
    body: { title: 'Agent proof', content: '# Agent proof\n\nwritten by a person.\n' },
  });
  const noteId = note.json?.data?.id || note.json?.data?.noteId;
  created.noteId = noteId || null;
  line(Boolean(noteId), 'the person creates a note', `${note.status} ${note.bytes} B`);

  const connection = await call(`${BASE}/api/agent/connections`, {
    method: 'POST',
    token: jwt,
    body: { agentLabel: 'Promi', scopes: ['notes:read', 'notes:write'], expiresAt: null },
  });
  const agentToken = connection.json?.data?.token;
  created.connectionId = connection.json?.data?.connection?.id || connection.json?.data?.id || null;
  line(Boolean(agentToken), 'the person issues a delegated token', `${connection.status}`);

  const manifest = await call(`${BASE}/api/agent`, { token: agentToken });
  line(manifest.status === 200, 'the agent enters', `${manifest.status} ${manifest.bytes} B`);

  const list = await call(`${BASE}/api/agent/notes`, { token: agentToken });
  const notes = list.json?.data?.notes || list.json?.data || [];
  line(Array.isArray(notes) && notes.length > 0, 'the agent reads the list', `${list.status} ${list.bytes} B`);

  const one = await call(`${BASE}/api/agent/notes/${noteId}`, { token: agentToken });
  const revision = one.json?.data?.revision || one.json?.data?.rev || null;
  line(one.status === 200, 'the agent reads the note', `${one.status} ${one.bytes} B`);

  const write = await call(`${BASE}/api/agent/notes/${noteId}`, {
    method: 'PATCH',
    token: agentToken,
    body: { content: '# Agent proof\n\nwritten by a person.\n\nand appended by an agent.\n', ifRevision: revision },
  });
  line(write.status === 200, 'the agent writes under its own name', `${write.status} ${write.bytes} B`);

  const presence = await call(`${BASE}/api/agent/notes/${noteId}/presence`, {
    method: 'POST',
    token: agentToken,
    body: { mode: 'reading' },
  });
  line(presence.status === 200 || presence.status === 204, 'the agent leaves a caret', `${presence.status} ${presence.bytes} B`);

  // Presence lives in each lambda's memory, so a read can land on an instance
  // that never saw the heartbeat. Retry rather than pretend it is instant.
  let entries = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const seen = await call(`${BASE}/api/agent/notes/${noteId}/presence`, { token: jwt });
    entries = seen.json?.data?.entries || [];
    if (entries.length > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  const agentVisible = entries.some((entry) => JSON.stringify(entry).toLowerCase().includes('promi'));
  line(agentVisible, 'the person sees the agent caret', `${entries.length} entr(y/ies)`);

  // The per-note switch: off means the agent cannot tell the note from a missing one.
  // A PATCH needs the current revision (428 without one), so read it first.
  const before = await call(`${BASE}/api/agent/notes/${noteId}`, { token: agentToken });
  const currentRevision = before.json?.data?.revision ?? null;

  const off = await call(`${BASE}/api/notes/${noteId}`, {
    method: 'PATCH',
    token: jwt,
    body: { agentAccess: false, ifRevision: currentRevision },
  });
  line(off.status === 200, 'the person switches the note off', `${off.status}`);

  const hidden = await call(`${BASE}/api/agent/notes/${noteId}`, { token: agentToken });
  line(hidden.status === 404, 'the agent gets 404, not 403', `${hidden.status}`);

  const listed = await call(`${BASE}/api/agent/notes`, { token: agentToken });
  const listedIds = (listed.json?.data || []).map((note) => note.id);
  line(!listedIds.includes(noteId), 'the note is gone from the agent list', `${listedIds.length} note(s)`);

  const current = await call(`${BASE}/api/notes/${noteId}`, { token: jwt });
  const on = await call(`${BASE}/api/notes/${noteId}`, {
    method: 'PATCH',
    token: jwt,
    body: { agentAccess: true, ifRevision: current.json?.data?.revision ?? null },
  });
  const back = await call(`${BASE}/api/agent/notes/${noteId}`, { token: agentToken });
  line(on.status === 200 && back.status === 200, 'switching it back on restores access', `${back.status}`);

  const audit = await call(`${BASE}/api/agent/audit`, { token: jwt });
  const events = audit.json?.data?.events || audit.json?.data || [];
  line(Array.isArray(events) && events.length > 0, 'the audit trail carries the write', `${audit.status} ${events.length} event(s)`);

  const history = await call(`${BASE}/api/notes/${noteId}/history`, { token: jwt });
  const historyBody = history.json?.data || {};
  const versions = historyBody.items || historyBody.versions || [];
  line(Array.isArray(versions) && versions.length >= 1, 'history carries the agent edit', `${history.status} ${versions.length} version(s)`);

  const revert = await call(`${BASE}/api/notes/${noteId}/revert`, {
    method: 'POST',
    token: jwt,
    body: { revision: versions[0]?.revision || versions[0]?.version || 1 },
  });
  line(
    revert.status === 200,
    'the person restores a version',
    `${revert.status} ${revert.bytes} B${revert.status === 200 ? '' : ` ${revert.text.slice(0, 120)}`}`
  );
} catch (error) {
  line(false, 'the proof ran', error.message);
} finally {
  // Leave nothing behind: the note, the token and the account all go.
  try {
    if (created.noteId) {
      const session = await call(`${SUPABASE}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: PUBLIC },
        body: { email, password },
      });
      const jwt = session.json?.access_token;
      if (jwt) await call(`${BASE}/api/notes/${created.noteId}`, { method: 'DELETE', token: jwt });
    }
  } catch {
    /* cleanup is best effort */
  }
  try {
    if (created.userId) {
      await call(`${SUPABASE}/auth/v1/admin/users/${created.userId}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE },
      });
      console.log('cleaned up the throwaway account');
    }
  } catch {
    /* cleanup is best effort */
  }
}

console.log(failures === 0 ? '\nPASS  an agent and a person shared this notebook, in production\n' : `\n${failures} step(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
