import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  parseFrontmatter,
  titleFromFilename,
  markdownToNote,
  readNotesFromFiles,
  importNotesIntoNotebook,
} from './import';

describe('parseFrontmatter', () => {
  it('splits the exporter frontmatter from the body', () => {
    const { data, content } = parseFrontmatter(
      '---\ntitle: Meeting notes\ndate: 2026-06-20T10:00:00.000Z\ntags: [work, q3]\n---\n\n# Body\n\ntext'
    );
    expect(data.title).toBe('Meeting notes');
    expect(data.date).toBe('2026-06-20T10:00:00.000Z');
    expect(data.tags).toEqual(['work', 'q3']);
    expect(content).toBe('\n# Body\n\ntext');
  });

  it('treats a file without frontmatter as body text', () => {
    const { data, content } = parseFrontmatter('# Just a note\n\nhello');
    expect(data).toEqual({});
    expect(content).toBe('# Just a note\n\nhello');
  });

  it('does not throw on a malformed block', () => {
    const { content } = parseFrontmatter('---\nnot yaml at all\n');
    expect(content).toContain('not yaml');
  });
});

describe('titleFromFilename', () => {
  it('strips the extension and separators', () => {
    expect(titleFromFilename('my_first-note.md')).toBe('my first note');
    expect(titleFromFilename('/tmp/notes/roadmap.markdown')).toBe('roadmap');
  });
});

describe('markdownToNote', () => {
  it('prefers the frontmatter title', () => {
    const note = markdownToNote('file.md', '---\ntitle: From frontmatter\n---\n\n# Heading\nbody');
    expect(note.title).toBe('From frontmatter');
    expect(note.content).toBe('# Heading\nbody');
  });

  it('falls back to the first line, then the filename', () => {
    expect(markdownToNote('file.md', '# The real title\n\nbody').title).toBe('The real title');
    // No heading: the first line is the title, exactly as the sidebar shows it.
    expect(markdownToNote('fallback-name.md', 'no heading here').title).toBe('no heading here');
    // Nothing in the body: the filename is the last resort.
    expect(markdownToNote('from-the-name.md', '').title).toBe('from the name');
  });

  it('reads the date into an updated timestamp', () => {
    const note = markdownToNote('x.md', '---\ndate: 2026-06-20T10:00:00.000Z\n---\nbody');
    expect(note.updated).toBe(new Date('2026-06-20T10:00:00.000Z').getTime());
  });
});

describe('readNotesFromFiles', () => {
  it('reads markdown files into parsed notes', async () => {
    const files = [
      new File(['# One\n\nalpha'], 'one.md', { type: 'text/markdown' }),
      new File(['two body'], 'two.markdown'),
      new File(['ignored'], 'image.png'),
    ];
    const notes = await readNotesFromFiles(files);
    expect(notes.map((n) => n.title)).toEqual(['One', 'two body']);
  });

  it('reads the .md files inside a zip export', async () => {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    zip.folder('notes').file('Alpha.md', '---\ntitle: Alpha\n---\n\nalpha body');
    zip.folder('notes').file('Beta.md', '# Beta\n\nbeta body');
    zip.file('readme.txt', 'not markdown');
    const blob = await zip.generateAsync({ type: 'blob' });
    const file = new File([blob], 'notes-export.zip', { type: 'application/zip' });

    const notes = await readNotesFromFiles([file]);
    expect(notes.map((n) => n.title).sort()).toEqual(['Alpha', 'Beta']);
    const alpha = notes.find((n) => n.title === 'Alpha');
    expect(alpha.content).toBe('alpha body');
  });
});

describe('importNotesIntoNotebook', () => {
  beforeEach(() => {
    window.storage = { set: vi.fn(() => Promise.resolve()), get: vi.fn(), delete: vi.fn() };
  });

  const storage = {
    noteStorageKey: (id) => `user-1:${id}`,
  };

  it('writes each note body and returns its metadata', async () => {
    const ids = ['note-1', 'note-2'];
    const { imported, skipped } = await importNotesIntoNotebook({
      parsedNotes: [
        { title: 'Alpha', content: 'alpha body', tags: [], updated: 1 },
        { title: 'Beta', content: 'beta body', tags: [], updated: 2 },
      ],
      storage,
      createId: () => ids.shift(),
    });

    expect(skipped).toBe(0);
    expect(imported.map((n) => n.title)).toEqual(['Alpha', 'Beta']);
    expect(window.storage.set).toHaveBeenCalledWith('user-1:note-1', 'alpha body');
    expect(window.storage.set).toHaveBeenCalledWith('user-1:note-2', 'beta body');
  });

  it('skips notes whose title already exists, so re-imports do not duplicate', async () => {
    const { imported, skipped } = await importNotesIntoNotebook({
      parsedNotes: [{ title: 'Alpha', content: 'new body' }],
      existingNotes: [{ title: 'alpha' }],
      storage,
      createId: () => 'note-x',
    });

    expect(imported).toHaveLength(0);
    expect(skipped).toBe(1);
    expect(window.storage.set).not.toHaveBeenCalled();
  });
});
