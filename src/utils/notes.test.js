import { describe, expect, it } from 'vitest';
import { classifyNotesForSidebar, normalizeNoteMetadata, normalizeNotesMetadata, hasDisplayableTitle } from './notes';

describe('who wrote what', () => {
  it('says whose note it is in one word', () => {
    const you = normalizeNoteMetadata({ id: 'a', createdBy: 'uuid-1', updatedBy: 'uuid-1' }).note;
    const agent = normalizeNoteMetadata({ id: 'b', createdBy: 'agent', updatedBy: 'agent' }).note;
    const both = normalizeNoteMetadata({ id: 'c', createdBy: 'uuid-1', updatedBy: 'agent' }).note;
    const handedBack = normalizeNoteMetadata({ id: 'd', createdBy: 'agent', updatedBy: 'uuid-1' }).note;
    expect([you.writer, agent.writer, both.writer, handedBack.writer]).toEqual([
      'you',
      'agent',
      'both',
      'both',
    ]);
  });

  it('marks a note the agent wrote last, and names it', () => {
    const { note } = normalizeNoteMetadata({
      id: 'n1',
      title: 'Writing together',
      folder: 'agent',
      updatedBy: 'agent',
      updatedByName: 'Promi',
      createdBy: 'agent',
      createdByName: 'Promi',
    });
    expect(note.lastWriterIsAgent).toBe(true);
    expect(note.lastWriterName).toBe('Promi');
  });

  it('treats an older agent id the same way, and a person not at all', () => {
    expect(normalizeNoteMetadata({ id: 'a', updatedBy: 'agent_rudi' }).note.lastWriterIsAgent).toBe(
      true
    );
    expect(
      normalizeNoteMetadata({ id: 'b', updatedBy: 'fa843a5d-bf35-4c23-a4b6-acd9fdf2b116' }).note
        .lastWriterIsAgent
    ).toBe(false);
  });

  it('does not invent a section for a folder nobody can set', () => {
    const now = Date.now();
    const sections = classifyNotesForSidebar({
      notes: [
        { id: 'shared-1', title: 'Filed shared by an API client', folder: 'shared', updated: now },
        { id: 'mine-1', title: 'Mine', folder: 'private', updated: now },
      ],
      now,
    });
    // `folder` is stored but no control sets it, and a heading that can only ever
    // be empty is a lie about a feature. Both notes are in Today, where they are.
    expect(sections.find((section) => section.key === 'shared')).toBeUndefined();
    const today = sections.find((section) => section.key === 'today');
    expect(today?.notes.map((note) => note.id)).toEqual(['shared-1', 'mine-1']);
  });
});

describe('classifyNotesForSidebar', () => {
  it('sorts notes newest-first within every sidebar section', () => {
    const now = new Date('2026-04-01T12:00:00.000Z').getTime();
    const oneDay = 24 * 60 * 60 * 1000;

    const notes = [
      { id: 'agent-old', title: 'Agent Old', updated: now - oneDay, folder: 'agent' },
      { id: 'agent-new', title: 'Agent New', updated: now, folder: 'agent' },
      // Notes written before the identity was made neutral still group here.
      { id: 'legacy-old', title: 'Legacy Old', updated: now - oneDay, folder: 'rudi' },
      { id: 'legacy-new', title: 'Legacy New', updated: now, createdBy: 'agent_rudi' },
      {
        id: 'pinned-old',
        title: 'Pinned Old',
        updated: now - oneDay,
        isPinned: true,
        folder: 'private',
      },
      { id: 'pinned-new', title: 'Pinned New', updated: now, isPinned: true, folder: 'private' },
      { id: 'today-old', title: 'Today Old', updated: now - 3 * 60 * 60 * 1000, folder: 'private' },
      { id: 'today-new', title: 'Today New', updated: now - 1 * 60 * 60 * 1000, folder: 'private' },
      { id: 'recent-old', title: 'Recent Old', updated: now - 5 * oneDay, folder: 'private' },
      { id: 'recent-new', title: 'Recent New', updated: now - 2 * oneDay, folder: 'private' },
      { id: 'all-old', title: 'All Old', updated: now - 20 * oneDay, folder: 'private' },
      { id: 'all-new', title: 'All New', updated: now - 10 * oneDay, folder: 'private' },
    ];

    const sections = classifyNotesForSidebar({ notes, now });

    expect(
      sections.find((section) => section.key === 'agent')?.notes.map((note) => note.id)
    ).toEqual(['agent-new', 'legacy-new', 'agent-old', 'legacy-old']);
    expect(
      sections.find((section) => section.key === 'pinned')?.notes.map((note) => note.id)
    ).toEqual(['pinned-new', 'pinned-old']);
    expect(
      sections.find((section) => section.key === 'today')?.notes.map((note) => note.id)
    ).toEqual(['today-new', 'today-old']);
    expect(
      sections.find((section) => section.key === 'recent')?.notes.map((note) => note.id)
    ).toEqual(['recent-new', 'recent-old']);
    expect(sections.find((section) => section.key === 'all')?.notes.map((note) => note.id)).toEqual(
      ['all-new', 'all-old']
    );
  });

  it('labels the agent section with the name the user gave their agent', () => {
    const notes = [{ id: 'agent-1', title: 'Agent Note', updated: 1000, folder: 'agent' }];

    const defaultSections = classifyNotesForSidebar({ notes, now: 2000 });
    const namedSections = classifyNotesForSidebar({ notes, now: 2000, agentName: 'Notetaker' });

    // No stored name: the neutral fallback, never a built-in person's assistant.
    expect(defaultSections.find((section) => section.key === 'agent')?.title).toBe('Agent');
    expect(namedSections.find((section) => section.key === 'agent')?.title).toBe('Notetaker');
  });

  it('sorts search results newest-first', () => {
    const filteredNotes = [
      { id: 'older', title: 'Older', updated: 1000 },
      { id: 'newer', title: 'Newer', updated: 2000 },
    ];

    const sections = classifyNotesForSidebar({
      filteredNotes,
      searchQuery: 'new',
    });

    expect(sections).toEqual([
      {
        key: 'search',
        title: 'Search Results',
        notes: [
          { id: 'newer', title: 'Newer', updated: 2000 },
          { id: 'older', title: 'Older', updated: 1000 },
        ],
      },
    ]);
  });
});

