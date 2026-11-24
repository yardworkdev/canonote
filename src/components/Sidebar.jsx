import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Search,
  FileText,
  FileSearch,
  Plus,
  X,
  Star,
  Download,
  Upload,
  Loader2,
  Pin,
  Bot,
  Eye,
  CheckSquare,
  Trash2,
} from 'lucide-react';
import { formatRelativeTime } from '../utils/time';
import { exportAllNotes } from '../utils/export';
import { debounce } from '../utils/debounce';
import { classifyNotesForSidebar } from '../utils/notes';
import { useAgentName } from '../hooks/useAgentName';
import Tooltip from './Tooltip';

const SKELETON_WIDTHS = ['75%', '55%', '65%'];
const SKELETON_WIDTHS_2 = ['55%', '45%', '60%'];
// A title long enough to be cut by the row's two-line clamp gets the full text
// on hover, so nothing is unreachable. Shorter titles stay quiet.
const TITLE_TOOLTIP_THRESHOLD = 60;
const sidebarIconButtonClass =
  'inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors duration-150 hover:bg-gray-700/40 hover:text-gray-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-400';
const sidebarTextButtonClass =
  'inline-flex h-7 items-center justify-center rounded-md px-2 text-xs text-gray-300 transition-colors duration-150 hover:bg-gray-700/40 hover:text-gray-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-400';

// The visual half of the row's selection control. It is a mark, not a second
// control: the row itself is the button (with `aria-pressed`), because a
// checkbox nested inside a button is unreachable by keyboard — the same defect
// the accessibility sweep found on the pin and delete actions.
const SelectionMark = ({ selected }) => (
  <span
    aria-hidden="true"
    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors duration-150 ${
      selected ? 'border-accent-500 bg-accent-600 text-white' : 'border-gray-600/70 text-transparent'
    }`}
  >
    <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M2.5 6.5 5 9l4.5-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </span>
);

const NoteItem = React.memo(function NoteItem({
  note,
  isActive,
  isSecondary,
  showPaneBadge,
  paneLabel,
  searchQuery,
  selecting,
  isSelected,
  onSelect,
  onPin,
  onToggleAccess,
  onDelete,
  onToggleSelected,
}) {
  // One line under the title: the search hit while searching, the note's own
  // second line otherwise. Never both.
  const snippet = note.snippet && searchQuery ? note.snippet : '';
  const secondLine = snippet || note.preview || '';

  return (
    <div
      className={`group relative rounded-lg border transition-colors duration-150 ${
        isSelected || isActive
          ? 'border-gray-600/40 bg-gray-750/50'
          : isSecondary
            ? 'border-gray-700/50 bg-gray-800/30'
            : 'border-transparent hover:bg-gray-800/40'
      }`}
    >
      {(isSelected || isActive) && (
        <span className="absolute left-0 top-3 bottom-3 w-0.5 rounded-full bg-accent-400" aria-hidden="true" />
      )}
      {showPaneBadge && (
        <span className="absolute -top-2 -left-2 rounded-full border border-gray-600/50 bg-gray-800 px-2 py-0.5 text-[10px] font-medium text-gray-300">
          {paneLabel}
        </span>
      )}
      {/* The row is a real button; the pin and delete controls are siblings, not
          nested inside it — a button inside a button is unreachable by keyboard. */}
      <button
        type="button"
        onClick={() => (selecting ? onToggleSelected(note.id) : onSelect(note.id))}
        aria-label={selecting ? `Select note: ${note.title}` : `Open note: ${note.title}`}
        aria-pressed={selecting ? isSelected : undefined}
        className={`flex w-full cursor-pointer items-start gap-2 rounded-lg p-3 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-400 ${
          selecting ? '' : 'pr-16'
        }`}
      >
        {selecting && <SelectionMark selected={isSelected} />}
        <div className="flex min-w-0 flex-col">
          <div
            className="text-balance text-sm font-medium leading-snug tracking-[-0.01em] text-gray-100 line-clamp-2"
            title={note.title.length > TITLE_TOOLTIP_THRESHOLD ? note.title : undefined}
          >
            {note.title}
          </div>
          {secondLine && (
            <div className="mt-1 line-clamp-2 text-pretty text-[11px] text-gray-400">{secondLine}</div>
          )}
          {/* One word, on every row: whose note this is. No verbs, no names,
              no legend to learn — you, agent, or both. */}
          <div className="mt-1">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] ${
                note.writer === 'you'
                  ? 'border-gray-700/60 text-gray-400'
                  : 'border-gray-500/50 text-gray-300'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  note.writer === 'agent' ? 'bg-gray-300' : note.writer === 'both' ? 'bg-gray-400' : 'bg-gray-600'
                }`}
                aria-hidden="true"
              />
              {note.writer === 'agent' ? 'agent' : note.writer === 'both' ? 'both' : 'you'}
            </span>
          </div>
          {note.updated && (
            <div
              className="mt-1 text-[11px] text-gray-400"
              title={new Date(note.updated).toLocaleString()}
            >
              {formatRelativeTime(note.updated)}
            </div>
          )}
        </div>
      </button>
      {/* The cluster floats over the row, so it must not swallow clicks meant for
          the row itself: the wrapper is transparent to the pointer and only the
          buttons in it take one. */}
      {!selecting && (
        <div className="pointer-events-none absolute right-1.5 top-1.5 flex items-center gap-0.5 [&_button]:pointer-events-auto">
          <Tooltip
            label={
              note.agentAccess === false
                ? 'Agents cannot see this note — click to allow'
                : 'Agents can see this note — click to block'
            }
          >
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              onToggleAccess(note.id);
            }}
            className={`${sidebarIconButtonClass} ${
              note.agentAccess === false
                ? 'text-gray-500 opacity-100'
                : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
            }`}
            aria-label={
              note.agentAccess === false
                ? `Allow agents to see: ${note.title}`
                : `Block agents from: ${note.title}`
            }
            aria-pressed={note.agentAccess !== false}
          >
            <Eye className={`w-3.5 h-3.5 ${note.agentAccess === false ? 'opacity-40' : ''}`} />
          </button>
          </Tooltip>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              onPin(note.id);
            }}
            className={`${sidebarIconButtonClass} ${
              note.isPinned
                ? 'text-accent-300 opacity-100'
                : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
            }`}
            aria-label={note.isPinned ? `Unpin note: ${note.title}` : `Pin note: ${note.title}`}
          >
            <Star className={`w-3.5 h-3.5 ${note.isPinned ? 'fill-current' : ''}`} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              onDelete(note.id, e);
            }}
            className={`${sidebarIconButtonClass} opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-red-500/10 hover:text-red-400`}
            aria-label={`Delete note: ${note.title}`}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
});

