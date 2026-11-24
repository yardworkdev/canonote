export function createNotesRepository(db) {
  if (!db) throw new Error('A Supabase database client is required.');

  const find = async (userId, noteId, { includeDeleted = false } = {}) => {
    let query = db
      .from('notes')
      .select('*')
      .eq('user_id', userId)
      .eq('note_id', noteId);
    if (!includeDeleted) query = query.is('deleted_at', null);
    const { data, error } = await query.limit(1);
    if (error) throw error;
    return data?.[0] || null;
  };

  /**
   * Just enough to answer "is this note here, and which revision" — no body.
   * The presence poll asks once every three seconds per open note, so it must
   * not carry the text of the note with it.
   */
  const meta = async (userId, noteId) => {
    const { data, error } = await db
      .from('notes')
      .select('note_id, version, agent_access')
      .eq('user_id', userId)
      .eq('note_id', noteId)
      .is('deleted_at', null)
      .limit(1);
    if (error) throw error;
    return data?.[0] || null;
  };

  /**
   * A note by whichever identifier the caller holds: the note id the routes are
   * documented with, or the row id a list used to hand out by mistake.
   */
  const findAny = async (userId, reference) => {
    const byNoteId = await find(userId, reference);
    if (byNoteId) return byNoteId;
    const byRowId = await db
      .from('notes')
      .select('*')
      .eq('user_id', userId)
      .eq('id', reference)
      .is('deleted_at', null)
      .limit(1);
    if (byRowId.error) throw byRowId.error;
    return byRowId.data?.[0] || null;
  };

  const list = async (userId, { limit = null } = {}) => {
    let query = db
      .from('notes')
      .select('*')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false });
    if (limit) query = query.limit(limit);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  };

  const insert = async (row) => {
    const { data, error } = await db.from('notes').insert(row).select('*').single();
    if (error) throw error;
    return data;
  };

  const update = async (
    userId,
    noteId,
    changes,
    { version = null, includeDeleted = false } = {}
  ) => {
    let query = db
      .from('notes')
      .update(changes)
      .eq('user_id', userId)
      .eq('note_id', noteId);
    if (!includeDeleted) query = query.is('deleted_at', null);
    if (version !== null) query = query.eq('version', version);
    const { data, error } = await query.select('*').maybeSingle();
    if (error) throw error;
    return data || null;
  };

  return { db, find, findAny, meta, list, insert, update };
}
