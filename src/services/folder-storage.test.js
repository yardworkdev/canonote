import { describe, expect, it } from 'vitest';
import {
  FOLDER_STATE_FILE,
  createFolderAdapter,
  isNoteStoreKey,
  noteIdFromStoreKey,
  slugFromMarkdown,
} from './folder-storage';

/**
 * An in-memory folder: the same six calls `createFolderDriver` makes, with the
 * files in a Map. The adapter's semantics are what this suite is about, so the
 * File System Access API itself is not in the way (the real one is exercised in
 * `tests/folder-store.spec.js`, against a real directory).
 */
const createMemoryDriver = ({ name = 'notes', files = {} } = {}) => {
  const contents = new Map(Object.entries(files));
  const driver = {
    name,
    contents,
    stateWrites: 0,
    failWriteFor: null,
    async readFile(fileName) {
      return contents.has(fileName) ? contents.get(fileName) : null;
    },
    async writeFile(fileName, text) {
      if (driver.failWriteFor === fileName) throw new Error('disk full');
      contents.set(fileName, text);
    },
    async removeFile(fileName) {
      contents.delete(fileName);
    },
    async readState() {
      const raw = contents.get(FOLDER_STATE_FILE);
      if (!raw) return { values: {}, files: {} };
      try {
        const parsed = JSON.parse(raw);
        return { values: parsed.values || {}, files: parsed.files || {} };
      } catch {
        return { values: {}, files: {} };
      }
    },
    async writeState(state) {
      driver.stateWrites += 1;
      contents.set(FOLDER_STATE_FILE, JSON.stringify(state));
    },
    async listMarkdownFiles() {
      return [...contents.keys()].filter((fileName) => /\.md$/i.test(fileName)).sort();
    },
  };
  return driver;
};

const noteKey = (id) => `local:${id}`;

describe('the note/bookkeeping boundary', () => {
  it('reads a note key as a note and every other notebook key as bookkeeping', () => {
    expect(isNoteStoreKey('local:note-abc')).toBe(true);
    expect(noteIdFromStoreKey('local:note-abc')).toBe('note-abc');

    expect(isNoteStoreKey('local:notes-cache')).toBe(false);
    expect(isNoteStoreKey('local:notes-current-id')).toBe(false);
    expect(isNoteStoreKey('local:note-draft:note-abc')).toBe(false);
    expect(isNoteStoreKey('local:note-versions:note-abc')).toBe(false);
    expect(isNoteStoreKey('local:conflict-draft:note-abc')).toBe(false);
    expect(isNoteStoreKey('agent-name')).toBe(false);
    expect(isNoteStoreKey(null)).toBe(false);
  });

  it('names a note after its title, as a person would write the file name', () => {
    expect(slugFromMarkdown('# Release checklist\n\nbody')).toBe('release-checklist');
    expect(slugFromMarkdown('- Fix the toolbar')).toBe('fix-the-toolbar');
    expect(slugFromMarkdown('')).toBe('untitled');
    expect(slugFromMarkdown('Записки за срещата')).toBe('записки-за-срещата');
  });
});