export default function Sidebar({
  showSidebar,
  notes,
  filteredNotes,
  currentNoteId,
  secondaryNoteId,
  activePaneId = 'primary',
  splitViewEnabled = false,
  searchQuery,
  isLoading,
  isSearching,
  storage,
  onCreateNote,
  onSwitchNote,
  onDeleteNote,
  onDeleteNotes,
  onTogglePin,
  onToggleAccess,
  onSearchChange,
  onImport,
  onClose,
}) {
  const [localSearch, setLocalSearch] = useState(searchQuery);
  const [isImporting, setIsImporting] = useState(false);
  // Selecting several notes is a mode, not a third click target on every row:
  // while it is on, a row toggles selection instead of opening the note, and
  // the per-row actions make room for it.
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const importInputRef = useRef(null);
  // The name the user gave their agent, so the list never shows a built-in one.
  const { agentName } = useAgentName();

  const onSearchChangeRef = useRef(onSearchChange);
  useEffect(() => { onSearchChangeRef.current = onSearchChange; }, [onSearchChange]);

  const debouncedSearch = useMemo(
    () => debounce((value) => onSearchChangeRef.current?.(value), 150),
    []
  );

  const handleSelectNote = useCallback(
    (noteId) => {
      onSwitchNote(noteId);
      if (window.innerWidth < 768) onClose?.();
    },
    [onSwitchNote, onClose]
  );
  const handlePinNote = useCallback((noteId) => onTogglePin(noteId), [onTogglePin]);
  const handleToggleAccess = useCallback(
    (noteId) => onToggleAccess?.(noteId),
    [onToggleAccess]
  );
  const handleDeleteNote = useCallback((noteId, e) => onDeleteNote(noteId, e), [onDeleteNote]);

  const exitSelection = useCallback(() => {
    setSelecting(false);
    setSelectedIds(new Set());
  }, []);

  const toggleSelected = useCallback((noteId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) next.delete(noteId);
      else next.add(noteId);
      return next;
    });
  }, []);

  const startSelection = useCallback(() => {
    setSelecting(true);
    setSelectedIds(new Set());
  }, []);

  // A note deleted by someone else (another tab, an agent) leaves no selection
  // behind: a stale id would make "Delete 3 notes" delete two.
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const live = new Set(notes.map((note) => note.id));
      const next = new Set([...prev].filter((id) => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [notes]);

  useEffect(() => {
    setLocalSearch(searchQuery);
  }, [searchQuery]);

  const handleSearchChange = (e) => {
    const value = e.target.value;
    setLocalSearch(value);
    debouncedSearch(value);
  };

  const handleExport = async () => {
    if (notes.length === 0) return;
    await exportAllNotes(notes, storage);
  };

  const handleImportClick = () => importInputRef.current?.click();

  const handleImportFiles = async (event) => {
    const input = event.target;
    const files = input.files;
    if (!files || files.length === 0) return;
    setIsImporting(true);
    try {
      await onImport?.(files);
    } finally {
      setIsImporting(false);
      // Let the same file be picked again (e.g. after fixing it on disk).
      input.value = '';
    }
  };

  const noteSections = useMemo(() => {
    const sections = classifyNotesForSidebar({ notes, filteredNotes, searchQuery, agentName });
    return sections.map((section) => {
      if (section.key === 'agent') return { ...section, icon: Bot };
      if (section.key === 'pinned') return { ...section, icon: Pin };
      return section;
    });
  }, [notes, filteredNotes, searchQuery, agentName]);

  // What "Select all" acts on: the rows on screen, not the whole notebook.
  const visibleIds = useMemo(() => filteredNotes.map((note) => note.id), [filteredNotes]);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const selectedCount = selectedIds.size;

  const handleSelectAll = () => {
    setSelectedIds(allVisibleSelected ? new Set() : new Set(visibleIds));
  };

  const handleDeleteSelected = async () => {
    if (selectedCount === 0) return;
    await onDeleteNotes?.([...selectedIds]);
    exitSelection();
  };

  return (
    <>
      {showSidebar && (
        <div
          className="fixed inset-0 bg-black/60 z-10 md:hidden animate-in fade-in duration-200"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <nav
        aria-label="Notes"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && selecting) {
            event.stopPropagation();
            exitSelection();
          }
        }}
        className={`fixed left-0 top-0 h-full w-52 xl:w-56 glass-back border-r border-gray-700/50 shadow-soft transform-gpu will-change-transform transition-transform duration-300 ease-in-out z-20 ${
          showSidebar ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="p-4 h-full flex flex-col">
          <div className="flex items-center justify-between mb-5">
            {selecting ? (
              <span className="text-sm font-medium text-gray-200" aria-live="polite">
                {selectedCount} selected
              </span>
            ) : (
              <h2 className="text-balance text-sm font-semibold tracking-[-0.01em] text-gray-200">Notes</h2>
            )}
            <div className="flex items-center gap-1">
              {selecting ? (
                <button
                  type="button"
                  onClick={exitSelection}
                  className={sidebarIconButtonClass}
                  aria-label="Cancel selection"
                >
                  <X className="w-4 h-4" />
                </button>
              ) : (
                <>
                  <button
                    onClick={onCreateNote}
                    className={`${sidebarIconButtonClass} focus-visible:ring-accent-500`}
                    title="New note"
                    aria-label="Create new note"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                  <button
                    onClick={handleImportClick}
                    disabled={isImporting}
                    className={`${sidebarIconButtonClass} focus-visible:ring-accent-500 disabled:opacity-50`}
                    title="Import markdown or zip"
                    aria-label="Import notes"
                  >
                    {isImporting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4" />
                    )}
                  </button>
                  <input
                    ref={importInputRef}
                    type="file"
                    accept=".md,.markdown,.txt,.zip"
                    multiple
                    tabIndex={-1}
                    className="sr-only"
                    aria-label="Import markdown or zip file"
                    onChange={handleImportFiles}
                  />
                  {notes.length > 0 && (
                    <button
                      onClick={handleExport}
                      className={`${sidebarIconButtonClass} focus-visible:ring-accent-500`}
                      title="Export all notes"
                      aria-label="Export all notes"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                  )}
                  {notes.length > 0 && (
                    <button
                      type="button"
                      onClick={startSelection}
                      className={`${sidebarIconButtonClass} focus-visible:ring-accent-500`}
                      title="Select notes"
                      aria-label="Select notes"
                    >
                      <CheckSquare className="w-4 h-4" />
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="mb-4 relative">
            {isSearching ? (
              <Loader2
                className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 animate-spin text-accent-400"
                aria-hidden="true"
              />
            ) : (
              <Search
                className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                aria-hidden="true"
              />
            )}
            <input
              type="text"
              placeholder="Search notes..."
              value={localSearch}
              onChange={handleSearchChange}
              className="w-full min-h-10 rounded-lg border border-gray-600/50 bg-gray-700/50 pl-9 pr-3 text-sm text-gray-300 shadow-soft transition-[transform,background-color,border-color,box-shadow,color] duration-200 placeholder:opacity-50 placeholder-gray-500 focus-visible:border-accent-500/50 focus:bg-gray-700/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/30"
              aria-label="Search notes"
            />
          </div>

          {/* The selection's actions get their own row: three controls plus a
              count do not fit the header's width, and a cluster that overflows
              the sidebar is worse than one more quiet row. */}
          {selecting && (
            <div className="mb-3 flex items-center justify-between">
              <button
                type="button"
                onClick={handleSelectAll}
                className={sidebarTextButtonClass}
                aria-label={allVisibleSelected ? 'Clear selection' : 'Select all notes'}
              >
                {allVisibleSelected ? 'Clear' : 'Select all'}
              </button>
              <button
                type="button"
                onClick={handleDeleteSelected}
                disabled={selectedCount === 0}
                className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-red-400 transition-colors duration-150 hover:bg-red-500/10 hover:text-red-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-400 disabled:opacity-40 disabled:hover:bg-transparent"
                aria-label={`Delete ${selectedCount} selected note${selectedCount === 1 ? '' : 's'}`}
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                Delete
              </button>
            </div>
          )}

          <div className="flex-1 overflow-y-auto space-y-3 min-h-0">
            {isLoading ? (
              <>
                {[...Array(3)].map((_, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-lg bg-gray-700/30 border border-gray-600/20"
                  >
                    <div className="flex flex-col gap-2">
                      <div
                        className="h-4 rounded motion-safe:animate-pulse bg-gray-600/50"
                        style={{ width: SKELETON_WIDTHS[idx] }}
                      ></div>
                      <div
                        className="h-3 rounded motion-safe:animate-pulse bg-gray-600/30"
                        style={{ width: SKELETON_WIDTHS_2[idx] }}
                      ></div>
                    </div>
                  </div>
                ))}
              </>
            ) : notes.length === 0 && !searchQuery ? (
              <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
                <FileText className="mb-4 h-8 w-8 text-gray-600" />
                <p className="mb-1 text-sm text-gray-300">No notes yet</p>
                <p className="mb-5 text-xs text-gray-400">Create your first note</p>
                <button
                  onClick={onCreateNote}
                  className="rounded-md border border-gray-600/50 px-4 py-2 text-sm text-gray-200 transition-colors duration-150 hover:border-gray-500/70 hover:bg-gray-800/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-400"
                >
                  Create note
                </button>
              </div>
            ) : filteredNotes.length === 0 && searchQuery && !isSearching ? (
              <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
                <FileSearch className="mb-4 h-8 w-8 text-gray-600" />
                <p className="mb-1 text-sm text-gray-300">
                  No notes found
                </p>
                <p className="text-xs text-gray-400">Try a different search term</p>
              </div>
            ) : (
              noteSections.map((section) => (
                <div
                  key={section.title}
                  className="mb-4"
                >
                  <div className="mb-2 flex items-center gap-1.5 px-1 text-gray-400">
                    {section.icon && <section.icon className="w-3.5 h-3.5" />}
                    <span className="text-[11px] font-medium uppercase tracking-[0.08em]">
                      {section.title}
                    </span>
                    <span className="text-[11px] text-gray-600">{section.notes.length}</span>
                  </div>
                  <div className="space-y-1">
                    {section.notes.map((note) => {
                      const isPrimary = note.id === currentNoteId;
                      const isSecondary = Boolean(secondaryNoteId && note.id === secondaryNoteId);
                      const isActive =
                        (activePaneId === 'primary' && isPrimary) ||
                        (activePaneId === 'secondary' && isSecondary);
                      const showPaneBadge = splitViewEnabled && (isPrimary || isSecondary);
                      const paneLabel = isPrimary ? 'L' : 'R';
                      return (
                        <NoteItem
                          key={note.id}
                          note={note}
                          isActive={isActive}
                          isSecondary={isSecondary}
                          showPaneBadge={showPaneBadge}
                          paneLabel={paneLabel}
                          searchQuery={searchQuery}
                          agentName={agentName}
                          selecting={selecting}
                          isSelected={selectedIds.has(note.id)}
                          onSelect={handleSelectNote}
                          onPin={handlePinNote}
                          onToggleAccess={handleToggleAccess}
                          onDelete={handleDeleteNote}
                          onToggleSelected={toggleSelected}
                        />
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </nav>
    </>
  );
}
