// @ts-check
import { test, expect } from '@playwright/test';

// The keyboard path through the notebook.
//
// The app is a tool someone types into all day, so "you can do it with a
// keyboard" is a product claim, not a nicety: the axe sweep proves a surface
// is *labelled*, and this suite proves it is *operable* — reachable by Tab,
// drivable by the keys the surface advertises, and honest about where the
// caret goes when a dialog closes.
//
// Three real defects this suite was written against (2026-10-15):
//   - the helper panel's tablist had four tab stops and no arrow keys, and its
//     content was not a tabpanel at all;
//   - the export dialog let Tab walk out of a dialog that says aria-modal;
//   - the shortcuts dialog did not answer Escape, though it lists Escape as
//     "close modal" in its own table, and no dialog gave the caret back to the
//     control that opened it.

const editor = (page) => page.locator('textarea[aria-label="Note editor"]').first();

const openFreshNotebook = async (page) => {
  await page.goto('/app');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(editor(page)).toBeVisible({ timeout: 15000 });
};

/** Press Tab until the predicate matches the focused element (or give up). */
const tabTo = async (page, predicate, limit = 40) => {
  const trail = [];
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press('Tab');
    const seen = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      return {
        tag: el.tagName,
        label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40),
        testid: el.getAttribute('data-testid'),
      };
    });
    if (!seen) continue;
    trail.push(`${seen.tag} "${seen.label}"`);
    if (await predicate(seen)) return trail;
  }
  throw new Error(`never reached the target by Tab; trail: ${trail.join(' -> ')}`);
};

/** Whatever the browser says is focused, as the suite's own vocabulary. */
const focused = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return { tag: 'NONE', label: '' };
    return {
      tag: el.tagName,
      label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40),
      inDialog: Boolean(el.closest('[role="dialog"]')),
      visible: el.matches(':focus-visible'),
    };
  });

/**
 * A dialog takes the keyboard when it opens (an effect), so wait for the caret
 * to be inside it before sending keys at it. Pressing Escape the instant the
 * dialog paints can beat the listener that answers it, which is a flake, not a
 * defect.
 */
const expectKeyboardInside = (page) =>
  expect.poll(async () => (await focused(page)).inDialog, { timeout: 5000 }).toBe(true);

