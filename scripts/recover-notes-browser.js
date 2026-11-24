/**
 * BROWSER CONSOLE RECOVERY SCRIPT
 *
 * Paste this entire file into the browser console while logged into the app.
 * Works on both https://notes-editor-two.vercel.app and localhost.
 *
 * What it does:
 *   1. Reads your Supabase session from localStorage
 *   2. Queries Supabase DIRECTLY (bypasses the API's deleted_at filter)
 *   3. Restores any soft-deleted notes in Supabase
 *   4. Pulls all note content into localStorage
 *   5. Reloads the app
 */
(async function recoverAllNotes() {
  // Fill these in from Project Settings → API in your Supabase dashboard.
  const SUPABASE_URL = window.__SUPABASE_URL__ || '<https://your-project.supabase.co>';
  const ANON_KEY = window.__SUPABASE_ANON_KEY__ || '<your-anon-key>';
  if (SUPABASE_URL.includes('<') || ANON_KEY.includes('<')) {
    console.error('Set SUPABASE_URL and ANON_KEY at the top of this script first.');
    return;
  }

  // --- 1. Read session ---
  const sbKey = Object.keys(localStorage).find(
    (k) => k.startsWith('sb-') && k.endsWith('-auth-token')
  );
  if (!sbKey) {
    console.error('❌ No Supabase session found. Log in first, then re-run this script.');
    return;
  }
  let session;
  try {
    session = JSON.parse(localStorage.getItem(sbKey));
  } catch {
    console.error('❌ Could not parse Supabase session.');
    return;
  }
  const jwt = session?.access_token;
  const userId = session?.user?.id;
  if (!jwt || !userId) {
    console.error('❌ Missing access_token or user.id in session.');
    return;
  }
  console.log(`✅ Session found — user: ${userId}`);

  const headers = {
    apikey: ANON_KEY,
    Authorization: `Bearer ${jwt}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };

  // --- 2. Fetch ALL notes (no deleted_at filter) ---
  const listResp = await fetch(
    `${SUPABASE_URL}/rest/v1/notes?select=*&order=updated_at.desc`,
    { headers }
  );
  if (!listResp.ok) {
    console.error('❌ Failed to fetch notes:', await listResp.text());
    return;
  }
  const allNotes = await listResp.json();
  const active = allNotes.filter((n) => !n.deleted_at);
  const deleted = allNotes.filter((n) => n.deleted_at);
  console.log(
    `📋 Found ${allNotes.length} notes total (${active.length} active, ${deleted.length} soft-deleted)`
  );

  // --- 3. Restore soft-deleted notes ---
  if (deleted.length > 0) {
    console.log(`🔄 Restoring ${deleted.length} soft-deleted notes in Supabase...`);
    for (const note of deleted) {
      try {
        const r = await fetch(
          `${SUPABASE_URL}/rest/v1/notes?note_id=eq.${encodeURIComponent(note.note_id)}&user_id=eq.${userId}`,
          { method: 'PATCH', headers, body: JSON.stringify({ deleted_at: null }) }
        );
        if (r.ok) {
          console.log(`  ✓ Restored: "${note.title}" (${note.note_id})`);
        } else {
          console.warn(`  ✗ Failed: "${note.title}"`, await r.text());
        }
      } catch (e) {
        console.warn(`  ✗ Error restoring "${note.title}":`, e.message);
      }
    }
  }

  // --- 4. Populate localStorage ---
  const cacheEntries = allNotes.map((n) => ({
    id: n.note_id,
    note_id: n.note_id,
    title: n.title || 'Untitled',
    updated: new Date(n.updated_at || n.created_at || Date.now()).getTime(),
    updated_at: n.updated_at,
    isPinned: Boolean(n.is_pinned),
    folder: n.folder || 'private',
  }));

  localStorage.setItem(`${userId}:notes-cache`, JSON.stringify(cacheEntries));
  console.log(`✅ Wrote notes-cache (${cacheEntries.length} entries)`);

  let stored = 0;
  for (const note of allNotes) {
    const noteId = note.note_id;
    const storageKey = `${userId}:${noteId.startsWith('note-') ? noteId : `note-${noteId}`}`;
    localStorage.setItem(storageKey, note.content || '');
    stored++;
  }
  console.log(`✅ Stored content for ${stored} notes`);

  // --- 5. Reload ---
  console.log('\n🎉 Recovery complete! Reloading the app in 2 seconds...');
  setTimeout(() => window.location.reload(), 2000);
})();
