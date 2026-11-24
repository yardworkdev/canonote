#!/usr/bin/env node
/**
 * Emergency note recovery script.
 *
 * Queries Supabase DIRECTLY (bypassing the API's deleted_at filter) so it can
 * find and restore soft-deleted notes.  Also writes a local backup JSON and
 * prints a browser-console snippet to populate localStorage.
 *
 * Usage:
 *   1. Get your Supabase JWT from the browser:
 *   2. Run:
 *        node scripts/recover-notes.mjs <JWT>
 *      OR set env var SUPABASE_JWT=<token> and run without argument.
 */

import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';

// Point this at your own project. Nothing is hardcoded: a recovery tool that
// ships with someone else's project URL and key is a tool nobody can reuse.
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const PROJECT_REF = SUPABASE_URL.match(/^https:\/\/([^.]+)\.supabase\.co/)?.[1] || '<project-ref>';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_ANON_KEY (Project Settings → API) first:');
  console.error('  SUPABASE_URL=https://<project>.supabase.co SUPABASE_ANON_KEY=<anon-key> \\');
  console.error('    node scripts/recover-notes.mjs <SUPABASE_JWT>');
  process.exit(1);
}

const jwt = process.argv[2] || process.env.SUPABASE_JWT;
if (!jwt) {
  console.error('Usage: node scripts/recover-notes.mjs <SUPABASE_JWT>');
  console.error('');
  console.error('Get your JWT from the browser console while logged in to the app:');
  console.error(
    `  JSON.parse(localStorage.getItem('sb-${PROJECT_REF}-auth-token'))?.access_token`
  );
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: { headers: { Authorization: `Bearer ${jwt}` } },
  auth: { persistSession: false, autoRefreshToken: false },
});

async function run() {
  // Verify session
  const { data: userData, error: userError } = await db.auth.getUser(jwt);
  if (userError || !userData?.user) {
    console.error('Invalid or expired JWT:', userError?.message || 'no user returned');
    process.exit(1);
  }
  const userId = userData.user.id;
  console.log(`Authenticated as: ${userId} (${userData.user.email || 'no email'})`);

  // Fetch ALL notes including soft-deleted (no deleted_at filter)
  const { data: allNotes, error: notesError } = await db
    .from('notes')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (notesError) {
    console.error('Failed to fetch notes:', notesError.message);
    process.exit(1);
  }

  const active = allNotes.filter((n) => !n.deleted_at);
  const deleted = allNotes.filter((n) => n.deleted_at);

  console.log(`\nFound ${allNotes.length} total notes:`);
  console.log(`  Active:       ${active.length}`);
  console.log(`  Soft-deleted: ${deleted.length}`);

  // Restore soft-deleted notes
  if (deleted.length > 0) {
    console.log(`\nRestoring ${deleted.length} soft-deleted notes...`);
    for (const note of deleted) {
      const { error } = await db
        .from('notes')
        .update({ deleted_at: null })
        .eq('user_id', userId)
        .eq('note_id', note.note_id);
      if (error) {
        console.warn(`  ✗ Failed to restore "${note.title}" (${note.note_id}): ${error.message}`);
      } else {
        console.log(`  ✓ Restored: "${note.title}" (${note.note_id})`);
      }
    }
  }

  // Build localStorage payload
  const cacheEntries = allNotes.map((n) => ({
    id: n.note_id,
    note_id: n.note_id,
    title: n.title || 'Untitled',
    updated: new Date(n.updated_at || n.created_at || Date.now()).getTime(),
    updated_at: n.updated_at,
    isPinned: Boolean(n.is_pinned),
    folder: n.folder || 'private',
  }));

  const contentEntries = {};
  for (const note of allNotes) {
    const noteId = note.note_id;
    const storageKey = `${userId}:${noteId.startsWith('note-') ? noteId : `note-${noteId}`}`;
    contentEntries[storageKey] = note.content || '';
  }

  // Write backup
  const backup = { userId, timestamp: new Date().toISOString(), notes: allNotes };
  const backupPath = `notes-backup-${Date.now()}.json`;
  writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  console.log(`\nBackup saved to: ${backupPath}`);

  // Print browser-console snippet to populate localStorage
  const snippet = `
// Paste this in the browser console to restore notes to localStorage
(function() {
  const userId = ${JSON.stringify(userId)};
  const cache = ${JSON.stringify(cacheEntries)};
  const content = ${JSON.stringify(contentEntries)};

  localStorage.setItem(userId + ':notes-cache', JSON.stringify(cache));
  for (const [key, val] of Object.entries(content)) {
    localStorage.setItem(key, val);
  }
  console.log('Restored ' + cache.length + ' notes. Reloading...');
  setTimeout(() => window.location.reload(), 1000);
})();
`.trim();

  console.log('\n--- BROWSER CONSOLE SNIPPET (copy and paste to restore) ---');
  console.log(snippet);
  console.log('-----------------------------------------------------------');
  console.log('\nDone. If Supabase was successfully updated, just reload the app.');
  console.log(
    'If you also need to populate localStorage, paste the snippet above in the browser console.'
  );
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
