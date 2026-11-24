import { useState, useEffect, useRef, useCallback } from 'react';
import { hasDisplayableTitle, normalizeNotesMetadata } from '../utils/notes';
import { notesApi } from '../services/notes-api';
import { isSupabaseConfigured } from '../services/supabase';
import { isNoteDeleted, markNoteDeleted } from '../services/deleted-notes';
import { createNoteId } from '../utils/ids';
import { PLACEHOLDER_NOTE_ID } from '../constants/notes';
import { readNotesFromFiles, importNotesIntoNotebook } from '../utils/import';
import { previewFromMarkdown, titleFromMarkdown } from '../utils/markdown';
import { draftKeyFor, readStoreEntries, replayJournal } from '../services/note-journal';
import { noteHistoryKey } from '../services/note-history';
import { logSaveDebug } from '../utils/saveDebugLogger';

const DEFAULT_NOTE_ID = PLACEHOLDER_NOTE_ID;
const NOTES_BROADCAST_CHANNEL = 'notes-sync';

export const useNotes = (user, storage) => {
  const [notes, setNotes] = useState([]);
  const [currentNoteId, setCurrentNoteId] = useState(PLACEHOLDER_NOTE_ID);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchTimeoutRef = useRef(null);
  const searchRequestRef = useRef(0);
  const metadataIssueWarnedRef = useRef(false);
  const broadcastRef = useRef(null);
  const loadVersionRef = useRef(0);
  // Latest notes, for the local search path, without re-running the debounce
  // every time a note changes.
  const notesRef = useRef([]);
  // Notes deleted in this session, so an in-flight save cannot resurrect one.
  const deletedNoteIdsRef = useRef(new Set());
  // Every change the notebook itself made to the list (created, imported,
  // renamed, pinned, deleted). A load that started before such a change is
  // reading older state than the notebook already has, so it must not be
  // applied over it: `loadVersionRef` guards load against load, this guards
  // load against change.
  const localChangeRef = useRef(0);
  const noteLocalChange = useCallback(() => {
    localChangeRef.current += 1;
  }, []);

  const normalizeNotes = useCallback((incomingNotes, source = 'notes') => {
    const { notes: normalizedNotes, issues } = normalizeNotesMetadata(incomingNotes);
    const issueCount = Object.values(issues).reduce((sum, count) => sum + count, 0);
    if (import.meta.env.DEV && issueCount > 0 && !metadataIssueWarnedRef.current) {
      metadataIssueWarnedRef.current = true;
      console.warn(
        `[notes] Normalized ${issueCount} invalid note metadata field(s) from ${source}.`,
        issues
      );
    }
    return normalizedNotes;
  }, []);

  const publishNotesChanged = useCallback((detail = {}) => {
    broadcastRef.current?.postMessage({ type: 'notes-changed', ...detail });
  }, []);

  const persistNotesCache = useCallback(
    async (nextNotes) => {
      const key = storage?.scopedKey?.('notes-cache');
      if (!key) return;
      await window.storage.set(key, JSON.stringify(nextNotes));
    },
    [storage]
  );

  const readNotesCache = useCallback(async () => {
    const key = storage?.scopedKey?.('notes-cache');
    if (!key) return [];
    const stored = await window.storage.get(key);
    if (!stored?.value) return [];
    try {
      return normalizeNotes(JSON.parse(stored.value), 'offline notes cache');
    } catch {
      return [];
    }
  }, [normalizeNotes, storage]);

  // Scan the store for note content that has no row in the known set. This
  // recovers notes whose cache entry was lost (e.g. overwritten after a failed
  // POST). It reads through the seam rather than reaching into `localStorage`:
  // the store is the seam's business, and a scan that assumes which store it is
  // would stop working the day the store changes.
  //
  // The same read feeds the list's previews: the store is enumerated once per
  // load (`readNoteContents`) and both questions are answered from it, rather
  // than a second pass over every note.
  const scanOrphanContentKeys = useCallback(
    (knownIds, contents) => {
      if (!user?.id || !contents) return [];
      const orphans = [];
      for (const [noteId, content] of contents) {
        if (knownIds.has(noteId)) continue;
        // A note deleted in this session is not an orphan to recover.
        if (isNoteDeleted(noteId)) continue;
        if (!content.trim()) continue;
        orphans.push({
          id: noteId,
          note_id: noteId,
          // One title rule for the whole app, not a second one here.
          title: titleFromMarkdown(content) || 'Untitled',
          preview: previewFromMarkdown(content),
          updated: Date.now(),
          isPinned: false,
          folder: 'private',
          revision: null,
        });
      }
      return orphans;
    },
    [user?.id]
  );

  // Every note's stored content, keyed by note id. The orphan scan and the
  // list previews are two questions about one read.
  const readNoteContents = useCallback(async () => {
    const contents = new Map();
    if (!user?.id) return contents;
    const prefix = `${user.id}:`;
    for (const [key, content] of await readStoreEntries(window.storage)) {
      if (!key.startsWith(prefix)) continue;
      const noteId = key.slice(prefix.length); // e.g. "note-1780437351351-wi0u"
      if (!noteId.startsWith('note-')) continue;
      if (noteId.includes(':')) continue; // skip "note-draft:…", "note-versions:…" etc.
      contents.set(noteId, content);
    }
    return contents;
  }, [user?.id]);

  // Where the note list comes from: the cloud when one is configured,
  // otherwise the local notebook. In local-only mode we never call the API —
  // a request that can only fail would log an error and stall every load.
  //
  // It also reports whether the cache is worth writing back. The local store
  // already holds everything that was just read from it, so persisting the list
  // again is a write that can only overwrite whatever another writer (a second
  // tab, an agent) put there in the meantime — with an asynchronous store that
  // window is real, and losing it costs a note its title. So the cache is
  // written only when the load produced something the store did not have:
  // recovered orphan content or a replayed journal record. The cloud path is
  // the exception: there the cache is the local mirror of the list that just
  // arrived.
  const fetchNotesList = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      const cached = await readNotesCache();
      const contents = await readNoteContents();
      const orphans = scanOrphanContentKeys(new Set(cached.map((note) => note.id)), contents);
      // The row carries the note's second line, so the list says what a note is
      // about without opening it. Read from the store read above, not from a
      // second pass: the preview is a fact about content the load already has.
      const withPreviews = cached.map((note) => {
        const content = contents.get(note.id);
        if (typeof content !== 'string') return note;
        const preview = previewFromMarkdown(content);
        return preview === note.preview ? note : { ...note, preview };
      });
      const withOrphans = [...withPreviews, ...orphans];
      // An interrupted save left a journal record behind: writing it back is the
      // difference between "the text is gone" and "the note is here".
      const { restored } = await replayJournal({
        store: window.storage,
        userId: user?.id,
        notes: withOrphans,
        isDeleted: isNoteDeleted,
        noteKeyFor: (noteId) => storage?.noteStorageKey?.(noteId),
      });
      if (restored.length > 0) {
        logSaveDebug('journal-replay', {
          recovered: restored.length,
          noteIds: restored.map((note) => note.id),
        });
      }
      // A recovered note replaces the row it belongs to rather than joining it:
      // one note, one row, with the text the journal was holding.
      const merged = [...withOrphans];
      const indexById = new Map(merged.map((note, index) => [note.id, index]));
      restored.forEach((row) => {
        const index = indexById.get(row.id);
        if (index === undefined) {
          indexById.set(row.id, merged.length);
          merged.push(row);
          return;
        }
        merged[index] = { ...merged[index], ...row };
      });
      return {
        notes: normalizeNotes(merged, 'local notes'),
        shouldPersist: orphans.length > 0 || restored.length > 0,
      };
    }
    const data = await notesApi.list();
    return {
      notes: normalizeNotes(Array.isArray(data) ? data : [], 'supabase notes'),
      shouldPersist: true,
    };
  }, [normalizeNotes, readNotesCache, readNoteContents, scanOrphanContentKeys, user?.id, storage]);

  const loadNotes = useCallback(
    async ({ silent = false } = {}) => {
      if (!user || !storage) {
        setIsLoading(false);
        return;
      }

      // Version counter prevents a slow/stale load from overwriting a newer one.
      const thisLoad = ++loadVersionRef.current;
      const changesAtStart = localChangeRef.current;

      try {
        if (!silent) setIsLoading(true);
        const currentIdKey = storage.scopedKey('notes-current-id');
        const { notes: remoteNotes, shouldPersist } = await fetchNotesList();

        // Bail if a newer load has already started — don't overwrite its results.
        if (thisLoad !== loadVersionRef.current) return;
        // Bail if the notebook changed while the store was being read: a note
        // created, imported, renamed, pinned or deleted in that window is newer
        // than this read, and applying the read over it is how "Imported 1
        // note." ended up over an empty sidebar. The change already updated the
        // list; anything this read recovered is recovered again on the next load.
        if (localChangeRef.current !== changesAtStart) return;

        setNotes(remoteNotes);
        // Only when the load recovered something: see `fetchNotesList`.
        if (shouldPersist) await persistNotesCache(remoteNotes);

        if (thisLoad !== loadVersionRef.current) return;
        if (currentIdKey) {
          const savedCurrentId = await window.storage.get(currentIdKey);
          const requestedNoteId = savedCurrentId?.value || DEFAULT_NOTE_ID;
          let resolvedNoteId = requestedNoteId;

          if (requestedNoteId && requestedNoteId !== DEFAULT_NOTE_ID) {
            const existsInList = remoteNotes.some((note) => note.id === requestedNoteId);
            if (!existsInList) {
              resolvedNoteId = remoteNotes[0]?.id || DEFAULT_NOTE_ID;
              if (resolvedNoteId !== requestedNoteId) {
                await window.storage.set(currentIdKey, resolvedNoteId);
              }
            }
          }

          setCurrentNoteId(resolvedNoteId);
        }
      } catch (error) {
        console.error('Failed to load notes from API — falling back to local data:', error);
        if (thisLoad !== loadVersionRef.current) return;
        const cachedNotes = await readNotesCache();
        const cachedIds = new Set(cachedNotes.map((n) => n.id));
        const storageOrphans = await scanOrphanContentKeys(cachedIds);
        const fallbackNotes = [...cachedNotes, ...storageOrphans];
        if (thisLoad !== loadVersionRef.current) return;
        if (fallbackNotes.length > 0) {
          const normalizedFallback = normalizeNotes(fallbackNotes, 'fallback (cache + orphans)');
          setNotes(normalizedFallback);
          // Don't persistNotesCache here — the cache already contains this data and
          // persisting a potentially-smaller fallback set would permanently shrink it.
          const currentIdKey = storage.scopedKey('notes-current-id');
          const savedCurrentId = currentIdKey ? await window.storage.get(currentIdKey) : null;
          const requestedId = savedCurrentId?.value;
          setCurrentNoteId(
            normalizedFallback.some((note) => note.id === requestedId)
              ? requestedId
              : normalizedFallback[0]?.id || DEFAULT_NOTE_ID
          );
        } else {
          console.warn('No local notes found either — starting fresh');
        }
      } finally {
        if (thisLoad === loadVersionRef.current && !silent) setIsLoading(false);
      }
    },
    [user, storage, fetchNotesList, normalizeNotes, persistNotesCache, readNotesCache, scanOrphanContentKeys]
  );

  // Load notes list and current note ID on mount
  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  useEffect(() => {
    if (!user) return undefined;
    if (!('BroadcastChannel' in window)) return undefined;

    const channel = new BroadcastChannel(NOTES_BROADCAST_CHANNEL);
    broadcastRef.current = channel;
    channel.onmessage = (event) => {
      if (event?.data?.type === 'notes-changed') {
        loadNotes({ silent: true });
      }
    };

    return () => {
      if (broadcastRef.current === channel) broadcastRef.current = null;
      channel.close();
    };
  }, [loadNotes, user]);

  useEffect(() => {
    if (!user || !storage) return undefined;

    let cancelled = false;
    let debounceTimer = null;

    const refreshNotes = () => {
      if (cancelled || document.hidden) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (!cancelled && !document.hidden) void loadNotes({ silent: true });
        debounceTimer = null;
      }, 300);
    };

    window.addEventListener('focus', refreshNotes);
    document.addEventListener('visibilitychange', refreshNotes);

    return () => {
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      window.removeEventListener('focus', refreshNotes);
      document.removeEventListener('visibilitychange', refreshNotes);
    };
  }, [user, storage, loadNotes]);

  const createNewNote = async () => {
    if (!user) return;
    const newId = createNoteId();
    try {
      // Local-only mode: the note is created in browser storage. There is no
      // server row to POST, and a request that can only fail would leave the
      // user with a note that never appears.
      const data = isSupabaseConfigured()
        ? await notesApi.create({ noteId: newId, title: 'Untitled', content: '' })
        : {
            id: newId,
            note_id: newId,
            title: 'Untitled',
            content: '',
            updated: Date.now(),
            isPinned: false,
            revision: null,
          };
      const created = normalizeNotes([data], 'create note')[0] || {
        id: newId,
        title: 'Untitled',
        updated: Date.now(),
        isPinned: false,
      };
      noteLocalChange();
      setNotes((prev) => {
        const nextNotes = normalizeNotes([created, ...prev], 'create note state');
        void persistNotesCache(nextNotes).catch((cacheError) => {
          console.warn('Failed to cache created note metadata:', cacheError);
        });
        return nextNotes;
      });
      setCurrentNoteId(created.id);
      await window.storage.set(storage.scopedKey('notes-current-id'), created.id);
      publishNotesChanged({ noteId: created.id, action: 'create' });
      return created.id;
    } catch (error) {
      console.error('Failed to create note:', error);
    }
  };

  const switchNote = async (noteId) => {
    if (!user) return;
    try {
      setCurrentNoteId(noteId);
      await window.storage.set(storage.scopedKey('notes-current-id'), noteId);
      return noteId;
    } catch (error) {
      console.error('Failed to switch note:', error);
    }
  };

  // Keep the local search path pointed at the current notes.
  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);

  // One delete path for one note and for many. A bulk delete is the same
  // operation with more ids: one pass over the list, one cache write, one
  // broadcast, one removal of the content and the journal records. Calling the
  // single-note path in a loop would write the whole cache once per note and
  // leave a window where half the selection is gone.
  const deleteNotes = useCallback(
    async (noteIds) => {
      if (!user) return;
      const ids = [...new Set((noteIds || []).filter(Boolean))];
      if (ids.length === 0) return;

      // Everything that talks to the server or the store happens before the
      // state update, not inside it: React may call an updater more than once
      // (StrictMode does), and a delete must not be sent twice, or sent at all
      // from a render that is then thrown away.
      const currentNotes = notesRef.current || [];
      const doomed = currentNotes.filter((n) => ids.includes(n.id));
      if (doomed.length === 0) {
        console.warn('Attempted to delete non-existent notes:', ids);
        return;
      }
      const doomedIds = new Set(doomed.map((n) => n.id));

      doomedIds.forEach((noteId) => {
        markNoteDeleted(noteId);
        // Armed here as well as in the persisted tombstone: a save that was
        // already in flight when the user hit delete would otherwise re-add
        // the row to the list through updateNoteInList.
        deletedNoteIdsRef.current.add(noteId);
      });
      noteLocalChange();

      if (isSupabaseConfigured()) {
        // A delete that the server refused must be visible and must not remove
        // the local copy: otherwise the note comes back on the next load with its
        // text already gone.
        const results = await Promise.allSettled(
          doomed.map((note) => notesApi.delete(note.id, note.revision || null))
        );
        const failure = results.find(
          (result) =>
            result.status === 'rejected' && result.reason?.status !== 404
        );
        if (failure) {
          doomedIds.forEach((noteId) => {
            deletedNoteIdsRef.current.delete(noteId);
          });
          throw failure.reason;
        }
      }

      {
        const updatedNotes = currentNotes.filter((n) => !doomedIds.has(n.id));
        setNotes(updatedNotes);
        persistNotesCache(updatedNotes);
        publishNotesChanged({ noteIds: [...doomedIds], action: 'delete' });

        // Each note's content, its journal record and its version history go
        // together. A record left behind is replayed on the next open, which
        // would bring the deleted note back — the one thing a delete must
        // prevent — and version snapshots of a note that no longer exists are
        // dead weight the history panel can never reach.
        const doomedKeys = [];
        doomedIds.forEach((noteId) => {
          doomedKeys.push(
            storage.noteStorageKey(noteId),
            draftKeyFor(storage.scopedKey, noteId),
            noteHistoryKey(storage, noteId)
          );
        });
        const keys = doomedKeys.filter(Boolean);
        const removal =
          typeof window.storage.setMany === 'function'
            ? window.storage.setMany([], { remove: keys })
            : Promise.all(keys.map((key) => window.storage.delete(key)));
        removal.catch((contentError) => {
          console.warn('Failed to delete note content (note removed from list):', contentError);
        });
      }
    },
    [user, storage, publishNotesChanged, persistNotesCache, noteLocalChange]
  );

  const deleteNote = useCallback((noteId) => deleteNotes([noteId]), [deleteNotes]);

  const updateNoteInList = useCallback(
    (noteId, title, updatedTimestamp, metadata = {}) => {
      if (!user || !noteId) return;
      // A deleted note must stay deleted: a save that was already in flight
      // when the user hit delete would otherwise put it back in the list.
      if (deletedNoteIdsRef.current.has(noteId)) return;
      if (!title || title.trim().length === 0) return;

      noteLocalChange();
      setNotes((prev) => {
        const existing = prev.find((n) => n.id === noteId);
        let updatedNotes;
        if (existing) {
          updatedNotes = prev.map((n) =>
            n.id === noteId ? { ...n, ...metadata, title, updated: updatedTimestamp } : n
          );
        } else {
          updatedNotes = [
            ...prev,
            { id: noteId, title, updated: updatedTimestamp, isPinned: false, ...metadata },
          ];
        }
        const normalized = normalizeNotes(updatedNotes, 'update note');
        void persistNotesCache(normalized).catch((error) => {
          console.warn('Failed to cache updated note metadata:', error);
        });
        return normalized;
      });
    },
    [user, normalizeNotes, persistNotesCache, noteLocalChange]
  );

  const togglePinNote = useCallback(
    async (noteId) => {
      if (!user || !noteId) return;
      const current = notes.find((note) => note.id === noteId);
      if (!current) return;
      const nextPinned = !current.isPinned;

      // Local-only mode: pinning is local metadata, there is no server row.
      if (!isSupabaseConfigured()) {
        const updatedLocal = normalizeNotes(
          notes.map((note) => (note.id === noteId ? { ...note, isPinned: nextPinned } : note)),
          'toggle pin'
        );
        noteLocalChange();
        setNotes(updatedLocal);
        void persistNotesCache(updatedLocal).catch((cacheError) => {
          console.warn('Failed to cache pinned note metadata:', cacheError);
        });
        publishNotesChanged({ noteId, action: 'pin' });
        return;
      }

      try {
        const data = await notesApi.update(noteId, {
          isPinned: nextPinned,
          ifRevision: current.revision || null,
        });
        const updated = normalizeNotes([data], 'toggle pin response')[0];
        if (updated) {
          noteLocalChange();
          setNotes((prev) => {
            const nextNotes = normalizeNotes(
              prev.map((note) => (note.id === noteId ? { ...note, ...updated } : note)),
              'toggle pin'
            );
            void persistNotesCache(nextNotes).catch((cacheError) => {
              console.warn('Failed to cache pinned note metadata:', cacheError);
            });
            return nextNotes;
          });
        }
        publishNotesChanged({ noteId, action: 'pin' });
      } catch (error) {
        console.error('Failed to toggle pin:', error);
      }
    },
    [user, notes, normalizeNotes, persistNotesCache, publishNotesChanged, noteLocalChange]
  );

  // The per-note agent switch. Mirror of togglePinNote: same optimistic local write,
  // same server call, but this one decides whether the agent can see the note at all.
  // A local-only notebook has no server row and no agent, so the flag is just kept.
  const toggleAgentAccess = useCallback(
    async (noteId) => {
      if (!user || !noteId) return;
      const current = notes.find((note) => note.id === noteId);
      if (!current) return;
      const nextAccess = current.agentAccess === false;

      if (!isSupabaseConfigured()) {
        const updatedLocal = normalizeNotes(
          notes.map((note) =>
            note.id === noteId ? { ...note, agentAccess: nextAccess } : note
          ),
          'toggle agent access'
        );
        noteLocalChange();
        setNotes(updatedLocal);
        void persistNotesCache(updatedLocal).catch((cacheError) => {
          console.warn('Failed to cache agent access:', cacheError);
        });
        publishNotesChanged({ noteId, action: 'agent-access' });
        return;
      }

      try {
        const data = await notesApi.update(noteId, {
          agentAccess: nextAccess,
          ifRevision: current.revision || null,
        });
        const updated = normalizeNotes([data], 'toggle agent access response')[0];
        if (updated) {
          noteLocalChange();
          setNotes((prev) => {
            const nextNotes = normalizeNotes(
              prev.map((note) => (note.id === noteId ? { ...note, ...updated } : note)),
              'toggle agent access'
            );
            void persistNotesCache(nextNotes).catch((cacheError) => {
              console.warn('Failed to cache agent access:', cacheError);
            });
            return nextNotes;
          });
        }
        publishNotesChanged({ noteId, action: 'agent-access' });
      } catch (error) {
        console.error('Failed to toggle agent access:', error);
      }
    },
    [user, notes, noteLocalChange, persistNotesCache, publishNotesChanged]
  );

  // Import markdown files (or a zip the app itself exports) into the notebook.
  // Parsing lives in utils/import; this hook owns the state and cache write so
  // imported notes behave exactly like created ones.
  const importNotes = useCallback(
    async (fileList) => {
      if (!user || !storage) return { imported: 0, skipped: 0, firstId: null };
      const parsedNotes = await readNotesFromFiles(fileList);
      if (parsedNotes.length === 0) return { imported: 0, skipped: 0, firstId: null };

      const { imported, skipped } = await importNotesIntoNotebook({
        parsedNotes,
        existingNotes: notesRef.current,
        storage,
      });

      if (imported.length > 0) {
        noteLocalChange();
        setNotes((prev) => {
          const nextNotes = normalizeNotes([...imported, ...prev], 'import notes');
          void persistNotesCache(nextNotes).catch((error) => {
            console.warn('Failed to cache imported notes:', error);
          });
          return nextNotes;
        });
        publishNotesChanged({ action: 'import' });
      }

      return { imported: imported.length, skipped, firstId: imported[0]?.id || null };
    },
    [user, storage, normalizeNotes, persistNotesCache, publishNotesChanged, noteLocalChange]
  );

  // Debounced full-text search via API — searches all notes including unopened ones
  useEffect(() => {
    if (!searchQuery.trim() || !user) {
      setSearchResults([]);
      setIsSearching(false);
      searchRequestRef.current += 1;
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
      return;
    }

    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    setIsSearching(true);
    const requestId = ++searchRequestRef.current;

    searchTimeoutRef.current = setTimeout(() => {
      const runSearch = async () => {
        try {
          // Local-only mode: search the notebook itself (titles and the
          // content stored on this device) instead of a server index.
          const query = searchQuery.trim();
          let data;
          if (isSupabaseConfigured()) {
            data = await notesApi.search(query);
          } else {
            const needle = query.toLowerCase();
            const matches = await Promise.all(
              notesRef.current.map(async (note) => {
                if ((note.title || '').toLowerCase().includes(needle)) return note;
                const key = storage?.noteStorageKey?.(note.id);
                const stored = key ? await window.storage.get(key) : null;
                const content = stored?.value || '';
                return content.toLowerCase().includes(needle) ? note : null;
              })
            );
            data = matches.filter(Boolean);
          }
          if (requestId === searchRequestRef.current) {
            setSearchResults(Array.isArray(data) ? data : []);
            setIsSearching(false);
          }
        } catch (error) {
          console.error('Search failed:', error);
          if (requestId === searchRequestRef.current) {
            setSearchResults([]);
            setIsSearching(false);
          }
        }
      };
      runSearch();
    }, 300);

    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [searchQuery, user]);

  // Use search results when searching, otherwise filter by title
  const filteredNotes = (searchQuery.trim() ? searchResults : notes)
    .filter((note) => {
      return hasDisplayableTitle(note);
    })
    .sort((a, b) => {
      // Pinned notes first
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      // Then by updated timestamp
      return b.updated - a.updated;
    });

  const currentNote = notes.find((note) => note.id === currentNoteId) || null;
  const currentNoteTitle = currentNote?.title?.trim() || '';

  return {
    notes,
    setNotes,
    currentNoteId,
    currentNote,
    currentNoteTitle,
    setCurrentNoteId,
    searchQuery,
    setSearchQuery,
    createNewNote,
    switchNote,
    deleteNote,
    deleteNotes,
    importNotes,
    updateNoteInList,
    togglePinNote,
    toggleAgentAccess,
    filteredNotes,
    isLoading,
    isSearching,
  };
};
