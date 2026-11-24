# DESIGN-RULES.md — the anti-default constraints

Written 2026-11-08, after four rounds of design that Ves rejected as generic ("looks like everything
else", then "looks AI-designed"). Those rejections were correct, and the cause was mechanical, not
mysterious: I kept reaching for the same references every model reaches for. This file replaces taste
with constraints that can be checked.

## The evidence

A September 2026 study measured 409 Lovable-built apps against 423 YC startup sites
(<https://designpixil.com/blog/vibe-coded-apps-design-study>):

- **86%** of AI-built apps use shadcn/ui theme tokens, unchanged. YC: 33%.
- **59%** use Inter or the browser default stack. YC: 25%. Three fonts cover 63% of them.
- **79%** use gradient backgrounds; **39%** use purple/violet/indigo gradients.
- A third ship shadcn's default `0.5rem` corner radius.

A separate typography piece makes the same point from the other side: Inter, Geist and GT America are
excellent faces, and that is the problem — "when everyone reaches for the safe choice, nothing stands
out" (<https://www.typealoud.com/guides/why-so-many-brands-look-the-same-in-2025>).

So the generic look is not a mystery of taste. It is a specific set of defaults. Avoiding them is a
checklist, not an inspiration problem.

## The constraints

Each one is falsifiable in a screenshot. A design that breaks any of these does not ship.

1. **No corner radius above 2px.** Buttons, inputs, panels, images: square or a 2px softening. The
   8–16px rounded card is the single strongest "AI product" tell after the font.
2. **No gradients, no glassmorphism, no coloured shadows.** One flat background colour per surface.
   Warm black is a colour; a gradient is a tell.
3. **No Inter, Geist, SF, or the default stack for display type.** The interface may use one neutral
   grotesk for small labels, but the voice of the product must come from a face that was chosen, not
   inherited. Maximum two weights per family.
4. **One accent, one meaning.** The accent is named in this file and may only mark that one thing.
   If a second meaning needs emphasis, it gets a token (a rule, a background, a mark) — not a hue.
5. **No floating cards to make groups.** Structure comes from rules, alignment and space. A card with
   a shadow where a hairline would do is decoration.
6. **Density floor.** At ≥1100px the note occupies at least 60% of the viewport width. Reading apps
   that leave half the screen empty behind rounded panels are the house style of generated UIs.
7. **Everything survives greyscale.** No state may be signalled by colour alone; every state needs a
   mark, a word, or a position. This also happens to be the accessibility floor.

## The acceptance test

Before any direction is shown: screenshot it, remove all colour mentally, and ask a stranger *"does
this look like Linear, Notion, Vercel or any AI product you've seen this year?"* If the answer is yes
for any reason other than "it's a text editor", it fails.

A second test, harder and more useful: **can you name the real-world artifact this design is derived
from?** If the answer is "a modern SaaS dashboard", it is not a design, it is a default. If the answer
is a specific printed object, instrument or archive, the design has provenance and will look like
nothing else in the category.

## What this means for the next pass

No direction ships until it answers, in one sentence, which non-software artifact it is built from and
which of the seven constraints shapes it hardest. Ves's own references take precedence over any
artifact I choose.

---

# v2 — the taxonomy, and why v1 was not enough

v1 above is a list of things I dislike. On 2026-11-08 Ves said the four directions built against it
still looked AI-generated, and he was right. The difference between "I avoid these" and "I can name
the named pattern I am avoiding" is the whole game, so this section replaces the invented rules with
published ones.

## Sources, read in full on 2026-11-08

- `yetone/kill-ai-slop` — 35 tells, field guide at killaislop.com (Apache-2.0). The strongest of
the five, and the one this file works from.
- `pavithralamahewa/slop-patterns` — 534 patterns with evidence tiers (sloppatterns.com, MIT).
- `hankimis/ai-design-tells` — 27 tells, weighted "Tell Score", detector validated on 202 real sites.
- `edwingao28/vibe-check` — 18 signals scored by static analysis of CSS/Tailwind/JSX, 445 tests.
- Adrian Krebs' Show HN audit — 1,590 pages, 16 patterns: 22% heavy, 32% mild, 46% clean.

## Why the last four attempts failed

Not timidly. Each landed on a *named evolved tell*:

| Direction | The tell it is |
|---|---|
| Ink blue + Newsreader + amber agent colour | 08 serif where sans belongs; 35 editorial dashboard |
| Broadside (ultramarine, giant caps, hairlines) | 11 full-sentence display headline; 95 broadsheet cosplay |
| Wax proof (cream sheet, red stamp, tilted) | 03 warm cozy palette; 09 decorative strikes; 35 again |
| Broadcast console (near-black, mono, red) | 34 the tasteful terminal, verbatim |
| Plate / Workbench (acid green on black) | 94 acid accent on near-black; 104 monospace as costume |

kill-ai-slop names the escape hatch too — tell 118, *the second-choice font*: "told to avoid Inter,
the model picks the next font on its short list, like Space Grotesk or Geist." That is what Syne,
Anybody, Bodoni and Bricolage were. Avoiding Inter is not making a type decision.

## The rule behind all 35

From kill-ai-slop's preamble: **slop is the absence of a decision**, and a tell is only slop when it
is a default nobody chose. Every attempt above was a costume worn to look unlike the previous
costume. None named the decision it was refusing.

So the bar is not "more distinctive". It is: **every visible choice traces to a product fact, and I
can write down which tell it refuses and why.** If that sentence cannot be written, the choice is
decoration and does not ship.

## What canonote's own facts force

canonote is a notebook where an agent's edits arrive as suggestions a human accepts or declines, and
the file is plain text the person owns. Four consequences no template supplies:

1. **Two authors, permanently distinguishable.** Authorship stated on every change, never by colour
   alone (04, 05).
2. **The document is the product** — not a dashboard with a document in it (17, 28, 31, 35).
3. **A decision is a first-class object** with a place, a state and a history (23, 29).
4. **Plain text is a promise**, so no metaphor may hide the file: terminal chrome (34) and
   markdown-as-brand (104) both make it look like a developer artifact, which fails the actual user.

## v2 constraints — checked on a rendered screenshot

- One face for the document, one for the interface, both with a written reason. Not Inter, Geist or
  Space Grotesk, and not chosen because it is fashionable (33, 118).
- No kicker that restates a heading (10); no ordinals on unordered things (30).
- No grid of equal-weight cards (28); one surface per region (31).
- No coloured left border as the way to mark a suggestion (17) — state authorship instead.
- No near-black plus one bright accent as the identity (94, 06); no broadsheet pastiche (95); no
  terminal chrome (34).
- Hierarchy from scale and space with real jumps (11, 12, 32).
- Every colour traces to a semantic token with a written meaning (04, 05).
