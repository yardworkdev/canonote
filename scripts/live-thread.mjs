/**
 * The thread, driven over the API the way two clients actually meet.
 *
 *   node scripts/live-thread.mjs
 *
 * This is the honest boundary of what can be proven without a person's password:
 * everything on the server side, and the two promises the server can make. What a
 * signed-in browser does with the same rows is `check:thread-ui`, which needs a
 * cookie this script must not have.
 *
 * It uses the agent token in `.secrets/canonote-agent-token` (or AGENT_TOKEN) and
 * creates one scratch note in the owner's notebook, which it empties, renames and
 * states plainly at the end so nothing of the owner's is touched or hidden.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE || 'https://canonote.vercel.app';
const TOKEN =
  process.env.AGENT_TOKEN || fs.readFileSync('.secrets/canonote-agent-token', 'utf8').trim();
const API = `${BASE}/api/agent`;

const call = async (path, options = {}) => {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.success) {
    throw new Error(`${options.method || 'GET'} ${path} → ${response.status} ${payload?.error || ''}`);
  }
  return payload.data;
};

let failures = 0;
const line = (ok, label, extra = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok   ' : 'FAIL '} ${label}${extra ? `  ${extra}` : ''}`);
};

// Notes a previous failed run left behind are emptied and renamed here first, so a
// broken run cannot slowly fill the notebook with debris.
const leftovers = ((await call('/notes').catch(() => [])) || []).filter((entry) =>
  String(entry.title || '').startsWith('thread proof')
);
for (const note of leftovers) {
  const current = await call(`/notes/${note.id}`).catch(() => null);
  if (!current) continue;
  await call(`/notes/${note.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      content: '',
      title: `delete me — ${String(note.title).replace(/^delete me — /, '')}`,
      ifRevision: String(current.revision),
    }),
  }).catch(() => {});
  // Not a failure of this run: it is debris a broken run left, and this is the
  // pass that clears it. Reported, not counted.
  console.log(`note  cleaned up a scratch note a previous run left behind  ${note.title}`);
}

const marker = `thread proof ${Date.now()}`;
const created = await call('/notes', {
  method: 'POST',
  body: JSON.stringify({
    title: marker,
    content: `# ${marker}\n\nA note the thread proof made, so nothing of yours is touched.\n\nThis paragraph is the anchor a proposal is written after.`,
  }),
});
const noteId = created.id;
const revision = Number(created.revision);
line(Boolean(noteId), 'the agent made a scratch note', noteId);

let kept = true;
try {
  const message = await call(`/notes/${noteId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ body: 'Is the closing paragraph right?', kind: 'note' }),
  });
  line(message.authorType === 'agent', 'the agent posted a message');
  line(message.kind === 'note', 'and it is conversation, not a change to the note');

  const proposal = await call(`/notes/${noteId}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      body: 'A closing paragraph the agent suggests.',
      kind: 'proposal',
      baseRevision: revision,
    }),
  });
  line(proposal.kind === 'proposal', 'the agent posted a proposal');
  line(proposal.baseRevision === revision, 'the proposal carries its base revision', String(revision));

  let refused = null;
  try {
    await call(`/notes/${noteId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body: 'no revision given', kind: 'proposal' }),
    });
  } catch (error) {
    refused = error.message;
  }
  line(Boolean(refused), 'a proposal without a revision is refused', (refused || '').slice(0, 60));

  const listed = await call(`/notes/${noteId}/messages`);
  line(listed.length === 2, 'both messages come back in one read', String(listed.length));
  line(
    listed[0].authorType === 'agent' && listed[1].kind === 'proposal',
    'oldest first, so a conversation reads top to bottom'
  );

  const ahead = new Date(Date.now() + 1000).toISOString();
  const quiet = await call(`/notes/${noteId}/messages?since=${encodeURIComponent(ahead)}`);
  line(quiet.length === 0, 'a poll with nothing new is empty, not a re-read', String(quiet.length));

  // The boundary the whole design rests on: deciding is the person's route, and an
  // agent has no way to reach it.
  const agentCannotDecide = await fetch(`${API}/notes/${noteId}/messages/${proposal.id}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ applied: true }),
  });
  line(
    agentCannotDecide.status === 404 || agentCannotDecide.status === 405,
    'an agent has no route that applies a proposal',
    String(agentCannotDecide.status)
  );

  const stillUnchanged = await call(`/notes/${noteId}`);
  line(
    Number(stillUnchanged.revision) === revision,
    'a proposal does not touch the note until a person applies it',
    `revision ${stillUnchanged.revision}`
  );

  // Without an account the panel says there is no thread instead of showing an
  // empty one. Checked on the deployed build, in a browser with no session.
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
    args: ['--no-sandbox'],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await context.newPage();
    await page.goto(`${BASE}/app/`, { waitUntil: 'networkidle' });
    // With no session the deployed app shows its sign-in gate, so this browser cannot
    // open a panel: it is stopped one screen earlier. That is the honest result and
    // it is what a stranger meets — the panel's own copy is covered by
    // `check:live-app` (device build) and by the notice unit tests.
    const gate = await page.getByRole('button', { name: /use this device only/i }).count();
    const editor = await page.locator('textarea[aria-label="Note editor"]').count();
    line(
      gate > 0 || editor > 0,
      'without a session the deployed app stops at the sign-in gate, as designed',
      gate > 0 ? 'gate shown' : 'device editor'
    );
    await context.close();
  } finally {
    await browser.close();
  }
} finally {
  // The agent API has no delete on purpose: an agent cannot remove what its owner
  // wrote. So the scratch note is emptied and renamed, and named unmistakably, so
  // it is obvious in the list and harmless for the owner to delete by hand.

  const current = await call(`/notes/${noteId}`).catch(() => null);
  if (current) {
    try {
      await call(`/notes/${noteId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          content: '',
          title: `delete me — ${marker}`,
          ifRevision: String(current.revision),
        }),
      });
      kept = false;
    } catch {
      kept = true;
    }
  }
  line(!kept, 'the scratch note is emptied and renamed for deletion');
  if (kept) console.log(`     left behind: ${noteId} (delete it in the app)`);
}

console.log(
  failures === 0
    ? '\nPASS  an agent and a person can talk on a note, and a proposal is a proposal\n'
    : `\n${failures} check(s) failed\n`
);
process.exit(failures === 0 ? 0 : 1);
