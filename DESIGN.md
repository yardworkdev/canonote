# Design rules, and what the scanner flags that we keep

The UI is achromatic, left-anchored and small. `design-audit`'s scanner (`scripts/scan.mjs` in that
skill) reports code-level tells; this file records which hits were fixed and which are deliberate,
so the next run does not re-litigate them.

## What the notebook settles on

- **One radius.** `rounded-lg` for cards, modals, inputs and buttons. `rounded-full` only for
  avatars and status dots.
- **No glass.** Sheets and modals are solid; the overlay behind them dims the page and nothing blurs.
- **Colour means state.** Neutral grey carries structure. Red marks an error, amber a conflict,
  green a confirmed save. Nothing else is coloured.
- **A settled state sits still.** No infinite pulse on "Saved"; no hover that lifts an element.

## Fixed on 11 Nov 2026 (177 hits, 17 groups → 96 hits, 12 groups)

| Tell | Was | Now |
|---|---|---|
| Blue tip block in Keyboard Shortcuts | `bg-blue-900/20`, blue `<kbd>` | neutral `bg-white/[0.04]` |
| Selected history version | amber block | `bg-white/[0.06]` |
| Footer "Saved" | green, pulsing forever | still, neutral |
| Export format icons | `text-blue-500`, `text-purple-500` | `text-gray-400` |
| `rounded-xl` / `rounded-2xl` (37 uses) | three radii | `rounded-lg` |
| `backdrop-blur-*` (21 uses) | glass overlays and panels | removed |
| `hover:-translate-y-px` (13 uses) | lift on hover | removed |
| `shadow-2xl`, `shadow-soft-xl` (11 uses) | oversized elevation | `shadow-lg` |
| `transition-all` (7 uses) | animates layout for a colour change | `transition-colors` |

## Kept, and why

- **Red error boxes, red destructive buttons.** A real state, not decoration.
- **11px uppercase section labels.** The notebook's own idiom for a sidebar group; the headings are
  short and the labels are not repeated.
- **`<s>` and `<u>` in the markdown renderer.** These are user-typed syntax, not styling.
- **Monospace on keys and payloads.** A keycap and a token are code.
- **`bg-black/10` overlays.** The scanner reads a dim overlay as glass; there is no blur on them.
- **`text-lg` modal headings.** One heading per modal, no competing step below it.
- **Emoji in two tests.** Fixture strings proving the copy linter and the cursor maths handle them.

Re-run after any UI work: `node <design-audit>/scripts/scan.mjs src`. A hit is a question, not a
verdict; anything kept goes in the table above with the reason.
