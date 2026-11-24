# The interruption — canonote's visual direction

Written 2026-11-08, after four rejected directions and after reading five published taxonomies of
AI-generated design (see `DESIGN-RULES.md` v2 for the sources and the failures they name).

## The idea, in one sentence

**The page is a document, and a proposal is an event in it:** when Claude has something to say the
surface itself changes — edge to edge, full bleed — the note continues underneath, and the decision
sits in its own column at the far edge; accept, and the band closes and the new sentence rejoins the
document in the document's own voice.

That is the whole design. Everything on the page either is the note or is the decision about the note.

## Why this and not the other four

The four rejected directions were costumes. They are, precisely:

| Rejected | Named tell |
|---|---|
| Ink blue + Newsreader + amber | 08 serif where sans belongs · 35 editorial dashboard |
| Broadside | 11 full-sentence display headline · 95 broadsheet cosplay |
| Wax proof | 03 warm cozy palette · 09 decorative strikes · 35 again |
| Console / plate / workbench | 34 the tasteful terminal · 94 acid accent on near-black · 104 monospace as costume |

Each was a style worn to look unlike the previous style. None named the decision it was refusing.
The rule under all 35 tells is that **slop is the absence of a decision**, so every element here
traces to a product fact:

| Product fact | What it forces |
|---|---|
| Two authors, one file | the band: the surface changes, because the author changed |
| The document is the product | one reading column, no sidebar, no toolbar, no cards |
| A decision is an object with a state | the decision column, and a log that outlives the decision |
| Plain text is a promise | the file's format, size and location are stated at the foot of the page |

## The two faces, and why these two

- **Golos Text** — drawn at Paratype for continuous reading on screen: large x-height, open
  apertures, low stroke contrast. The note is read at length, so the note gets a text face, not a
  display face. Not a model default: it is absent from every "safe font" list in the taxonomies.
- **Public Sans** — built for the US Web Design System, tested at small sizes in public services and
  forms. The interface should be legible under stress and quiet everywhere else; it never raises its
  voice, because the only thing allowed to raise its voice is the proposal.

Both are OFL 1.1, self-hosted as single variable files (`docs/design/direction/fonts/`), 38 KB and
27 KB, one `@font-face` each.

## What it refuses, by name

- 01 / 02 / 06 — no gradient, anywhere, for any reason.
- 03 / 35 — no cream paper, no display serif, no magazine costume.
- 04 / 05 / 94 — no accent colour at all. State is carried by surface, weight and position, so the
  page survives greyscale entirely and cannot become "one bright accent on near-black".
- 10 / 28 — no kicker above a heading, no all-caps labels, no card grid.
- 17 — no coloured left rule: the proposal is not a stripe, it is a surface change.
- 19 / 20 / 21 — no radius above 2px (there is none at all), no shadow, no translucent panes.
- 29 — the numbers on the page are the note's real ones (1.2 KB, 14:52); nothing is invented.
- 31 — one surface per region; nothing is nested.
- 32 — spacing is by relationship: 19px inside a paragraph group, 24px around the band, 44px before
  the record.
- 33 / 118 — neither face is Inter, Geist, Space Grotesk or the next name on that list.

## States

- `proposal.png` — the pending state: struck old line, 26px proposed line, decision column at the edge.
- `accepted.png` — the accepted state: the band is gone, the sentence is ordinary body text, and the
  log has one more line. The page keeps its own record; nothing else about it changes.

## The audit, not the opinion

`scripts/audit-design.mjs` checks a rendered page against the rules, because the failure mode is
invisible to the model that produced it. Run on both states:

```
PASS  no radius over 2px             []
PASS  no gradients                   []
PASS  no shadows                     []
PASS  no coloured left rule          []
PASS  no uppercase runs              []
PASS  nothing centred                "0 / 2"
PASS  contrast ≥ 4.5 everywhere      []
PASS  document ≥ 33% of width        0.367
PASS  faces loaded                   ["Golos Text 400 700","Public Sans 400 700"]
PASS  no failed requests             []

families : Public Sans | Golos Text
colours  : 6 values, each a named token
clean
```

Two families, six colours, no radius, no shadow, no gradient, every text pair at 4.5:1 or better.

## What it would take to build

Three surfaces change, none of them structural:

1. `src/components/Editor.jsx` — the reading column: 33rem, Golos 19/1.62, title 40/1.12.
2. `src/components/Suggestion.jsx` — becomes the band: full-bleed section, struck line, 26px
   proposed line, decision column with its own hairline.
3. `src/index.css` — tokens: paper, ink, ink-near, ink-quiet, ink-faint, rule, band, band-text,
   band-quiet. Two `@font-face` blocks, two woff2 into `src/fonts/`.

The demo page (`public/demo/index.html`) gets the same treatment so the landing page shows the real
thing rather than a parallel design.
