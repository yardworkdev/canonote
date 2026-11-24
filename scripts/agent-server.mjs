/**
 * A runnable reference implementation of the canonote agent API.
 *
 * Same contract as scripts/lib/agent-context.js, over an in-memory notebook, so the
 * handshake can be exercised end to end without Supabase or Vercel:
 *
 *   node scripts/agent-server.mjs 8100
 *
 * It prints the key once, on start, then serves:
 *   GET  /api/agent                          the manifest (≤700 bytes)
 *   GET  /api/agent/notes                   metadata only, paged, projectable
 *   GET  /api/agent/notes/:id?part=meta|body
 *   GET  /api/agent/search?q=
 *   POST /api/agent/notes/:id/propose       a suggestion, never a write
 *   POST /api/agent/switch                  the on/off switch (admin key only)
 */
import http from 'node:http';
import { createHash } from 'node:crypto';
import { appendToNote, authors, createNote, replaceNote } from './lib/notebook-store.js';
import { filterAgentVisible, hidesFromAgent } from '../api/_lib/agent-access.js';
import {
  manifest,
  mintKey,
  page,
  parseFields,
  parseLimit,
  project,
  respond,
  since,
  afterCursor,
  clampToBytes,
} from './lib/agent-context.js';

const PORT = Number(process.argv[2] || 8100);
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------- the notebook
// Synthetic, sized like a real notebook so the context arithmetic is honest.
const SUBJECTS = [
  'Q3 planning', 'Launch retro', 'Pricing page', 'Reading list', 'Hiring loop',
  'Support macros', 'Weekly review', 'Onboarding copy', 'Churn interview notes',
  'Agent permissions design', 'Site migration', 'Newsletter draft', 'Board update',
  'Vendor shortlist', 'Metrics definitions', 'Homepage rewrite', 'Pricing tests',
  'Sales objections', 'Roadmap bets', 'Design critique', 'Bug triage', 'Postmortem',
];
const PARAGRAPH =
  'This note exists so the API has something realistic to hand back. It is long enough ' +
  'to matter when someone measures bytes, and dull enough that nobody mistakes it for content. ';

const notes = Array.from({ length: 40 }, (_, i) => {
  const day = String(28 - (i % 27)).padStart(2, '0');
  const title = `${SUBJECTS[i % SUBJECTS.length]}${i > SUBJECTS.length ? ` (${i})` : ''}`;
  const body =
    `# ${title}\n\n` +
    `${PARAGRAPH.repeat(2)}\n\n` +
    `## What happened\n\n${PARAGRAPH.repeat(3)}\n\n` +
    `## What we decided\n\n1. ${PARAGRAPH.slice(0, 90)}\n2. ${PARAGRAPH.slice(0, 70)}\n`;
  return {
    id: `note-${String(i).padStart(3, '0')}`,
    title,
    created: `2026-09-${day}T09:${String(10 + i).slice(0, 2)}:00.000Z`,
    updated: `2026-10-${day}T18:${String((i * 7) % 60).padStart(2, '0')}:00.000Z`,
    words: body.split(/\s+/).filter(Boolean).length,
    rev: Buffer.from(`${i}:${title}`).toString('base64url').slice(0, 12),
    folder: i % 5 === 0 ? 'work' : 'private',
    tags: i % 3 === 0 ? ['planning'] : [],
    body,
  };
}).sort((a, b) => (a.updated < b.updated ? 1 : -1));

// ---------------------------------------------------------------------- the keys
const PRESENCE_TTL_MS = 12000;
const AGENT_MODES = ['reading', 'proposing', 'writing'];

const admin = mintKey('cn_admin');
const agent = mintKey('cn_live');
const keys = new Map([
  [admin.hash, { id: admin.id, kind: 'admin', scopes: ['admin'], enabled: true }],
  [agent.hash, { id: agent.id, kind: 'agent', scopes: ['notes:read', 'notes:propose', 'notes:write'], enabled: true }],
]);
let globalSwitch = true;
/** one agent per note is enough for a fixture; the real store holds eight */
const presence = new Map();
const suggestions = [];
const writes = [];
let seq = notes.length;

// ----------------------------------------------------------------------- helpers
const send = (res, status, body, extra = {}) => {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-canonote-bytes': Buffer.byteLength(body, 'utf8'),
    ...extra,
  });
  res.end(body);
};

const emit = (res, payload, maxBytes) => {
  const out = respond(payload, { maxBytes });
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-canonote-bytes': out.bytes,
    'x-canonote-truncated': String(out.truncated),
  });
  res.end(out.body);
  return out.bytes;
};

function auth(req) {
  const raw = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.headers['x-agent-key'];
  if (!raw) return { error: [401, { error: 'missing key', enter: `${BASE}/api/agent` }] };
  const record = keys.get(hash(raw));
  if (!record) return { error: [401, { error: 'unknown key', enter: `${BASE}/api/agent` }] };
  if (!globalSwitch || !record.enabled) {
    return { error: [423, { error: 'this notebook is switched off for agents', switch: `${BASE}/api/agent/switch` }] };
  }
  return { record };
}

