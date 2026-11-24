/**
 * Proof that one note can be taken away from the agent without taking anything
 * away from the person.
 *
 *   node scripts/agent-server.mjs 8160
 *   AGENT_KEY=... ADMIN_KEY=... node scripts/agent-access.mjs http://127.0.0.1:8160 note-003
 *
 * What it shows, in order: the agent can see the note; the person switches it off;
 * the agent's list no longer contains it; a direct read answers 404, not 403; a
 * search cannot find it; writing to it fails the same way; switching it back on
 * restores every route.
 */

const base = (process.argv[2] || 'http://127.0.0.1:8160').replace(/\/+$/, '');
const noteId = process.argv[3] || 'note-003';
const agentKey = process.env.AGENT_KEY;
const adminKey = process.env.ADMIN_KEY;
if (!agentKey) {
  console.error('AGENT_KEY is required (printed by agent-server.mjs on start)');
  process.exit(2);
}

let total = 0;

async function call(method, path, { key = agentKey, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  total += Buffer.byteLength(text, 'utf8');
  return { status: res.status, bytes: Buffer.byteLength(text, 'utf8'), json: safe(text) };
}

const safe = (t) => {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
};

const line = (label, r) =>
  console.log(`${String(r.status).padEnd(4)} ${label.padEnd(46)} ${String(r.bytes).padStart(5)} B`);

const seenInList = async () => {
  const r = await call('GET', '/api/agent/notes?limit=50&fields=id');
  return (r.json?.items || []).some((n) => n.id === noteId);
};

console.log(`note     ${noteId}`);
console.log(`agent    ${base}\n`);

console.log('— before the switch');
console.log(`listed: ${await seenInList()}`);
line('GET meta', await call('GET', `/api/agent/notes/${noteId}?part=meta`));
line('GET body (capped)', await call('GET', `/api/agent/notes/${noteId}?part=body&maxBytes=400`));

console.log('\n— the person switches it off');
line('POST /api/human/notes/access', await call('POST', '/api/human/notes/access', {
  key: adminKey || '',
  body: { id: noteId, agentAccess: false },
}));

console.log('\n— after the switch, as the agent');
console.log(`listed: ${await seenInList()}`);
const meta = await call('GET', `/api/agent/notes/${noteId}?part=meta`);
line('GET meta (expect 404)', meta);
const bodyRes = await call('GET', `/api/agent/notes/${noteId}?part=body`);
line('GET body (expect 404)', bodyRes);
const patchRes = await call('PATCH', `/api/agent/notes/${noteId}`, {
  body: { op: 'append', text: 'the agent should not get this in' },
});
line('PATCH append (expect 404)', patchRes);
const search = await call('GET', '/api/agent/search?q=the');
console.log(
  `${String(search.status).padEnd(4)} search cannot find it${' '.repeat(20)} ${String(search.bytes).padStart(5)} B` +
    (search.json?.items?.some((h) => h.id === noteId) ? '  <-- LEAK' : '')
);

console.log('\n— the person switches it back on');
line('POST /api/human/notes/access', await call('POST', '/api/human/notes/access', {
  key: adminKey || '',
  body: { id: noteId, agentAccess: true },
}));
console.log(`listed: ${await seenInList()}`);
line('GET meta (expect 200)', await call('GET', `/api/agent/notes/${noteId}?part=meta`));

console.log(`\ntotal bytes read by the agent: ${total}`);
const ok =
  meta.status === 404 && bodyRes.status === 404 && patchRes.status === 404 &&
  !search.json?.items?.some((h) => h.id === noteId);
console.log(ok ? 'PASS  a switched-off note is indistinguishable from a missing one' : 'FAIL');
process.exit(ok ? 0 : 1);
