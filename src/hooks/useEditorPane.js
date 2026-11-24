import { useState, useEffect, useRef, useMemo } from 'react';
import { dialog } from '../utils/dialog';
import { copyTextToClipboard } from '../utils/clipboard';
import { useConflictRecovery } from './useConflictRecovery';
import { useNotePersistence } from './useNotePersistence';

// Markdown source has no document model, so we cannot ask the editor which
// formats are "active". We derive them cheaply from the selected text only:
// a format counts as active when the selection is wrapped in its marker.
// Cursor-only selections (empty text) report no active format.
const deriveActiveFormats = (text) => ({
  bold: text.length >= 4 && text.startsWith('**') && text.endsWith('**'),
  italic:
    text.length >= 4 && text.startsWith('*') && text.endsWith('*') && !text.startsWith('**'),
  underline: text.length >= 4 && text.startsWith('_') && text.endsWith('_'),
  strike: text.length >= 4 && text.startsWith('~~') && text.endsWith('~~'),
});

// Approximate the on-screen position of a character offset in a textarea so the
// selection toolbar can anchor near the caret.
const caretPosition = (handle, offset) => {
  const el = handle?.getElement?.();
  if (!el) return null;
  const lineIndex = el.value.slice(0, offset).split('\n').length - 1;
  const rect = el.getBoundingClientRect();
  const styles = window.getComputedStyle(el);
  const lineHeight = parseFloat(styles.lineHeight) || 20;
  const paddingTop = parseFloat(styles.paddingTop) || 0;
  return {
    top: rect.top + window.scrollY + paddingTop + lineIndex * lineHeight + lineHeight,
    left: rect.left + rect.width / 2,
  };
};

// Strip an existing list marker from a line so list buttons can switch type.
const stripListPrefix = (line) => line.replace(/^\s*(?:- \[[ x]\]\s+|\d+\.\s+|[-*+]\s+)/, '');

