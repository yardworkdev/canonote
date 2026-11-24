# Brand & Style Guide

The single style source for both surfaces: the notebook (`app.html` → `/app`) and the public front end
(`index.html` → `/`). Where this document and the code disagree, the code wins and this document is
wrong — fix it in the same commit.

Product name: **canonote** (renamed from Notes Editor on 2026-11-07).

One line: **a calm, local-first markdown notebook your agent can write into.** Agent edits arrive as
reviewable suggestions, not silent writes.

## Principles

1. **Content first.** Every pixel that is not text, space or a hairline rule must earn its place.
2. **Quiet by default.** Flat surfaces, no gradients, no blur, no textures, no glow.
3. **One accent.** The accent marks focus, selection and active state. It is never decoration.
4. **Motion is a hint, not a show.** Colour and opacity, ~140ms. Nothing loops.
5. **Say the truth plainly.** Messages name what happened and the next step. No hype, no vagueness.

## Colour

Themes change the ramps, not the rules. Values are CSS custom properties in `index.css` (app) and
`site.css` (front end), mirrored as Tailwind tokens in `tailwind.config.js`. **The front end uses the
midnight palette exactly** — one identity, not a shopfront with its own colours.

| Token (`index.css`) | Midnight | Sepia | Use |
| --- | --- | --- | --- |
| `--bg-grad` | `#121212` | `#14100d` | page background, one flat colour |
| `--surface` | `38 38 38` | `52 44 37` | raised panels, sidebar, toolbar |
| `--editor-text` | `228 228 228` | `236 227 214` | the note itself |
| `--gray-200` (body) | `228 228 228` | `230 219 203` | body text — 15.3:1 / 13.8:1 on the page |
| `--gray-400` (muted) | `159 159 159` | `186 171 150` | secondary and metadata — 7.3:1 / 7.6:1 |
| `--gray-500` (faint) | `115 115 115` | `152 136 116` | placeholders and quiet labels — 4.1:1 / 4.9:1 |
| accent ramp | **no hue** — the accent is the lightest grey (`--accent-*`, 50 → 900) | ember `230 150 54` at `--accent-600` | focus, selection, active state, the one filled button |
| `--agent-bg` / `--agent-rule` | `58 58 58` / `226 226 226` | `34 40 52` / `122 162 214` | anything an agent wrote: a raised panel with a rule down its left edge |

Numbers in the contrast column are measured against `--gray-950`, not eyeballed. There are two
themes because a third, aurora, was a grey ramp close enough to the other two that switching to it
looked like nothing happened; it was cut on 2026-11-18 rather than restyled.

Rules:

- **Why no colour at all.** Ink blue lasted one day: "the blue accent is just terrible… just keep it
  grey" (Ves, 2026-11-08). The page and the app are now achromatic. Hierarchy comes from the grey ramp,
  from weight and from space; the single filled control is near-white, and the only warm colour left
  anywhere belongs to an agent's text, where it still means "not yours yet".
- **Why blue was a mistake, and why two colours.** Warm metal as the *interface* accent read as decorative
  (Ves, 2026-10-08) and a near-grey ramp left no colour at all (2026-10-09); teal then read as
  "green, doesn't fit the design" (Ves, 2026-11-08). Ink blue is the interface accent now, and it
  frees warm amber for the one meaning that matters: **an agent wrote this**. Human edits are ink,
  agent edits are warm — the colour does the labelling with no legend required.
- **The agent colour is not decoration.** It may only mark agent-authored content and agent
  presence. If amber appears on a button the human pressed, the grammar has broken.
- The ink neutrals are warm-leaning and lifted off pure black (`#121316`, not `#000`): hairline rules
  and panels read, and large dark areas stop looking like a void.
- Accent fills only primary buttons and active states. Body text is never accent-coloured.
- **Semantic colours** (emerald = fine, amber = watch out, red = wrong) may only colour an icon or a
  mark **next to words** — never a whole panel, never the only signal. State must survive greyscale.
- Contrast floor: 4.5:1 for body text, 3:1 for large text and icons. Measured: app editor 12.7:1, note
  titles 14.4:1, toolbar icons 6.1:1; front end hero 14.6:1, lede 7.0:1, card body 6.4:1, table 5.6:1.
  Muted text is the `gray-400` token (5.8:1 on the app surfaces); `gray-500` measures 3.2:1 there, so
  it stays for icons, borders and disabled controls. `tests/a11y.spec.js` enforces the floor with axe
  on every surface, so a regression fails the build instead of waiting to be noticed.