describe('the folder store', () => {
  it('writes a note as one markdown file holding exactly its text', async () => {
    const driver = createMemoryDriver();
    const adapter = createFolderAdapter({ driver });
    await adapter.initialize();

    await adapter.set(noteKey('note-1'), '# Release checklist\n\n- [ ] tag 1.0.0');

    expect(driver.contents.get('release-checklist.md')).toBe('# Release checklist\n\n- [ ] tag 1.0.0');
    expect(await adapter.get(noteKey('note-1'))).toEqual({
      value: '# Release checklist\n\n- [ ] tag 1.0.0',
    });
  });

  it('keeps the notebook bookkeeping in the sidecar, not beside the notes', async () => {
    const driver = createMemoryDriver();
    const adapter = createFolderAdapter({ driver });
    await adapter.initialize();

    await adapter.set('local:notes-cache', JSON.stringify([{ id: 'note-1' }]));
    await adapter.set('local:note-draft:note-1', 'half typed');

    expect([...driver.contents.keys()].sort()).toEqual([FOLDER_STATE_FILE]);
    expect(await adapter.get('local:notes-cache')).toEqual({ value: JSON.stringify([{ id: 'note-1' }]) });
    expect(await adapter.get('local:note-draft:note-1')).toEqual({ value: 'half typed' });
  });

  it('opens on the notes that are really in the folder, including files dropped in by hand', async () => {
    const driver = createMemoryDriver({
      files: { 'bought by hand.md': 'A note written in another editor' },
    });
    const adapter = createFolderAdapter({ driver });
    await adapter.initialize();
    await adapter.set(noteKey('note-1'), '# From the app');

    const keys = await adapter.keys();
    expect(keys).toContain(noteKey('note-1'));
    expect(keys).toContain(noteKey('note-bought-by-hand'));
    expect(await adapter.get(noteKey('note-bought-by-hand'))).toEqual({
      value: 'A note written in another editor',
    });

    // Deterministic: the same file gets the same id on the next boot, or the
    // notebook would list it twice.
    const reopened = createFolderAdapter({
      driver: createMemoryDriver({ files: Object.fromEntries(driver.contents) }),
    });
    await reopened.initialize();
    expect(await reopened.keys()).toContain(noteKey('note-bought-by-hand'));
  });

  it('treats a file the user deleted as a note the user deleted', async () => {
    const driver = createMemoryDriver({ files: { 'keep.md': 'keep', 'gone.md': 'gone' } });
    const adapter = createFolderAdapter({ driver });
    await adapter.initialize();
    expect(await adapter.keys()).toContain(noteKey('note-gone'));

    await driver.removeFile('gone.md');

    expect(await adapter.keys()).not.toContain(noteKey('note-gone'));
    expect(await adapter.get(noteKey('note-gone'))).toBeNull();
  });

  it('renames a file the notebook named when the title changes, and leaves a hand-named file alone', async () => {
    const driver = createMemoryDriver();
    const adapter = createFolderAdapter({ driver });
    await adapter.initialize();

    await adapter.set(noteKey('note-1'), 'untitled');
    expect(driver.contents.has('untitled.md')).toBe(true);

    await adapter.set(noteKey('note-1'), '# Meeting notes');
    expect(driver.contents.has('meeting-notes.md')).toBe(true);
    expect(driver.contents.has('untitled.md')).toBe(false);
    expect(await adapter.get(noteKey('note-1'))).toEqual({ value: '# Meeting notes' });

    const handNamed = createMemoryDriver({ files: { 'my own name.md': 'first' } });
    const onHandNamed = createFolderAdapter({ driver: handNamed });
    await onHandNamed.initialize();
    await onHandNamed.set(noteKey('note-my-own-name'), '# A different title');
    expect(handNamed.contents.has('my own name.md')).toBe(true);
    expect([...handNamed.contents.keys()].filter((name) => /\.md$/i.test(name))).toEqual([
      'my own name.md',
    ]);
  });

  it('does not let two notes share one file name', async () => {
    const driver = createMemoryDriver();
    const adapter = createFolderAdapter({ driver });
    await adapter.initialize();

    await adapter.set(noteKey('note-1'), '# Same title');
    await adapter.set(noteKey('note-2'), '# Same title');

    const names = [...driver.contents.keys()].filter((name) => /\.md$/i.test(name)).sort();
    expect(names).toEqual(['same-title-2.md', 'same-title.md']);
  });

  it('writes before it removes, so a refused write leaves the record where it was', async () => {
    const driver = createMemoryDriver();
    const adapter = createFolderAdapter({ driver });
    await adapter.initialize();
    await adapter.set(noteKey('note-1'), '# Kept');
    await adapter.set('local:note-draft:note-1', 'draft text');

    driver.failWriteFor = 'kept-again.md';
    await expect(
      adapter.setMany([[noteKey('note-1'), '# Kept again']], { remove: ['local:note-draft:note-1'] })
    ).rejects.toThrow('disk full');

    expect(await adapter.get(noteKey('note-1'))).toEqual({ value: '# Kept' });
    expect(await adapter.get('local:note-draft:note-1')).toEqual({ value: 'draft text' });
  });

  it('deletes a note file and its bookkeeping', async () => {
    const driver = createMemoryDriver();
    const adapter = createFolderAdapter({ driver });
    await adapter.initialize();
    await adapter.set(noteKey('note-1'), '# Doomed');
    await adapter.set('local:note-versions:note-1', '[]');

    await adapter.delete(noteKey('note-1'));
    await adapter.delete('local:note-versions:note-1');

    expect(driver.contents.has('doomed.md')).toBe(false);
    expect(await adapter.keys()).toEqual([]);
    expect(await adapter.get(noteKey('note-1'))).toBeNull();
  });

  it('enumerates what the orphan scan and the storage panel read', async () => {
    const driver = createMemoryDriver();
    const adapter = createFolderAdapter({ driver });
    await adapter.initialize();
    await adapter.set(noteKey('note-1'), '# One');
    await adapter.set('local:notes-current-id', 'note-1');

    const entries = await adapter.entries();
    expect(entries).toEqual([
      ['local:notes-current-id', 'note-1'],
      ['local:note-1', '# One'],
    ]);
    expect(await adapter.measure()).toBe(
      entries.reduce((total, [key, value]) => total + (key.length + value.length) * 2, 0)
    );
  });

  it('measures an empty folder as nothing and reports the folder as the mode', async () => {
    const driver = createMemoryDriver({ name: 'Dropbox notes' });
    const adapter = createFolderAdapter({ driver });

    expect(await adapter.measure()).toBe(0);
    expect(await adapter.initialize()).toEqual({
      mode: 'folder',
      message: 'Notes are .md files in “Dropbox notes”',
    });
  });

  it('rebuilds a sidecar nobody can parse from the markdown beside it', async () => {
    const driver = createMemoryDriver({
      files: { [FOLDER_STATE_FILE]: '{not json at all', 'a note.md': 'still here' },
    });
    const adapter = createFolderAdapter({ driver });
    await adapter.initialize();

    expect(await adapter.keys()).toEqual([noteKey('note-a-note')]);
    expect(await adapter.get(noteKey('note-a-note'))).toEqual({ value: 'still here' });
  });
});

