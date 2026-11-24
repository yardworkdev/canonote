import { useEffect, useState } from 'react';
import { useEditorPane } from './useEditorPane';
import { PLACEHOLDER_NOTE_ID } from '../constants/notes';
import {
  readBrowserStorageValue,
  removeBrowserStorageValue,
  writeBrowserStorageValue,
} from '../services/browser-storage';

const clampRatio = (value) => Math.min(98, Math.max(10, value));

const getStoredNumber = (key, fallback) => {
  const raw = readBrowserStorageValue(key);
  if (!raw) return fallback;
  const parsed = parseFloat(raw);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  return fallback;
};

export const useEditor = (user, storage, currentNoteId, notes) => {
  const primaryNoteId = currentNoteId || PLACEHOLDER_NOTE_ID;
  const [secondaryNoteId, setSecondaryNoteId] = useState(() => {
    return readBrowserStorageValue('editor-secondary-note') || null;
  });
  const [splitViewEnabled, setSplitViewEnabled] = useState(() => {
    return readBrowserStorageValue('editor-split-view') === 'true';
  });
  const [activePaneId, setActivePaneId] = useState('primary');
  const [splitRatio, setSplitRatio] = useState(() =>
    clampRatio(getStoredNumber('editor-split-ratio', 45))
  );

  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  useEffect(() => {
    if (!user || !storage) return;

    const loadPreferences = async () => {
      try {
        const scopedRatio = await window.storage.get(storage.scopedKey('editor-split-ratio'));
        // The unscoped ratio is written straight to browser storage above, so
        // it is read from there: a preference read through one store and
        // written to another stops being a preference.
        const globalRatio = readBrowserStorageValue('editor-split-ratio');
        const ratioToUse = scopedRatio?.value || globalRatio;
        if (ratioToUse) {
          const ratio = clampRatio(parseFloat(ratioToUse));
          if (!Number.isNaN(ratio)) {
            setSplitRatio(ratio);
          }
        }
      } catch (error) {
        console.error('Failed to load editor preferences', error);
      }
    };

    loadPreferences();
  }, [storage, user]);

  useEffect(() => {
    if (!writeBrowserStorageValue('editor-split-view', splitViewEnabled ? 'true' : 'false')) {
      console.error('Failed to persist split view flag.');
    }
  }, [splitViewEnabled]);

  useEffect(() => {
    if (secondaryNoteId) {
      if (!writeBrowserStorageValue('editor-secondary-note', secondaryNoteId)) {
        console.error('Failed to persist secondary note id');
      }
      return;
    }

    if (!removeBrowserStorageValue('editor-secondary-note')) {
      console.error('Failed to clear secondary note id');
    }
  }, [secondaryNoteId]);

  useEffect(() => {
    if (!writeBrowserStorageValue('editor-split-ratio', splitRatio.toString())) {
      console.error('Failed to save split ratio to browser storage.');
    }

    if (user && storage) {
      const saveSplit = async () => {
        try {
          const key = storage.scopedKey('editor-split-ratio');
          if (key) {
            await window.storage.set(key, splitRatio.toString());
          }
        } catch (error) {
          console.error('Failed to save split ratio to user storage:', error);
        }
      };
      saveSplit();
    }
  }, [splitRatio, storage, user]);

  useEffect(() => {
    if (!splitViewEnabled && activePaneId === 'secondary') {
      setActivePaneId('primary');
    }
  }, [activePaneId, splitViewEnabled]);

  const primaryPane = useEditorPane({
    paneId: 'primary',
    user,
    storage,
    noteId: primaryNoteId,
    notes,
  });
  const secondaryPane = useEditorPane({
    paneId: 'secondary',
    user,
    storage,
    noteId: splitViewEnabled ? secondaryNoteId : null,
    notes,
  });

  const getPane = (paneId = activePaneId) => (paneId === 'secondary' ? secondaryPane : primaryPane);

  const openSplitView = async () => {
    if (splitViewEnabled) {
      return secondaryNoteId;
    }

    let nextId = secondaryNoteId;
    if (!nextId) {
      // Split view is for looking at two things at once. Creating an empty note
      // every time it opens left a real "Untitled" row behind even when the person
      // typed nothing, so the notebook grew one blank note per glance. Take the
      // most recent note that is not already in the other pane, and only create
      // one when there is nothing to show.
      const other = primaryNoteId;
      const candidate = (notes?.notes || []).find((note) => note.id !== other && !note.deletedAt);
      nextId = candidate?.id || null;
      if (!nextId && notes?.createNewNote) {
        nextId = await notes.createNewNote();
      }
      if (nextId) {
        setSecondaryNoteId(nextId);
      }
    }

    setSplitViewEnabled(true);
    setActivePaneId('secondary');
    return nextId;
  };

  const closeSplitView = () => {
    if (!splitViewEnabled) return;
    setSplitViewEnabled(false);
    setActivePaneId('primary');
    setSecondaryNoteId(null);
  };

  const toggleSplitView = async () => {
    if (splitViewEnabled) {
      closeSplitView();
    } else {
      await openSplitView();
    }
  };

  const proxyAction =
    (action) =>
    (...args) => {
      const pane = getPane();
      if (pane && typeof pane[action] === 'function') {
        return pane[action](...args);
      }
    };

  const activePane = getPane();
  const currentNote = notes?.currentNote || null;
  const currentNoteTitle = currentNote?.title?.trim() || activePane?.title || '';

  return {
    splitRatio,
    setSplitRatio: (value) => setSplitRatio(clampRatio(value)),
    splitViewEnabled,
    toggleSplitView,
    openSplitView,
    closeSplitView,
    activePaneId,
    setActivePaneId,
    primaryNoteId,
    secondaryNoteId,
    setSecondaryNoteId,
    panes: {
      primary: primaryPane,
      secondary: secondaryPane,
    },
    activePane,
    currentNote,
    currentNoteTitle,
    content: activePane?.content || '',
    wordCount: activePane?.wordCount || 0,
    charCount: activePane?.charCount || 0,
    saveStatus: activePane?.saveStatus || 'idle',
    saveError: activePane?.saveError || null,
    hasConflict: Boolean(activePane?.hasConflict),
    conflictStatus: activePane?.conflictStatus || 'idle',
    conflictSnapshot: activePane?.conflictSnapshot || null,
    conflictRecovery: activePane?.conflictRecovery || null,
    activeFormats: activePane?.activeFormats || {
      bold: false,
      italic: false,
      underline: false,
      strike: false,
    },
    copied: activePane?.copied || false,
    editorRef: activePane?.editorRef,
    selectedText: activePane?.selectedText || '',
    selectionPosition: activePane?.selectionPosition,
    selectionRange: activePane?.selectionRange,
    // `?? null` rather than `|| null`: caret offset 0 is a real position.
    caretIndex: activePane?.caretIndex ?? null,
    wrapSelection: proxyAction('wrapSelection'),
    insertHeading: proxyAction('insertHeading'),
    insertBlockquote: proxyAction('insertBlockquote'),
    insertCodeBlock: proxyAction('insertCodeBlock'),
    insertLink: proxyAction('insertLink'),
    insertNumberedList: proxyAction('insertNumberedList'),
    insertBulletList: proxyAction('insertBulletList'),
    insertTaskList: proxyAction('insertTaskList'),
    insertHorizontalRule: proxyAction('insertHorizontalRule'),
    insertTable: proxyAction('insertTable'),
    clearAll: proxyAction('clearAll'),
    copyAll: proxyAction('copyAll'),
    handleLocalKeyDown: proxyAction('handleLocalKeyDown'),
    handleContentChange: proxyAction('handleContentChange'),
    loadNoteContent: proxyAction('loadNoteContent'),
    clearEditor: proxyAction('clearEditor'),
    replaceSelectedText: proxyAction('replaceSelectedText'),
    clearSelection: proxyAction('clearSelection'),
    retrySave: proxyAction('retrySave'),
    reloadFromStorage: proxyAction('reloadFromStorage'),
    restoreConflictDraft: proxyAction('restoreConflictDraft'),
    saveLocalDraft: proxyAction('saveLocalDraft'),
    acceptIncoming: proxyAction('acceptIncoming'),
    copyConflictToClipboard: proxyAction('copyConflictToClipboard'),
    flushPendingChanges: proxyAction('flushPendingChanges'),
  };
};
