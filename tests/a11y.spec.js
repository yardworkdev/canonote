// @ts-check
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Accessibility sweep for both surfaces. The app is a keyboard-heavy tool —
// a notebook someone types into all day — so a missing label or an unlabelled
// control is a real defect, not a lint nit. Every state below must be axe-clean
// (zero violations of any impact) or the suite fails.
//
// The states deliberately include the ones a screen reader meets first: the
// empty notebook (its empty state, its import control), the note list, the
// helper panel, and the modal surfaces (export, find & replace, shortcuts,
// command palette) that trap focus.

const editor = (page) => page.locator('textarea[aria-label="Note editor"]').first();

const summarise = (violations) =>
  violations
    .map(
      (v) =>
        `[${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s)) -> ${v.nodes
          .slice(0, 3)
          .map((n) => n.target.join(' '))
          .join(' | ')}`,
    )
    .join('\n');

const openFreshNotebook = async (page) => {
  await page.goto('/app');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(editor(page)).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(2000);
};

const expectClean = async (page) => {
  // Modal surfaces fade in. axe measures the *computed* colours, so analysing
  // mid-animation reports the blended (mid-fade) contrast. Let the transition
  // settle first — the app honours prefers-reduced-motion, so it is quick.
  await page.waitForTimeout(600);
  const results = await new AxeBuilder({ page }).analyze();
  expect(summarise(results.violations), summarise(results.violations)).toBe('');
};

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test.describe('Accessibility', () => {
  test('the marketing page has no axe violations', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 15000 });
    await expectClean(page);
  });

  test('the empty notebook has no axe violations', async ({ page }) => {
    await openFreshNotebook(page);
    await expectClean(page);
  });

  test('the notebook with a note has no axe violations', async ({ page }) => {
    await openFreshNotebook(page);
    await editor(page).click();
    await page.keyboard.type('# A labelled notebook\n\nthe body of the note', { delay: 5 });
    await page.waitForTimeout(2500);
    await expectClean(page);
  });

  test('an empty search result has no axe violations', async ({ page }) => {
    await openFreshNotebook(page);
    await page.getByLabel('Search notes').fill('zzz-nothing-matches-this');
    await page.waitForTimeout(900);
    await expectClean(page);
  });

  test('the helper panel has no axe violations', async ({ page }) => {
    await openFreshNotebook(page);
    await editor(page).click();
    await page.keyboard.type('# Helper\n\n## Section\n\ntext with #tag', { delay: 3 });
    await page.waitForTimeout(2500);
    await page.getByLabel(/Show helper panel/).click();
    await page.waitForTimeout(900);
    await expectClean(page);
  });

  // Each of the four helper panels is swept in its own right: they share one
  // header, one empty, one loading and one error (HelperPanel.jsx), and the
  // suite used to sweep only whichever tab the app happened to open on.
  for (const tab of ['Thread', 'History', 'Tags & References', 'Agent']) {
    test(`the ${tab} panel has no axe violations`, async ({ page }) => {
      await openFreshNotebook(page);
      await editor(page).click();
      await page.keyboard.type('# Helper\n\n## Section\n\ntext with #tag', { delay: 3 });
      await page.waitForTimeout(2500);
      await page.getByLabel(/Show helper panel/).click();
      await expect(page.getByRole('tablist', { name: 'Helper views' })).toBeVisible({
        timeout: 10000,
      });
      await page.getByRole('tab', { name: tab }).click();
      await expectClean(page);
    });
  }

  test('the export dialog has no axe violations', async ({ page }) => {
    await openFreshNotebook(page);
    await page.getByLabel('Export note').click();
    await expect(page.getByRole('dialog', { name: 'Export note' })).toBeVisible();
    await expectClean(page);
  });

  test('find and replace has no axe violations', async ({ page }) => {
    await openFreshNotebook(page);
    await page.locator('body').click();
    await page.keyboard.press('Control+f');
    await expect(page.getByLabel('Find text')).toBeVisible({ timeout: 5000 });
    await expectClean(page);
  });

  test('the command palette has no axe violations', async ({ page }) => {
    await openFreshNotebook(page);
    await page.locator('body').click();
    await page.keyboard.press('Control+k');
    await expect(page.getByPlaceholder(/type a command/i)).toBeVisible({ timeout: 5000 });
    await expectClean(page);
  });

  test('the storage panel has no axe violations', async ({ page }) => {
    await openFreshNotebook(page);
    await page.locator('body').click();
    await page.keyboard.press('Control+k');
    const input = page.getByPlaceholder(/type a command/i);
    await expect(input).toBeVisible({ timeout: 5000 });
    await input.fill('storage');
    await page.getByRole('option', { name: /storage health/i }).click();
    await expect(page.getByRole('dialog', { name: 'Storage' })).toBeVisible({ timeout: 5000 });
    await expectClean(page);
  });

  // The panel has two states and the folder one is the state a fresh install
  // never reaches: the notes are a folder the user picked, and the panel states
  // it and offers to leave. Swept here because the sweep only ever sees the
  // state it opens (the same way Contents, History and Tags went unswept).
  // The picker cannot be driven, so the folder is a real directory handle the
  // browser hands out without one (the origin private file system).
  test('the storage panel on a folder has no axe violations', async ({ page }) => {
    await page.addInitScript(async () => {
      window.showDirectoryPicker = async () => {
        const root = await navigator.storage.getDirectory();
        return root.getDirectoryHandle('notes-folder', { create: true });
      };
    });
    await openFreshNotebook(page);

    await page.locator('body').click();
    await page.keyboard.press('Control+k');
    const input = page.getByPlaceholder(/type a command/i);
    await expect(input).toBeVisible({ timeout: 5000 });
    await input.fill('storage');
    await page.getByRole('option', { name: /storage health/i }).click();
    await page.getByRole('button', { name: /use a folder for your notes/i }).click();
    await expect(page.getByText('Stored in “notes-folder”')).toBeVisible({ timeout: 15000 });
    await expect(editor(page)).toBeVisible({ timeout: 15000 });

    await page.locator('body').click();
    await page.keyboard.press('Control+k');
    await expect(input).toBeVisible({ timeout: 5000 });
    await input.fill('storage');
    await page.getByRole('option', { name: /storage health/i }).click();
    await expect(page.getByRole('dialog', { name: 'Storage' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: /back to this browser/i })).toBeVisible();
    await expectClean(page);
  });

  // The agent trail has one state a fresh install reaches (no account, so
  // nothing to read from) and one it never does (a session, and a list of
  // events) — the list is swept in the component's own spec, because a session
  // needs a configured backend. What is swept here is the surface a visitor
  // actually meets.
  test('the agent activity panel has no axe violations', async ({ page }) => {
    await openFreshNotebook(page);
    await page.locator('body').click();
    await page.keyboard.press('Control+k');
    const input = page.getByPlaceholder(/type a command/i);
    await expect(input).toBeVisible({ timeout: 5000 });
    await input.fill('agent activity');
    await page.getByRole('option', { name: /agent activity/i }).click();
    await expect(page.getByRole('dialog', { name: 'Agent activity' })).toBeVisible({
      timeout: 5000,
    });
    await expectClean(page);
  });

  test('the note list in selection mode has no axe violations', async ({ page }) => {
    await openFreshNotebook(page);
    await editor(page).click();
    await page.keyboard.type(`# Selectable

the body of the note`, { delay: 5 });
    await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 10000 });
    await page.getByLabel('Select notes').click();
    await page.getByRole('button', { name: 'Select note: Selectable' }).click();
    await expect(page.getByText('1 selected')).toBeVisible();
    await expectClean(page);
  });

  test('the narrow toolbar and its overflow menu have no axe violations', async ({ page }) => {
    // A phone width is where the bar drops controls, and the menu that holds them
    // is a surface a screen reader meets — so it is swept like any other.
    await page.setViewportSize({ width: 375, height: 720 });
    await openFreshNotebook(page);
    await page.getByRole('button', { name: 'More controls' }).click();
    await expect(
      page.getByRole('menu', { name: 'More formatting and note actions' })
    ).toBeVisible();
    await expectClean(page);
  });

  test('the keyboard shortcuts dialog has no axe violations', async ({ page }) => {
    await openFreshNotebook(page);
    await page.locator('body').click();
    await page.keyboard.press('Control+?');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible({
      timeout: 5000,
    });
    await expectClean(page);
  });

  test('everything reachable by keyboard has a visible focus ring', async ({ page }) => {
    // A focus-visible sweep: Tab through the notebook and assert each focused
    // element carries an outline or a ring, so a keyboard user can always see
    // where they are.
    await openFreshNotebook(page);
    await editor(page).click();
    await page.keyboard.type('# Focus sweep\n\nsome text', { delay: 5 });
    await page.waitForTimeout(2000);
    await page.locator('body').click();

    const offenders = [];
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body || el.tagName === 'HTML') return null;
        const cs = getComputedStyle(el);
        const ring =
          (cs.outlineStyle && cs.outlineStyle !== 'none' && cs.outlineWidth !== '0px') ||
          cs.boxShadow !== 'none';
        return {
          tag: el.tagName,
          label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30),
          ring,
        };
      });
      if (info && !info.ring) offenders.push(info);
    }

    expect(
      offenders,
      `focusable elements without a visible ring: ${JSON.stringify(offenders)}`,
    ).toEqual([]);
  });
});
