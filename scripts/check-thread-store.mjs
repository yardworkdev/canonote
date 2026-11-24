/**
 * The thread's contract, asked of the real database.
 *
 *   node scripts/check-thread-store.mjs
 *
 * Unit tests prove the maths and the UI; this proves the table. It needs a
 * service-role key, read from THREAD_TEST_URL/THREAD_TEST_KEY (or the local
 * .env.thread-test, which is gitignored), and it deletes every row it creates
 * so it can be run against production without leaving anything behind.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';

const local = existsSync('.env.thread-test')
  ? Object.fromEntries(
      readFileSync('.env.thread-test', 'utf8')
        .trim()
        .split('\n')
        .map((line) => line.split('='))
    )
  : {};
const url = process.env.THREAD_TEST_URL || local.URL;
const key = process.env.THREAD_TEST_KEY || local.KEY;
const userId = process.env.THREAD_TEST_USER || local.USER;
if (!url || !key || !userId) {
  console.error('FAIL  set THREAD_TEST_URL, THREAD_TEST_KEY and THREAD_TEST_USER (or .env.thread-test)');
  process.exit(1);
}
const supabase = createClient(url, key);
const { createThread } = await import('../api/_lib/thread.js');
const thread = createThread(supabase);
const noteId = 'thread-selftest-' + Date.now();

const check = (ok, label, extra='') => console.log(ok ? 'ok   ' : 'FAIL', label, extra);

const a = await thread.post({ userId, noteId, authorType:'agent', authorName:'Promi', kind:'note', body:'Hello from the agent.' });
check(a.id && a.authorType === 'agent', 'an agent can post a message', a.kind);

const p = await thread.post({ userId, noteId, authorType:'agent', authorName:'Promi', kind:'proposal', body:'A paragraph offered for the note.', baseRevision: 12 });
check(p.baseRevision === 12, 'a proposal carries the revision it was written for');

let refused = null;
try { await thread.post({ userId, noteId, authorType:'agent', kind:'proposal', body:'no revision' }); }
catch (e) { refused = e.message; }
check(Boolean(refused), 'a proposal without a revision is refused', refused);
// The uuid column is the reason this row cannot exist: it is the schema that says
// no, not the handler being polite.
check(String(refused || '').includes('proposal') || String(refused || '').includes('baseRevision'), 'and it says which field is missing', String(refused || '').slice(0, 60));

let tooBig = null;
try { await thread.post({ userId, noteId, authorType:'agent', kind:'note', body:'x'.repeat(2001) }); }
catch (e) { tooBig = e.message; }
check(Boolean(tooBig), 'a message over 2000 bytes is refused', tooBig);

const page = await thread.list({ userId, noteId });
check(page.messages.length === 2, 'reading returns both messages oldest first', page.messages.map(m=>m.kind).join(','));
check(page.nextCursor === page.messages[page.messages.length-1].createdAt, 'the poll cursor is the newest timestamp');

const quiet = await thread.list({ userId, noteId, since: page.nextCursor });
check(quiet.messages.length === 0, 'a quiet poll returns nothing');

const decided = await thread.decide({ userId, noteId, messageId: p.id, applied: true });
check(decided.appliedAt !== null, 'the person can apply a proposal');

const wrongOwner = await thread.list({ userId: '00000000-0000-0000-0000-000000000000', noteId });
check(wrongOwner.messages.length === 0, 'another owner sees an empty thread, not this one');

// clean up our own rows only
await supabase.from('note_messages').delete().eq('user_id', userId).eq('note_id', noteId);
const gone = await thread.list({ userId, noteId });
check(gone.messages.length === 0, 'cleanup left nothing behind');
