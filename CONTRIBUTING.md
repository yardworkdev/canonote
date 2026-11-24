# Contributing

Thanks for taking a look. canonote is a small, deliberately quiet app — the contribution rules are
short for the same reason the product is.

## Ground rules

- **Delete rather than shim.** If something is dead, remove it. Do not leave a wrapper, a flag or a
  compatibility layer behind.
- **No new dependency for a feature.** The dependency list is part of the product. A new package
  needs a reason that survives "could this be twenty lines instead?".
- **Docs must match code, in the same commit.** A document that describes code which no longer
  exists is a bug. If you change behaviour, change the doc that claims the old behaviour.
- **One representation.** Markdown is the only format stored and the only thing the editor shows.
  Do not add an HTML copy of a note or a conversion step.
- **Cut, don't add.** If a feature cannot be explained in one sentence, it probably does not belong.

## Getting set up

```bash
git clone https://github.com/vesivanov/canonote.git
cd canonote
npm install
npm run dev
```

Node `22.x` (see `.nvmrc`). The front end is at `http://localhost:5173`, the notebook at
`http://localhost:5173/app`. No environment variables are needed for local work.

## Before you open a pull request

Run all seven gates and report the real counts — not an estimate:

```bash
npm run test:unit       # Vitest, src/** only
npm run test:coverage   # same suite, with the coverage floors enforced
npm test                # Playwright end-to-end (includes the performance budget)
npm run build
npm run check:bundle    # bundle-size budget over dist/ (run build first)
npm run check:portable  # the credential-reading scripts still run from a clone
npm run lint
```

- `npm run test:coverage` fails when a covered layer drops below its floor (the floors live in
  `vitest.config.js`). Raise a floor when your change raises the number; never lower one to make a
  build pass.
- `npm run check:bundle` fails when the first load of either surface, the largest JS chunk, or the
  total JS + CSS in `dist/` exceeds its budget ([PERFORMANCE.md](./PERFORMANCE.md) lists the numbers
  and when a budget may move). `tests/performance.spec.js`, which `npm test` runs, is the runtime
  half of the same gate: editor-open time and keystroke latency in a large note.
- `npm run lint` is clean of **errors** but carries pre-existing **warnings** (unused vars, stray
  `console`). Attribute any warning to a file before claiming your change added none.
- Remove scratch scripts before running `npm run lint` — they add `no-undef` errors the baseline
  does not have.
- The `api/_lib` handlers are covered by the unit tests under `src/api/*.test.js` against a mocked
  database client. What has no automated coverage is the live hosted path against a real backend —
  if you touch it, exercise it by hand and say so in the PR.
- Verify UI behaviour in a real browser, not by reading the code. If a change touches styling,
  clear the stale Vite cache first (kill any old dev server on `5173`, delete `node_modules/.vite`,
  restart) — otherwise you are measuring a build that is not on disk.

## The checks that need credentials

The `check:*` and `live-*` scripts drive the deployed app and a real database, so they need a
service-role key and, sometimes, an agent token. Nothing is hardcoded: every one of them reads its
key through `scripts/lib/secrets.mjs`, in this order —

1. `SUPABASE_SERVICE_KEY` (the value), or `SUPABASE_SERVICE_KEY_FILE` (a path to a file holding it);
2. `.secrets/supabase-service-key` in the repository root, which is `.gitignore`d;
3. a different directory entirely, via `CANONOTE_SECRETS_DIR`.

So the shortest path is `mkdir .secrets && printf '%s' "$KEY" > .secrets/supabase-service-key`. A
missing key fails with the three places it looked, not with an `ENOENT` naming a directory you have
never had.

`npm run check:portable` proves the resolver still behaves that way and that no script has gone back
to an absolute path on the machine it was written on. Run it after touching anything in `scripts/`.

Browsers come from Playwright. Set `CHROME_BIN` only when the machine keeps Chromium somewhere else;
the scripts pass it to `chromium.launch()` and otherwise let Playwright resolve its own build.

What a clone can prove with no credential at all — measured on a fresh `git clone` followed by
`npm ci` (518 packages, 8 s): `npm run verify` (typecheck, 702 unit tests in 72 files, a build that
writes `dist/sw.js`) and `npm run lint` (0 errors) need nothing but Node; `npm run check:portable`
needs nothing; and `npm run check:live-app` — the notebook served from `dist/` on a local port and
driven as a person uses it — needs nothing either, once `npx playwright install` has run.

## Pull requests

- Keep the change to one idea. Small diffs get reviewed; large ones get argued about.
- Include a test for anything with behaviour: a unit test in `src/**` or an e2e spec in `tests/`.
  A bug fix should come with a spec that fails against the old code.
- Update `README.md`, `CHANGELOG.md` or `ROADMAP.md` in the same PR when the change makes them
  wrong. Do not leave that for a follow-up.
- Describe what you ran and what it printed. "Tests pass" is not evidence; the counts are.
- Screenshots help for anything visual — before and after.

## Commits

Conventional-commit prefixes are used in this repo (`feat:`, `fix:`, `docs:`, `style:`, `test:`,
`chore:`). One line, imperative, lowercase after the prefix. The body explains _why_ when the reason
is not obvious from the diff.

## Reporting bugs and asking for features

Use the issue templates. A bug report is far more useful with the browser, the steps, what you
expected, and what happened instead. Security issues do **not** go in the issue tracker — see
[SECURITY.md](./SECURITY.md).

## What is out of scope for now

- Accounts, hosted sync, and billing — a hosted layer exists in the repo but is not the default, and
  the storage question behind it is deliberately open (see
  [DECISIONS.md](./DECISIONS.md)). Do not build hosted-sync features speculatively.
- Rich text. Markdown is the product.

## Licence

Contributions are accepted under the MIT licence in [LICENSE](./LICENSE).
