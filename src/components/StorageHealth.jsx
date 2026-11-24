import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, HardDrive, Download, History, FolderOpen } from 'lucide-react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import {
  readBackup,
  readBackupIndex,
  restoreLocalBackup,
  writeLocalBackup,
} from '../services/local-backups';
import {
  describeBrowserQuota,
  describeLocalUsage,
  measureStoreBytes,
  readStorageUsage,
} from '../services/storage-health';
import {
  FOLDER_STATE_FILE,
  folderPermission,
  folderStorageAvailable,
  forgetFolderHandle,
  readSavedFolderHandle,
  requestFolderHandle,
  saveFolderHandle,
} from '../services/folder-storage';
import { getStorageMode } from '../services/storage-adapter';
import { noticeText, noticeTone } from '../services/notices';
import { formatRelativeTime } from '../utils/time';

/**
 * Storage health — the facts about where the notes live, in one panel.
 *
 * Slice 2's promise is "storage you can trust", and trust needs a place that
 * answers three questions in plain words: where are my notes, how much room is
 * left, and when was the last backup. The facts belong here rather than in the
 * status row, because a row of status text cannot carry a number, a unit and an
 * action without turning into a dashboard (BRAND.md: status is a fact, a
 * control is a control — this is the surface the controls live on).
 *
 * It is also where the notebook is put on a **folder the user picks** — the
 * second store behind the seam (`src/services/folder-storage.js`). That is a
 * control with a real cost, so it lives here and nowhere else: the notes become
 * `.md` files in a folder the user owns, and the choice is made at boot, which
 * is why connecting a folder reloads the notebook. The panel states the folder
 * it is on, offers the folder it remembers but cannot open any more, and can
 * put the notebook back in the browser without touching the files.
 *
 * Reachable from the command palette, not from the status row: the row states,
 * this panel acts.
 */
const panelButton =
  'inline-flex min-h-10 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButton = `${panelButton} border-gray-600/50 text-gray-200 hover:border-gray-500 hover:bg-gray-700/40`;
const primaryButton = `${panelButton} border-accent-600 bg-accent-600 text-white hover:border-accent-700 hover:bg-accent-700`;

/** The store is chosen before the app renders, so a switch is a reload. */
const RELOAD_AFTER_NOTICE_MS = 1500;

