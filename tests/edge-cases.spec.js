// @ts-check
import { test, expect } from '@playwright/test';

// Edge sweep for the local notebook: the states that are not the happy path but
// are the ones where a notebook silently loses work — an empty notebook, text
// that is not ASCII, a note big enough to matter, a corrupt cache, a second tab
// editing the same device, and no network at all.
//
// The P0 note-loss bug shipped because nothing exercised the app as it actually
// opens. These specs exist so the next one is caught here instead of by Ves.

const editor = (page) => page.locator('textarea[aria-label="Note editor"]').first();
// The empty state renders late and only when the notebook is empty, so create
// notes through the toolbar control (named "Create new note" once a note exists).
const createNote = (page) => page.getByRole('button', { name: /create (new )?note/i }).first();

const openFresh = async (page) => {
  await page.goto('/app');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(editor(page)).toBeVisible({ timeout: 15000 });
  // The app settles its load (notes cache, current id) after first paint.
  await page.waitForTimeout(2500);
};

test.beforeEach(async ({ page }) => {
  await openFresh(page);
});

test.describe('Edge states', () => {
  test('opens an empty notebook ready to write, with no failing requests', async ({ page }) => {
    const failures = [];
    const pageErrors = [];
    page.on('response', (r) => {
      if (r.status() >= 400) failures.push(`${r.status()} ${r.url()}`);
    });
    page.on('pageerror', (error) => pageErrors.push(String(error)));

    await openFresh(page);

    await expect(editor(page)).toBeVisible();
    // An empty notebook lists nothing — the placeholder note is not a note yet.
    await expect(page.getByRole('button', { name: /Open note:/ })).toHaveCount(0);
    // ...but it is usable: typing materialises it without the create button.
    await editor(page).click();
    await page.keyboard.type('# First ever note', { delay: 5 });
    await expect(page.getByRole('button', { name: /Open note: First ever note/ })).toBeVisible({
      timeout: 5000,
    });

    expect(pageErrors).toEqual([]);
    expect(failures).toEqual([]);
  });

  test('round-trips non-ASCII text through a reload', async ({ page }) => {
    // Emoji (including a ZWJ sequence), CJK, RTL, combining marks and a lone
    // surrogate pair are where naive encoders split characters.
    const text = [
      '# Ünïcödé — заметка 笔记',
      '',
      'emoji 👩‍💻🧑🏽‍🚀🇧🇬',
      'arabic: مرحبا بالعالم',
      'combining: e\u0301 a\u0300 n\u0303',
      'math: 𝕄𝕒𝕥𝕙 ∑ ∫',
    ].join('\n');

    await createNote(page).click();
    await editor(page).fill(text);
    // Wait for the app's own save signal, never a fixed sleep: the store is
    // IndexedDB now, so a reload that lands inside the save debounce leaves the
    // note as a draft record and the editor comes back empty.
    await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 20000 });
    await page.reload();
    await expect(editor(page)).toBeVisible({ timeout: 15000 });

    await expect(editor(page)).toHaveValue(text, { timeout: 20000 });
  });

  test('keeps a large note intact across a reload', async ({ page }) => {
    const body = Array.from({ length: 1200 }, (_, i) => `line ${i} — ${'x'.repeat(48)}`).join('\n');
    const text = `# Large note\n\n${body}\nEND-OF-LARGE-NOTE`;

    await createNote(page).click();
    await editor(page).fill(text);
    // Wait for the app's own save signal rather than a fixed delay: this note is
    // 72 KB, and a fixed wait made the spec fail on a loaded machine while the
    // save was still in its debounce.
    await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 20000 });
    await page.reload();
    await expect(editor(page)).toBeVisible({ timeout: 15000 });

    // The editor loads the note out of the store, which is a round trip now
    // that the store is IndexedDB — so the value is waited for rather than read
    // once, and the tail is what proves nothing was cut off.
    await expect(editor(page)).toHaveValue(text, { timeout: 20000 });
    const value = await editor(page).inputValue();
    expect(value).toHaveLength(text.length);
    expect(value.endsWith('END-OF-LARGE-NOTE')).toBe(true);
  });

  test('survives a corrupt notes cache and recovers orphan content', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));

    // Seeded through the seam, which is the store the app reads: the notes live
    // in IndexedDB now, and a seed written straight into `localStorage` would
    // sit one store over from the app.
    await page.evaluate(async () => {
      // A cache entry that is not JSON: reading it must not throw the app away.
      await window.storage.set('local:notes-cache', '{not json at all');
      // Content with no cache row: the orphan scan is what recovers it, and the
      // key is the note's storage key (`<user>:<noteId>`).
      await window.storage.set('local:note-orphan-1', '# Recovered orphan\n\nbody from a lost row');
    });

    await page.reload();
    await expect(editor(page)).toBeVisible({ timeout: 15000 });

    const row = page.getByRole('button', { name: /Open note: Recovered orphan/ }).first();
    await expect(row).toBeVisible({ timeout: 5000 });
    await row.click();
    await expect(editor(page)).toHaveValue('# Recovered orphan\n\nbody from a lost row');
    expect(pageErrors).toEqual([]);
  });

  test('replays a save the tab never finished', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));

    // The shape of a tab killed mid-save: the journal record is on disk, and the
    // note it belongs to was never committed — no content key, no row in the
    // list. Before recovery existed, this text was invisible to the notebook.
    await page.evaluate(async () => {
      await window.storage.set(
        'local:note-draft:note-interrupted',
        JSON.stringify({
          schemaVersion: 1,
          noteId: 'note-interrupted',
          content: '# Interrupted save\n\nthe last words of a killed tab',
          baseRevision: null,
          updatedAt: Date.now(),
          dirty: true,
        })
      );
    });

    await page.reload();
    await expect(editor(page)).toBeVisible({ timeout: 15000 });

    const row = page.getByRole('button', { name: /Open note: Interrupted save/ }).first();
    await expect(row).toBeVisible({ timeout: 5000 });
    await row.click();
    await expect(editor(page)).toHaveValue(
      '# Interrupted save\n\nthe last words of a killed tab'
    );

    // The text is committed to the note itself, and the record is consumed — so
    // the next open has nothing left to replay.
    expect(
      await page.evaluate(async () => (await window.storage.get('local:note-interrupted'))?.value ?? null)
    ).toBe('# Interrupted save\n\nthe last words of a killed tab');
    expect(
      await page.evaluate(
        async () => (await window.storage.get('local:note-draft:note-interrupted'))?.value ?? null
      )
    ).toBeNull();
    expect(pageErrors).toEqual([]);
  });

  test('a second tab sees the first tab’s note and loses nothing', async ({ page, context }) => {
    const first = '# Note from tab one\n\nwritten in tab one';
    await createNote(page).click();
    await editor(page).fill(first);
    // The row appears when the save commits, which is the app's own signal —
    // a fixed wait raced the write once the store became asynchronous.
    await expect(page.getByRole('button', { name: /Open note: Note from tab one/ })).toBeVisible({
      timeout: 15000,
    });

    // A second tab on the same device — same origin, same storage.
    const second = await context.newPage();
    await second.goto('/app');
    await expect(editor(second)).toBeVisible({ timeout: 15000 });
    await expect(second.getByRole('button', { name: /Open note: Note from tab one/ })).toBeVisible({
      timeout: 5000,
    });

    // Tab two writes its own note...
    const other = '# Note from tab two\n\nwritten in tab two';
    await createNote(second).click();
    await editor(second).fill(other);
    await expect(second.getByRole('button', { name: /Open note: Note from tab two/ })).toBeVisible({
      timeout: 15000,
    });
    await second.close();

    // ...and tab one, reloaded, must still hold its own note as well as the new
    // one. A whole-cache overwrite is how a second tab eats the first one’s work.
    await page.reload();
    await expect(editor(page)).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: /Open note: Note from tab one/ })).toBeVisible({
      timeout: 5000,
    });
    await page.getByRole('button', { name: /Open note: Note from tab one/ }).click();
    await expect(editor(page)).toHaveValue(first);
    await expect(page.getByRole('button', { name: /Open note: Note from tab two/ })).toBeVisible({
      timeout: 5000,
    });
  });

  test('opens, writes and reloads with no internet', async ({ page }) => {
    // "Offline" here is no internet, not no dev server: the app is still served
    // from localhost, but every external request fails.
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith('http://127.0.0.1:') || url.startsWith('http://localhost:')) {
        return route.continue();
      }
      return route.abort('internetdisconnected');
    });

    await page.reload();
    await expect(editor(page)).toBeVisible({ timeout: 15000 });

    const text = '# Offline note\n\nwritten with no internet at all';
    await editor(page).fill(text);
    // The app's own save signal, not a sleep — and the reload's value is waited
    // for, because loading a note is a store round trip now.
    await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 20000 });
    await page.reload();
    await expect(editor(page)).toBeVisible({ timeout: 15000 });
    await expect(editor(page)).toHaveValue(text, { timeout: 20000 });
  });

  test('a load in flight never reverts text typed while it was reading', async ({ page }) => {
    // The note is created and typed into, and the load that follows the id
    // change reads the store while the typing is still in its save debounce.
    // The load must not land on top of the newer text: before the fix the
    // editor came back with the previous content while the sidebar row already
    // showed the new title — the same note-loss shape as the P0, reachable by
    // typing twice in a row.
    const first = '# Draft one\n\n' + 'First version of the note. '.repeat(8);
    const second = '# Draft two\n\n' + 'Second version, longer and rewritten. '.repeat(16);

    await createNote(page).click();
    await editor(page).click();
    await editor(page).fill(first);
    await expect(page.getByRole('button', { name: /Open note: Draft one/ })).toBeVisible({
      timeout: 15000,
    });

    await editor(page).fill(second);
    await expect(page.getByRole('button', { name: /Open note: Draft two/ })).toBeVisible({
      timeout: 15000,
    });
    await expect(editor(page)).toHaveValue(second, { timeout: 15000 });

    // And the newer text is what survives a reload.
    await page.reload();
    await expect(editor(page)).toBeVisible({ timeout: 15000 });
    await expect(editor(page)).toHaveValue(second, { timeout: 20000 });
  });
});
