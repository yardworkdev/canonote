#!/usr/bin/env node
/**
 * The span bookkeeping, straight against production: an agent creates a note,
 * appends a paragraph, and a person then edits. Only the agent's characters
 * should ever be marked.
 */
import { readSecret } from './lib/secrets.mjs';

const BASE = 'https://canonote.vercel.app';
const SUPABASE = 'https://vcplldetvuezauzwyrkh.supabase.co';
const SERVICE = readSecret('supabase-service-key', 'SUPABASE_SERVICE_KEY');
const PUBLIC = 'sb_publishable_qB1erd1_XW71j1dJmGi4Lw_-KfNyjQd';
const stamp = Date.now();
const email = `promi-spans-${stamp}@example.com`;
const password = `spans-${stamp}-aaaa`;

const api = async (url, { method = 'GET', body, headers = {} } = {}) => {
  const response = await fetch(url, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
};

const user = await api(`${SUPABASE}/auth/v1/admin/users`, {
  method: 'POST',
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  body: { email, password, email_confirm: true },
});
const userId = user.json?.id;
const session = await api(`${SUPABASE}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: PUBLIC, Authorization: `Bearer ${PUBLIC}` },
  body: { email, password },
});
const jwt = session.json?.access_token;
const issued = await api(`${BASE}/api/agent/connections`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${jwt}` },
  body: {
    agentLabel: 'Promi',
    scopes: ['notes:read', 'notes:write'],
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  },
});
const token = issued.json?.data?.token;
const A = { Authorization: `Bearer ${token}` };
const U = { Authorization: `Bearer ${jwt}` };

try {
  const created = await api(`${BASE}/api/agent/notes`, {
    method: 'POST',
    headers: A,
    body: { title: 'Spans', content: 'The agent wrote this line.' },
  });
  const note = created.json?.data;
  console.log('agent create →', created.status, 'spans', JSON.stringify(note?.agentSpans ?? note?.agent_spans));

  const got1 = await api(`${BASE}/api/notes/${note.note_id}`, { headers: U });
  console.log('as the person reads it →', JSON.stringify(got1.json?.data?.agentSpans));

  const appended = 'The agent wrote this line.\n\nA second paragraph, also the agent.';
  const patched = await api(`${BASE}/api/agent/notes/${note.note_id}`, {
    method: 'PATCH',
    headers: A,
    body: { content: appended, ifRevision: note.revision },
  });
  console.log('agent append →', patched.status);

  const got2 = await api(`${BASE}/api/notes/${note.note_id}`, { headers: U });
  const spans2 = got2.json?.data?.agentSpans || [];
  console.log('spans after append →', JSON.stringify(spans2));
  console.log('marked text →', JSON.stringify(spans2.map((s) => got2.json.data.content.slice(s.start, s.end))));

  const edited = `${appended}\n\nThe person added this one.`;
  const saved = await api(`${BASE}/api/notes/${note.note_id}`, {
    method: 'PATCH',
    headers: U,
    body: { content: edited, ifRevision: got2.json.data.revision },
  });
  console.log('person edit →', saved.status);
  const got3 = await api(`${BASE}/api/notes/${note.note_id}`, { headers: U });
  const spans3 = got3.json?.data?.agentSpans || [];
  console.log('spans after person edit →', JSON.stringify(spans3));
  console.log('marked text →', JSON.stringify(spans3.map((s) => got3.json.data.content.slice(s.start, s.end))));
} finally {
  await api(`${SUPABASE}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
}
