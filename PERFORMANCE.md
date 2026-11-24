# Performance budget

The product promises a **calm** notebook. A notebook that takes seconds to open, or stutters while
you type, breaks that promise more thoroughly than a missing feature does — and it happens by
accident, one dependency at a time. So the promise is a number, and the number is enforced:

| Gate                         | Command                                              | Where                 |
| ---------------------------- | ---------------------------------------------------- | --------------------- |
| Bundle size                  | `npm run check:bundle` (needs `npm run build` first) | right after the build |
| Editor open + typing latency | `npx playwright test tests/performance.spec.js`      | inside `npm test`     |

Both are **regression tripwires, not benchmarks**. An accidental heavy import, an eager dependency,
or a per-keystroke re-parse of the whole note fails the run; a few milliseconds of machine noise
does not.

## Budgets and the values they were set from

Measured on this machine. Bundle sizes come from the production build at HEAD (2026-11-09); the
runtime figures are from 2026-10-14 (chromium, Vite dev server). The dev server serves unbundled
modules, so the runtime numbers below are an upper bound on what a visitor meets.

| Metric                                               | Budget      | Measured                    |
| ---------------------------------------------------- | ----------- | --------------------------- |
| `/app` first load (html + entry JS + preloads + css) | 190 kB gzip | 152.9 kB                    |
| `/demo` first load (static, no account)              | 20 kB gzip  | 2.9 kB                      |
| `/` first load (html + site.css — no JS bundle)      | 25 kB gzip  | 4.5 kB                      |
| Largest single JS chunk                              | 110 kB gzip | 93.2 kB                     |
| All JS + CSS in `dist/`                              | 260 kB gzip | 234.5 kB                    |
| Editor usable after a cold load                      | 5000 ms     | ~2500 ms                    |
| Median keystroke → DOM in a ~60 KB note              | 250 ms      | 32 ms (worst of 10: 119 ms) |

Budget headroom is roughly 2–3×. It is set that wide on purpose: a tighter number turns a busy
machine into a flaky suite, and a flaky suite gets muted, which is worse than no suite.

One number is measured but not budgeted, because it is a known cost rather than a regression
tripwire: **filling (pasting) a 72 KB note blocks the main thread for ~2.6 s** — one long task,
measured identically before and after the IndexedDB swap (2.64 s on the previous store, 2.58 s on
IndexedDB), so it is the markdown pipeline, not the store. Typing *after* the paste is unaffected
(median 32 ms on IndexedDB, 36 ms before it). A future slice can move the parse off the keystroke
path; the budget table above stays the release gate.

## How the checks work

- `scripts/check-bundle-size.mjs` reads the built HTML and sums the gzip size of every asset the
  browser fetches before the app renders (`<script src>`, `rel="modulepreload"`,
  `rel="stylesheet"`). Because the entries come from the HTML, the budget tracks the real first load
  of each surface and cannot go stale when a chunk is renamed. Gzip is the unit because that is what
  a visitor actually downloads; binary assets are excluded from the total because their size cannot
  regress from a dependency.
- `tests/performance.spec.js` measures the two things a person feels: how long a cold load takes to
  reach a usable editor, and how long a keystroke takes to appear — in a note large enough
  (~60 KB) that a synchronous re-parse on every keystroke would show up.

## Changing a budget

A budget moves for one of two reasons, and both are written down in the pull request:

1. **The product got heavier on purpose** — raise the number in the same commit as the feature and
   say why in `CHANGELOG.md`.
2. **The budget was set wrong** — it fails or nearly fails on an idle machine, so it is measuring
   the runner rather than the app. Fix the number, not the app.

Lowering a budget to make a build pass is the one move this exists to prevent. If a change cannot
fit the current budget, the change is what gives, not the budget.

## Deliberately not measured

- **Idle/steady-state memory.** No stable ceiling on this stack, and a noisy number is worse than an
  absent one.
- **Real-network first paint.** A local dev server cannot model a user's connection; the bundle-size
  budget is the proxy for what crosses the wire.
- **Large-note size limits.** That is covered as an edge case in `tests/edge-cases.spec.js` (a
  ~60 KB note must survive a reload) rather than as a latency budget.
