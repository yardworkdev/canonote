// The editor opens on a placeholder note before the notebook has any note.
// The placeholder id has to live in the same id space as generated note ids
// (`note-…`): the orphan-content scan recovers a note from its storage key
// (`<user>:note-<id>`), so a placeholder id without that prefix would come back
// under a different id and be listed a second time.
export const PLACEHOLDER_NOTE_ID = 'note-default';

/** The empty pane before a first note exists is not a note the server knows. */
export const isPlaceholderNoteId = (noteId) => noteId === PLACEHOLDER_NOTE_ID;
