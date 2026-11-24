import { describe, expect, it, vi } from 'vitest';
import {
  NOTE_HISTORY_LIMIT,
  readNoteVersions,
  readNoteVersionsResult,
  recordNoteVersion,
  writeNoteVersions,
} from './note-history';

// The version store had no unit tests at all, which is how the panel came to
// show "No versions saved yet" over a read the browser refused: the service
// answered [] for a refused read and for an empty note alike, so the caller
// could not tell the two apart. Both answers are pinned here.

const version = (overrides = {}) => ({
  id: 'v-1',
  content: 'the body of the note',
  timestamp: 1000,
  wordCount: 5,
  charCount: 19,
  ...overrides,
});

const makeStorage = (initial = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    values,
    scopedKey: (key) => `local:${key}`,
    get: vi.fn(async (key) => (values.has(key) ? { value: values.get(key) } : null)),
    set: vi.fn(async (key, value) => {
      values.set(key, value);
      return true;
    }),
  };
};

describe('readNoteVersionsResult', () => {
  it('answers the versions newest first', async () => {
    const storage = makeStorage({
      'local:note-versions:note-1': JSON.stringify([
        version({ id: 'old', timestamp: 1 }),
        version({ id: 'new', timestamp: 9 }),
      ]),
    });

    const { versions, error } = await readNoteVersionsResult(storage, 'note-1');

    expect(error).toBeNull();
    expect(versions.map((v) => v.id)).toEqual(['new', 'old']);
  });

  it('says a note has none rather than that the read failed', async () => {
    const { versions, error } = await readNoteVersionsResult(makeStorage(), 'note-1');

    expect(versions).toEqual([]);
    expect(error).toBeNull();
  });

  it('carries the error when the store refuses the read', async () => {
    const storage = makeStorage();
    storage.get.mockImplementation(async () => {
      throw new DOMException('Access to storage is not allowed.', 'SecurityError');
    });

    const { versions, error } = await readNoteVersionsResult(storage, 'note-1');

    expect(versions).toEqual([]);
    expect(error).toBeInstanceOf(DOMException);
  });

  it('treats unparseable history as none, never as an error', async () => {
    const storage = makeStorage({ 'local:note-versions:note-1': '{not json at all' });

    const { versions, error } = await readNoteVersionsResult(storage, 'note-1');

    expect(versions).toEqual([]);
    expect(error).toBeNull();
  });

  it('drops entries that carry no content', async () => {
    const storage = makeStorage({
      'local:note-versions:note-1': JSON.stringify([version({ id: 'kept' }), { id: 'no-content' }]),
    });

    const { versions } = await readNoteVersionsResult(storage, 'note-1');

    expect(versions.map((v) => v.id)).toEqual(['kept']);
  });
});

describe('readNoteVersions', () => {
  it('stays the forgiving form the save pipeline uses', async () => {
    const storage = makeStorage();
    storage.get.mockImplementation(async () => {
      throw new Error('denied');
    });

    await expect(readNoteVersions(storage, 'note-1')).resolves.toEqual([]);
  });
});

describe('writeNoteVersions', () => {
  it('keeps the newest versions and stops at the limit', async () => {
    const storage = makeStorage();
    const versions = Array.from({ length: NOTE_HISTORY_LIMIT + 5 }, (_, index) =>
      version({ id: `v-${index}` })
    );

    await writeNoteVersions(storage, 'note-1', versions);

    const written = JSON.parse(storage.values.get('local:note-versions:note-1'));
    expect(written).toHaveLength(NOTE_HISTORY_LIMIT);
    expect(written[0].id).toBe('v-0');
  });

  it('lets a refused write reach the caller', async () => {
    const storage = makeStorage();
    storage.set.mockImplementation(async () => {
      throw new DOMException('full', 'QuotaExceededError');
    });

    await expect(writeNoteVersions(storage, 'note-1', [version()])).rejects.toMatchObject({
      name: 'QuotaExceededError',
    });
  });
});

describe('recordNoteVersion', () => {
  it('writes the first snapshot of a note', async () => {
    const storage = makeStorage();

    const recorded = await recordNoteVersion(storage, 'note-1', 'the first body of this note');

    expect(recorded).toBe(true);
    expect(JSON.parse(storage.values.get('local:note-versions:note-1'))).toHaveLength(1);
  });

  it('does not record the same content twice', async () => {
    const storage = makeStorage();

    await recordNoteVersion(storage, 'note-1', 'the first body of this note');
    const recorded = await recordNoteVersion(storage, 'note-1', 'the first body of this note');

    expect(recorded).toBe(false);
    expect(JSON.parse(storage.values.get('local:note-versions:note-1'))).toHaveLength(1);
  });

  it('records a trivial change when forced, so a restore can be undone', async () => {
    const storage = makeStorage();
    const content = 'the first body of this note';
    await recordNoteVersion(storage, 'note-1', content);

    const recorded = await recordNoteVersion(storage, 'note-1', `${content}!`, { force: true });

    expect(recorded).toBe(true);
    expect(JSON.parse(storage.values.get('local:note-versions:note-1'))).toHaveLength(2);
  });

  it('ignores empty content', async () => {
    const storage = makeStorage();

    expect(await recordNoteVersion(storage, 'note-1', '   ')).toBe(false);
    expect(storage.set).not.toHaveBeenCalled();
  });
});
