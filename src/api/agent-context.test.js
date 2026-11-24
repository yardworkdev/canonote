import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_BYTES,
  HARD_MAX_BYTES,
  MANIFEST_MAX_BYTES,
  afterCursor,
  clampToBytes,
  decodeCursor,
  encodeCursor,
  hashKey,
  manifest,
  mintKey,
  page,
  parseFields,
  parseLimit,
  project,
  respond,
  since,
} from '../../scripts/lib/agent-context.js';

const note = (i, over = {}) => ({
  id: `note-${String(i).padStart(3, '0')}`,
  title: `Note ${i}`,
  updated: `2026-10-${String(10 + (i % 18)).padStart(2, '0')}T10:00:00.000Z`,
  created: `2026-09-01T10:00:00.000Z`,
  words: 120 + i,
  rev: `rev${i}`,
  folder: 'private',
  tags: [],
  body: `# Note ${i}\n\n${'Body copy that costs context. '.repeat(60)}`,
  ...over,
});

describe('the handshake stays small', () => {
  it('a manifest fits in a few hundred bytes and carries no note content', () => {
    const raw = JSON.stringify(
      manifest({ counts: { total: 40, pending: 2 }, newest: '2026-10-28T18:09:00.000Z', base: 'https://canonote.app' })
    );
    expect(Buffer.byteLength(raw, 'utf8')).toBeLessThanOrEqual(MANIFEST_MAX_BYTES);
    expect(raw).not.toContain('Body copy');
  });
});

describe('an agent pays only for what it asks for', () => {
  it('projects the requested fields in the requested order', () => {
    const out = project(note(1), ['title', 'id']);
    expect(Object.keys(out)).toEqual(['title', 'id']);
    expect(out.body).toBeUndefined();
  });

  it('drops fields it does not know instead of leaking them', () => {
    expect(parseFields('id,body,secret')).toEqual(['id']);
    expect(parseFields('')).toBeNull();
  });

  it('a list never contains a body', () => {
    const { items } = page([note(1), note(2)], { limit: 5, fields: null });
    for (const item of items) {
      expect(item.body).toBeUndefined();
      expect(item.title).toBeTruthy();
    }
  });

  it('caps the limit instead of trusting the caller', () => {
    expect(parseLimit('9999')).toBe(50);
    expect(parseLimit('0')).toBe(20);
    expect(parseLimit('nonsense')).toBe(20);
  });
});

describe('paging is stable under writes', () => {
  it('continues from a cursor without repeating a row', () => {
    const rows = [note(3), note(2), note(1)];
    const first = page(rows, { limit: 2, fields: null });
    expect(first.next).toBeTruthy();
    const rest = page(afterCursor(rows, first.next), { limit: 2, fields: null });
    const ids = [...first.items, ...rest.items].map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(3);
  });

  it('round-trips a cursor and rejects junk', () => {
    const c = encodeCursor(note(1));
    expect(decodeCursor(c).id).toBe('note-001');
    expect(decodeCursor('not-a-cursor')).toBeNull();
  });

  it('since returns only what changed', () => {
    const rows = [note(1, { updated: '2026-10-28T10:00:00.000Z' }), note(2, { updated: '2026-10-01T10:00:00.000Z' })];
    expect(since(rows, '2026-10-20T00:00:00.000Z')).toHaveLength(1);
  });
});

describe('nothing unfair reaches a context window', () => {
  it('clamps by bytes, not characters, without splitting a character', () => {
    const text = 'é'.repeat(100);
    const out = clampToBytes(text, 51);
    expect(out.truncated).toBe(true);
    expect(out.text).not.toContain('\uFFFD');
    expect(out.bytes).toBeLessThanOrEqual(51);
  });

  it('marks truncation explicitly and never exceeds the budget', () => {
    const big = { items: Array.from({ length: 200 }, (_, i) => ({ id: i, title: 'x'.repeat(80) })) };
    const out = respond(big, { maxBytes: 1000 });
    expect(out.truncated).toBe(true);
    expect(out.bytes).toBeLessThanOrEqual(1000);
    const parsed = JSON.parse(out.body);
    expect(parsed.truncated).toBe(true);
    expect(typeof parsed.head).toBe('string');
    expect(parsed.hint).toMatch(/fields|limit|maxBytes/);
  });

  it('holds even when the caller asks for more than the hard ceiling', () => {
    const out = respond({ a: 'x'.repeat(100000) }, { maxBytes: 10_000_000 });
    expect(out.bytes).toBeLessThanOrEqual(HARD_MAX_BYTES);
    expect(DEFAULT_MAX_BYTES).toBeLessThanOrEqual(HARD_MAX_BYTES);
  });
});

describe('keys', () => {
  it('mints a key that hashes to the stored value, and never repeats', () => {
    const a = mintKey();
    const b = mintKey();
    expect(a.key).not.toBe(b.key);
    expect(a.hash).toBe(hashKey(a.key));
    expect(a.key.startsWith('cn_live_')).toBe(true);
  });
});
