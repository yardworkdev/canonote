# Design System

**The brand canon is [BRAND.md](./BRAND.md)** — principles, colour, type, space, motion, components,
voice, and the token table. This file is the implementation record: what is actually in
`tailwind.config.js`, `index.css`, `site.css` and the shared component patterns. When the two disagree,
the code wins and this file is wrong.

## Design Direction

Ves, 2026-10-08: _"I envision very minimal and high taste design. Simple but feeling great and high
taste."_ That replaced the earlier language (gradients, glass, coloured shadows) on the same day.

The UI is built around:

- **flat surfaces** — opaque panels, one background colour per theme, no gradients, no blur
- **hairline rules** — 1px borders at low alpha instead of shadows and glass edges
- **one accent** — the theme accent ramp is for focus rings, selection and active states only
- **one type family** — Inter for UI and headings; the editor is monospace because it shows markdown
  source
- **calm motion** — ~140ms opacity/colour changes; no scale-on-hover, no bounce, no float, no shimmer
- **two themes, and only two** — midnight (achromatic) and sepia (espresso paper, ember accent).
  Aurora was cut on 2026-11-18: all three ramps looked the same, so the switch felt broken

### What was removed and why (2026-10-08)

| Removed                                                                                     | Reason                                                                      |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `.bg-animated-gradient`, `.bg-animated-gradient-dark` animation                             | the moving background was the loudest thing on screen and said nothing      |
| `gradient-primary`, `gradient-ai`, `gradient-success`, `gradient-warning`, `gradient-mesh`  | no callers anywhere in `src/`, `index.html` or `app.html`                   |
| glass system (`.glass-front/middle/back`, `.glass-morphism`, noise overlay, tinted shadows) | three blur depths and a texture layer for a notebook; surfaces are flat now |
| `.border-gradient`, `.focus-ring-gradient`                                                  | no callers                                                                  |
| `shimmer`, `float`, `glow-pulse`, `bounce-in`, `animate-shimmer`                            | no callers; decorative motion                                               |
| global `button:active { scale(0.96) }` and hover-zoom on components                         | springy press on every control; motion is quieter than that now             |
| TipTap/ProseMirror CSS and `[contenteditable][data-placeholder]` rules                      | the rich-text surface is gone; a test asserts it stays gone                 |
| `Outfit` display font, coloured shadow tokens, 20px radii                                   | two families and tinted elevations on a plain-text tool                     |

Net: `index.css` 708 → 464 lines, and the same screen renders as 39 KB of PNG instead of 434 KB —
the blur and gradient layers were most of both files.

## Core Tokens

### Fonts

- UI: `Inter` (everything — headings included)
- Source: `JetBrains Mono` (the markdown editor)

Tailwind extensions:

- `font-sans` -> `Inter`
- `font-display` -> `Inter` (kept as a name for heading classes; same family)
- `font-mono` -> `JetBrains Mono`, ui-monospace, …

Both load in one Google Fonts request from `app.html` and `index.html`. Hierarchy is size, weight and
tracking — no second display face; see BRAND.md.

### Color Tokens

Defined in [tailwind.config.js](./tailwind.config.js):

- `white`: `#fefcff`
- `accent-50` to `accent-900`: teal accent scale (real hue; the slate ramp before it read as grey)
- custom neutral stops: `gray-750`, `gray-850`

Practical usage:

- `accent-*` is used for focus rings, active states, call-to-action buttons, and selected helper tabs.
- base surfaces stay neutral and low-chroma.
- AI surfaces use the shared accent system plus localized purple highlights where needed.

### Shadows

Two elevations, both quiet, defined in `tailwind.config.js`:

- `shadow-soft` — resting panels and controls
- `shadow-soft-lg` / `shadow-soft-xl` — overlays (dialogs, command palette)
- `shadow-inner-soft` — the one inset hairline where a control needs it

`shadow-accent`, `shadow-success` and `shadow-warning` still exist as names for compatibility but
resolve to the same quiet value: coloured elevation tinted whole panels and is not used any more.
The matching CSS custom properties in `index.css` were removed with the glass system.

## Background and Surface System

