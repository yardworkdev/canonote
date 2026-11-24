#!/usr/bin/env node
/**
 * The deployed site, checked the way a stranger meets it.
 *
 * Runs against production by default (override with LIVE_URL). It answers one
 * question: is everything that answers over HTTP actually answering, and does
 * it answer correctly when it should refuse — a note API that lets an anonymous
 * caller through is worse than one that is down.
 *
 * Exits 1 if anything that should work does not.
 */
const BASE = (process.env.LIVE_URL || 'https://canonote.vercel.app').replace(/\/$/, '');

let failures = 0;

function line(ok, label, detail) {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(34)} ${detail}`);
}

async function get(path) {
  const response = await fetch(`${BASE}${path}`, { redirect: 'follow' });
  const body = await response.text();
  return { status: response.status, body };
}

async function main() {
  console.log(`\nlive check  ${BASE}\n`);

  for (const [path, label] of [
    ['/', 'the landing page'],
    ['/app', 'the notebook'],
    ['/demo', 'the demo'],
  ]) {
    const { status, body } = await get(path);
    line(status === 200 && body.includes('canonote'), label, `${status} ${body.length} B`);
  }

  const notes = await get('/api/notes');
  const notesSaysSignIn = /Unauthorized|Sign in/i.test(notes.body);
  line(
    notes.status === 401 && notesSaysSignIn,
    'notes refuse an anonymous caller',
    `${notes.status} ${notes.body.slice(0, 60)}`
  );

  const agent = await get('/api/agent');
  if (agent.status === 401) {
    // 401 means the handler is alive and the database is configured; the
    // manifest itself is not public. 503 is the failure this check exists for.
    line(true, 'the agent API is alive', `${agent.status} ${agent.body.slice(0, 60)}`);
  } else if (agent.status === 200) {
    let manifest = null;
    try {
      manifest = JSON.parse(agent.body);
    } catch {
      /* reported below */
    }
    line(Boolean(manifest?.data), 'agent manifest', `${agent.status} ${agent.body.length} B`);
  } else {
    let reason = agent.body;
    try {
      reason = JSON.parse(agent.body).error;
    } catch {
      /* keep raw */
    }
    line(false, 'agent manifest', `${agent.status} ${reason}`);
    if (/Database not configured/i.test(agent.body)) {
      console.log(
        '\n   Fix: set SUPABASE_URL and SUPABASE_SERVICE_KEY in Vercel, then redeploy.\n'
      );
    }
  }

  // With a delegated token, the agent half is checked for real: announce a
  // caret on a note, read it back, and leave nothing behind.
  if (process.env.AGENT_KEY && process.env.NOTE_ID) {
    const headers = { Authorization: `Bearer ${process.env.AGENT_KEY}` };
    const announce = await fetch(
      `${BASE}/api/agent/notes/${encodeURIComponent(process.env.NOTE_ID)}/presence`,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'reading' }),
      }
    );
    const announced = await announce.text();
    line(announce.ok, 'agent announces a caret', `${announce.status} ${announced.length} B`);

    const read = await fetch(
      `${BASE}/api/notes/${encodeURIComponent(process.env.NOTE_ID)}/presence`,
      { headers }
    );
    line(read.ok, 'presence reads back', `${read.status} ${(await read.text()).length} B`);
  }

  console.log(failures === 0 ? '\nPASS  the live site answers as promised\n' : `\n${failures} check(s) failed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('live check failed to run:', error.message);
  process.exit(1);
});