## Typography

Three roles, one of them new on purpose:

- **Inter** — the whole interface: headings, note titles, buttons, labels, tables, metadata. Hierarchy
  comes from size, weight and tracking, not from a second face.
- **System serif** (`font-note`) — the note itself. A note is a page you read, not a buffer you
  inspect: serif at 17px/1.85 on a 44rem measure. Nothing is downloaded; the stack is Iowan,
  Palatino, Georgia, Cambria. Chosen 2026-11-08 so the product stops reading like a developer tool.
- **JetBrains Mono** — code the user actually typed, file previews, and the on-disk view in the demo.

Rules:

- No serif in the interface or in headings. A serif *headline* still reads as borrowed (Ves,
  2026-10-08); the serif is for note body text only, where it earns its place by being readable.
- No italic in product copy. Italic is for quoted text and for an agent's proposed wording, which is
  the one place it carries meaning rather than decoration.
- Loading: one Google Fonts request (Inter 400/500/600, JetBrains Mono 400/500).

| Role | Family | Size / line-height | Weight | Tracking |
| --- | --- | --- | --- | --- |
| Hero (front end) | Inter | 36–52 / 1.08 | 600 | -0.03em |
| Page title | Inter | 24 / 1.3 | 600 | -0.02em |
| Section title | Inter | 22–26 / 1.25 | 600 | -0.02em |
| Card title | Inter | 17 / 1.4 | 600 | -0.01em |
| Note title (list) | Inter | 14 / 1.35 | 500 | -0.01em |
| Body | Inter | 16 / 1.65 | 400 | normal |
| UI text | Inter | 14 / 1.5 | 400–500 | normal |
| Small / metadata | Inter | 13 / 1.5 | 400 | normal |
| Label (eyebrow) | Mono | 11–12 / 1.4, uppercase | 500 | 0.1em |
| Markdown source | Mono | 15 / 1.75 | 400 | normal |

Measure: body text 62–75 characters. The editor keeps a comfortable line length; prose never runs the
full width of a large screen.

## Space, shape, elevation

- **Space scale (px):** 4, 8, 12, 16, 24, 32, 48, 64, 96. Nothing between those steps.
- **Page rhythm:** 96px between marketing sections, 32px inside a card, 24px between cards.
- **Radii:** 6px controls (`rounded-md`–`lg`), 8px panels (`rounded-lg`–`xl`), 10px overlays. No pills
  except status chips.
- **Borders:** 1px, `--border`. Use a border before reaching for a shadow.
- **Elevation:** exactly two steps — resting (`0 1px 2px rgb(0 0 0 / 0.04)`) and overlay
  (`0 8px 24px rgb(0 0 0 / 0.10)`). No coloured or tinted shadows.

## Motion

- 140ms, `cubic-bezier(0.2, 0, 0, 1)`; animate opacity, colour, and at most a 2px transform.
- No scale on hover, no bounce, no float, no shimmer, no glow, no looping animation.
- Overlays fade in with a 2px rise. Nothing moves the layout.
- `prefers-reduced-motion: reduce` removes all of it.

## Components

- **Primary button** — accent fill, `--border`-size radius, 500 weight, hover = one step lighter
  accent, focus = 1px accent ring, disabled = 40% opacity and no hover.
- **Secondary button** — transparent, 1px `--border`, text at `text` colour, hover raises the border to
  `--border-strong`. On no account a second filled colour next to the primary.
- **Ghost button** — icon or text only; hover tints the background, never scales.
- **Input / textarea** — surface background, hairline border, accent ring on focus-visible, no inner
  shadow, no glow.
- **Card / panel** — surface background, hairline border, 8px radius, no shadow.
- **Table** — hairline row rules; header row in `label` style; no zebra striping.
- **Notice (toast / inline)** — icon + one sentence + optional action. Four kinds: success, info,
  warning, error. Plain language, no "Oops", no exclamation marks, no blame. The words are not written
  at the call site: every notice lives in `src/services/notices.js`, keyed, with its tone, and the
  tone standard (at most two sentences — the fact then the step — no hype, no apology, numbers where
  the app knows them, a next step that can help on every error, 140 characters at most) is enforced
  over the whole catalog by `src/services/notices.test.js`. Add a message there, not in a component.