Each theme sets one flat background colour (`--bg-grad`, now a solid colour despite the name) and one
`--surface`. `.bg-animated-gradient` and `.bg-animated-gradient-dark` are kept as class names but
resolve to flat colours — no animation, no gradient image.

Surfaces are opaque: `bg-gray-800`, `bg-gray-900`, thin borders at low alpha. Blur, translucency and
the three glass depths are gone; `backdrop-blur-*` utilities may still appear in component classes but
there is nothing behind the panels to blur, and new work should drop them.

Every theme is dark, so there is one styling path. Tailwind's dark variant is keyed to the `dark`
class that `app.html` sets (`darkMode: ['selector', '.dark']`), which is the same hook the
hand-written `.dark …` rules use — a `dark:` utility is always on, and the light counterpart in a
`x light dark:x` pair is the branch that never renders.

## Typography Rules

### UI Text

- Base UI font is Inter.
- Buttons and controls generally use `text-sm` or `text-xs` with medium weight.
- Numeric UI uses `font-variant-numeric: tabular-nums` globally.

### Editor Content

The editor is a plain markdown textarea (`src/components/Editor.jsx`), styled with Tailwind
utilities and `font-mono` — markdown source reads better monospaced, and there is no rich-text
rendering layer to theme. The old `.editor-content` block in `index.css` (prose typography for the
removed TipTap surface, ~470 lines) was deleted on 2026-10-07; nothing referenced it, and removing
it produced a pixel-identical app.

Rendered prose typography exists only where markdown is converted to HTML: the export dialog
(`markdownToHtml`) and the landing page, which carries its own styles.

## Interaction Patterns

### Focus and Hover

- interactive controls use accent-colored focus rings
- hover states usually shift background opacity rather than changing layout
- many controls use a subtle scale animation on press/hover

### Motion

Motion is short and functional: opacity and a couple of pixels, ~140ms, ease-out.

- dialogs and floating UI fade in with a 2px rise (`zoom-in-95` is a fade now, not a zoom)
- press feedback is a colour change; there is no global scale on `:active`
- nothing loops: no shimmer, float, glow or gradient animation anywhere

Respect `prefers-reduced-motion` where the component already checks for it, and do not introduce long decorative animations.

## Reusable Component Patterns

### Buttons

Primary CTA:

- a single filled `accent-600` surface with a white label (hover `accent-700`) — the one filled
  button color in the app (`DialogContainer.jsx`, `StorageHealth.jsx`); the `gradient-primary`
  utility was deleted with the 2026-10-08 flat-surface pass
- `min-h-10` (the codebase's working minimum for a comfortable target)
- accent focus ring

Secondary / utility actions:

- neutral background or none, thin border
- accent focus ring

Danger actions:

- red foreground or border emphasis
- same radius and focus treatment as neutral actions

### Panels

Used for modals, helper panes, dropdowns, AI setup, and auth cards:

- `rounded-xl` or `rounded-2xl`
- backdrop blur
- low-contrast border
- `shadow-soft-xl` for overlays

### Tabs and segmented controls

Active state typically uses:

- accent foreground
- subtle accent background or underline
- preserved layout without size shift

### The helper panels

Contents, AI, History and Tags render through one set of states, `src/components/HelperPanel.jsx`:

- **`PanelHeader`** — the panel's own fact (`2 sections`, `0 versions saved`, the AI's message count)
  on the left, its controls on the right, on the `gray-700/50` rule the other panel chrome uses. The
  AI panel's model button sits in that left cluster, because the header is the way into the settings
  and must not require an API key to reach.
- **`PanelEmpty`** — one line of text and an optional action, centred, no illustration and no
  oversized icon (`BRAND.md` § Components).
- **`PanelLoading`** — a spinner and what is being read, in a `role="status"` so it is announced.
- **`PanelError`** — `role="alert"`, an `AlertCircle`, the sentence about what happened, the detail if
  there is one, and the step as a bordered button. The error copy names the failure class: a blocked
  store gets "Allow site data for this page, then reload.", never a retry that the browser would
  refuse (`src/services/storage-failure.js` owns the vocabulary).
- A panel that is on screen while the note is edited re-reads on
  `canonote:note-versions-changed` rather than stating a count taken once, and a refresh skips the
  loading state so the panel does not flicker on every save.
