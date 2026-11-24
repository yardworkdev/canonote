/**
 * Two authors, one note — the failure case and the fix, over real HTTP.
 *
 *   AGENT_KEY=… ADMIN_KEY=… node scripts/agent-write.mjs http://127.0.0.1:8120
 *
 * The sequence is deliberate: the agent appends, a person appends while the agent is
 * not looking, the agent tries to replace and is refused, then merges and succeeds.
 * Nothing is lost and nothing is claimed that did not happen.
 */
const base = process.argv[2] || 'http://127.0.0.1:8120';
const key = process.env.AGENT_KEY;
const admin = process.env.ADMIN_KEY;
if (!key) {
  console.error('AGENT_KEY is required');
  process.exit(2);
}

let spent = 0;
const call = async (path, init = {}, token = key) => {
  const res = await fetch(base + path, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers || {}) },
  });
  const text = await res.text();
  spent += Buffer.byteLength(text, 'utf8');
  console.log(`${String(Buffer.byteLength(text, 'utf8')).padStart(6)} B  ${String(res.status).padEnd(3)} ${init.method || 'GET'} ${path}`);
  return { status: res.status, json: JSON.parse(text) };
};

console.log('--- the agent starts a note of its own');
const created = await call('/api/agent/notes', {
  method: 'POST',
  body: JSON.stringify({ title: 'Deploy checks', body: '# Deploy checks\n\n- build passes\n- audit clean' }),
});
const id = created.json.id;

console.log('--- the agent appends a section (no lock, no clobber)');
await call(`/api/agent/notes/${id}`, {
  method: 'PATCH',
  body: JSON.stringify({ op: 'append', content: '## Notes\n\nRan on the release branch at 21:40.' }),
});

console.log('--- meanwhile the person adds a line to the same note');
await call('/api/human/notes/append', { method: 'POST', body: JSON.stringify({ id, text: '- I want a canary step in here.' }) }, admin);

console.log('--- the agent now tries a replace with the revision it read earlier');
const stale = await call(`/api/agent/notes/${id}`, {
  method: 'PATCH',
  body: JSON.stringify({ op: 'replace', content: '# Deploy checks\n\n- build passes', ifRevision: created.json.rev }),
});
console.log('    refused:', stale.status === 409, '| current rev:', stale.json.rev);

console.log('--- so it reads the body, merges, and writes again under the real revision');
const current = await call(`/api/agent/notes/${id}?part=body`);
const merged = `${current.json.content.trim()}\n\n- canary first, then the rest.`;
const done = await call(`/api/agent/notes/${id}`, {
  method: 'PATCH',
  body: JSON.stringify({ op: 'replace', content: merged, ifRevision: current.json.rev }),
});

console.log('--- what the note says now');
const final = await call(`/api/agent/notes/${id}?part=body`);
console.log('\n' + final.json.content);
console.log(`\nby: ${JSON.stringify(done.json.by)}  words: ${done.json.words}`);
console.log(`session cost: ${spent} bytes (~${Math.round(spent / 4)} tokens)`);
