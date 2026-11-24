import crypto from 'node:crypto';
import { canonicalRevision, normalizeCanonicalNote } from './canonical-note.js';
import { isAgentActor, spansAfterWrite } from './attribution.js';

export class NotesDomainError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {{ status?: number, currentNote?: unknown }} [options]
   */
  constructor(code, message, { status, currentNote = null } = {}) {
    super(message);
    this.name = 'NotesDomainError';
    this.code = code;
    this.status = status;
    this.currentNote = currentNote;
  }
}

export function createNotesService(repository) {
  const get = async (userId, noteId) => {
    const row = await repository.find(userId, noteId);
    if (!row) throw new NotesDomainError('NOTE_NOT_FOUND', 'Note not found', { status: 404 });
    return row;
  };

  const list = async (userId) => repository.list(userId);

  /**
   * Is this note here, and which revision — without its text. Presence asks
   * this on every poll, so it must not read the body.
   */
  const meta = async (userId, noteId) => repository.meta(userId, noteId);

  // Just the number that moves when the text does. The presence poll asks this
  // once every three seconds per open note, so it reads one column and returns
  // null for a note that is gone or was never there.
  const revision = async (userId, noteId) => {
    const row = await repository
      .find(userId, noteId, { includeDeleted: true })
      .catch(() => null);
    return row ? canonicalRevision(row) : null;
  };

  const create = async (actor, input = {}) => {
    if (!actor?.userId) {
      throw new NotesDomainError('VALIDATION_ERROR', 'A user-scoped identity is required.', {
        status: 400,
      });
    }
    const noteId =
      typeof input.noteId === 'string' && input.noteId.trim()
        ? input.noteId.trim()
        : `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const existing = await repository.find(actor.userId, noteId, { includeDeleted: true });
    if (existing) {
      throw new NotesDomainError('NOTE_EXISTS', 'A note with this ID already exists.', {
        status: 409,
        currentNote: existing.deleted_at
          ? null
          : normalizeCanonicalNote(existing, { includeContent: true }),
      });
    }
    const now = new Date().toISOString();
    const content = typeof input.content === 'string' ? input.content : '';
    return repository.insert({
      id: crypto.randomUUID(),
      user_id: actor.userId,
      note_id: noteId,
      title:
        typeof input.title === 'string' && input.title.trim()
          ? input.title.trim()
          : content.split('\n')[0].trim().slice(0, 50) || 'Untitled',
      content,
      folder:
        typeof input.folder === 'string' && input.folder.trim() ? input.folder.trim() : 'private',
      is_pinned: Boolean(input.isPinned),
      created_by: actor.id,
      created_by_name: actor.name,
      updated_by: actor.id,
      updated_by_name: actor.name,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      // A note an agent opened is the agent's text from the first character.
      agent_spans: isAgentActor(actor.id) && content ? [{ start: 0, end: content.length }] : [],
    });
  };

  const update = async (actor, noteId, changes, expectedRevision) => {
    const existing = await get(actor.userId, noteId);
    const currentRevision = canonicalRevision(existing);
    const currentNote = normalizeCanonicalNote(existing, { includeContent: true });
    if (!expectedRevision) {
      throw new NotesDomainError('PRECONDITION_REQUIRED', 'A note revision is required.', {
        status: 428,
        currentNote,
      });
    }
    if (!Number.isFinite(Number(expectedRevision))) {
      throw new NotesDomainError('PRECONDITION_REQUIRED', 'Invalid revision format.', {
        status: 428,
        currentNote,
      });
    }
    if (expectedRevision !== currentRevision) {
      throw new NotesDomainError('REVISION_CONFLICT', 'The note changed since it was loaded.', {
        status: 409,
        currentNote,
      });
    }

    const versionNum = Number(currentRevision);
    if (!Number.isFinite(versionNum)) {
      throw new NotesDomainError('PRECONDITION_REQUIRED', 'Invalid revision format.', {
        status: 428,
        currentNote,
      });
    }
    // Who wrote which characters is recorded with the text, not reconstructed
    // later: remap the spans through this edit, and if the writer is an agent,
    // add the region it brought in.
    const nextChanges = { ...changes };
    if (typeof changes.content === 'string' && changes.content !== (existing.content || '')) {
      nextChanges.agent_spans = spansAfterWrite({
        before: existing.content || '',
        after: changes.content,
        spans: existing.agent_spans,
        actorId: actor.id,
      });
    }

    const row = await repository.update(
      actor.userId,
      noteId,
      { ...nextChanges, updated_by: actor.id, updated_by_name: actor.name },
      { version: versionNum }
    );
    if (!row) {
      const latest = await repository.find(actor.userId, noteId);
      throw new NotesDomainError(
        latest ? 'REVISION_CONFLICT' : 'NOTE_NOT_FOUND',
        latest ? 'The note changed since it was loaded.' : 'Note not found',
        {
          status: latest ? 409 : 404,
          currentNote: latest
            ? normalizeCanonicalNote(latest, { includeContent: true })
            : null,
        }
      );
    }
    return row;
  };

  const remove = async (actor, noteId, expectedRevision) =>
    update(
      actor,
      noteId,
      { deleted_at: new Date().toISOString() },
      expectedRevision
    );

  return { create, get, list, meta, revision, update, remove };
}