- The section headings inside a panel are `<h2>`, not `<h3>`: the page's `<h1>` is the only level
  above them, and a skipped level is a moderate axe violation (`heading-order`).

### Editor-adjacent tools

Toolbar, command palette, AI chat, history, and collaboration surfaces should visually read as part
of one workspace. Reuse the existing glass panel, border, and accent-ring patterns instead of inventing a separate subsystem.

The status row under the editor is the one place for facts — where the notes live, the save state,
the word count, and where the caret is (`Ln 3, Col 10`, counted in the units a textarea reports, so it
agrees with the selection it describes). Nothing there wears control chrome (no border, no fill, no
hover): a bordered chip in a row of buttons reads as another button, which is how the toolbar's old
"Local" chip was misread (`StorageMode`, `BRAND.md` § Components).

**The toolbar is grouped and it overflows rather than hides.** Its controls sit in six named groups —
Text formatting, Lists, Blocks, Notebook, Note actions, Panels — separated by the 1px `gray-700/50`
rule the bar already used, so the grouping is announced (`role="group"` + `aria-label`) rather than
only drawn. Every control carries a tooltip that names the shortcut it really answers to
(`Cmd/Ctrl+B`, `Markdown: - [ ]`), and the four formatting controls also set `aria-keyshortcuts`.
Controls that need text to act on are disabled while the note is empty, dimmed to `opacity-40` with
the reason in the tooltip — never restyled into a different button. When the bar cannot hold the block
controls it moves them into the **overflow menu** (`ToolbarOverflowMenu.jsx`, the `MoreHorizontal`
trigger): a 264px panel of `bg-gray-800/95`, the same radius and border as the other popups, each row
an icon, a label and a muted `gray-400` hint, closing on Escape and walking with the arrow keys. It is
anchored to its trigger but clamped to the viewport, so it never leaves the screen on a phone. A
popup that portals to `document.body` carries its own named `region`, or its content would sit in no
landmark at all.

Facts that need numbers and actions get a panel instead of a longer row: **Storage**
(`StorageHealth.jsx`) states where the notes live, how much space they take and when the last backup
was, and carries the three controls that belong with those numbers — back up now, export everything,
restore the latest backup. It is reached from the command palette (`Storage health`), not from the
status row: the row states, the panel acts.

The panel is also where the notebook is put on **a folder the user picks**, and that is a control with
a cost, so it lives below a hairline rule at the foot of the panel: one line saying what the folder
option is, one secondary button (`Use a folder for your notes`, or `Reconnect “<folder>”` when the
browser has forgotten a folder the notebook remembers, or `Back to this browser` when it is on one),
and — while it is on a folder — one muted line stating that leaving moves nothing. The panel never
carries the same control twice: the folder section shows exactly one of those two states. Status stays
in the row under the editor, which reads `Stored in “<folder>”` on a folder and `Stored in this browser`
otherwise, and the browser's own permission prompt is only ever raised from the button's click.

### Agent activity

The second panel of the same shape as Storage (`AgentActivity.jsx`), reached the same way (command
palette → `Agent activity`): a dialog with one `<h2>`, the shared close control, and the three states
every panel here wears — `PanelLoading` while the read is in flight, `PanelEmpty` for the fact that
there is nothing to read from, `PanelError` with a retry for a read that failed. One event is one
`<li>`: the sentence (verb + note title, 14/400), `by <actor>` in muted `gray-400`, and the relative
time right-aligned as a `<time>` carrying the ISO value. The list is hairline-separated
(`gray-700/50`), never boxed, and a truncated note title keeps the row one line.

- **The empty state is not the error state**, and the panel shows the difference in the shape of the
  surface as well as the words: `PanelEmpty` for "no account connected, so there is no trail to read",
  `PanelError` (with the retry) only when a read actually failed.
- **The actor is named, not guessed.** A user session reads as `you`; an agent event carries its own id.
  A build that does not know an action shows it as it was recorded rather than inventing a verb.
- With events on screen the panel states the rule once at the foot (`Every note an agent creates or
  edits through the API is recorded here, newest first.`, or `Showing the newest N events.` when the
  server has more) instead of repeating it per row; the empty and error states carry only their own
  sentence.

### The note list

