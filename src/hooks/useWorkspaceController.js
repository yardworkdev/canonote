import { useCallback, useRef } from 'react';
import { dialog } from '../utils/dialog';

export const useWorkspaceController = ({
  editor,
  notes,
  primaryPane,
  secondaryPane,
  showNotice,
}) => {
  const focusPane = useCallback(
    (paneId) => {
      if (paneId === 'secondary' && !editor.splitViewEnabled) return;
      editor.setActivePaneId(paneId);
    },
    [editor]
  );

  const flushPaneDraft = useCallback(async (pane) => {
    if (!pane?.flushPendingChanges) return false;
    try {
      return await pane.flushPendingChanges();
    } catch (error) {
      console.error('Failed to flush pending note changes:', error);
      return false;
    }
  }, []);

  const handleSwitchNote = useCallback(
    async (
      noteId,
      paneId = editor.splitViewEnabled ? editor.activePaneId : 'primary',
      options = {}
    ) => {
      if (!noteId) return;
      const wantsSecondary = paneId === 'secondary';
      const targetPane = wantsSecondary ? 'secondary' : 'primary';
      const { allowReassign = false } = options;

      if (targetPane === 'secondary' && !editor.splitViewEnabled) {
        await editor.openSplitView();
      }

      const currentPrimaryId = editor.primaryNoteId;
      const currentSecondaryId = editor.secondaryNoteId;
      const existingPane =
        noteId === currentPrimaryId
          ? 'primary'
          : noteId === currentSecondaryId
            ? 'secondary'
            : null;

      if (existingPane) {
        if (existingPane === targetPane) {
          // A row click must always show the note's content. Focus alone is only
          // enough when the pane actually has the note loaded — a pane can hold
          // the id without having loaded it (e.g. the placeholder it opened on).
          const pane = existingPane === 'primary' ? primaryPane : secondaryPane;
          if (pane && !pane.hasNote) {
            await notes.switchNote(noteId);
            await pane.loadNoteContent(noteId, { shouldFocus: true });
          }
          focusPane(existingPane);
          return;
        }

        const canReassign =
          allowReassign && existingPane === 'secondary' && targetPane === 'primary';

        if (canReassign) {
          await flushPaneDraft(primaryPane);
          await flushPaneDraft(secondaryPane);
          await notes.switchNote(noteId);
          await primaryPane?.loadNoteContent(noteId, { shouldFocus: true });
          editor.setActivePaneId('primary');
          editor.setSecondaryNoteId(null);
          return;
        }

        focusPane(existingPane);
        showNotice?.('noteAlreadyOpen');
        return;
      }

      if (targetPane === 'primary') {
        if (noteId !== currentPrimaryId) {
          // Blank at the click: the flush is a round trip, and the pane must not
          // keep showing the note being left while it drains.
          primaryPane?.hideForSwitch?.();
          await flushPaneDraft(primaryPane);
          await notes.switchNote(noteId);
          await primaryPane?.loadNoteContent(noteId, { shouldFocus: true });
        }
      } else {
        await flushPaneDraft(secondaryPane);
        editor.setSecondaryNoteId(noteId);
        await secondaryPane?.loadNoteContent(noteId, { shouldFocus: true });
      }

      editor.setActivePaneId(targetPane);
    },
    [editor, focusPane, flushPaneDraft, notes, primaryPane, secondaryPane, showNotice]
  );

  const createNoteInPane = useCallback(
    async (paneId) => {
      const wantsSecondary = paneId === 'secondary';
      const targetPane = wantsSecondary && editor.splitViewEnabled ? 'secondary' : 'primary';

      if (targetPane === 'primary') {
        // Close the pane to new content first. The flush and the create are both
        // round trips, and in that window the pane still carries the old note's
        // id — a load or a save response that lands there repaints the old text,
        // and a keystroke goes into the note the person just left.
        primaryPane?.beginPaneTransition?.();
        // Blank the pane now, before the flush: the outgoing text is saved from the
        // pane's refs during the transition, so the screen does not have to hold it.
        primaryPane?.resetForNewNote?.();
        // The caret moves at the click, not after the round trip. The button keeps
        // focus, and every space typed while the note is being created re-activates
        // it — "one two" became three blank notes.
        primaryPane?.focusEditor?.();
        await flushPaneDraft(primaryPane);
        // A filter that matched nothing would otherwise hide the note that was
        // just created, and the person would create it again.
        notes.setSearchQuery?.('');
        const newId = await notes.createNewNote();
        if (!newId) return null;
        await primaryPane?.loadNoteContent(newId, { shouldFocus: true });
        primaryPane?.focusEditor?.();
        editor.setActivePaneId('primary');
        return newId;
      }

      if (!editor.splitViewEnabled) {
        await editor.openSplitView();
      }
      await flushPaneDraft(secondaryPane);
      const newId = await notes.createNewNote();
      if (!newId) return null;
      editor.setSecondaryNoteId(newId);
      await secondaryPane?.loadNoteContent(newId, { shouldFocus: true });
      editor.setActivePaneId('secondary');
      return newId;
    },
    [editor, flushPaneDraft, notes, primaryPane, secondaryPane]
  );

  const handleCreateNote = useCallback(
    async (paneId = editor.splitViewEnabled ? editor.activePaneId : 'primary') => {
      // One create at a time: a second press while the first is in flight would
      // make a second blank note for the same intention.
      if (creatingRef.current) return null;
      creatingRef.current = true;
      try {
        return await createNoteInPane(paneId);
      } finally {
        creatingRef.current = false;
      }
    },
    [createNoteInPane, editor.activePaneId, editor.splitViewEnabled]
  );

  const handleCloseSecondaryPane = useCallback(async () => {
    await flushPaneDraft(secondaryPane);
    editor.closeSplitView();
    focusPane('primary');
  }, [editor, flushPaneDraft, focusPane, secondaryPane]);

  const handleClosePrimaryPane = useCallback(async () => {
    if (!editor.splitViewEnabled || !editor.secondaryNoteId) {
      await handleCloseSecondaryPane();
      return;
    }
    const nextPrimaryId = editor.secondaryNoteId;
    await handleSwitchNote(nextPrimaryId, 'primary', { allowReassign: true });
    await handleCloseSecondaryPane();
  }, [editor.secondaryNoteId, editor.splitViewEnabled, handleCloseSecondaryPane, handleSwitchNote]);

  const handleClosePane = useCallback(
    async (paneId) => {
      if (paneId === 'secondary') {
        await handleCloseSecondaryPane();
        return;
      }
      await handleClosePrimaryPane();
    },
    [handleClosePrimaryPane, handleCloseSecondaryPane]
  );

  const handleAddEditorPane = useCallback(async () => {
    const id = await editor.openSplitView();
    const noteId = id || editor.secondaryNoteId;
    if (noteId) {
      await secondaryPane?.loadNoteContent(noteId, { shouldFocus: true });
    }
  }, [editor, secondaryPane]);

  const handleToggleSplitView = useCallback(async () => {
    if (editor.splitViewEnabled) {
      await handleCloseSecondaryPane();
      return;
    }
    await handleAddEditorPane();
  }, [editor.splitViewEnabled, handleAddEditorPane, handleCloseSecondaryPane]);

  const handleDeleteNote = useCallback(
    async (noteId, event) => {
      event?.stopPropagation();
      const confirmed = await dialog.confirm('Delete this note?', {
        title: 'Delete note',
        confirmLabel: 'Delete',
        variant: 'danger',
      });
      if (!confirmed) return;

      try {
        await notes.deleteNote(noteId);
      } catch (err) {
        console.error('Failed to delete note:', err);
        showNotice?.(
          err?.status === 409 || err?.message?.includes('409') || err?.message?.includes('conflict')
            ? 'deleteBlockedByConflict'
            : 'deleteFailed'
        );
        return;
      }

      // Never pick the note we just deleted as the fallback: `notes.notes`
      // still holds it until the state update lands, and re-selecting it would
      // load a deleted note straight back into the editor.
      const currentNotes = notes.notes.filter((note) => note.id !== noteId);

      if (noteId === editor.primaryNoteId) {
        if (currentNotes.length > 0) {
          const fallback =
            currentNotes.find((note) => note.id !== editor.secondaryNoteId) || currentNotes[0];
          await handleSwitchNote(fallback.id, 'primary');
        } else {
          await handleCreateNote('primary');
        }
      }

      if (editor.splitViewEnabled && noteId === editor.secondaryNoteId) {
        const fallback = currentNotes.find(
          (note) => note.id !== editor.primaryNoteId && note.id !== noteId
        );
        if (fallback) {
          await handleSwitchNote(fallback.id, 'secondary');
        } else {
          await handleCloseSecondaryPane();
        }
      }
    },
    [
      editor.primaryNoteId,
      editor.secondaryNoteId,
      editor.splitViewEnabled,
      handleCloseSecondaryPane,
      handleCreateNote,
      handleSwitchNote,
      notes,
      showNotice,
    ]
  );

  // The bulk delete: same dialog, same delete path, and the same rule about
  // never leaving the editor on a note that no longer exists.
  const handleDeleteNotes = useCallback(
    async (noteIds) => {
      const ids = [...new Set((noteIds || []).filter(Boolean))];
      if (ids.length === 0) return;
      const many = ids.length > 1;
      const confirmed = await dialog.confirm(
        many ? `Delete ${ids.length} notes?` : 'Delete this note?',
        {
          title: many ? 'Delete notes' : 'Delete note',
          confirmLabel: 'Delete',
          variant: 'danger',
        }
      );
      if (!confirmed) return;

      try {
        await notes.deleteNotes(ids);
      } catch (err) {
        console.error('Failed to delete notes:', err);
        showNotice?.(
          err?.status === 409 || err?.message?.includes('409') || err?.message?.includes('conflict')
            ? 'notesDeleteBlockedByConflict'
            : 'notesDeleteFailed'
        );
        return;
      }

      // Never pick a note that was just deleted as the fallback: `notes.notes`
      // still holds it until the state update lands.
      const deleted = new Set(ids);
      const currentNotes = notes.notes.filter((note) => !deleted.has(note.id));

      if (deleted.has(editor.primaryNoteId)) {
        if (currentNotes.length > 0) {
          const fallback =
            currentNotes.find((note) => note.id !== editor.secondaryNoteId) || currentNotes[0];
          await handleSwitchNote(fallback.id, 'primary');
        } else {
          await handleCreateNote('primary');
        }
      }

      if (editor.splitViewEnabled && deleted.has(editor.secondaryNoteId)) {
        const fallback = currentNotes.find(
          (note) => note.id !== editor.primaryNoteId && !deleted.has(note.id)
        );
        if (fallback) {
          await handleSwitchNote(fallback.id, 'secondary');
        } else {
          await handleCloseSecondaryPane();
        }
      }
    },
    [
      editor.primaryNoteId,
      editor.secondaryNoteId,
      editor.splitViewEnabled,
      handleCloseSecondaryPane,
      handleCreateNote,
      handleSwitchNote,
      notes,
      showNotice,
    ]
  );

  const creatingRef = useRef(false);
  const switchNoteRef = useRef(handleSwitchNote);
  switchNoteRef.current = handleSwitchNote;

  const deleteNoteRef = useRef(handleDeleteNote);
  deleteNoteRef.current = handleDeleteNote;

  const deleteNotesRef = useRef(handleDeleteNotes);
  deleteNotesRef.current = handleDeleteNotes;

  const stableHandleSwitchNote = useCallback((...args) => switchNoteRef.current(...args), []);
  const stableHandleDeleteNote = useCallback((...args) => deleteNoteRef.current(...args), []);
  const stableHandleDeleteNotes = useCallback((...args) => deleteNotesRef.current(...args), []);

  return {
    focusPane,
    flushPaneDraft,
    handleSwitchNote,
    handleCreateNote,
    handleAddEditorPane,
    handleToggleSplitView,
    handleCloseSecondaryPane,
    handleClosePrimaryPane,
    handleClosePane,
    handleDeleteNote,
    handleDeleteNotes,
    stableHandleSwitchNote,
    stableHandleDeleteNote,
    stableHandleDeleteNotes,
  };
};