export default function StorageHealth({
  isOpen,
  onClose,
  notes = [],
  storage,
  isLocalMode = true,
  store,
  onBackupWritten,
  onExportAll,
  onRestored,
  onNotice,
}) {
  const containerRef = useRef(null);
  const [backups, setBackups] = useState([]);
  const [localBytes, setLocalBytes] = useState(null);
  const [estimate, setEstimate] = useState({ usageBytes: null, quotaBytes: null });
  const [isBusy, setIsBusy] = useState(false);
  const [mode, setMode] = useState({ mode: 'local', folderName: null });
  const [savedFolderName, setSavedFolderName] = useState(null);

  useFocusTrap(containerRef, isOpen, { onClose });

  const refresh = useCallback(async () => {
    // `store` is the Web Storage the backup snapshots live in; the number
    // reported for the notes comes through the seam, which is the store they
    // are actually on (IndexedDB, Web Storage as the fallback, or a folder).
    const index = readBackupIndex(store);
    setBackups(index);
    setLocalBytes(await measureStoreBytes());
    return index;
  }, [store]);

  useEffect(() => {
    if (!isOpen) return undefined;
    refresh();
    setMode(getStorageMode());

    let isActive = true;
    readStorageUsage().then((usage) => {
      if (isActive) setEstimate(usage);
    });

    // A folder the notebook remembers but could not open (the browser wants the
    // permission asked for again, from a click): name it so the panel can offer
    // to reconnect instead of silently opening on the browser store.
    if (folderStorageAvailable() && getStorageMode().mode !== 'folder') {
      readSavedFolderHandle().then((handle) => {
        if (handle && isActive) setSavedFolderName(handle.name || 'folder');
      });
    }

    return () => {
      isActive = false;
    };
  }, [isOpen, refresh]);

  if (!isOpen) return null;

  const latestBackup = backups[0] || null;
  const quotaLine = describeBrowserQuota(estimate);
  const onFolder = mode.mode === 'folder';

  /** One notice, then the reload that puts the notebook on the new store. */
  const switchStore = (key, args) => {
    onNotice?.(noticeText(key, args), noticeTone(key));
    setIsBusy(true);
    window.setTimeout(() => window.location.reload(), RELOAD_AFTER_NOTICE_MS);
  };

  const handleChooseFolder = async () => {
    setIsBusy(true);
    try {
      const handle = await requestFolderHandle();
      if ((await folderPermission(handle, { request: true })) !== 'granted') {
        setIsBusy(false);
        onNotice?.(noticeText('folderPermissionNeeded'), noticeTone('folderPermissionNeeded'));
        return;
      }
      if (!(await saveFolderHandle(handle))) {
        setIsBusy(false);
        onNotice?.(noticeText('folderFailed'), noticeTone('folderFailed'));
        return;
      }
      switchStore('folderConnected', { name: handle.name || 'folder' });
    } catch (error) {
      setIsBusy(false);
      // The user closed the picker: that is not a failure to report.
      if (error?.name === 'AbortError') return;
      onNotice?.(noticeText('folderFailed'), noticeTone('folderFailed'));
    }
  };

  const handleReconnectFolder = async () => {
    setIsBusy(true);
    const handle = await readSavedFolderHandle();
    const permission = handle ? await folderPermission(handle, { request: true }) : 'denied';
    if (permission !== 'granted') {
      setIsBusy(false);
      onNotice?.(noticeText('folderPermissionNeeded'), noticeTone('folderPermissionNeeded'));
      return;
    }
    switchStore('folderConnected', { name: handle.name || savedFolderName || 'folder' });
  };

  const handleStopFolder = async () => {
    setIsBusy(true);
    await forgetFolderHandle();
    switchStore('folderStopped');
  };

  const handleBackupNow = async () => {
    setIsBusy(true);
    const result = await writeLocalBackup({
      notes,
      store,
      readContent: async (note) => {
        const row = await window.storage.get(storage.noteStorageKey(note.id));
        return row?.value ?? '';
      },
    });
    setIsBusy(false);

    if (!result.ok) {
      onNotice?.(result.message, result.tone ?? noticeTone('backupBlocked'));
      return;
    }

    const index = await refresh();
    onBackupWritten?.(index);
    const count = result.entry.noteCount;
    onNotice?.(noticeText('backedUp', { count }), noticeTone('backedUp'));
  };

  const handleRestore = async () => {
    if (!latestBackup) return;
    const snapshot = readBackup(latestBackup.id, store);
    setIsBusy(true);
    const { restored, skipped } = await restoreLocalBackup({ snapshot, currentNotes: notes, storage });
    setIsBusy(false);

    if (restored.length === 0) {
      onNotice?.(noticeText('nothingToRestore', { skipped }), noticeTone('nothingToRestore'));
      return;
    }

    const count = restored.length;
    await onRestored?.(restored);
    onNotice?.(
      noticeText('restored', { count, when: formatRelativeTime(latestBackup.createdAt) }),
      noticeTone('restored')
    );
    onClose?.();
  };

  const whereTheNotesLive = onFolder
    ? `In “${mode.folderName}”, as .md files`
    : isLocalMode
      ? 'In this browser, on this device'
      : 'In your account, with a copy in this browser';

  const facts = [
    { label: 'Where the notes live', value: whereTheNotesLive },
    { label: 'Notes and space', value: describeLocalUsage(localBytes, notes.length) },
    ...(quotaLine ? [{ label: 'Room the browser allows', value: quotaLine }] : []),
    {
      label: 'Last backup',
      value: latestBackup
        ? `${formatRelativeTime(latestBackup.createdAt)} — ${latestBackup.noteCount} ${
            latestBackup.noteCount === 1 ? 'note' : 'notes'
          }`
        : 'No backup taken yet',
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={containerRef}
        tabIndex={-1}
        className="w-full max-w-md overflow-hidden rounded-lg border border-gray-700/50 bg-gray-800 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="storage-health-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-700/50 px-6 py-4">
          <h2
            id="storage-health-title"
            className="flex items-center gap-2 text-base font-semibold tracking-[-0.01em] text-gray-100"
          >
            <HardDrive className="h-4 w-4 text-gray-400" aria-hidden="true" />
            Storage
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close storage panel"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 transition-colors duration-200 hover:bg-gray-700/50 hover:text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="px-6 py-5">
          <dl className="space-y-3 text-sm">
            {facts.map((fact) => (
              <div key={fact.label} className="flex items-baseline justify-between gap-4">
                <dt className="text-gray-400">{fact.label}</dt>
                <dd className="text-right text-gray-200">{fact.value}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-4 text-xs text-gray-400">
            {backups.length === 0
              ? 'A backup is a copy of every note, kept in this browser; it is not a second device.'
              : `${backups.length} ${backups.length === 1 ? 'backup' : 'backups'} kept in this browser; the oldest is dropped when a fourth is written.`}
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleBackupNow}
              disabled={isBusy || notes.length === 0}
              className={primaryButton}
            >
              <History className="h-3.5 w-3.5" aria-hidden="true" />
              Back up now
            </button>
            <button type="button" onClick={onExportAll} disabled={isBusy} className={secondaryButton}>
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              Export all notes (.zip)
            </button>
            <button
              type="button"
              onClick={handleRestore}
              disabled={isBusy || !latestBackup}
              className={secondaryButton}
            >
              Restore latest backup
            </button>
          </div>

          <p className="mt-3 text-xs text-gray-400">
            Restoring only adds notes this notebook no longer has — nothing here is overwritten.
          </p>

          {onFolder ? (
            <div className="mt-5 border-t border-gray-700/50 pt-4">
              <p className="text-xs text-gray-400">
                Every note is one <code className="text-gray-300">.md</code> file in that folder, so
                the drive you already use can sync it; the notebook keeps its own index in{' '}
                <code className="text-gray-300">{FOLDER_STATE_FILE}</code>. Files you add to the
                folder yourself open here too.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleStopFolder}
                  disabled={isBusy}
                  className={secondaryButton}
                >
                  <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                  Back to this browser
                </button>
              </div>
              <p className="mt-3 text-xs text-gray-400">
                Leaving the folder moves nothing: the notes stay as files, and the notebook starts
                empty in this browser.
              </p>
            </div>
          ) : folderStorageAvailable() ? (
            <div className="mt-5 border-t border-gray-700/50 pt-4">
              <p className="text-xs text-gray-400">
                Your notes can be a folder you pick — one <code className="text-gray-300">.md</code>{' '}
                file per note, in a drive you already sync.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={savedFolderName ? handleReconnectFolder : handleChooseFolder}
                  disabled={isBusy}
                  className={secondaryButton}
                >
                  <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                  {savedFolderName ? `Reconnect “${savedFolderName}”` : 'Use a folder for your notes'}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
