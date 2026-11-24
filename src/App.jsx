import React, { useState, useEffect, useMemo, useRef, useCallback, Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AlertCircle, Check, Loader2, X } from 'lucide-react';
import { AppProvider, useApp } from './context/AppContext';
import ErrorBoundary from './components/ErrorBoundary';
import Auth from './components/Auth';
import Sidebar from './components/Sidebar';
import Toolbar from './components/Toolbar';
import Editor from './components/Editor';
import WordCount from './components/WordCount';
import PresenceBar from './components/PresenceBar';
import StorageMode from './components/StorageMode';
import SurfaceFallback from './components/SurfaceFallback';
import { ToastContainer } from './components/Toast';
import {
  hasSupabaseCredentials,
  isLocalOnlyPreferred,
  isSupabaseConfigured,
  setLocalOnlyPreferred,
} from './services/supabase';
import DialogContainer from './components/DialogContainer';
import { readBrowserStorageValue, writeBrowserStorageValue } from './hooks/useStorage';
import { useWorkspaceController } from './hooks/useWorkspaceController';
import { usePresence } from './hooks/usePresence';
import { useThread } from './hooks/useThread';
import { applyProposal } from './lib/proposal-apply';
import { notesApi } from './services/notes-api';
import { extractHeadings } from './utils/markdown';
import { readBackupIndex, shouldWriteBackup, writeLocalBackup } from './services/local-backups';
import { notice, noticeTone } from './services/notices';
import { exportAllNotes } from './utils/export';
import { lineColumnAt } from './utils/cursor';

const FindReplaceModal = lazy(() => import('./components/FindReplaceModal'));
const CommandPalette = lazy(() => import('./components/CommandPalette'));
const SelectionToolbar = lazy(() => import('./components/SelectionToolbar'));
const ExportModal = lazy(() => import('./components/ExportModal'));
const StorageHealth = lazy(() => import('./components/StorageHealth'));
const AgentActivity = lazy(() => import('./components/AgentActivity'));
const KeyboardShortcutsModal = lazy(() => import('./components/KeyboardShortcutsModal'));
const HelperView = lazy(() => import('./components/HelperView'));

const MIN_EDITOR_SPLIT = 10;
const MAX_EDITOR_SPLIT = 98;
const noop = () => {};

// Load persisted pane ratio from storage
const loadPersistedPaneRatio = () => {
  try {
    const saved = readBrowserStorageValue('editor-pane-ratio');
    if (saved) {
      const parsed = parseFloat(saved);
      if (Number.isFinite(parsed) && parsed >= 25 && parsed <= 75) {
        return parsed;
      }
    }
  } catch (error) {
    console.error('Failed to load persisted pane ratio.');
  }
  return 50;
};

