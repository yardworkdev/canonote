import React, { useState, useEffect, useCallback } from 'react';
import { dialog } from '../utils/dialog';
import { Clock, RotateCcw, Trash2, Calendar } from 'lucide-react';
import { formatRelativeTime } from '../utils/time';
import {
  readNoteVersionsResult,
  recordNoteVersion,
  writeNoteVersions,
  NOTE_VERSIONS_EVENT,
} from '../services/note-history';
import { PanelHeader, PanelEmpty, PanelLoading, PanelError } from './HelperPanel';
import { notesApi } from '../services/notes-api';
import { isSupabaseConfigured } from '../services/supabase';
import { probeStorageAdapter } from '../services/storage-failure';

// What the panel says when the store itself is the reason it cannot look. Same
// vocabulary as the status row (src/services/storage-failure.js): the sentence
// and the step that fits that failure, not a generic retry.
const STORAGE_FAILURE_COPY = {
  blocked: {
    message: 'Versions cannot be read — this browser is blocking storage.',
    detail: 'Allow site data for this page, then reload.',
  },
  full: {
    message: 'Versions cannot be read — storage is full.',
    detail: 'Export your notes, then delete a note to free space.',
  },
};

export default function NoteHistory({ noteId, content, storage, onRestore, editorRef }) {
  const [versions, setVersions] = useState([]);
  const [selectedVersion, setSelectedVersion] = useState(null);
  // 'loading' | 'ready' | 'error' — the panel says which, because "no versions
  // saved yet" over a read the browser refused is a claim the app cannot make.
  const [status, setStatus] = useState('loading');
  const [storageFailure, setStorageFailure] = useState(null);
  const [deleteError, setDeleteError] = useState(null);
  // The server keeps its own history (note_versions, migration 012): every canonical
  // save, with who made it. Local versions are this browser's snapshots; these are
  // the note's, including the agent's edits. Shown together so the list answers
  // "who changed this, and when" rather than "what did this browser see".
  const [serverHistory, setServerHistory] = useState([]);
  const [serverStatus, setServerStatus] = useState('idle');
  const versionsRef = React.useRef([]);
  const loadTokenRef = React.useRef(0);
  // Which server version is being put back, so the row can say so instead of
  // freezing the whole panel on one request.
  const [revertingRevision, setRevertingRevision] = useState(null);
  const [revertError, setRevertError] = useState(null);

  const readServerHistory = useCallback(async () => {
    const data = await notesApi.history(noteId, 30);
    setServerHistory(Array.isArray(data?.items) ? data.items : []);
    setServerStatus('ready');
  }, [noteId]);

  useEffect(() => {
    if (!noteId || !isSupabaseConfigured()) {
      setServerHistory([]);
      setServerStatus('idle');
      return undefined;
    }
    let cancelled = false;
    setServerStatus('loading');
    readServerHistory().catch(() => {
      if (cancelled) return;
      setServerHistory([]);
      setServerStatus('unavailable');
    });
    return () => {
      cancelled = true;
    };
  }, [noteId, readServerHistory]);

  // A panel that is already open must not keep showing the history it read before
  // the person's last keystrokes landed: the newest version is the note as it is
  // now, and a list without it shows a "current" that is not. Debounced so typing
  // does not turn into a request per character.
  useEffect(() => {
    if (!noteId || !isSupabaseConfigured()) return undefined;
    const timer = setTimeout(() => {
      void readServerHistory().catch(() => {});
    }, 1500);
    return () => clearTimeout(timer);
  }, [content, noteId, readServerHistory]);

  /**
   * Put the note back the way a server version left it. The revert is a new
   * version by the person, so the agent's text is still in history afterwards —
   * this is an undo, not a delete.
   */
  const restoreServerVersion = useCallback(
    async (entry) => {
      if (!entry?.revision || revertingRevision) return;
      setRevertingRevision(entry.revision);
      setRevertError(null);
      try {
        const note = await notesApi.revert(noteId, entry.revision);
        onRestore?.(note?.content ?? '');
        await readServerHistory();
      } catch (error) {
        setRevertError(error?.message || 'That version could not be restored.');
      } finally {
        setRevertingRevision(null);
      }
    },
    [noteId, onRestore, readServerHistory, revertingRevision]
  );

  const loadVersions = useCallback(
    async ({ silent = false } = {}) => {
      const token = ++loadTokenRef.current;
      if (!storage || !noteId) {
        versionsRef.current = [];
        setVersions([]);
        setStatus('ready');
        return;
      }

      // A refresh driven by the save pipeline must not flip the panel back to
      // its loading state on every save — it already has something to show.
      if (!silent) setStatus('loading');
      const { versions: sorted, error } = await readNoteVersionsResult(storage, noteId);
      // A load must not be applied over a newer one: switching notes quickly
      // leaves two reads in flight and the slower one would win.
      if (token !== loadTokenRef.current) return;

      if (error) {
        console.warn('Failed to read note versions:', error);
        setStatus('error');
        return;
      }

      // A store that answers null for every key answers null here too, so an
      // empty read is only an empty note if the store can be written to at all.
      // Asking is what keeps "No versions saved yet" a fact instead of a guess.
      if (sorted.length === 0) {
        const probe = await probeStorageAdapter(storage);
        if (token !== loadTokenRef.current) return;
        if (!probe.available) {
          setStorageFailure(probe.reason === 'full' ? 'full' : 'blocked');
          setStatus('error');
          return;
        }
      }

      setStorageFailure(null);
      versionsRef.current = sorted;
      setVersions(sorted);
      setStatus('ready');
    },
    [storage, noteId]
  );

  useEffect(() => {
    loadVersions();
  }, [loadVersions]);

  // A snapshot recorded while this panel is on screen arrives as an event, so
  // the count in the header stays a fact instead of a reading taken once.
  useEffect(() => {
    const onVersionsChanged = (event) => {
      if (event.detail?.noteId && event.detail.noteId !== noteId) return;
      loadVersions({ silent: true });
    };
    window.addEventListener(NOTE_VERSIONS_EVENT, onVersionsChanged);
    return () => window.removeEventListener(NOTE_VERSIONS_EVENT, onVersionsChanged);
  }, [loadVersions, noteId]);

  // Versions are recorded by the save pipeline (src/services/note-history.js,
  // called whenever the app reports the note saved) — not here. A snapshot
  // timer in this panel only ran while the History tab was open, with a 15s
  // debounce, so a note edited in any other tab was never versioned at all.

  const restoreVersion = async (version) => {
    if (!editorRef?.current || !onRestore) return;
    const confirmed = await dialog.confirm(
      'Restore this version? Current content will be replaced.',
      {
        title: 'Restore version',
        confirmLabel: 'Restore',
      }
    );
    if (confirmed) {
      // Keep what is on screen now, so a restore can itself be undone.
      await recordNoteVersion(storage, noteId, content, { force: true }).catch((error) => {
        console.warn('Failed to snapshot content before restoring:', error);
      });
      onRestore(version.content);
      setSelectedVersion(null);
      await loadVersions();
    }
  };

  const deleteVersion = async (versionId) => {
    if (!storage || !noteId) return;
    setDeleteError(null);

    try {
      const updated = versions.filter((v) => v.id !== versionId);
      await writeNoteVersions(storage, noteId, updated);
      versionsRef.current = updated;
      setVersions(updated);
    } catch (error) {
      console.warn('Failed to delete version:', error);
      // A refused write leaves the store as it was, so nothing was removed and
      // the list on screen is still the truth. Say so, and offer the step.
      setDeleteError({
        message: 'That version could not be deleted.',
        detail: 'The browser refused the write, so nothing was removed.',
        retry: () => deleteVersion(versionId),
      });
    }
  };

  const formatDate = (timestamp) => {
    return new Date(timestamp).toLocaleString();
  };

  const headerLabel =
    status === 'loading'
      ? 'Reading versions…'
      : status === 'error'
        ? 'Versions could not be read'
        : `${versions.length} ${versions.length === 1 ? 'version' : 'versions'} saved`;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PanelHeader label={headerLabel} />

      <div className="flex-1 overflow-y-auto">
        {deleteError && (
          <PanelError
            message={deleteError.message}
            detail={deleteError.detail}
            onRetry={() => {
              const retry = deleteError.retry;
              setDeleteError(null);
              retry();
            }}
          />
        )}

        {serverStatus === 'unavailable' && (
          <div className="px-5 pt-4 text-[11px] text-gray-600">
            Server history unavailable — showing this browser's versions only.
          </div>
        )}

        {serverHistory.length > 0 && (
          <div className="px-5 pt-4">
            <div className="mb-2 text-[11px] uppercase tracking-wide text-gray-500">
              On the server · {serverHistory.length}
            </div>
            <div className="space-y-px">
              {serverHistory.map((entry, index) => (
                <div
                  key={`${entry.revision}-${entry.at}`}
                  className="flex items-baseline justify-between gap-3 border-l border-gray-700 py-1.5 pl-3 text-xs"
                >
                  <div className="min-w-0">
                    <span className={entry.actor === 'agent' ? 'text-gray-200' : 'text-gray-400'}>
                      {entry.actor === 'agent' ? 'Agent' : entry.actor === 'human' ? 'You' : 'Unknown'}
                    </span>
                    {typeof entry.added === 'number' && (
                      <span className="ml-2 text-gray-500">
                        +{entry.added} −{entry.removed}
                      </span>
                    )}
                    <span className="ml-2 text-gray-600">{entry.words} words</span>
                  </div>
                  <span className="flex shrink-0 items-baseline gap-2 text-gray-600">
                    <span title={entry.at || ''}>
                      {entry.at ? formatRelativeTime(new Date(entry.at).getTime()) : '—'}
                    </span>
                    {/* The newest entry is what the note already says; the rest are
                        what the note used to say, and can be put back. */}
                    {index === 0 && (
                      <span className="text-gray-600 uppercase tracking-wide">current</span>
                    )}
                    {index > 0 && entry.revision && (
                      <button
                        type="button"
                        onClick={() => restoreServerVersion(entry)}
                        disabled={Boolean(revertingRevision)}
                        className="text-gray-500 underline decoration-gray-700 underline-offset-2 hover:text-gray-300 disabled:opacity-50"
                        title="Put the note back the way it was in this version"
                      >
                        {revertingRevision === entry.revision ? 'Restoring…' : 'Restore'}
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
            {revertError && (
              <div className="mt-2 text-[11px] text-gray-400">{revertError}</div>
            )}
            <div className="mt-3 border-t border-gray-800 pt-3 text-[11px] uppercase tracking-wide text-gray-500">
              This browser
            </div>
          </div>
        )}

        {status === 'loading' ? (
          <PanelLoading label="Reading this note's versions…" />
        ) : status === 'error' ? (
          <PanelError
            message={
              storageFailure
                ? STORAGE_FAILURE_COPY[storageFailure].message
                : "This note's versions could not be read."
            }
            detail={
              storageFailure
                ? STORAGE_FAILURE_COPY[storageFailure].detail
                : 'The browser refused to read them. Reloading the page is worth a try.'
            }
            onRetry={() => loadVersions()}
          />
        ) : versions.length === 0 ? (
          <PanelEmpty message="No versions saved yet — versions are recorded as you edit." />
        ) : (
          <div className="space-y-2 p-5">
            {versions.map((version) => (
              <div
                key={version.id}
                className={`rounded-lg border p-3 transition-colors ${
                  selectedVersion?.id === version.id
                    ? 'bg-white/[0.06] border-gray-500'
                    : 'bg-gray-800 border-gray-700 hover:bg-gray-750'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Calendar className="w-3.5 h-3.5 text-gray-400" />
                      <span className="text-xs font-medium text-gray-300">
                        {formatRelativeTime(version.timestamp)}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mb-2">{formatDate(version.timestamp)}</p>
                    <div className="text-xs text-gray-400">
                      {version.wordCount} words • {version.charCount} chars
                    </div>
                    <p className="text-xs mt-2 line-clamp-2 text-gray-400">
                      {version.content.substring(0, 100)}...
                    </p>
                  </div>
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() =>
                        setSelectedVersion(selectedVersion?.id === version.id ? null : version)
                      }
                      className="p-1.5 rounded hover:bg-white/10 text-gray-400"
                      title="View details"
                    >
                      <Clock className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => restoreVersion(version)}
                      className="p-1.5 rounded hover:bg-white/10 text-green-400"
                      title="Restore this version"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={async () => {
                        const confirmed = await dialog.confirm('Delete this version?', {
                          title: 'Delete version',
                          confirmLabel: 'Delete',
                          variant: 'danger',
                        });
                        if (confirmed) deleteVersion(version.id);
                      }}
                      className="p-1.5 rounded hover:bg-white/10 text-red-400"
                      title="Delete version"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {selectedVersion?.id === version.id && (
                  <div className="mt-3 pt-3 border-t border-gray-700">
                    <div className="text-xs whitespace-pre-wrap max-h-40 overflow-y-auto text-gray-300">
                      {version.content}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