export const useEditorPane = ({ paneId, user, storage, noteId, notes }) => {
  const [content, setContent] = useState('');
  const [wordCount, setWordCount] = useState(0);
  const [charCount, setCharCount] = useState(0);
  const [activeFormats, setActiveFormats] = useState({
    bold: false,
    italic: false,
    underline: false,
    strike: false,
  });
  const [copied, setCopied] = useState(false);
  const [selectedText, setSelectedText] = useState('');
  const [selectionPosition, setSelectionPosition] = useState(null);
  const [selectionRange, setSelectionRange] = useState(null);
  const [caretIndex, setCaretIndex] = useState(null);

  const editorRef = useRef(null);
  const selectionSubscriptionRef = useRef(null);
  const lastContentRef = useRef('');
  const contentRef = useRef('');
  const contentEditVersionRef = useRef(0);
  const wordCountTimeoutRef = useRef(null);

  const resolvedNote = useMemo(() => {
    if (!noteId) return null;

    const noteList = Array.isArray(notes?.notes) ? notes.notes : [];
    const fromList = noteList.find((note) => note?.id === noteId) || null;
    if (fromList) return fromList;

    if (notes?.currentNote?.id === noteId) {
      return notes.currentNote;
    }

    return null;
  }, [noteId, notes?.currentNote, notes?.notes]);

  const contentPreviewTitle = useMemo(() => {
    const firstLine = (content || '').split('\n')[0].trim();
    return firstLine || 'Untitled';
  }, [content]);

  const noteTitle = resolvedNote?.title?.trim() || contentPreviewTitle;
  const noteMeta = useMemo(
    () => ({
      id: noteId || resolvedNote?.id || null,
      title: noteTitle,
      noteTitle,
      updated: resolvedNote?.updated ?? null,
      isPinned: Boolean(resolvedNote?.isPinned),
      folder: resolvedNote?.folder || 'private',
      // The note's canonical revision, so a proposal written against another one
      // can be judged instead of guessed at.
      revision: Number.isInteger(resolvedNote?.revision) ? resolvedNote.revision : null,
      createdBy: resolvedNote?.createdBy || null,
      createdByName: resolvedNote?.createdByName || null,
      contentPreview: contentPreviewTitle,
      isPlaceholder: !resolvedNote,
    }),
    [contentPreviewTitle, noteId, noteTitle, resolvedNote]
  );

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  const conflictRecovery = useConflictRecovery({
    noteId,
    storage,
    editorRef,
    contentRef,
    lastContentRef,
    setContent,
  });

  const persistence = useNotePersistence({
    paneId,
    user,
    storage,
    noteId,
    notes,
    resolvedNote,
    editorRef,
    content,
    setContent,
    contentRef,
    contentEditVersionRef,
    lastContentRef,
    hasConflict: conflictRecovery.hasConflict,
    hasConflictRef: conflictRecovery.hasConflictRef,
    conflictSnapshotRef: conflictRecovery.conflictSnapshotRef,
    conflictMessage: conflictRecovery.conflictMessage,
    readPersistedConflictSnapshot: conflictRecovery.readPersistedConflictSnapshot,
    applyConflictSnapshot: conflictRecovery.applyConflictSnapshot,
    setConflictRecovery: conflictRecovery.setConflictRecovery,
    clearConflictRecovery: conflictRecovery.clearConflictRecovery,
    clearPersistedConflictSnapshot: conflictRecovery.clearPersistedConflictSnapshot,
    restoreConflictDraftContent: conflictRecovery.restoreConflictDraftContent,
  });

  useEffect(() => {
    const text = content || '';

    if (wordCountTimeoutRef.current) {
      clearTimeout(wordCountTimeoutRef.current);
    }

    wordCountTimeoutRef.current = setTimeout(() => {
      const words = text
        .trim()
        .split(/\s+/)
        .filter((word) => word.length > 0).length;
      const chars = text.length;
      setWordCount(words);
      setCharCount(chars);
    }, 500);

    return () => {
      if (wordCountTimeoutRef.current) {
        clearTimeout(wordCountTimeoutRef.current);
        wordCountTimeoutRef.current = null;
      }
    };
  }, [content]);

  // Stop listening on whatever element the selection subscription is attached to.
  const detachSelectionListener = () => {
    const subscription = selectionSubscriptionRef.current;
    if (!subscription) return;
    if (subscription.rafId !== null) {
      cancelAnimationFrame(subscription.rafId);
    }
    subscription.el.removeEventListener('select', subscription.listener);
    subscription.el.removeEventListener('keyup', subscription.listener);
    subscription.el.removeEventListener('mouseup', subscription.listener);
    subscription.el.removeEventListener('input', subscription.listener);
    subscription.el.removeEventListener('blur', subscription.listener);
    selectionSubscriptionRef.current = null;
  };

  // Track the textarea selection so the selection toolbar and AI actions know
  // what the user has highlighted, and so the status row can show the caret.
  //
  // This must not subscribe once at mount. The editor element does not exist at
  // the first commit — the app renders "Opening your workspace…" until storage
  // is open and auth has settled — so a `[]`-deps effect ran while
  // `editorRef.current` was still null, returned, and never ran again. The
  // bubble menu, the format states and the caret readout were all dead because
  // of it. Re-checking after every render costs a ref read and attaches the
  // first time the textarea is really there (and again if it is ever replaced).
  useEffect(() => {
    const el = editorRef.current?.getElement?.();
    if (!el || selectionSubscriptionRef.current?.el === el) return;
    detachSelectionListener();

    const subscription = { el, rafId: null, listener: null };
    subscription.listener = () => {
      if (subscription.rafId !== null) return;
      subscription.rafId = requestAnimationFrame(() => {
        subscription.rafId = null;
        const current = editorRef.current;
        if (!current || typeof current.getSelection !== 'function') return;

        const { start, end, text } = current.getSelection();
        setActiveFormats(deriveActiveFormats(text));
        // The caret's offset, for the status row's line/column readout. A
        // selection reports its end (where the next keystroke lands); a plain
        // caret reports start === end, so one expression covers both.
        setCaretIndex(typeof end === 'number' ? end : typeof start === 'number' ? start : null);

        if (text.trim().length >= 1) {
          setSelectedText(text);
          setSelectionRange({ from: start, to: end });
          setSelectionPosition(caretPosition(current, start));
        } else {
          setSelectedText('');
          setSelectionPosition(null);
          setSelectionRange(null);
        }
      });
    };

    el.addEventListener('select', subscription.listener);
    el.addEventListener('keyup', subscription.listener);
    el.addEventListener('mouseup', subscription.listener);
    el.addEventListener('input', subscription.listener);
    el.addEventListener('blur', subscription.listener);
    selectionSubscriptionRef.current = subscription;
  });

  // The listeners outlive every render, so they are torn down on unmount alone.
  useEffect(() => () => detachSelectionListener(), []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (selectionPosition && !event.target.closest('.selection-toolbar')) {
        const el = editorRef.current?.getElement?.();
        if (el && !el.contains(event.target)) {
          setSelectedText('');
          setSelectionPosition(null);
          setSelectionRange(null);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [selectionPosition]);

  const getEditor = () => editorRef.current;

  const readValue = () => {
    const editor = getEditor();
    if (editor && typeof editor.getValue === 'function') return editor.getValue();
    return contentRef.current;
  };

  const getSelection = () => {
    const editor = getEditor();
    if (!editor || typeof editor.getSelection !== 'function') {
      return { start: 0, end: 0, text: '' };
    }
    return editor.getSelection();
  };

  // Replace the note text and move the caret. Every formatting action below is
  // built from this one primitive.
  const writeValue = (nextValue, caretStart, caretEnd) => {
    const editor = getEditor();
    if (!editor) return;
    editor.setValue(nextValue);
    if (typeof caretStart === 'number') {
      editor.setSelection(caretStart, typeof caretEnd === 'number' ? caretEnd : caretStart);
    }
  };

  // Apply `transform` to each line the selection touches.
  const transformSelectedLines = (transform) => {
    if (!getEditor()) return;
    const { start, end } = getSelection();
    const value = readValue();
    const blockStart = value.lastIndexOf('\n', start - 1) + 1;
    let blockEnd = value.indexOf('\n', end);
    if (blockEnd === -1) blockEnd = value.length;
    const block = value.slice(blockStart, blockEnd);
    const nextBlock = block
      .split('\n')
      .map((line, index) => transform(line, index))
      .join('\n');
    writeValue(
      value.slice(0, blockStart) + nextBlock + value.slice(blockEnd),
      blockStart,
      blockStart + nextBlock.length
    );
  };

  const wrapSelection = (format) => {
    const editor = getEditor();
    if (!editor) return;
    const { start, end, text } = getSelection();
    const value = readValue();

    if (start === end) {
      writeValue(value.slice(0, start) + format + format + value.slice(end), start + format.length);
      return;
    }

    writeValue(
      value.slice(0, start) + format + text + format + value.slice(end),
      start + format.length,
      end + format.length
    );
  };

  const insertHeading = (level) => {
    const editor = getEditor();
    if (!editor) return;
    const { start } = getSelection();
    const value = readValue();
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = value.indexOf('\n', start);
    if (lineEnd === -1) lineEnd = value.length;
    const line = value.slice(lineStart, lineEnd);
    const existing = line.match(/^(#{1,6})\s+/);
    const body = existing ? line.replace(/^(#{1,6})\s+/, '') : line;
    // Toggle off when the line already has this exact heading level.
    const nextLine = existing && existing[1].length === level ? body : `${'#'.repeat(level)} ${body}`;
    writeValue(value.slice(0, lineStart) + nextLine + value.slice(lineEnd), lineStart + nextLine.length);
  };

  const insertBlockquote = () => {
    transformSelectedLines((line) => (line.startsWith('> ') ? line.slice(2) : `> ${line}`));
  };

  const insertCodeBlock = () => {
    const editor = getEditor();
    if (!editor) return;
    const { start, end, text } = getSelection();
    const value = readValue();

    if (text) {
      const insert = `\`\`\`\n${text}\n\`\`\``;
      writeValue(value.slice(0, start) + insert + value.slice(end), start + 4, start + 4 + text.length);
    } else {
      const insert = '```\n\n```';
      writeValue(value.slice(0, start) + insert + value.slice(end), start + 4);
    }
  };

  const insertLink = async () => {
    const editor = getEditor();
    if (!editor) return;
    const url = await dialog.prompt('Enter URL:', {
      title: 'Insert link',
      placeholder: 'https://',
      confirmLabel: 'Insert',
    });
    if (!url) return;

    const { start, end, text } = getSelection();
    const value = readValue();
    const label = text || 'link text';
    const insert = `[${label}](${url})`;

    if (text) {
      writeValue(value.slice(0, start) + insert + value.slice(end), start + insert.length);
    } else {
      writeValue(value.slice(0, start) + insert + value.slice(end), start + 1, start + 1 + label.length);
    }
  };

  const insertNumberedList = () => {
    if (!readValue().trim()) {
      writeValue('1. ');
      return;
    }
    transformSelectedLines((line, index) => {
      const body = stripListPrefix(line);
      return body.trim() ? `${index + 1}. ${body}` : line;
    });
  };

  const insertBulletList = () => {
    if (!readValue().trim()) {
      writeValue('- ');
      return;
    }
    transformSelectedLines((line) => {
      const body = stripListPrefix(line);
      return body.trim() ? `- ${body}` : line;
    });
  };

  const insertTaskList = () => {
    if (!readValue().trim()) {
      writeValue('- [ ] ');
      return;
    }
    transformSelectedLines((line) => {
      const body = stripListPrefix(line);
      return body.trim() ? `- [ ] ${body}` : line;
    });
  };

  const insertHorizontalRule = () => {
    const editor = getEditor();
    if (!editor) return;
    const { start, end } = getSelection();
    const value = readValue();
    const insert = '\n---\n';
    writeValue(value.slice(0, start) + insert + value.slice(end), start + insert.length);
  };

  const insertTable = () => {
    const editor = getEditor();
    if (!editor) return;
    const { start, end } = getSelection();
    const value = readValue();
    const insert = '\n| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |\n';
    writeValue(value.slice(0, start) + insert + value.slice(end), start + insert.length);
  };

  // Called before a new note exists, so the pane cannot show the previous note
  // while the create request is in flight. Display only: nothing is written.
  const resetForNewNote = () => {
    // Display only, and only once the outgoing text is safely flushed: the pane
    // must not keep showing a note the person has left, but blanking it before a
    // flush would let that flush save an empty body over the real text.
    setContent('');
  };

  const clearAll = async () => {
    if (!persistence.hasNote) return;
    const confirmed = await dialog.confirm('Clear this note? This cannot be undone.', {
      title: 'Clear note',
      confirmLabel: 'Clear',
      variant: 'danger',
    });
    if (!confirmed) return;

    try {
      await persistence.applyExternalContent('', { allowEmptyContent: true });
    } catch (error) {
      console.error('Failed to clear note content:', error);
    }
  };

  const copyAll = () => {
    void copyTextToClipboard(content).then((copied) => {
      if (!copied) {
        console.warn('Copy failed: the browser refused clipboard access.');
        return;
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleLocalKeyDown = (event) => {
    if (!getEditor()) return;

    const metaPressed = event.metaKey || event.ctrlKey;
    if (!metaPressed) return;
    const key = event.key.toLowerCase();

    // Undo / redo are left to the textarea's native history.
    if (key === 'b') {
      event.preventDefault();
      wrapSelection('**');
      return;
    }

    if (key === 'i') {
      event.preventDefault();
      wrapSelection('*');
      return;
    }

    if (key === 'u') {
      event.preventDefault();
      wrapSelection('_');
      return;
    }

    if (event.shiftKey && key === 's') {
      event.preventDefault();
      wrapSelection('~~');
    }
  };

  const handleContentChange = (markdown) => {
    persistence.noteOwnsContent?.();
    contentEditVersionRef.current += 1;
    contentRef.current = markdown;
    conflictRecovery.updateConflictDraft(markdown);
    setContent(markdown);
  };

  // The new note must take the caret. A button keeps focus after a click, and a
  // person who presses "+" and keeps typing types into the button: every space
  // re-activates it and creates another empty note.
  const focusEditor = () => {
    const editor = editorRef.current;
    if (editor && typeof editor.focus === 'function') {
      editor.focus();
      editor.setSelection?.(0);
      return true;
    }
    return false;
  };

  const clearEditor = () => {
    const editor = editorRef.current;
    if (editor && typeof editor.setValue === 'function') {
      editor.setValue('');
    }
  };

  const replaceSelectedText = (newText) => {
    const editor = getEditor();
    if (!editor) return;
    const { start, end } = getSelection();
    const value = readValue();
    const next = value.slice(0, start) + newText + value.slice(end);
    writeValue(next, start + newText.length);
    setSelectedText('');
    setSelectionPosition(null);
    setSelectionRange(null);
  };

  const clearSelection = () => {
    setSelectedText('');
    setSelectionPosition(null);
    setSelectionRange(null);
  };

  return {
    paneId,
    noteId,
    note: noteMeta,
    title: noteTitle,
    noteTitle,
    noteUpdated: noteMeta.updated,
    noteFolder: noteMeta.folder,
    noteCreatedBy: noteMeta.createdBy,
    noteCreatedByName: noteMeta.createdByName,
    hasNote: persistence.hasNote,
    content,
    setContent,
    wordCount,
    charCount,
    contentLoading: persistence.contentLoading,
    agentSpans: persistence.agentSpans,
    saveStatus: persistence.saveStatus,
    saveError: persistence.saveError,
    activeFormats,
    copied,
    editorRef,
    selectedText,
    selectionPosition,
    selectionRange,
    caretIndex,
    hasConflict: conflictRecovery.hasConflict,
    conflictStatus: conflictRecovery.conflictStatus,
    conflictSnapshot: conflictRecovery.conflictSnapshot,
    conflictRecovery: conflictRecovery.conflictSnapshot
      ? {
          status: conflictRecovery.conflictStatus,
          noteId: conflictRecovery.conflictSnapshot.noteId,
          storageKey: conflictRecovery.conflictSnapshot.storageKey,
          localContent: conflictRecovery.conflictSnapshot.localContent,
          incomingContent: conflictRecovery.conflictSnapshot.incomingContent,
          savedContent: conflictRecovery.conflictSnapshot.savedContent,
          detectedAt: conflictRecovery.conflictSnapshot.detectedAt,
        }
      : null,
    wrapSelection,
    insertHeading,
    insertBlockquote,
    insertCodeBlock,
    insertLink,
    insertNumberedList,
    insertBulletList,
    insertTaskList,
    insertHorizontalRule,
    insertTable,
    clearAll,
    resetForNewNote,
    beginPaneTransition: persistence.beginPaneTransition,
    clearForSwitch: persistence.clearForSwitch,
    hideForSwitch: persistence.hideForSwitch,
    paneLocked: persistence.paneLocked,
    copyAll,
    handleLocalKeyDown,
    handleContentChange,
    loadNoteContent: persistence.loadNoteContent,
    reloadFromStorage: persistence.reloadFromStorage,
    clearEditor,
    focusEditor,
    replaceSelectedText,
    clearSelection,
    retrySave: persistence.retrySave,
    restoreConflictDraft: persistence.restoreConflictDraft,
    saveLocalDraft: persistence.saveLocalDraft,
    acceptIncoming: persistence.acceptIncoming,
    copyConflictToClipboard: conflictRecovery.copyConflictToClipboard,
    applyExternalContent: persistence.applyExternalContent,
    adoptCanonicalContent: persistence.adoptCanonicalContent,
    flushPendingChanges: persistence.flushPendingChanges,
  };
};