function AppContent() {
  const { auth, notes, editor, storage } = useApp();

  // Presence is a courtesy, never a dependency: it reads the caret, publishes at
  // most ten messages a second, and stays silent when no channel exists.
  const presence = usePresence({
    noteId: notes.currentNoteId,
    name: auth.user?.name || auth.user?.username || 'Someone',
    caret: editor.caretIndex,
  });

  const publishCaret = presence.publishCaret;

  // Other writers' carets and selections, drawn inside the note itself. Only
  // entries that name a character position can be drawn: an agent that announces
  // "writing" without saying where is presence in the footer, not on the page.
  const remoteRanges = useMemo(
    () =>
      presence.others
        .filter((entry) => Number.isInteger(entry?.from))
        .map((entry) => ({ id: entry.id, name: entry.name, from: entry.from, to: entry.to })),
    [presence.others]
  );

  useEffect(() => {
    publishCaret(editor.caretIndex);
  }, [editor.caretIndex, publishCaret]);
  const [showSidebar, setShowSidebar] = useState(
    () => readBrowserStorageValue('sidebar-open') !== 'false'
  );
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showStorageHealth, setShowStorageHealth] = useState(false);
  const [showAgentActivity, setShowAgentActivity] = useState(false);
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false);
  const [showHelperView, setShowHelperView] = useState(
    () => readBrowserStorageValue('helper-open') === 'true'
  );
  const [helperViewTab, setHelperViewTab] = useState(() => {
    const saved = readBrowserStorageValue('helper-tab');
    return saved === 'thread' || saved === 'history' || saved === 'tags' || saved === 'agent'
      ? saved
      : 'thread';
  });
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [isResizing, setIsResizing] = useState(false);
  const [isPaneResizing, setIsPaneResizing] = useState(false);
  const [editorPaneRatio, setEditorPaneRatio] = useState(() => loadPersistedPaneRatio());
  const containerRef = useRef(null);
  const paneContainerRef = useRef(null);
  const resizeStartRef = useRef(null);
  const paneResizeStartRef = useRef(null);
  const lastSaveErrorRef = useRef(null);
  const conflictToastShownRef = useRef(false);
  const toastCounterRef = useRef(0);
  const primaryPane = editor?.panes?.primary;
  const secondaryPane = editor?.panes?.secondary;
  // Which words in the open note came from an agent. They travel with the body,
  // so an open costs one request and the ranges refresh on every load instead
  // of being fetched once and going stale.
  const primarySpans = primaryPane?.agentSpans || [];
  const secondarySpans = editor.splitViewEnabled ? secondaryPane?.agentSpans || [] : [];
  // Jumping to a heading moved from the Helper View's Contents tab to the
  // command palette; the offset maths is the same, it just lives here now.
  const noteHeadings = React.useMemo(
    () => extractHeadings(editor?.content || '').map((heading, index) => ({ ...heading, order: index })),
    [editor?.content]
  );

  const jumpToHeading = useCallback(
    (lineNumber) => {
      const handle = editor?.activePane?.editorRef?.current;
      if (!handle) return;
      const value =
        typeof handle.getValue === 'function' ? handle.getValue() : editor?.content || '';
      const lines = value.split('\n');
      let offset = 0;
      for (let i = 0; i < lineNumber && i < lines.length; i += 1) {
        offset += lines[i].length + 1;
      }
      handle.focus?.();
      handle.setSelection?.(offset, offset);
    },
    [editor?.activePane, editor?.content]
  );

  const activePane = editor?.activePane;
  const activePaneNote = activePane?.note || null;

  /**
   * Applying a proposal is the person's own guarded write.
   *
   * The proposal is placed by `applyProposal`, which either puts it somewhere
   * honest or refuses; the text then goes through the editor's normal save, so a
   * change the agent never saw still loses the revision race and says so. This
   * is the line that makes "no silent rewrite" structural: the agent wrote a
   * message, a person pressed Apply.
   */
  const applyProposalToNote = useCallback(
    async (message) => {
      if (!activePane || !message?.body) return 'stale';
      const current = activePane.content || '';
      let versions = [];
      if (Number.isInteger(message.baseRevision) && message.baseRevision !== activePaneNote?.revision) {
        try {
          const history = await notesApi.history(activePaneNote?.id, 60);
          versions = (Array.isArray(history) ? history : []).map((version) => ({
            revision: version.revision,
            content: version.content || '',
          }));
        } catch {
          // Without the version it was written against, the honest answer is
          // "cannot place this", which applyProposal gives when versions is empty.
          versions = [];
        }
      }
      const result = applyProposal({
        content: current,
        revision: activePaneNote?.revision ?? null,
        proposal: message.body,
        baseRevision: message.baseRevision ?? null,
        versions,
      });
      if (result.status !== 'applied') return 'stale';
      const saved = await activePane.applyExternalContent?.(result.content);
      return saved === false ? 'stale' : 'applied';
    },
    [activePane, activePaneNote?.id, activePaneNote?.revision]
  );
  const activeNote = activePaneNote || editor?.currentNote || notes?.currentNote || null;
  const activeNoteId =
    activePane?.noteId || activeNote?.id || notes?.currentNoteId || editor?.primaryNoteId || null;
  // The thread on the open note. Assembled here rather than in the panel because
  // applying a proposal is a write to the note, and only the shell holds the
  // editor's guarded save path. It sits below `activeNoteId` on purpose: reading
  // it from a hook declared above is a temporal dead zone, and that crashed the
  // whole notebook rather than the panel.
  const thread = useThread({ noteId: activeNoteId, enabled: isSupabaseConfigured() });

  const activeNoteTitle =
    activePane?.noteTitle ||
    activePane?.title ||
    activeNote?.title ||
    editor?.currentNoteTitle ||
    notes?.currentNoteTitle ||
    'Untitled';

  // Toast helper. Both of these are stable across renders on purpose: the
  // effects below raise a notice from inside a subscription or a status
  // reconciler, and a function that changed identity every render would either
  // re-run those effects or have to be left out of their dependency list.
  const showToast = useCallback((message, type = 'info', duration = 5000) => {
    const id = ++toastCounterRef.current;
    setToasts((prev) => [...prev, { id, message, type, duration }]);
  }, []);

  // The one way the app raises a notice: name a key from
  // `src/services/notices.js` and pass the numbers it needs. Copy never lives
  // at a call site — the tone standard is enforced over the catalog in
  // `notices.test.js`, and a prose argument here fails that suite.
  const showNotice = useCallback(
    (key, args, duration) => {
      const raised = notice(key, args);
      showToast(raised.message, raised.tone, duration ?? raised.duration);
    },
    [showToast]
  );

  const removeToast = (id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  };

  // Persist panel states across sessions
  useEffect(() => {
    writeBrowserStorageValue('sidebar-open', showSidebar ? 'true' : 'false');
  }, [showSidebar]);

  useEffect(() => {
    writeBrowserStorageValue('helper-open', showHelperView ? 'true' : 'false');
  }, [showHelperView]);

  useEffect(() => {
    writeBrowserStorageValue('helper-tab', helperViewTab);
  }, [helperViewTab]);

  const {
    focusPane,
    handleSwitchNote,
    handleCreateNote,
    handleToggleSplitView,
    handleClosePane,
    stableHandleSwitchNote,
    stableHandleDeleteNote,
    stableHandleDeleteNotes,
  } = useWorkspaceController({
    editor,
    notes,
    primaryPane,
    secondaryPane,
    showNotice,
  });

  // Import markdown files (or a zip) into the notebook, then show the first one
  // so the import is visibly real rather than a toast with nothing behind it.
  const handleImport = async (files) => {
    const result = await notes.importNotes(files);
    if (!result || result.imported === 0) {
      showNotice(result?.skipped ? 'importAlreadyHere' : 'importNothingFound');
      return result;
    }
    if (result.firstId) await handleSwitchNote(result.firstId, 'primary');
    showNotice('imported', { imported: result.imported, skipped: result.skipped });
    return result;
  };

  // Handle find in content: select the first match in the markdown text.
  const handleFind = (findText) => {
    if (!findText || !editor.editorRef?.current) return;
    const handle = editor.editorRef.current;
    const text = (editor.content || '').toLowerCase();
    const index = text.indexOf(findText.toLowerCase());

    if (index !== -1) {
      handle.focus?.();
      handle.setSelection?.(index, index + findText.length);
    }
  };

  // Handle replace in content (markdown string replace).
  const handleReplace = (findText, replaceText) => {
    if (!findText) return;
    const safeFind = findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(safeFind, 'g');
    const safeReplace = replaceText.replace(/\$/g, '$$$$');
    const newContent = editor.content.replace(regex, safeReplace);
    if (newContent === editor.content) {
      return;
    }
    activePane?.setContent?.(newContent);
    const handle = activePane?.editorRef?.current;
    if (handle) {
      handle.focus?.();
      handle.setSelection?.(newContent.length);
    }
  };

  // Resize handler
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizing || !containerRef.current) return;

      const container = containerRef.current;
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percentage = (x / rect.width) * 100;

      const constrained = Math.max(MIN_EDITOR_SPLIT, Math.min(MAX_EDITOR_SPLIT, percentage));
      editor.setSplitRatio(constrained);
    };

    const handleTouchMove = (e) => {
      if (!isResizing || !containerRef.current) return;
      e.preventDefault(); // Prevent scrolling while resizing

      const container = containerRef.current;
      const rect = container.getBoundingClientRect();
      const touch = e.touches[0];
      const x = touch.clientX - rect.left;
      const percentage = (x / rect.width) * 100;

      const constrained = Math.max(MIN_EDITOR_SPLIT, Math.min(MAX_EDITOR_SPLIT, percentage));
      editor.setSplitRatio(constrained);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      resizeStartRef.current = null;
    };

    const handleTouchEnd = () => {
      setIsResizing(false);
      resizeStartRef.current = null;
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.addEventListener('touchmove', handleTouchMove, { passive: false });
      document.addEventListener('touchend', handleTouchEnd);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, editor]);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isPaneResizing || !paneContainerRef.current || !editor.splitViewEnabled) return;

      const rect = paneContainerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percentage = (x / rect.width) * 100;
      const constrained = Math.max(25, Math.min(75, percentage));
      setEditorPaneRatio(constrained);
    };

    const handleTouchMove = (e) => {
      if (!isPaneResizing || !paneContainerRef.current || !editor.splitViewEnabled) return;
      e.preventDefault();

      const rect = paneContainerRef.current.getBoundingClientRect();
      const touch = e.touches[0];
      const x = touch.clientX - rect.left;
      const percentage = (x / rect.width) * 100;
      const constrained = Math.max(25, Math.min(75, percentage));
      setEditorPaneRatio(constrained);
    };

    const handleMouseUp = () => {
      setIsPaneResizing(false);
      paneResizeStartRef.current = null;
    };

    const handleTouchEnd = () => {
      setIsPaneResizing(false);
      paneResizeStartRef.current = null;
    };

    if (isPaneResizing && editor.splitViewEnabled) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.addEventListener('touchmove', handleTouchMove, { passive: false });
      document.addEventListener('touchend', handleTouchEnd);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isPaneResizing, editor.splitViewEnabled]);

  // Persist pane ratio when it changes
  useEffect(() => {
    if (!writeBrowserStorageValue('editor-pane-ratio', editorPaneRatio.toString())) {
      console.error('Failed to persist pane ratio.');
    }
  }, [editorPaneRatio]);

  useEffect(() => {
    if (editor.saveStatus === 'error' && editor.saveError) {
      if (lastSaveErrorRef.current !== editor.saveError) {
        // The sentence is decided in the storage layer
        // (`describeStorageFailure`) and lives in the notice catalog; the tone
        // is the catalog's too, so the two cannot drift apart.
        showToast(editor.saveError, noticeTone('saveFailed'), 7000);
        lastSaveErrorRef.current = editor.saveError;
      }
      conflictToastShownRef.current = false;
      return;
    }

    if (editor.saveStatus === 'conflict') {
      if (!conflictToastShownRef.current) {
        showNotice('conflictDetected');
        conflictToastShownRef.current = true;
      }
      lastSaveErrorRef.current = null;
      return;
    }

    // Clear the "already shown" marker only once a save actually succeeded.
    // Clearing it on every intermediate status re-fired the same error toast on
    // every keystroke while the failure persisted — one save attempt per
    // keystroke, one identical toast each time (2026-10-13).
    if (editor.saveStatus === 'saved') {
      lastSaveErrorRef.current = null;
    }
    conflictToastShownRef.current = false;
  }, [editor.saveStatus, editor.saveError, showNotice, showToast]);

  // Rotating local backups. The notebook keeps one copy of every note, so the
  // app writes a whole-notebook snapshot when the newest one has gone stale —
  // once a day, silently, and on demand from the Storage panel. A failure here
  // is not announced with a toast: the panel is where storage problems are
  // stated, and a notebook that cannot back up still has to be writable.
  useEffect(() => {
    if (isSupabaseConfigured() || !storage || notes.isLoading || notes.notes.length === 0) return;
    if (!shouldWriteBackup(readBackupIndex())) return;
    void writeLocalBackup({
      notes: notes.notes,
      readContent: async (note) => {
        const row = await window.storage.get(storage.noteStorageKey(note.id));
        return row?.value ?? '';
      },
    });
  }, [storage, notes.isLoading, notes.notes]);

  useEffect(() => {
    const handleAgentSyncError = (event) => {
      const detail = event?.detail?.message;
      if (detail) {
        showToast(detail, noticeTone('agentSyncFailed'));
        return;
      }
      showNotice('agentSyncFailed');
    };

    window.addEventListener('agent-sync-error', handleAgentSyncError);
    return () => window.removeEventListener('agent-sync-error', handleAgentSyncError);
  }, [showNotice, showToast]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Sidebar toggle (Cmd/Ctrl + \)
      if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
        e.preventDefault();
        setShowSidebar((prev) => !prev);
        return;
      }
      // Command Palette (Cmd/Ctrl + K)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowCommandPalette(true);
        return;
      }
      // Find & Replace (Cmd/Ctrl + F)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setShowFindReplace(true);
      }
      // Save (Cmd/Ctrl + S). The notebook saves as you type, so the browser's
      // "Save page as" dialog is never what the person wants; this flushes the
      // queued write and keeps the key doing the obvious thing.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        editor?.flushPendingChanges?.();
        return;
      }
      // Keyboard Shortcuts (Cmd/Ctrl + ?)
      if ((e.ctrlKey || e.metaKey) && e.key === '?') {
        e.preventDefault();
        setShowKeyboardShortcuts(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editor]);

  // Handle logout - reset everything
  const handleLogout = async (expired = false) => {
    await auth.logout(expired);
    primaryPane?.setContent('');
    primaryPane?.clearEditor();
    secondaryPane?.setContent('');
    secondaryPane?.clearEditor();
    editor.closeSplitView();
    focusPane('primary');
    setShowSidebar(false);
    setShowFindReplace(false);
    setShowHelperView(false);
    setHelperViewTab('toc');
  };

  // A recovery link signs the browser in as a side effect, so `auth.user` exists
  // while there is still no password anyone knows. In that state the form matters,
  // not the notebook.
  if (!auth || !auth.user || auth?.authMode === 'reset') {
    if (auth?.isLoading) {
      return <SurfaceFallback className="min-h-screen" message="Opening your workspace…" />;
    }
    return (
      <Auth
        sessionExpired={auth?.sessionExpired || false}
        authMode={auth?.authMode || 'login'}
        setAuthMode={auth?.setAuthMode || noop}
        authError={auth?.authError || ''}
        authForm={auth?.authForm || { username: '', password: '' }}
        setAuthForm={auth?.setAuthForm || noop}
        resetPasswordForm={auth?.resetPasswordForm || { password: '', confirmPassword: '' }}
        setResetPasswordForm={auth?.setResetPasswordForm || noop}
        onAuthenticate={auth?.authenticate || noop}
        onResetPassword={auth?.requestPasswordReset || noop}
        onCompletePasswordReset={auth?.completePasswordReset || noop}
        onUseLocally={() => {
          setLocalOnlyPreferred(true);
          window.location.reload();
        }}
      />
    );
  }

  return (
    <div
      className={`min-h-screen bg-animated-gradient-dark transition-[padding-left] duration-300 ease-in-out flex items-start justify-center py-2 px-0 sm:py-4 sm:px-2 ${showSidebar ? 'md:pl-52 xl:pl-56' : ''}`}
    >
      {/* Sidebar */}
      <ErrorBoundary level="component">
        <Sidebar
          showSidebar={showSidebar}
          notes={notes.notes}
          filteredNotes={notes.filteredNotes}
          currentNoteId={editor.primaryNoteId}
          secondaryNoteId={editor.secondaryNoteId}
          activePaneId={editor.activePaneId}
          splitViewEnabled={editor.splitViewEnabled}
          searchQuery={notes.searchQuery}
          isLoading={notes.isLoading}
          isSearching={notes.isSearching}
          storage={storage}
          onCreateNote={handleCreateNote}
          onSwitchNote={stableHandleSwitchNote}
          onDeleteNote={stableHandleDeleteNote}
          onDeleteNotes={stableHandleDeleteNotes}
          onTogglePin={notes.togglePinNote}
          onToggleAccess={notes.toggleAgentAccess}
          onSearchChange={notes.setSearchQuery}
          onImport={handleImport}
          onClose={() => setShowSidebar(false)}
        />
      </ErrorBoundary>

      {/* Find & Replace Modal */}
      {showFindReplace && (
        <ErrorBoundary level="component">
          <Suspense
            fallback={
              <SurfaceFallback
                className="fixed inset-0 z-50 bg-black/10"
                message="Loading find and replace…"
              />
            }
          >
            <FindReplaceModal
              content={editor.content}
              editorRef={editor.editorRef}
              onFind={handleFind}
              onReplace={handleReplace}
              onClose={() => setShowFindReplace(false)}
            />
          </Suspense>
        </ErrorBoundary>
      )}

      {/* Command Palette */}
      {showCommandPalette && (
        <ErrorBoundary level="component">
          <Suspense
            fallback={
              <SurfaceFallback
                className="fixed inset-0 z-50 bg-black/10"
                message="Loading command palette…"
              />
            }
          >
            <CommandPalette
              notes={notes.notes}
              onClose={() => setShowCommandPalette(false)}
              onCreateNote={handleCreateNote}
              onOpenFindReplace={() => setShowFindReplace(true)}
              onSwitchNote={handleSwitchNote}
              onToggleHelperView={() => setShowHelperView((prev) => !prev)}
              onOpenStorageHealth={() => setShowStorageHealth(true)}
              onOpenAgentActivity={() => setShowAgentActivity(true)}
              headings={noteHeadings}
              onJumpToHeading={jumpToHeading}
            />
          </Suspense>
        </ErrorBoundary>
      )}

      {/* Storage health — where the notes live, how much room is left, backups */}
      {showStorageHealth && (
        <ErrorBoundary level="component">
          <Suspense
            fallback={
              <SurfaceFallback
                className="fixed inset-0 z-50 bg-black/10"
                message="Loading storage panel…"
              />
            }
          >
            <StorageHealth
              isOpen={showStorageHealth}
              onClose={() => setShowStorageHealth(false)}
              notes={notes.notes}
              storage={storage}
              isLocalMode={!isSupabaseConfigured()}
              onExportAll={() => exportAllNotes(notes.notes, storage)}
              onRestored={(restoredNotes) =>
                notes.setNotes((previous) => [...restoredNotes, ...previous])
              }
              onNotice={(message, tone) => showToast(message, tone, 6000)}
            />
          </Suspense>
        </ErrorBoundary>
      )}

      {/* Agent activity — what the agent did to the notes, read from the server */}
      {showAgentActivity && (
        <ErrorBoundary level="component">
          <Suspense
            fallback={
              <SurfaceFallback
                className="fixed inset-0 z-50 bg-black/10"
                message="Loading agent activity…"
              />
            }
          >
            <AgentActivity
              isOpen={showAgentActivity}
              onClose={() => setShowAgentActivity(false)}
              notes={notes.notes}
            />
          </Suspense>
        </ErrorBoundary>
      )}

      {/* Toast Notifications */}
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {/* Confirm / Prompt dialogs — replaces window.confirm / window.prompt */}
      <DialogContainer />

      {/* Selection Toolbar for inline AI */}
      {editor.selectedText && editor.selectionPosition && (
        <ErrorBoundary level="component">
          <Suspense fallback={null}>
            <SelectionToolbar
              position={editor.selectionPosition}
              activeFormats={editor.activeFormats}
              onFormat={editor.wrapSelection}
              onInsertHeading={editor.insertHeading}
              onInsertLink={editor.insertLink}
              onClose={editor.clearSelection}
            />
          </Suspense>
        </ErrorBoundary>
      )}

      {/* Export Modal */}
      {showExportModal && (
        <ErrorBoundary level="component">
          <Suspense
            fallback={
              <SurfaceFallback
                className="fixed inset-0 z-50 bg-black/10"
                message="Loading export…"
              />
            }
          >
            <ExportModal
              isOpen={showExportModal}
              onClose={() => setShowExportModal(false)}
              content={editor.content}
              noteTitle={activeNoteTitle}
              onNotice={showNotice}
            />
          </Suspense>
        </ErrorBoundary>
      )}

      {/* Keyboard Shortcuts Modal */}
      {showKeyboardShortcuts && (
        <ErrorBoundary level="component">
          <Suspense
            fallback={
              <SurfaceFallback
                className="fixed inset-0 z-50 bg-black/10"
                message="Loading shortcuts…"
              />
            }
          >
            <KeyboardShortcutsModal
              isOpen={showKeyboardShortcuts}
              onClose={() => setShowKeyboardShortcuts(false)}
            />
          </Suspense>
        </ErrorBoundary>
      )}

      <main className="glass-front mx-auto w-full min-w-0 max-w-[1360px] rounded-none border-x-0 px-0 shadow-lg transition-[background-color,border-color,box-shadow] duration-200 sm:rounded-lg sm:border sm:px-4 md:px-6 lg:px-8 2xl:max-w-[1440px] 2xl:px-10">
        {/* A page needs one level-one heading; the toolbar and the note list are
            the visible chrome, so it is for screen readers only. */}
        <h1 className="sr-only">Notebook</h1>
        {/* Toolbar */}
        <Toolbar
          activeFormats={editor.activeFormats}
          user={auth.user}
          sessionExpiresAt={auth.sessionExpiresAt}
          copied={editor.copied}
          sidebarOpen={showSidebar}
          onToggleSidebar={() => setShowSidebar((prev) => !prev)}
          showHelperView={showHelperView}
          editorRef={editor.editorRef}
          currentNote={activeNote}
          content={editor.content}
          onFormat={editor.wrapSelection}
          onInsertHeading={editor.insertHeading}
          onInsertBlockquote={editor.insertBlockquote}
          onInsertCodeBlock={editor.insertCodeBlock}
          onInsertLink={editor.insertLink}
          onInsertNumberedList={editor.insertNumberedList}
          onInsertTaskList={editor.insertTaskList}
          onInsertHorizontalRule={editor.insertHorizontalRule}
          onInsertBulletList={editor.insertBulletList}
          onCopy={editor.copyAll}
          onClear={editor.clearAll}
          onLogout={() => handleLogout(false)}
          isLocalMode={!isSupabaseConfigured() || !auth.user}
          onToggleHelperView={() => setShowHelperView((prev) => !prev)}
          onOpenAgents={
            isSupabaseConfigured()
              ? () => {
                  setShowHelperView(true);
                  setHelperViewTab('agent');
                }
              : undefined
          }
          /* Device-only mode has no account, so agents cannot exist there. The
             button says so and leads to the sign-in form instead of vanishing.
             `hasSupabaseCredentials`, not `isSupabaseConfigured`: choosing
             device-only makes the latter false, which is exactly the state this
             button exists for. */
          onSignInToUseAgents={
            hasSupabaseCredentials() && isLocalOnlyPreferred()
              ? () => {
                  setLocalOnlyPreferred(false);
                  window.location.reload();
                }
              : undefined
          }
          splitViewEnabled={editor.splitViewEnabled}
          onToggleSplitView={handleToggleSplitView}
          onCreateNote={handleCreateNote}
          onInsertTable={editor.insertTable}
          onExport={() => setShowExportModal(true)}
          onKeyboardShortcuts={() => setShowKeyboardShortcuts(true)}
        />

        {/* Editor + Right Panel (TOC or AI) */}
        <div
          ref={containerRef}
          className="flex min-w-0 flex-col md:flex-row gap-0 p-2 sm:px-4 sm:py-2 lg:px-4 lg:py-2 editor-container"
          style={{
            '--split-ratio': `${editor.splitRatio}%`,
            '--preview-ratio': `${100 - editor.splitRatio}%`,
          }}
        >
          <div
            className="flex flex-col gap-4 min-w-0"
            style={
              showHelperView
                ? { flex: '0 1 var(--split-ratio)', minWidth: 0 }
                : { flex: '1 1 100%', minWidth: 0 }
            }
          >
            <div
              ref={paneContainerRef}
              className={`flex flex-col gap-4 ${editor.splitViewEnabled ? 'md:flex-row md:items-stretch md:gap-0' : ''}`}
              style={
                editor.splitViewEnabled ? { '--pane-ratio': `${editorPaneRatio}%` } : undefined
              }
            >
              <div
                className={`relative min-w-0 ${editor.splitViewEnabled ? 'flex-1' : 'w-full'}`}
                style={
                  editor.splitViewEnabled
                    ? { flex: `0 1 ${editorPaneRatio}%`, minWidth: 0 }
                    : undefined
                }
              >
                {editor.splitViewEnabled && (
                  <div className="flex items-center justify-between px-2 pb-2 text-[11px] uppercase tracking-wide text-gray-400">
                    <span>1</span>
                    <button
                      type="button"
                      onClick={() => handleClosePane('primary')}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-gray-600 text-[10px] text-gray-300 transition-[transform,background-color,color,border-color] duration-200 hover:bg-gray-700/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 active:scale-[0.96]"
                      aria-label="Close editor 1"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}
                <Editor
                  editorRef={primaryPane?.editorRef}
                  content={primaryPane?.content}
                  currentNoteId={editor.primaryNoteId}
                  onContentChange={primaryPane?.handleContentChange}
                  onKeyDown={(e) => primaryPane?.handleLocalKeyDown(e)}
                  isActive={editor.activePaneId === 'primary'}
                  splitViewEnabled={editor.splitViewEnabled}
                  onFocusPane={() => focusPane('primary')}
                  spans={primarySpans}
                  remoteRanges={remoteRanges}
                  contentLoading={primaryPane?.contentLoading}
                  readOnly={primaryPane?.paneLocked}
                />
              </div>

              {editor.splitViewEnabled && (
                <>
                  <div
                    className="relative flex w-1 cursor-col-resize bg-gray-700/50 transition-[background-color] duration-200 hover:bg-accent-500/60 group"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setIsPaneResizing(true);
                    }}
                    onTouchStart={(e) => {
                      e.preventDefault();
                      setIsPaneResizing(true);
                    }}
                    role="separator"
                    aria-label="Resize editor panes"
                    aria-orientation="vertical"
                  >
                    <div className="absolute inset-y-0 left-1/2 w-10 -translate-x-1/2 rounded-lg transition-[background-color,opacity] duration-200 hover:bg-gray-600/40" />
                  </div>

                  <div
                    className="relative flex-1 min-w-0"
                    style={{ flex: `0 1 ${100 - editorPaneRatio}%` }}
                  >
                    <div className="flex items-center justify-between px-2 pb-2 text-[11px] uppercase tracking-wide text-gray-400">
                      <span>2</span>
                      <button
                        type="button"
                        onClick={() => handleClosePane('secondary')}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-gray-600 text-[10px] text-gray-300 transition-[transform,background-color,color,border-color] duration-200 hover:bg-gray-700/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 active:scale-[0.96]"
                        aria-label="Close editor 2"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                    <Editor
                      editorRef={secondaryPane?.editorRef}
                      content={secondaryPane?.content}
                      currentNoteId={editor.secondaryNoteId}
                      onContentChange={secondaryPane?.handleContentChange}
                      onKeyDown={(e) => secondaryPane?.handleLocalKeyDown(e)}
                      isActive={editor.activePaneId === 'secondary'}
                      splitViewEnabled={editor.splitViewEnabled}
                      onFocusPane={() => focusPane('secondary')}
                      spans={secondarySpans}
                      contentLoading={secondaryPane?.contentLoading}
                    />
                  </div>
                </>
              )}
            </div>
          </div>

          {showHelperView && (
            <>
              <div
                className="relative hidden w-1 cursor-col-resize bg-gray-700/50 transition-[background-color] duration-200 hover:bg-accent-500/60 group md:flex"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setIsResizing(true);
                  resizeStartRef.current = { x: e.clientX, startRatio: editor.splitRatio };
                }}
                onTouchStart={(e) => {
                  e.preventDefault();
                  setIsResizing(true);
                  resizeStartRef.current = {
                    x: e.touches[0].clientX,
                    startRatio: editor.splitRatio,
                  };
                }}
                role="separator"
                aria-label="Resize panels"
                aria-orientation="vertical"
              >
                <div className="absolute inset-y-0 left-1/2 w-10 -translate-x-1/2 rounded-lg transition-[background-color,opacity] duration-200 hover:bg-gray-600/40" />
              </div>

              <div
                className="hidden self-stretch overflow-hidden rounded-[1.25rem] border border-white/10 bg-gray-900/10 p-1 shadow-soft md:flex md:flex-col"
                style={{
                  flex: '0 1 var(--preview-ratio)',
                  minWidth: '64px',
                  maxHeight: 'calc(100vh - 150px)',
                }}
              >
                <ErrorBoundary level="component">
                  <Suspense
                    fallback={
                      <SurfaceFallback
                        className="min-h-[520px] w-full"
                        message="Loading helper view…"
                      />
                    }
                  >
                    <HelperView
                      content={editor.content}
                      editorRef={activePane?.editorRef}
                      activeTab={helperViewTab}
                      onTabChange={setHelperViewTab}
                      noteId={activeNoteId}
                      storage={storage}
                      notes={notes.notes}
                      currentNoteId={activeNoteId}
                      onNoteClick={handleSwitchNote}
                      onTagClick={(tag) => {
                        // The chip knows a tag, not the syntax it was written
                        // with: `#alpha` and `tags: alpha` are the same tag, and
                        // searching for a literal `#` found neither reliably.
                        notes.setSearchQuery(tag);
                        setShowSidebar(true);
                      }}
                      onHide={() => setShowHelperView(false)}
                      agentsEnabled={isSupabaseConfigured()}
                      onSignInToUseAgents={
                        hasSupabaseCredentials() && isLocalOnlyPreferred()
                          ? () => {
                              setLocalOnlyPreferred(false);
                              window.location.reload();
                            }
                          : undefined
                      }
                      onRestoreContent={(content) => activePane?.applyExternalContent?.(content)}
                      onNotice={showNotice}
                      threadProps={{
                        noteId: activeNoteId,
                        messages: thread.messages,
                        status: thread.status,
                        notice: thread.notice,
                        baseRevision: activePaneNote?.revision ?? null,
                        onPost: thread.post,
                        onDecide: thread.decide,
                        onApply: applyProposalToNote,
                      }}
                    />
                  </Suspense>
                </ErrorBoundary>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className={`bg-gray-800/40 border-gray-700/50 border-t px-4 py-2.5 rounded-b-2xl`}>
          <div
            className={`text-xs text-gray-400 flex items-center justify-between flex-wrap gap-2`}
          >
            <WordCount
              content={editor.content}
              cursor={
                editor.caretIndex == null ? null : lineColumnAt(editor.content, editor.caretIndex)
              }
            />
            <div className="flex items-center gap-3">
              <PresenceBar others={presence.others} />
              {!isSupabaseConfigured() && <StorageMode />}
              {editor.saveStatus === 'saving' && (
                <span className="flex items-center gap-1.5 pulse-subtle">
                  <Loader2 className="w-3 h-3 motion-safe:animate-spin text-accent-500" />
                  <span>Saving...</span>
                </span>
              )}
              {editor.saveStatus === 'saved' && (
                <span className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400 fade-in-up">
                  <Check className="w-3 h-3 motion-safe:animate-checkmark" />
                  <span>Saved</span>
                </span>
              )}
              {editor.saveStatus === 'error' && (
                <span className="flex items-center gap-1.5 text-red-600 dark:text-red-400">
                  <AlertCircle className="w-3 h-3" />
                  <span>Save failed</span>
                  <button
                    onClick={() => editor.retrySave()}
                    className="underline text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 focus-visible:outline-none"
                  >
                    Retry
                  </button>
                </span>
              )}
              {editor.saveStatus === 'conflict' && (
                <span className="flex items-center flex-wrap gap-2 text-yellow-700 dark:text-yellow-300">
                  <span className="flex items-center gap-1.5">
                    <AlertCircle className="w-3 h-3" />
                    <span>Conflicting server update</span>
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      const accepted = await editor.acceptIncoming?.({ shouldFocus: true });
                      if (accepted) {
                        showNotice('serverVersionLoaded');
                      }
                    }}
                    className="underline hover:text-yellow-900 dark:hover:text-yellow-100 focus-visible:outline-none"
                  >
                    Use server version
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const restored = editor.restoreConflictDraft?.({ shouldFocus: true });
                      if (restored) {
                        showNotice('conflictDraftRestored');
                      }
                    }}
                    className="underline hover:text-yellow-900 dark:hover:text-yellow-100 focus-visible:outline-none"
                  >
                    Restore draft
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const copied = await editor.copyConflictToClipboard?.();
                      showNotice(copied ? 'conflictDraftCopied' : 'conflictCopyFailed');
                    }}
                    className="underline hover:text-yellow-900 dark:hover:text-yellow-100 focus-visible:outline-none"
                  >
                    Copy draft
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const saved = await editor.saveLocalDraft?.();
                      showNotice(saved ? 'localDraftSaved' : 'localDraftSaveFailed');
                    }}
                    className="underline hover:text-yellow-900 dark:hover:text-yellow-100 focus-visible:outline-none"
                  >
                    Keep my version
                  </button>
                </span>
              )}
              <button
                onClick={() => setShowCommandPalette(true)}
                className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors focus-visible:outline-none focus-visible:ring-1 border-gray-600/50 text-gray-400 hover:text-gray-300 hover:border-gray-500 focus-visible:ring-accent-500`}
                title="Open command palette (Ctrl/Cmd+K)"
                aria-label="Open command palette (Ctrl/Cmd+K)"
              >
                {/Mac|iPhone|iPad/i.test(navigator.userAgent) ? '⌘K' : 'Ctrl+K'}
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary level="page">
      <Router>
        <AppProvider>
          <Routes>
            <Route path="*" element={<AppContent />} />
          </Routes>
        </AppProvider>
      </Router>
    </ErrorBoundary>
  );
}