- **A row states, in one column:** the title (14/500, two-line clamp — a longer title keeps its full
  text on hover), the note's second line as one muted `gray-400` line (`previewFromMarkdown`, derived
  from the same store read the load already performs, and written with the title on every save), and
  the recency. A search hit replaces the second line rather than stacking under it.
- **Row actions appear on hover and on focus** (pin, delete) as 28px ghost icon buttons; the row
  itself is a real `<button>` and the actions are siblings, because a button inside a button is
  unreachable by keyboard.
- **Selection is a mode, not a per-row control.** _Select notes_ in the list header turns it on: the
  header becomes the count (`aria-live`) plus a cancel control, a second quiet row carries _Select
  all_ / _Clear_ and _Delete_, and each row shows a checkbox **mark** (`accent-600` fill, `accent-500`
  border) while the row button carries `aria-pressed` and toggles selection instead of opening the
  note. The mark is drawn `aria-hidden`: the row must stay one interactive element. Escape leaves the
  mode. The selected row is marked the same way the active one is — a 2px `accent-400` rule at its
  left edge — plus the accent fill in the mark.
- The selection's controls sit on their own row on purpose: a count and three controls do not fit the
  header's width at the sidebar's 208px, and a cluster that overflows the sidebar is worse than one
  more quiet row (measured before and after; `tests/note-list.spec.js` covers the flow).

## Accessibility Expectations

- Text/background contrast is at least 4.5:1 for body text and 3:1 for large text and icons,
  measured, not asserted. Muted text is `gray-400` on the app surfaces; `gray-500` is for icons,
  borders and disabled controls only.
- Visible keyboard focus on every interactive control (`tests/a11y.spec.js` tabs through the
  notebook and fails on a focused element without an outline or ring).
- Focus indication is keyboard-only: every ring, outline and focus border uses `focus-visible:`, so a
  mouse click does not paint one (`tests/keyboard.spec.js` measures the computed ring after a click
  and asserts `:focus-visible` after Tab).
- **Every dialog keeps the keyboard to itself.** `useFocusTrap` is the one implementation of the
  contract: Tab and Shift+Tab cycle the dialog's own controls, Escape closes it from the document
  (a click inside can leave focus outside the container), focus moves in when it opens, and it goes
  back to the control that opened it when it closes. A `role="dialog"` with `aria-modal="true"` that
  lets Tab walk out behind it is a lie to a screen reader; a dialog that closes onto `<body>` makes
  the keyboard start over from the top of the page.
- **A tablist is one tab stop.** `role="tab"` carries a roving `tabindex` (0 on the selected tab,
  -1 on the rest), the arrow keys move between tabs, Home and End go to the ends, and the panel is a
  `role="tabpanel"` named by the tab that is showing. Only the selected tab names a panel
  (`aria-controls`) — the other panels are not in the DOM, and an IDREF to nothing is a dangling
  reference.
- `tests/a11y.spec.js` runs axe over the marketing page and every notebook surface — empty, with a
  note, no results, the note list in selection mode, helper panel, AI settings, storage panel, export,
  find & replace, command palette, keyboard shortcuts — and fails on any violation. It runs with the
  rest of the Playwright suite.
- Do not encode state with color alone.
- Keep touch targets comfortably clickable; the codebase already trends toward `min-h-[44px]` on primary controls.
- Do not nest an interactive control inside another (the note row is a button; its pin and delete
  controls are siblings). A visually hidden control that a visible button triggers is out of the tab
  order (`tabIndex={-1}`), never a focus stop with no ring.

## What To Avoid

Do not reintroduce design guidance that is not implemented. In particular:

- no new token scales unless they land in `tailwind.config.js`
- no alternate font systems unless the app actually ships them
- no feature-specific design rules that contradict current shared surfaces
- no documentation of removed public share-token collaboration flows

## Source Of Truth

When this file drifts, prefer the code:

- [tailwind.config.js](./tailwind.config.js)
- [index.css](./index.css)
- [site.css](./site.css) — the marketing page's stylesheet, holding the same token values
- [src/components/Auth.jsx](./src/components/Auth.jsx)
- [src/App.jsx](./src/App.jsx)

---

Last updated: 2026-10-12 (status row: facts, not controls)
