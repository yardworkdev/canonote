# Self-hosted typefaces

Two faces, both SIL Open Font License 1.1, both subset to Latin and stored here so the app
never makes a third-party font request and still renders correctly offline.

| File | Family | Used for | Upstream |
| --- | --- | --- | --- |
| `Newsreader-400-normal.woff2` | Newsreader 400 | note body | https://fonts.google.com/specimen/Newsreader |
| `Newsreader-400-italic.woff2` | Newsreader 400 italic | quoted text, agent's proposed wording | same |
| `Newsreader-600-normal.woff2` | Newsreader 600 | emphasis inside a note | same |
| `InstrumentSerif-400-normal.woff2` | Instrument Serif 400 | masthead, display headings | https://fonts.google.com/specimen/Instrument+Serif |
| `InstrumentSerif-400-italic.woff2` | Instrument Serif 400 italic | display accent | same |

Licence: https://openfontlicense.org — the OFL allows bundling and redistribution, including in
commercial products, provided the fonts are not sold on their own and the licence travels with them.

Inter (interface) and JetBrains Mono (code) still load from Google Fonts in `index.html`; moving those
to the same self-hosted pattern is a small follow-up, not a necessity.
