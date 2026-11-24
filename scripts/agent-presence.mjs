/**
 * The agent half of presence, over real HTTP.
 *
 *   node scripts/agent-presence.mjs http://127.0.0.1:8185
 *
 * An agent announces where it is working, the person's browser reads it back, a
 * note switched off for agents answers 404 even here, and silence for twelve
 * seconds removes the agent without anyone sending a goodbye.
 *
 * Needs the reference server running (node scripts/agent-server.mjs 8185), which
 * prints AGENT_KEY and ADMIN_KEY.
 */
const base = process.argv[2] || 'http://127.0.0.1:8185';
const agent = process.env.AGENT_KEY;
const admin = process.env.ADMIN_KEY;
if (!agent || !admin) {
  console.error('AGENT_KEY and ADMIN_KEY must be set (the server prints both on start)');
  process.exit(2);
}

let spent = 0;
const call = async (path, { method = 'GET', body, key = agent } = {}) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  spent += Buffer.byteLength(text);
  return { status: res.status, json: text ? JSON.parse(text) : null, bytes: Buffer.byteLength(text) };
};

const line = (label, value) => console.log(`  ${label.padEnd(46)} ${value}`);

console.log('\n--- an agent says where it is working');
const announced = await call('/api/agent/notes/note-004/presence', {
  method: 'POST',
  body: { mode: 'writing', from: 120, to: 180 },
});
line('POST .../note-004/presence', `${announced.status}  ${announced.bytes} B`);
if (announced.status !== 200) {
  console.error('FAIL  the agent could not announce presence');
  process.exit(1);
}

console.log('\n--- the browser reads it back');
const read = await call('/api/human/notes/note-004/presence', { key: admin });
line('entries', JSON.stringify(read.json.entries));
line('mode', read.json.entries?.[0]?.mode);
line('range', `${read.json.entries?.[0]?.from}-${read.json.entries?.[0]?.to}`);

console.log('\n--- a note switched off for agents answers 404, even here');
await call('/api/human/notes/access', { method: 'POST', key: admin, body: { id: 'note-005', agentAccess: false } });
const hidden = await call('/api/agent/notes/note-005/presence', { method: 'POST', body: { mode: 'reading' } });
line('POST on a hidden note', `${hidden.status}  ${hidden.bytes} B`);

console.log('\n--- nobody says goodbye; twelve seconds is the whole contract');
await new Promise((resolve) => setTimeout(resolve, 12_500));
const later = await call('/api/human/notes/note-004/presence', { key: admin });
line('entries after 12.5 s', JSON.stringify(later.json.entries));

const ok =
  read.json.entries?.[0]?.mode === 'writing' &&
  read.json.entries?.[0]?.from === 120 &&
  read.json.entries?.[0]?.to === 180 &&
  hidden.status === 404 &&
  Array.isArray(later.json.entries) &&
  later.json.entries.length === 0;

console.log(`\nbytes the agent spent: ${spent}`);
console.log(ok ? 'PASS  presence is announced, readable, hidden with the note, and expires on its own' : 'FAIL  one of those is not true');
process.exit(ok ? 0 : 1);
