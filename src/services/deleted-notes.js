/**
 * Notes deleted in this session.
 *
 * A note can be deleted while a save for it is still in flight (the editor
 * keeps saving for a moment after the click). Without this registry that save
 * writes the content back, and the next page load resurrects the note — it
 * reappears in the sidebar as an orphan even though the user deleted it.
 *
 * Ids stay in the registry for the life of the page; they are unique, so a
 * later note can never collide with one.
 */

const deletedNoteIds = new Set();

export const markNoteDeleted = (noteId) => {
  if (noteId) deletedNoteIds.add(noteId);
};

export const isNoteDeleted = (noteId) => Boolean(noteId) && deletedNoteIds.has(noteId);

export const forgetDeletedNotes = () => deletedNoteIds.clear();
