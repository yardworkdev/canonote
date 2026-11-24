# canonote-agent (Rust)

A second implementation of the same agent API, in one static binary. It exists to keep the
contract honest: the same routes, the same JSON shapes, the same byte budget, checked by
`scripts/conformance.mjs` against the Node reference server rather than asserted in a blog post.

It is **not** the production server. Production is `api/_lib/agent-handler.js` on Vercel. This one
is for people who want the agent API running next to their own machine with no Node installed.

```bash
cargo build --release
./target/release/canonote-agent 8140
```

It prints the two keys it minted on startup, then serves:

```
GET   /api/agent                     manifest, ~480 B
GET   /api/agent/notes               metadata only, limit and field projection
GET   /api/agent/notes/:id           part=meta|body, maxBytes capped
GET   /api/agent/search              snippets, never whole bodies
POST  /api/agent/notes               create
PATCH /api/agent/notes/:id           op=append|replace, ifRevision on replace
POST  /api/agent/notes/:id/propose   a suggestion the person still has to accept
POST  /api/agent/switch              the notebook-wide on/off
POST  /api/human/notes/append        the person appends
POST  /api/human/notes/access        the person switches one note off for agents
```

Data is in memory and reseeded on start: forty synthetic notes, no persistence. That is deliberate —
this is a conformance fixture, not a store.

## Verify

```bash
cd ../..
node scripts/conformance.mjs      # both servers, 21 vectors, same order, same state
```

Measured on this machine: 927 KB binary, ~3.3 MB resident, p50 0.35 ms against the Node server's
0.65 ms, startup 10 ms. The latency is a rounding error; the memory is the point.

MIT, same as the rest of canonote.