- **Empty state** — one line of text and one action. No illustration, no oversized icon.
- **Helper panel** — a panel beside the editor (Contents, AI, History, Tags) wears one header (the
  panel's own fact on the left, its controls on the right), one empty, one loading and one error, all
  from `src/components/HelperPanel.jsx`. A panel that cannot read what it is showing says so, with
  the step that helps, rather than showing an empty state — and a count in a header has to stay true
  while the panel is on screen, so it is re-read when the save pipeline records something.
- **Chip / badge** — 12px label, hairline border, surface fill. A status chip must not look like a
  button (this was a real complaint: the "Local" chip read as clickable).
- **Note row** — title (14/500), the note's second line as one muted line under it, then the recency;
  pin and delete appear on hover and on focus. Selection is a *mode*: the row then shows a checkbox
  mark and toggles selection instead of opening the note. The accent marks the selected row (2px rule
  at its left edge, accent-600 fill in the mark) — never a second control inside the row, because a
  checkbox nested in the row button is unreachable by keyboard.
- **Status is not a chip.** Where the notes live, the save state and the count of the open note are
  facts about the notebook, so they are stated plainly in the status row at the foot of the editor —
  plain muted text, no border, no fill, no hover, nothing to click. A bordered box sitting among real
  buttons is read as a seventh button, which is exactly why the old toolbar "Local" chip had to go
  rather than be restyled. A bordered cluster is for a control (a signed-in account and its sign-out
  button), never for a fact.
- **The fact has to be true.** When the browser refuses to store anything — site data blocked, private
  browsing, a full quota — the status row says that instead of "Stored in this browser", and the
  failure message names the cause with the step that resolves it. A row that claims storage while every
  write is refused is the same defect as a chip that looks clickable: the app telling the user
  something that is not so.

## Voice

- Sentence case for headings, buttons and labels.
- Concrete over clever: "Notes are stored in this browser only" beats "You're all set".
- Errors say what happened, why, and the next step. If the cause is unknown, say that.
- Numbers instead of adjectives ("50 versions per note", not "lots of history").
- No exclamation marks, no emoji in product copy (the marketing page may use a bullet, not a party).
- The rules above are the copy standard, and they hold for every string a reader sees, not only for
  notices. The messages an event raises live in `src/services/notices.js` (keyed, with their tone);
  everything else — a heading, an empty state, a help line, a confirmation — is written where it is
  shown and is held to the same rules by the copy audit (`src/services/copy-audit.js`, with
  `src/services/copy-audit.test.js` running it over the whole source): no exclamation mark, no emoji,
  no blame or apology, and no failure that states no fact where the app is holding one.
  `node scripts/audit-copy.mjs` prints the inventory and the violations; `--all` prints every string.
- A failure states the fact and the step that can clear it. "Please retry" is allowed only where a
  retry can help; advice that cannot be followed is a defect, not a courtesy — "clear your browser
  data" in a local-first notebook points at where the notes live, and "contact support" at a support
  line that does not exist.

## Applying it

- **App:** styles come from `tailwind.config.js` tokens + `index.css`. Components use token classes;
  no component defines its own hex value, radius or shadow.
- **Front end:** `site.css`, importing the same token values. It must not import the app's stylesheet
  (the app's Tailwind build is for the app), so the token block is duplicated — and any change must
  land in both files in the same commit, listed in the table above.
- **New surface checklist:** uses the type scale, uses the space scale, hairline over shadow, no new
  colour, motion ≤140ms, focus-visible present, message in plain language.
- **Focus indication is for the keyboard.** Every ring, outline and focus border is written with the
  `focus-visible:` variant, never `focus:` — a ring that answers a mouse click is noise, and the
  pointer already says where the click went.

## Do not

- Gradients (backgrounds, text, buttons, borders), glassmorphism, backdrop blur, noise textures.
- Hover lift or zoom, looping animation, parallax, or anything that moves without being asked.
- More than one accent colour on a screen; more than one filled button per view.
- Pill-shaped primary buttons, 16px+ radii on panels, 20px+ shadows.
- Colour as the only carrier of meaning.
- A focus ring that answers the mouse: `focus:` on a ring, outline or focus border.
- Loading a font family the product does not use.
