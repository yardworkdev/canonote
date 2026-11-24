// @ts-check
import { test, expect } from '@playwright/test';

// Performance budget for the notebook, the runtime half of the release gate
// (the bundle-size half is `npm run check:bundle`; both are described in
// PERFORMANCE.md and both run locally, inside `npm test` and after the build).
//
// The promise of the product is a calm notebook, and a notebook that takes
// seconds to open or stutters while you type is not calm. The budgets are
// deliberately loose — this is a regression tripwire, not a benchmark: pulling
// a heavy dependency into the editor or re-parsing the whole note on every
// keystroke fails here, a few milliseconds of machine noise does not.

const editor = (page) => page.locator('textarea[aria-label="Note editor"]').first();

const EDITOR_OPEN_BUDGET_MS = 5000;
const KEYSTROKE_BUDGET_MS = 250;

test.beforeEach(async ({ page }) => {
  // Transitions and animations are disabled so a measurement never lands in the
  // middle of a fade.
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test.describe('Performance budget', () => {
  test('a cold load reaches the editor inside the budget', async ({ page }) => {
    const started = Date.now();
    await page.goto('/app');
    await expect(editor(page)).toBeVisible({ timeout: 15000 });
    const openMs = Date.now() - started;

    expect(
      openMs,
      `editor was usable after ${openMs} ms (budget ${EDITOR_OPEN_BUDGET_MS} ms)`
    ).toBeLessThan(EDITOR_OPEN_BUDGET_MS);
  });

  test('a keystroke lands inside the budget, including in a large note', async ({ page }) => {
    await page.goto('/app');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(editor(page)).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2500);

    await editor(page).click();

    // A note big enough that a per-keystroke full re-parse would show up as latency.
    const body = Array.from({ length: 1200 }, (_, i) => `line ${i} — ${'x'.repeat(48)}`).join('\n');
    await editor(page).fill(`# Large note\n\n${body}\n`);
    await page.waitForTimeout(2500);

    // Characters that do not occur in the note (its alphabet is `line N — x`),
    // so "did the keystroke land?" is an unambiguous question.
    const chars = ['q', 'z', 'j', 'k', 'v', 'b', 'p', 'y', 'g', 'w'];
    const latencies = [];
    for (const char of chars) {
      const started = Date.now();
      await page.keyboard.type(char);
      // The wait is a "did it land at all" guard, not the budget: the budget is
      // the median below. It has to be wide enough that a loaded machine is not
      // a failure on its own — filling a 72 KB note blocks the main thread for
      // ~2.6 s before this loop even starts (measured on both sides of the
      // IndexedDB swap), and a keystroke that never lands at all is what this
      // catches.
      await page.waitForFunction(
        (c) => document.querySelector('textarea[aria-label="Note editor"]')?.value.includes(c),
        char,
        { timeout: 15000 }
      );
      latencies.push(Date.now() - started);
    }

    const sorted = [...latencies].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    expect(
      median,
      `median keystroke→DOM was ${median} ms of [${latencies.join(', ')}] (budget ${KEYSTROKE_BUDGET_MS} ms)`
    ).toBeLessThan(KEYSTROKE_BUDGET_MS);
  });
});