describe('normalizeNoteMetadata', () => {
  it('returns null for non-object input', () => {
    expect(normalizeNoteMetadata(null).note).toBeNull();
    expect(normalizeNoteMetadata(undefined).note).toBeNull();
    expect(normalizeNoteMetadata('string').note).toBeNull();
    expect(normalizeNoteMetadata(42).note).toBeNull();
  });

  it('returns null for missing id', () => {
    expect(normalizeNoteMetadata({}).note).toBeNull();
    expect(normalizeNoteMetadata({ id: '' }).note).toBeNull();
    expect(normalizeNoteMetadata({ id: '   ' }).note).toBeNull();
  });

  it('trims whitespace from id', () => {
    const result = normalizeNoteMetadata({ id: '  note-abc  ', title: 'T', updated: 100 });
    expect(result.note.id).toBe('note-abc');
  });

  it('defaults invalid folder to private', () => {
    const result = normalizeNoteMetadata({ id: 'n1', folder: 'invalid', updated: 100 });
    expect(result.note.folder).toBe('private');
    expect(result.issues.invalid_folder).toBe(1);
  });

  it('accepts rudi folder', () => {
    const result = normalizeNoteMetadata({ id: 'n1', folder: 'rudi', updated: 100 });
    expect(result.note.folder).toBe('rudi');
    expect(result.issues.invalid_folder).toBeUndefined();
  });

  it('uses Date.now() when updated is NaN', () => {
    const now = 1000000;
    const result = normalizeNoteMetadata({ id: 'n1', updated: NaN }, { now });
    expect(result.note.updated).toBe(now);
    expect(result.issues.invalid_updated).toBe(1);
  });

  it('uses Date.now() when updated is Infinity', () => {
    const now = 1000000;
    const result = normalizeNoteMetadata({ id: 'n1', updated: Infinity }, { now });
    expect(result.note.updated).toBe(now);
  });

  it('defaults title to empty string when not a string', () => {
    const result = normalizeNoteMetadata({ id: 'n1', title: 123, updated: 100 });
    expect(result.note.title).toBe('');
  });

  it('coerces isPinned to boolean', () => {
    expect(normalizeNoteMetadata({ id: 'n1', isPinned: 1, updated: 100 }).note.isPinned).toBe(true);
    expect(normalizeNoteMetadata({ id: 'n1', isPinned: 0, updated: 100 }).note.isPinned).toBe(false);
    expect(normalizeNoteMetadata({ id: 'n1', updated: 100 }).note.isPinned).toBe(false);
  });

  it('defaults createdBy to null when not a string', () => {
    expect(normalizeNoteMetadata({ id: 'n1', createdBy: 123, updated: 100 }).note.createdBy).toBeNull();
  });

  it('parses string updated timestamps', () => {
    const result = normalizeNoteMetadata({ id: 'n1', updated: '2024-01-01T00:00:00Z' });
    expect(result.note.updated).toBe(new Date('2024-01-01T00:00:00Z').getTime());
  });
});

describe('normalizeNotesMetadata', () => {
  it('returns empty array for non-array input', () => {
    expect(normalizeNotesMetadata(null).notes).toEqual([]);
    expect(normalizeNotesMetadata('string').notes).toEqual([]);
  });

  it('drops invalid notes from output', () => {
    const result = normalizeNotesMetadata([
      { id: 'valid', title: 'OK', updated: 100 },
      null,
      { id: '', updated: 100 },
    ]);
    expect(result.notes).toHaveLength(1);
    expect(result.issues.missing_id).toBe(1);
  });
});

describe('hasDisplayableTitle', () => {
  it('returns true for non-empty trimmed title', () => {
    expect(hasDisplayableTitle({ title: 'Hello' })).toBe(true);
    expect(hasDisplayableTitle({ title: '  Hello  ' })).toBe(true);
  });

  it('returns false for empty or whitespace-only title', () => {
    expect(hasDisplayableTitle({ title: '' })).toBe(false);
    expect(hasDisplayableTitle({ title: '   ' })).toBe(false);
    expect(hasDisplayableTitle({ title: null })).toBe(false);
    expect(hasDisplayableTitle({})).toBe(false);
  });
});