const hash = (key) => createHash('sha256').update(String(key)).digest('hex');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, BASE);
  const path = url.pathname.replace(/\/+$/, '');
  const q = url.searchParams;

  // entry point: no key needed, no content included, tiny by construction
  if (path === '/api/agent' && req.method === 'GET') {
    const body = manifest({
      counts: { total: filterAgentVisible(notes).length, pending: suggestions.filter((s) => s.state === 'pending').length },
      newest: notes[0].updated,
      base: BASE,
    });
    const out = respond(body, { maxBytes: 700 });
    res.writeHead(200, { 'content-type': 'application/json', 'x-canonote-bytes': out.bytes });
    return res.end(out.body);
  }

  const { record, error } = auth(req);
  if (error) return send(res, error[0], JSON.stringify(error[1]));

  // the on/off switch: admin only, instant, no key rotation
  if (path === '/api/agent/switch' && req.method === 'POST') {
    if (record.kind !== 'admin') return send(res, 403, JSON.stringify({ error: 'admin key required' }));
    const body = await readJson(req);
    if (typeof body.global === 'boolean') globalSwitch = body.global;
    if (typeof body.enabled === 'boolean') {
      // no key named means every agent key: the switch is a switch, not a form
      for (const [h, k] of keys) if (body.key ? k.id === body.key : k.kind !== 'admin') k.enabled = body.enabled;
    }
    const agentRecord = [...keys.values()].find((k) => k.kind === 'agent');
    return send(res, 200, JSON.stringify({ global: globalSwitch, agentsEnabled: agentRecord.enabled }));
  }

  // metadata only. bodies are never in a list.
  if (path === '/api/agent/notes' && req.method === 'GET') {
    const limit = parseLimit(q.get('limit'));
    const fields = parseFields(q.get('fields'));
    let rows = filterAgentVisible(notes);
    if (q.get('since')) rows = since(rows, q.get('since'));
    if (q.get('cursor')) rows = afterCursor(rows, q.get('cursor'));
    const { items, next } = page(rows, { limit, fields });
    return emit(res, { count: items.length, next, items }, q.get('maxBytes'));
  }

  const noteMatch = path.match(/^\/api\/agent\/notes\/([^/]+)$/);
  if (noteMatch && req.method === 'GET') {
    const note = notes.find((n) => n.id === noteMatch[1]);
    if (!note || hidesFromAgent(note)) return send(res, 404, JSON.stringify({ error: 'no such note' }));
    const part = q.get('part') || 'meta';
    if (part === 'body') {
      const body = clampToBytes(note.body, Number(q.get('maxBytes')) || 6000);
      return emit(res, { id: note.id, rev: note.rev, content: body.text, truncated: body.truncated }, q.get('maxBytes'));
    }
    return emit(res, project(note, parseFields(q.get('fields'))), q.get('maxBytes'));
  }

  // search returns snippets, capped, never whole bodies
  if (path === '/api/agent/search' && req.method === 'GET') {
    const needle = String(q.get('q') || '').toLowerCase();
    if (!needle) return send(res, 400, JSON.stringify({ error: 'q is required' }));
    const hits = filterAgentVisible(notes)
      .filter((n) => n.title.toLowerCase().includes(needle) || n.body.toLowerCase().includes(needle))
      .slice(0, parseLimit(q.get('limit'), 10, 20))
      .map((n) => {
        const at = n.body.toLowerCase().indexOf(needle);
        const from = Math.max(0, at - 40);
        return { id: n.id, title: n.title, updated: n.updated, snippet: n.body.slice(from, from + 120).replace(/\s+/g, ' ') };
      });
    return emit(res, { hits: hits.length, items: hits }, q.get('maxBytes'));
  }

  // write: create a note, append to one, or replace one under a revision guard
  if (path === '/api/agent/notes' && req.method === 'POST') {
    if (!record.scopes.includes('notes:write')) return send(res, 403, JSON.stringify({ error: 'no write scope' }));
    const body = await readJson(req);
    seq += 1;
    const made = createNote({
      id: `note-${String(seq).padStart(3, '0')}`,
      title: body.title,
      body: body.content,
      author: 'agent',
      at: new Date().toISOString(),
    });
    if (!made.ok) return send(res, made.status, JSON.stringify({ error: made.error }));
    notes.unshift(made.note);
    writes.push({ at: made.note.created, by: 'agent', op: 'create', note: made.note.id });
    return send(res, 201, JSON.stringify({ id: made.note.id, rev: made.note.rev, title: made.note.title }));
  }

  // where the agent is working: a caret and a mode, twelve seconds of life
  const presenceMatch = path.match(/^\/api\/agent\/notes\/([^/]+)\/presence$/);
  if (presenceMatch && req.method === 'POST') {
    const note = notes.find((n) => n.id === presenceMatch[1]);
    if (!note || hidesFromAgent(note)) return send(res, 404, JSON.stringify({ error: 'no such note' }));
    const body = await readJson(req);
    const entry = {
      kind: 'agent',
      id: record.id,
      name: record.name || 'Agent',
      mode: AGENT_MODES.includes(body.mode) ? body.mode : 'reading',
      from: Number.isInteger(body.from) ? body.from : null,
      to: Number.isInteger(body.to) ? body.to : null,
      at: Date.now(),
    };
    presence.set(note.id, entry);
    return send(res, 200, JSON.stringify(entry));
  }

  const humanPresenceMatch = path.match(/^\/api\/human\/notes\/([^/]+)\/presence$/);
  if (humanPresenceMatch && req.method === 'GET') {
    const entry = presence.get(humanPresenceMatch[1]);
    const live = entry && Date.now() - entry.at <= PRESENCE_TTL_MS ? [entry] : [];
    if (!entry || !live.length) presence.delete(humanPresenceMatch[1]);
    return send(res, 200, JSON.stringify({ ttl: PRESENCE_TTL_MS, entries: live }));
  }

  if (path === '/api/human/notes/access' && req.method === 'POST') {
    // stands in for the per-note checkbox in the app: the person, not the agent, flips it
    const body = await readJson(req);
    const note = notes.find((n) => n.id === body.id);
    if (!note) return send(res, 404, JSON.stringify({ error: 'no such note' }));
    note.agentAccess = body.agentAccess !== false;
    writes.push({ at: new Date().toISOString(), by: 'human', op: 'access', note: note.id });
    return send(res, 200, JSON.stringify({ id: note.id, agentAccess: note.agentAccess }));
  }

  if (path === '/api/human/notes/append' && req.method === 'POST') {
    // stands in for the person typing in the app, so the demo can interleave honestly
    const body = await readJson(req);
    const note = notes.find((n) => n.id === body.id);
    if (!note) return send(res, 404, JSON.stringify({ error: 'no such note' }));
    const out = appendToNote(note, body.text, { author: 'human', at: new Date().toISOString() });
    if (!out.ok) return send(res, out.status, JSON.stringify({ error: out.error }));
    Object.assign(note, out.note);
    writes.push({ at: out.note.updated, by: 'human', op: 'append', note: note.id });
    return send(res, 200, JSON.stringify({ id: note.id, rev: note.rev, updatedBy: note.updatedBy }));
  }

  const patchMatch = path.match(/^\/api\/agent\/notes\/([^/]+)$/);
  if (patchMatch && req.method === 'PATCH') {
    if (!record.scopes.includes('notes:write')) return send(res, 403, JSON.stringify({ error: 'no write scope' }));
    const note = notes.find((n) => n.id === patchMatch[1]);
    if (!note || hidesFromAgent(note)) return send(res, 404, JSON.stringify({ error: 'no such note' }));
    const body = await readJson(req);
    const at = new Date().toISOString();
    const out =
      body.op === 'append'
        ? appendToNote(note, body.content, { author: 'agent', at })
        : replaceNote(note, body.content, { ifRev: body.ifRevision, author: 'agent', at });
    if (!out.ok) {
      return send(res, out.status, JSON.stringify({ error: out.error, rev: out.rev, body: out.body }));
    }
    Object.assign(note, out.note);
    writes.push({ at, by: 'agent', op: body.op || 'replace', note: note.id });
    notes.sort((a, b) => (a.updated < b.updated ? 1 : -1));
    return send(res, 200, JSON.stringify({ id: note.id, rev: note.rev, by: authors(note), words: note.words }));
  }

  // proposing, not writing: the human still decides
  const proposeMatch = path.match(/^\/api\/agent\/notes\/([^/]+)\/propose$/);
  if (proposeMatch && req.method === 'POST') {
    if (!record.scopes.includes('notes:propose')) return send(res, 403, JSON.stringify({ error: 'no propose scope' }));
    const note = notes.find((n) => n.id === proposeMatch[1]);
    if (!note || hidesFromAgent(note)) return send(res, 404, JSON.stringify({ error: 'no such note' }));
    const body = await readJson(req);
    if (body.ifRevision && body.ifRevision !== note.rev) {
      return send(res, 409, JSON.stringify({ error: 'stale revision', rev: note.rev }));
    }
    const suggestion = {
      id: `sug-${suggestions.length + 1}`,
      note: note.id,
      baseRev: note.rev,
      find: String(body.find || '').slice(0, 400),
      replace: String(body.replace || '').slice(0, 800),
      state: 'pending',
      at: new Date().toISOString(),
    };
    suggestions.push(suggestion);
    return send(res, 201, JSON.stringify({ id: suggestion.id, state: 'pending', note: note.id, humanMustAccept: true }));
  }

  if (path === '/api/agent/writes' && req.method === 'GET') {
    return emit(res, { count: writes.length, items: writes.slice(-10) }, q.get('maxBytes'));
  }

  send(res, 404, JSON.stringify({ error: 'no such route', enter: `${BASE}/api/agent` }));
});

function readJson(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

server.listen(PORT, '127.0.0.1', () => {
  const bytes = notes.reduce((n, x) => n + Buffer.byteLength(x.body, 'utf8'), 0);
  console.log(JSON.stringify({ listening: BASE, notes: notes.length, notebookBytes: bytes }));
  console.log(`AGENT_KEY=${agent.key}`);
  console.log(`ADMIN_KEY=${admin.key}`);
});