test.describe('Keyboard path', () => {
  test('the landing page hands the keyboard to the notebook', async ({ page }) => {
    await page.goto('/');
    await page.locator('body').click({ position: { x: 2, y: 2 } });

    // Walk the page's own tab order to the call to action — no shortcut, no
    // clicking the link: a visitor with no mouse has to be able to get there.
    await tabTo(page, (seen) => /open (the )?(app|notebook)/i.test(seen.label));

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/app$/);
    await expect(editor(page)).toBeVisible({ timeout: 15000 });
  });

  test('a note can be written and formatted without a mouse', async ({ page }) => {
    await openFreshNotebook(page);
    await page.locator('body').click({ position: { x: 2, y: 2 } });

    // The editor is reachable by Tab from the top of the app.
    await tabTo(page, (seen) => seen.tag === 'TEXTAREA');
    await page.keyboard.type('A note written with keys\n\nthe body of the note', { delay: 3 });

    // The row appears under the title the app derives from the first line.
    await expect(
      page.getByRole('button', { name: 'Open note: A note written with keys' })
    ).toBeVisible({ timeout: 10000 });

    // Ctrl+B is the app's own bold shortcut (the tooltip and the shortcuts
    // sheet both promise it), so it has to work from the keyboard alone:
    // Shift+Home selects the last line, Ctrl+B wraps it.
    await page.keyboard.press('Shift+Home');
    await page.keyboard.press('Control+b');
    await expect(editor(page)).toHaveValue(/\*\*the body of the note\*\*$/);
  });

  test('the helper panel is one tab stop and the arrow keys change the panel', async ({ page }) => {
    await openFreshNotebook(page);
    await editor(page).click();
    await page.keyboard.type('# Helper\n\n## Section\n\ntext with #tag', { delay: 3 });
    await expect(page.getByRole('button', { name: 'Open note: Helper' })).toBeVisible({
      timeout: 10000,
    });

    const toggle = page.getByLabel(/helper panel/i);
    await toggle.focus();
    await page.keyboard.press('Enter');

    const tablist = page.getByRole('tablist', { name: 'Helper views' });
    await expect(tablist).toBeVisible({ timeout: 10000 });

    const tabStops = await page.evaluate(() =>
      [...document.querySelectorAll('[role="tab"]')].map((tab) => ({
        id: tab.id,
        label: tab.getAttribute('aria-label'),
        selected: tab.getAttribute('aria-selected') === 'true',
        tabIndex: tab.getAttribute('tabindex'),
        controls: tab.getAttribute('aria-controls'),
      }))
    );
    // One tab stop, on the selected tab — not four.
    expect(tabStops.filter((tab) => tab.tabIndex === '0')).toHaveLength(1);
    expect(tabStops.find((tab) => tab.tabIndex === '0')?.selected).toBe(true);
    // The selected tab names the panel it controls, and that panel names the
    // tab back: a tablist whose tabs point at panels that are not there is a
    // dangling reference, and this one only ever has one panel mounted.
    const selected = tabStops.find((tab) => tab.selected);
    expect(selected?.controls).toBeTruthy();
    expect(
      await page.getByRole('tabpanel').getAttribute('aria-labelledby')
    ).toBe(selected?.id);

    // The tabs are Thread, History, Tags, Agent — Contents was cut, and its
    // heading jump lives in the command palette now. The thread leads because
    // talking to the agent is the thing a person does while writing.
    await page.getByRole('tab', { name: 'History' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Tags & References' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect((await focused(page)).label).toBe('Tags & References');

    await page.keyboard.press('End');
    await expect(page.getByRole('tab', { name: 'Agent' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await page.keyboard.press('Home');
    await expect(page.getByRole('tab', { name: 'Thread' })).toHaveAttribute(
      'aria-selected',
      'true'
    );

    // The panel that is showing is the one the selected tab points at.
    await expect(page.getByRole('tabpanel', { name: 'Thread' })).toBeVisible();
  });

  test('the export dialog keeps Tab inside itself', async ({ page }) => {
    await openFreshNotebook(page);
    const trigger = page.getByRole('button', { name: 'Export note' });
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Export note' })).toBeVisible();
    await expectKeyboardInside(page);

    const escaped = [];
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab');
      const where = await focused(page);
      if (!where.inDialog) escaped.push(`${where.tag} "${where.label}"`);
    }
    expect(escaped, `focus left the dialog: ${escaped.join(', ')}`).toEqual([]);
  });

  test('Escape closes every dialog and the keyboard goes back to its opener', async ({ page }) => {
    await openFreshNotebook(page);

    // Each entry: open the surface with the keyboard, close it with Escape,
    // and land back on the control that opened it.
    const surfaces = [
      {
        name: 'Export note',
        open: async () => {
          await page.getByRole('button', { name: 'Export note' }).focus();
          await page.keyboard.press('Enter');
          await expect(page.getByRole('dialog', { name: 'Export note' })).toBeVisible();
        },
        opener: 'Export note',
      },
      {
        name: 'Keyboard shortcuts',
        open: async () => {
          await page.locator('body').click({ position: { x: 2, y: 2 } });
          await page.keyboard.press('Control+?');
          await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible({
            timeout: 5000,
          });
        },
        opener: null,
      },
      {
        name: 'Find & Replace',
        open: async () => {
          await page.locator('body').click({ position: { x: 2, y: 2 } });
          await page.keyboard.press('Control+f');
          await expect(page.getByLabel('Find text')).toBeVisible({ timeout: 5000 });
        },
        opener: null,
      },
      {
        name: 'Command Palette',
        open: async () => {
          await page.locator('body').click({ position: { x: 2, y: 2 } });
          await page.keyboard.press('Control+k');
          await expect(page.getByPlaceholder(/type a command/i)).toBeVisible({ timeout: 5000 });
        },
        opener: null,
      },
    ];

    for (const surface of surfaces) {
      await surface.open();
      await expectKeyboardInside(page);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: surface.name })).toHaveCount(0);

      const where = await focused(page);
      expect(where.inDialog, `${surface.name} kept the caret in a dialog`).toBe(false);
      if (surface.opener) {
        expect(where.label, `${surface.name} dropped the caret instead of returning it`).toBe(
          surface.opener
        );
      }
    }

    // The palette's opener is wherever the caret was — normally the note being
    // written — so that is where it has to come back to.
    await editor(page).click();
    await page.keyboard.press('Control+k');
    await expect(page.getByPlaceholder(/type a command/i)).toBeVisible({ timeout: 5000 });
    await expectKeyboardInside(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Command Palette' })).toHaveCount(0);
    expect((await focused(page)).tag, 'the palette did not give the caret back').toBe('TEXTAREA');
  });

  test('the storage panel closes on Escape and returns the keyboard', async ({ page }) => {
    await openFreshNotebook(page);
    await page.locator('body').click({ position: { x: 2, y: 2 } });
    await page.keyboard.press('Control+k');
    const input = page.getByPlaceholder(/type a command/i);
    await expect(input).toBeVisible({ timeout: 5000 });
    await input.fill('storage');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Storage' })).toBeVisible({ timeout: 5000 });
    await expectKeyboardInside(page);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Storage' })).toHaveCount(0);
  });

  test('a focus ring is painted for the keyboard, not for the mouse', async ({ page }) => {
    // The app's focus indication is keyboard-only (focus-visible). A ring that
    // appears on a mouse click is noise; a control with no ring on Tab is a
    // keyboard user typing blind. Both halves are asserted here.
    await openFreshNotebook(page);

    const trigger = page.getByRole('button', { name: 'Export note' });
    await trigger.click();
    await expect(page.getByRole('dialog', { name: 'Export note' })).toBeVisible();
    await expectKeyboardInside(page);

    // Measured, not assumed: the ring is a box-shadow, and a click must not
    // paint one. (It did — every `focus:ring-*` utility in the app answered a
    // mouse click until 2026-10-15.)
    const ringOnClick = await trigger.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(ringOnClick, 'a mouse click painted a focus ring').toBe('none');

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Export note' })).toHaveCount(0);
    await page.keyboard.press('Tab');
    const where = await focused(page);
    expect(where.visible, `"${where.label}" has no :focus-visible ring on Tab`).toBe(true);
  });
});