/**
 * A scan and a save run at the same time in the real app: the orphan scan reads
 * `keys()` while the debounced save is writing. The driver here pauses *after*
 * the file has landed and before the sidecar has been told, which is the window
 * the report came from — two rows with the same title, `alpha.md` empty and
 * `alpha-2.md` holding the text.
 */
const pausedDriver = () => {
  const driver = createMemoryDriver();
  const realWrite = driver.writeFile.bind(driver);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let pausing = false;
  driver.writeFile = async (fileName, text) => {
    await realWrite(fileName, text);
    if (pausing) await gate;
  };
  return {
    driver,
    pause: () => {
      pausing = true;
    },
    release: () => release(),
  };
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const markdownFiles = (driver) =>
  [...driver.contents.keys()].filter((name) => /\.md$/i.test(name)).sort();

describe('a scan that runs while a save is in flight', () => {
  it('never reads the file a save is writing as a second note', async () => {
    const { driver, pause, release } = pausedDriver();
    const adapter = createFolderAdapter({ driver });
    await adapter.initialize();

    pause();
    const save = adapter.set(noteKey('note-1'), '# Alpha\n\nthe body of the note');
    await tick();
    const scan = adapter.keys();
    release();
    await save;

    expect((await scan).filter(isNoteStoreKey)).toEqual([noteKey('note-1')]);
    expect(markdownFiles(driver)).toEqual(['alpha.md']);
  });

  it('keeps the note on its own file when it is saved again', async () => {
    const { driver, pause, release } = pausedDriver();
    const adapter = createFolderAdapter({ driver });
    await adapter.initialize();

    pause();
    const save = adapter.set(noteKey('note-1'), '# Alpha\n\nthe body');
    await tick();
    const scan = adapter.keys();
    release();
    await Promise.all([save, scan]);

    await adapter.set(noteKey('note-1'), '# Alpha\n\nthe body of the note');

    expect(markdownFiles(driver)).toEqual(['alpha.md']);
    expect(driver.contents.get('alpha.md')).toBe('# Alpha\n\nthe body of the note');
  });

  it('never writes over a file that appeared in the folder by hand', async () => {
    const driver = createMemoryDriver();
    const adapter = createFolderAdapter({ driver });
    await adapter.initialize();

    // Dropped in while the notebook was open: the scan has not seen it yet, but
    // the folder has, and the folder is the truth.
    await driver.writeFile('alpha.md', 'written elsewhere');

    await adapter.set(noteKey('note-1'), '# Alpha\n\nthe body of the note');

    expect(driver.contents.get('alpha.md')).toBe('written elsewhere');
    expect(markdownFiles(driver)).toEqual(['alpha-2.md', 'alpha.md']);
    expect(await adapter.get(noteKey('note-1'))).toEqual({
      value: '# Alpha\n\nthe body of the note',
    });
  });
});
