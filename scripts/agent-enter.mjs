/**
 * An agent entering canonote, the way an agent should have to.
 *
 *   AGENT_KEY=... node scripts/agent-enter.mjs http://127.0.0.1:8100
 *
 * Every step prints the bytes it cost. The number at the end is what the whole
 * session put into a context window — the thing the API is designed to keep small.
 */
const base = process.argv[2] || 'http://127.0.0.1:8100';
const key = process.env.AGENT_KEY;
if (!key) {
  console.error('AGENT_KEY is required');
  process.exit(2);
}

let spent = 0;
const call = async (path, init = {}) => {
  const res = await fetch(base + path, {
    ...init,
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(init.headers || {}) },
  });
  const text = await res.text();
  spent += Buffer.byteLength(text, 'utf8');
  return { status: res.status, text, json: JSON.parse(text) };
};
const step = (label, r) => {
  const bytes = Buffer.byteLength(r.text, 'utf8');
  console.log(`${String(bytes).padStart(6)} B  ${String(r.status).padEnd(3)} ${label}`);
  return r;
};

console.log('--- enter');
const root = step('GET /api/agent (manifest, no key yet)', await fetch(base + '/api/agent').then(async (r) => {
  const text = await r.text();
  spent += Buffer.byteLength(text, 'utf8');
  return { status: r.status, text, json: JSON.parse(text) };
}));
console.log('   ', root.json.start);

console.log('--- find the work');
const list = step('GET notes?limit=5&fields=id,title,updated,words', await call('/api/agent/notes?limit=5&fields=id,title,updated,words'));
const target = list.json.items[0];

console.log('--- what changed recently');
step('GET notes?since=2026-10-20&fields=id,updated', await call('/api/agent/notes?since=2026-10-20&fields=id,updated&limit=50'));

console.log('--- read one note, in two parts');
const meta = step(`GET notes/${target.id}?part=meta`, await call(`/api/agent/notes/${target.id}?part=meta`));
step(`GET notes/${target.id}?part=body&maxBytes=1200`, await call(`/api/agent/notes/${target.id}?part=body&maxBytes=1200`));

console.log('--- search without reading everything');
step('GET search?q=pricing', await call('/api/agent/search?q=pricing&limit=3'));

console.log('--- propose an edit (never a write)');
const proposal = step(`POST notes/${target.id}/propose`, await call(`/api/agent/notes/${target.id}/propose`, {
  method: 'POST',
  body: JSON.stringify({
    ifRev: meta.json.rev,
    find: 'What we decided',
    replace: 'What we decided (revised)',
  }),
}));
console.log('    human must accept:', proposal.json.humanMustAccept);

console.log('--- the switch, for real');
const adminKey = process.env.ADMIN_KEY;
const admin = (path, init = {}) =>
  fetch(base + path, {
    ...init,
    headers: { authorization: `Bearer ${adminKey}`, 'content-type': 'application/json', ...(init.headers || {}) },
  });

if (adminKey) {
  await admin('/api/agent/switch', { method: 'POST', body: JSON.stringify({ enabled: false }) });
  const blocked = await call('/api/agent/notes?limit=1');
  console.log(`${String(Buffer.byteLength(blocked.text)).padStart(6)} B  ${blocked.status} agent read while switched off → ${blocked.json.error}`);
  await admin('/api/agent/switch', { method: 'POST', body: JSON.stringify({ enabled: true }) });
  const again = await call('/api/agent/notes?limit=1');
  console.log(`${String(Buffer.byteLength(again.text)).padStart(6)} B  ${again.status} agent read after switching back on`);
}

// the number that matters: all metadata, versus the whole notebook
const allMeta = await call('/api/agent/notes?limit=50&fields=id,title,updated,words');
console.log(`\nsession cost: ${spent} bytes (~${Math.round(spent / 4)} tokens)`);
console.log(`all 40 notes as metadata: ${Buffer.byteLength(allMeta.text, 'utf8')} bytes`);
console.log(`the notebook itself:      44426 bytes (from the server's own count)`);
