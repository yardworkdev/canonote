import JSZip from 'jszip';
import { createNoteId } from './ids';
import { previewFromMarkdown, titleFromMarkdown } from './markdown';

// Import closes the export-only asymmetry. Markdown is the only format the
// notebook stores, so importing is just: read `.md` text (or the `.md` files
// inside a `.zip` the app itself exports), split the small frontmatter block
// the exporter writes, and write each body into the notebook.
//
// The frontmatter parser is deliberately tiny and forgiving: it understands the
// fixed shape `export.js` writes (title/date/tags) and treats anything else as
// body text rather than throwing on a file the user did not export from here.

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const TEXT_FILE_RE = /\.(md|markdown|txt)$/i;
// Inside a zip, only markdown is a note — a stray README.txt from an archive
// must not become one. Loose .txt files the user picks directly still import.
const MARKDOWN_FILE_RE = /\.(md|markdown)$/i;

const stripQuotes = (value) => value.replace(/^["']|["']$/g, '');

export const parseFrontmatter = (text) => {
  const source = typeof text === 'string' ? text : '';
  const match = source.match(FRONTMATTER_RE);
  if (!match) return { data: {}, content: source };

  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim().toLowerCase();
    if (!key) continue;
    const raw = line.slice(sep + 1).trim();
    if (key === 'tags') {
      data.tags = raw
        .replace(/^\[/, '')
        .replace(/\]$/, '')
        .split(',')
        .map((tag) => stripQuotes(tag.trim()))
        .filter(Boolean);
    } else {
      data[key] = stripQuotes(raw);
    }
  }
  return { data, content: source.slice(match[0].length) };
};

export const titleFromFilename = (name) =>
  String(name || '')
    .split(/[\\/]/)
    .pop()
    .replace(MARKDOWN_FILE_RE, '')
    .replace(/[_-]+/g, ' ')
    .trim();

const toTimestamp = (value) => {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Date.now();
};

// A parsed markdown file → the note shape the notebook stores.
export const markdownToNote = (filename, text) => {
  const { data, content } = parseFrontmatter(text);
  const body = content.replace(/^\r?\n/, '');
  // Title order matches the app's own derivation: an explicit frontmatter
  // title wins, then the markdown's first line (the sidebar rule), and only
  // then the filename.
  const title =
    (data.title || '').trim() || titleFromMarkdown(body) || titleFromFilename(filename) || 'Untitled';
  return {
    title: title.slice(0, 200),
    // The list's second line, derived by the same rule the sidebar uses.
    preview: previewFromMarkdown(body),
    content: body,
    tags: Array.isArray(data.tags) ? data.tags : [],
    updated: data.date ? toTimestamp(data.date) : Date.now(),
  };
};

const readFileText = async (file) => {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
};

// Read a mixed selection of `.md`/`.markdown`/`.txt` files and `.zip` archives
// (the shape "export all notes" writes) into parsed notes.
export const readNotesFromFiles = async (fileList) => {
  const parsed = [];
  for (const file of Array.from(fileList || [])) {
    const name = file?.name || '';
    if (/\.zip$/i.test(name)) {
      const zip = await JSZip.loadAsync(file);
      const entries = Object.values(zip.files).filter(
        (entry) => !entry.dir && MARKDOWN_FILE_RE.test(entry.name)
      );
      for (const entry of entries) {
        const text = await entry.async('string');
        parsed.push(markdownToNote(entry.name, text));
      }
      continue;
    }
    if (TEXT_FILE_RE.test(name)) {
      parsed.push(markdownToNote(name, await readFileText(file)));
    }
  }
  return parsed;
};

const titleKey = (note) => (note?.title || '').trim().toLowerCase();

// Write parsed notes into the notebook behind `storage`. A note whose title
// already exists (or repeats earlier in the same batch) is skipped, so
// re-importing the same export does not duplicate the notebook.
export const importNotesIntoNotebook = async ({
  parsedNotes = [],
  existingNotes = [],
  storage,
  now = Date.now(),
  createId = createNoteId,
}) => {
  const seen = new Set(existingNotes.map(titleKey).filter(Boolean));
  const imported = [];
  let skipped = 0;

  for (const note of parsedNotes) {
    const key = titleKey(note);
    if (key && seen.has(key)) {
      skipped += 1;
      continue;
    }
    const id = createId();
    await window.storage.set(storage.noteStorageKey(id), note.content ?? '');
    imported.push({
      id,
      note_id: id,
      title: note.title || 'Untitled',
      preview: note.preview || '',
      tags: note.tags || [],
      updated: Number.isFinite(note.updated) ? note.updated : now,
      isPinned: false,
      folder: 'private',
      revision: null,
    });
    if (key) seen.add(key);
  }

  return { imported, skipped };
};
