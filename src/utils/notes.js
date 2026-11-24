import { agentDisplayName, isAgentAuthor, isAgentNote } from '../constants/agent';

const VALID_FOLDERS = new Set(['private', 'agent', 'rudi']);

const toFiniteUpdated = (value, fallback) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' || value instanceof Date) {
    const parsed = new Date(value).getTime();
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

export const normalizeNoteMetadata = (note, options = {}) => {
  if (!note || typeof note !== 'object') {
    return { note: null, issues: { invalid_shape: 1 } };
  }

  const now = options.now ?? Date.now();
  const issues = {};
  const rawId = note.id;
  const id = typeof rawId === 'string' ? rawId.trim() : '';
  if (!id) {
    return { note: null, issues: { missing_id: 1 } };
  }

  const rawFolder = typeof note.folder === 'string' ? note.folder : 'private';
  const folder = VALID_FOLDERS.has(rawFolder) ? rawFolder : 'private';
  if (folder !== rawFolder) issues.invalid_folder = 1;

  const updated = toFiniteUpdated(note.updated, now);
  if (updated === now && note.updated != null && note.updated !== now) issues.invalid_updated = 1;

  // Who wrote last, in the only two categories the reader cares about: the
  // person, or an agent. `updatedBy` is a uuid for a person and 'agent' (or
  // 'agent_<label>') for an agent, so this needs no second request.
  const lastWriterIsAgent = isAgentAuthor(note.updatedBy);
  const createdByAgent = isAgentAuthor(note.createdBy);
  // Three states and nothing else: whose note is this.
  //   you    a person created it and a person wrote last
  //   agent  an agent did both
  //   both   one of each
  const writer = createdByAgent
    ? lastWriterIsAgent
      ? 'agent'
      : 'both'
    : lastWriterIsAgent
      ? 'both'
      : 'you';

  const normalized = {
    ...note,
    writer,
    lastWriterIsAgent,
    lastWriterName: lastWriterIsAgent ? agentDisplayName(note.updatedByName) : null,
    id,
    title: typeof note.title === 'string' ? note.title : '',
    // The line under the title in the note list. Metadata, not content: the row
    // must say what a note is about without the note being opened.
    preview: typeof note.preview === 'string' ? note.preview : '',
    folder,
    updated,
    isPinned: Boolean(note.isPinned),
    createdBy: typeof note.createdBy === 'string' ? note.createdBy : null,
  };

  return { note: normalized, issues };
};

export const normalizeNotesMetadata = (notes, options = {}) => {
  const list = Array.isArray(notes) ? notes : [];
  const normalized = [];
  const issues = {};

  for (const entry of list) {
    const { note, issues: rowIssues } = normalizeNoteMetadata(entry, options);
    if (note) normalized.push(note);
    Object.entries(rowIssues).forEach(([key, count]) => {
      issues[key] = (issues[key] || 0) + count;
    });
  }

  return { notes: normalized, issues };
};

export const hasDisplayableTitle = (note) =>
  typeof note?.title === 'string' && note.title.trim().length > 0;

const sortNotesByNewest = (notes) =>
  [...notes].sort((a, b) => {
    const aUpdated = Number.isFinite(a?.updated) ? a.updated : -Infinity;
    const bUpdated = Number.isFinite(b?.updated) ? b.updated : -Infinity;
    if (aUpdated !== bUpdated) return bUpdated - aUpdated;

    const aTitle = typeof a?.title === 'string' ? a.title : '';
    const bTitle = typeof b?.title === 'string' ? b.title : '';
    return aTitle.localeCompare(bTitle);
  });

export const classifyNotesForSidebar = ({
  notes = [],
  filteredNotes = [],
  searchQuery = '',
  now = Date.now(),
  agentName,
}) => {
  if (searchQuery.trim()) {
    return [{ key: 'search', title: 'Search Results', notes: sortNotesByNewest(filteredNotes) }];
  }

  const today = new Date(now).setHours(0, 0, 0, 0);
  const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

  const agentNotes = notes.filter(isAgentNote);
  // `folder` is stored on the note but a person has no control that sets it, so a
  // section keyed on it could only ever be empty from the browser. What a reader
  // actually needs to see - written by me, by an agent, or both - is authorship,
  // and that is what these sections say.
  const ownNotes = notes.filter((n) => !isAgentNote(n));

  const pinned = ownNotes.filter((n) => n.isPinned);
  const unpinned = ownNotes.filter((n) => !n.isPinned);
  const todayNotes = unpinned.filter((n) => {
    const noteTime = new Date(n.updated).getTime();
    if (!Number.isFinite(noteTime)) return false;
    return new Date(noteTime).setHours(0, 0, 0, 0) === today;
  });
  const recentNotes = unpinned.filter((n) => {
    const noteTime = new Date(n.updated).getTime();
    return Number.isFinite(noteTime) && noteTime > oneWeekAgo && noteTime < today;
  });
  const allNotes = unpinned.filter((n) => {
    const noteTime = new Date(n.updated).getTime();
    return !Number.isFinite(noteTime) || noteTime <= oneWeekAgo;
  });

  const sections = [];
  if (agentNotes.length > 0)
    sections.push({
      key: 'agent',
      // No accent flag: sections are told apart by their label, not by colour
      // (BRAND.md — one accent, and never meaning that only exists in colour).
      // The label is the name the user gave their agent, defaulting to a neutral one.
      // The agent's own name, taken from the notes it wrote, so the section says
      // "Promi" rather than a placeholder the person never chose.
      title: agentDisplayName(
        agentNotes.find((note) => note.updatedByName || note.createdByName)?.updatedByName ||
          agentNotes.find((note) => note.createdByName)?.createdByName ||
          agentName
      ),
      notes: sortNotesByNewest(agentNotes),
    });
  if (pinned.length > 0)
    sections.push({ key: 'pinned', title: 'Pinned', notes: sortNotesByNewest(pinned) });
  if (todayNotes.length > 0)
    sections.push({ key: 'today', title: 'Today', notes: sortNotesByNewest(todayNotes) });
  if (recentNotes.length > 0)
    sections.push({
      key: 'recent',
      title: 'Recent (7 days)',
      notes: sortNotesByNewest(recentNotes),
    });
  if (allNotes.length > 0) {
    sections.push({
      key: 'all',
      title: 'All Notes',
      notes: sortNotesByNewest(allNotes),
    });
  }

  return sections;
};
