import { describe, expect, it } from 'vitest';
import { canonicalRevision, normalizeCanonicalNote } from '../../api/_lib/canonical-note.js';

describe('canonical note contract', () => {
  it('uses the database version as the only revision', () => {
    expect(canonicalRevision({ version: 12 })).toBe('12');
    expect(() => canonicalRevision({ updated_at: new Date().toISOString() })).toThrow(
      /migration 010/i
    );
  });

  it('returns "0" for version=0', () => {
    expect(canonicalRevision({ version: 0 })).toBe('0');
  });

  it('returns "NaN" for version=NaN (documents the edge case)', () => {
    expect(canonicalRevision({ version: NaN })).toBe('NaN');
  });

  it('returns "Infinity" for version=Infinity', () => {
    expect(canonicalRevision({ version: Infinity })).toBe('Infinity');
  });

  it('throws for version=undefined', () => {
    expect(() => canonicalRevision({})).toThrow(/migration 010/i);
  });

  it('throws for version=null', () => {
    expect(() => canonicalRevision({ version: null })).toThrow(/migration 010/i);
  });

  it('normalizes the migration-defined note_id shape', () => {
    expect(
      normalizeCanonicalNote({
        note_id: 'note-1',
        title: 'Title',
        content: 'Body',
        version: 3,
        updated_at: '2026-01-01T00:00:00.000Z',
      }, { includeContent: true })
    ).toMatchObject({ id: 'note-1', note_id: 'note-1', revision: '3', content: 'Body' });
  });

  it('returns null for falsy input', () => {
    expect(normalizeCanonicalNote(null)).toBeNull();
    expect(normalizeCanonicalNote(undefined)).toBeNull();
  });

  it('falls back to created_at when updated_at missing', () => {
    const result = normalizeCanonicalNote({
      note_id: 'n1', version: 1, created_at: '2024-06-15T00:00:00Z',
    });
    expect(result.updated_at).toBe('2024-06-15T00:00:00Z');
  });

  it('defaults content to empty string when includeContent=true and content missing', () => {
    const result = normalizeCanonicalNote(
      { note_id: 'n1', version: 1, updated_at: '2024-01-01T00:00:00Z' },
      { includeContent: true }
    );
    expect(result.content).toBe('');
  });

  it('omits content when includeContent is false (default)', () => {
    const result = normalizeCanonicalNote({
      note_id: 'n1', version: 1, content: 'secret', updated_at: '2024-01-01T00:00:00Z',
    });
    expect(result.content).toBeUndefined();
  });

  it('defaults title to Untitled when missing', () => {
    const result = normalizeCanonicalNote({
      note_id: 'n1', version: 1, updated_at: '2024-01-01T00:00:00Z',
    });
    expect(result.title).toBe('Untitled');
  });

  it('defaults a note with no agent_access row value to visible', () => {
    // migration 015 adds the column with default true; a row read before it was
    // applied, or from a cached payload, must still be readable by agents
    expect(normalizeCanonicalNote({
      note_id: 'n1', version: 1, updated_at: '2024-01-01T00:00:00Z',
    }).agentAccess).toBe(true);
    expect(normalizeCanonicalNote({
      note_id: 'n1', version: 1, agent_access: false, updated_at: '2024-01-01T00:00:00Z',
    }).agentAccess).toBe(false);
  });

  it('maps is_pinned boolean correctly', () => {
    expect(normalizeCanonicalNote({
      note_id: 'n1', version: 1, is_pinned: true, updated_at: '2024-01-01T00:00:00Z',
    }).isPinned).toBe(true);
    expect(normalizeCanonicalNote({
      note_id: 'n1', version: 1, is_pinned: false, updated_at: '2024-01-01T00:00:00Z',
    }).isPinned).toBe(false);
  });
});
