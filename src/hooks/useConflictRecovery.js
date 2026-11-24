import { useCallback, useRef, useState } from 'react';
import { logSaveDebug } from '../utils/saveDebugLogger';

export const useConflictRecovery = ({
  noteId,
  storage,
  editorRef,
  contentRef,
  lastContentRef,
  setContent,
}) => {
  const [conflictState, setConflictState] = useState(null);
  const conflictSnapshotRef = useRef(null);
  const hasConflictRef = useRef(false);
  const conflictMessage =
    'This note was updated in another tab. Reload, restore your draft, or explicitly save it.';

  const getConflictDraftKey = useCallback(
    (targetNoteId = noteId) => {
      if (!storage?.scopedKey || !targetNoteId) return null;
      return storage.scopedKey(`conflict-draft:${targetNoteId}`);
    },
    [noteId, storage]
  );

  const persistConflictSnapshot = useCallback(
    async (snapshot) => {
      const key = getConflictDraftKey(snapshot?.noteId);
      if (!key || !snapshot) return;
      await window.storage.set(key, JSON.stringify(snapshot));
    },
    [getConflictDraftKey]
  );

  const clearPersistedConflictSnapshot = useCallback(
    async (targetNoteId = noteId) => {
      const key = getConflictDraftKey(targetNoteId);
      if (!key) return;
      await window.storage.delete(key);
    },
    [getConflictDraftKey, noteId]
  );

  const readPersistedConflictSnapshot = useCallback(
    async (targetNoteId = noteId) => {
      const key = getConflictDraftKey(targetNoteId);
      if (!key) return null;
      try {
        const saved = await window.storage.get(key);
        if (!saved?.value) return null;
        const parsed = JSON.parse(saved.value);
        if (!parsed || typeof parsed !== 'object') return null;
        if (parsed.noteId !== targetNoteId) return null;
        if (typeof parsed.localContent !== 'string') return null;
        return {
          noteId: targetNoteId,
          storageKey:
            typeof parsed.storageKey === 'string'
              ? parsed.storageKey
              : storage?.noteStorageKey?.(targetNoteId) || null,
          localContent: parsed.localContent,
          incomingContent: typeof parsed.incomingContent === 'string' ? parsed.incomingContent : '',
          savedContent: typeof parsed.savedContent === 'string' ? parsed.savedContent : '',
          detectedAt:
            typeof parsed.detectedAt === 'string' ? parsed.detectedAt : new Date().toISOString(),
        };
      } catch {
        return null;
      }
    },
    [getConflictDraftKey, noteId, storage]
  );

  const createConflictSnapshot = useCallback(
    (incomingContent) => ({
      noteId,
      storageKey: storage?.noteStorageKey?.(noteId) || null,
      localContent: contentRef.current,
      incomingContent,
      savedContent: lastContentRef.current,
      detectedAt: new Date().toISOString(),
    }),
    [contentRef, lastContentRef, noteId, storage]
  );

  const applyConflictSnapshot = useCallback(
    (status, snapshot) => {
      if (!snapshot) {
        return null;
      }

      conflictSnapshotRef.current = snapshot;
      hasConflictRef.current = status === 'conflicted';
      setConflictState({ status, snapshot });
      if (status === 'conflicted') {
        logSaveDebug('conflict-detected', {
          noteId: snapshot.noteId,
          localLength: snapshot.localContent?.length || 0,
          incomingLength: snapshot.incomingContent?.length || 0,
        });
        void persistConflictSnapshot(snapshot).catch((error) => {
          console.error('Failed to persist conflict draft:', error);
        });
      } else if (snapshot?.noteId) {
        logSaveDebug('conflict-status-changed', {
          noteId: snapshot.noteId,
          status,
        });
        void clearPersistedConflictSnapshot(snapshot.noteId).catch((error) => {
          console.error('Failed to clear persisted conflict draft:', error);
        });
      }
      return snapshot;
    },
    [clearPersistedConflictSnapshot, persistConflictSnapshot]
  );

  const setConflictRecovery = useCallback(
    (status, incomingContent = null) => {
      const snapshot =
        incomingContent !== null
          ? createConflictSnapshot(incomingContent)
          : conflictSnapshotRef.current;

      return applyConflictSnapshot(status, snapshot);
    },
    [applyConflictSnapshot, createConflictSnapshot]
  );

  const clearConflictRecovery = useCallback(
    ({
      clearPersisted = false,
      targetNoteId = conflictSnapshotRef.current?.noteId || noteId,
    } = {}) => {
      setConflictState(null);
      conflictSnapshotRef.current = null;
      hasConflictRef.current = false;
      if (clearPersisted && targetNoteId) {
        void clearPersistedConflictSnapshot(targetNoteId).catch((error) => {
          console.error('Failed to clear persisted conflict draft:', error);
        });
      }
    },
    [clearPersistedConflictSnapshot, noteId]
  );

  const updateConflictDraft = useCallback(
    (markdown) => {
      if (!hasConflictRef.current || !conflictSnapshotRef.current) return;

      const nextSnapshot = {
        ...conflictSnapshotRef.current,
        localContent: markdown,
      };
      conflictSnapshotRef.current = nextSnapshot;
      setConflictState({ status: 'conflicted', snapshot: nextSnapshot });
      void persistConflictSnapshot(nextSnapshot).catch((error) => {
        console.error('Failed to persist conflict draft:', error);
      });
    },
    [persistConflictSnapshot]
  );

  const restoreConflictDraftContent = useCallback(
    (options = {}) => {
      if (!conflictSnapshotRef.current) return false;
      const nextContent = conflictSnapshotRef.current.localContent ?? '';
      logSaveDebug('conflict-draft-restored', {
        noteId: conflictSnapshotRef.current.noteId,
        shouldFocus: Boolean(options.shouldFocus),
        localLength: nextContent.length,
      });
      setContent(nextContent);
      // The textarea is driven by `content` state; only move focus.
      if (editorRef.current && options.shouldFocus) {
        editorRef.current.focus?.();
        editorRef.current.setSelection?.(nextContent.length);
      }
      setConflictRecovery('conflicted');
      return true;
    },
    [editorRef, setConflictRecovery, setContent]
  );

  const copyConflictToClipboard = useCallback(async () => {
    const draft = conflictSnapshotRef.current?.localContent;
    if (typeof draft !== 'string') return false;
    if (!navigator?.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(draft);
    return true;
  }, []);

  const conflictSnapshot = conflictState?.snapshot || conflictSnapshotRef.current;
  const hasConflict = conflictState?.status === 'conflicted';
  const conflictStatus = conflictState?.status || 'idle';

  return {
    conflictState,
    conflictSnapshotRef,
    conflictSnapshot,
    hasConflict,
    hasConflictRef,
    conflictStatus,
    conflictMessage,
    persistConflictSnapshot,
    clearPersistedConflictSnapshot,
    readPersistedConflictSnapshot,
    applyConflictSnapshot,
    setConflictRecovery,
    clearConflictRecovery,
    updateConflictDraft,
    restoreConflictDraftContent,
    copyConflictToClipboard,
  };
};
