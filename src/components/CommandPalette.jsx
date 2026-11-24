import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { Search, FileText, List, Command, HardDrive, Bot } from 'lucide-react';

function CommandPalette({
  notes = [],
  onClose,
  onCreateNote,
  onOpenFindReplace,
  onSwitchNote,
  onToggleHelperView,
  onOpenStorageHealth,
  onOpenAgentActivity,
  headings = [],
  onJumpToHeading,
}) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const containerRef = useRef(null);

  // Memoized action handlers
  const handleHelperToggle = useCallback(() => {
    onToggleHelperView();
    onClose();
  }, [onToggleHelperView, onClose]);

  const handleFindReplaceOpen = useCallback(() => {
    onOpenFindReplace?.();
    onClose();
  }, [onClose, onOpenFindReplace]);

  const handleStorageHealthOpen = useCallback(() => {
    onOpenStorageHealth?.();
    onClose();
  }, [onClose, onOpenStorageHealth]);

  const handleAgentActivityOpen = useCallback(() => {
    onOpenAgentActivity?.();
    onClose();
  }, [onClose, onOpenAgentActivity]);

  // Command definitions - memoized to prevent recreation
  const commands = useMemo(
    () => [
      {
        id: 'new-note',
        label: 'Create New Note',
        keywords: ['new', 'create', 'note'],
        icon: FileText,
        action: onCreateNote,
        category: 'Actions',
      },
      {
        id: 'open-find-replace',
        label: 'Open Find & Replace',
        keywords: ['find', 'replace', 'search', 'text'],
        icon: Search,
        action: handleFindReplaceOpen,
        category: 'Actions',
        shortcut: 'Ctrl/Cmd+F',
      },
      {
        id: 'toggle-helper',
        label: 'Toggle Helper View',
        keywords: ['helper', 'sidebar', 'toc', 'table'],
        icon: List,
        action: handleHelperToggle,
        category: 'View',
      },
      {
        id: 'storage-health',
        label: 'Storage health',
        keywords: ['storage', 'space', 'backup', 'health', 'quota', 'export', 'data'],
        icon: HardDrive,
        action: handleStorageHealthOpen,
        category: 'Data',
      },
      {
        id: 'agent-activity',
        label: 'Agent activity',
        keywords: ['agent', 'activity', 'audit', 'trail', 'history', 'who', 'changed'],
        icon: Bot,
        action: handleAgentActivityOpen,
        category: 'Data',
      },
    ],
    [
      onCreateNote,
      handleFindReplaceOpen,
      handleHelperToggle,
      handleStorageHealthOpen,
      handleAgentActivityOpen,
    ]
  );

  // Headings used to be a panel tab of their own. They belong here instead: the
  // palette is where you go when you know what you are looking for, and jumping
  // to a heading is exactly that.
  const filteredHeadings = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = needle
      ? headings.filter((heading) => heading.text.toLowerCase().includes(needle))
      : headings;
    return matches.slice(0, 6);
  }, [headings, query]);

  const jumpToHeading = useCallback(
    (lineNumber) => () => {
      onJumpToHeading?.(lineNumber);
      onClose();
    },
    [onJumpToHeading, onClose]
  );

  // Filter notes and commands - memoized
  const filteredNotes = useMemo(
    () => notes.filter((note) => note.title.toLowerCase().includes(query.toLowerCase())),
    [notes, query]
  );

  const filteredCommands = useMemo(
    () =>
      commands.filter((cmd) => {
        if (!query) return true;
        const queryLower = query.toLowerCase();
        return (
          cmd.label.toLowerCase().includes(queryLower) ||
          cmd.keywords.some((kw) => kw.includes(queryLower))
        );
      }),
    [commands, query]
  );

  // Create note action handler
  const createNoteAction = useCallback(
    (noteId) => () => {
      onSwitchNote(noteId);
      onClose();
    },
    [onSwitchNote, onClose]
  );

  const allResults = useMemo(
    () => [
      ...filteredCommands,
      ...filteredHeadings.map((heading) => ({
        id: `heading-${heading.lineNumber}-${heading.text}`,
        label: heading.text,
        icon: List,
        action: jumpToHeading(heading.lineNumber),
        category: 'Heading in this note',
      })),
      ...filteredNotes.map((note) => ({
        id: `note-${note.id}`,
        label: note.title,
        icon: FileText,
        action: createNoteAction(note.id),
        category: 'Notes',
      })),
    ],
    [filteredCommands, filteredHeadings, filteredNotes, createNoteAction, jumpToHeading]
  );

  useFocusTrap(containerRef, true, { onClose, initialFocusRef: inputRef });

  // Reset selected index when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const selectedElement = listRef.current.children[selectedIndex];
      if (selectedElement) {
        selectedElement.scrollIntoView?.({
          block: 'nearest',
          behavior: 'smooth',
        });
      }
    }
  }, [selectedIndex]);

  const allResultsRef = useRef(allResults);
  useEffect(() => { allResultsRef.current = allResults; }, [allResults]);

  const selectedIndexRef = useRef(selectedIndex);
  useEffect(() => { selectedIndexRef.current = selectedIndex; }, [selectedIndex]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev < allResultsRef.current.length - 1 ? prev + 1 : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : allResultsRef.current.length - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = allResultsRef.current[selectedIndexRef.current];
        if (item) {
          item.action();
        }
      }
      // Escape is the focus trap's job now (useFocusTrap) — one rule, one place.
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center pt-20 animate-in fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
    >
      <div
        ref={containerRef}
        className={`w-full max-w-2xl glass-front rounded-lg shadow-lg border overflow-hidden animate-in zoom-in-95`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-200/50 dark:border-gray-700/50">
          <Search className={`w-5 h-5 text-gray-400`} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command, heading or note..."
            className={`flex-1 bg-transparent border-none outline-none text-base text-gray-200 placeholder-gray-500`}
          />
          <kbd
            className={`hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-gray-700/50 text-gray-400 border-gray-600/50 border`}
          >
            <Command className="w-3 h-3" />
            <span>K</span>
          </kbd>
        </div>

        {/* Results */}
        <div
          ref={listRef}
          className="max-h-96 overflow-y-auto p-2"
          role="listbox"
          aria-label="Commands and notes"
        >
          {allResults.length === 0 ? (
            <div className={`px-4 py-8 text-center text-gray-400`}>No results found</div>
          ) : (
            allResults.map((item, index) => {
              const Icon = item.icon;
              const isSelected = index === selectedIndex;

              return (
                <button
                  key={item.id}
                  onClick={item.action}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors duration-200 ${
                    isSelected
                      ? 'bg-accent-600/20 text-gray-100'
                      : 'hover:bg-gray-700/50 text-gray-200'
                  }`}
                  role="option"
                  aria-selected={isSelected}
                >
                  <Icon
                    className={`w-5 h-5 flex-shrink-0 ${isSelected ? '' : 'text-gray-400'}`}
                    strokeWidth={1.5}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{item.label}</div>
                    {item.category && (
                      <div className={`text-xs mt-0.5 ${isSelected ? 'text-gray-300' : 'text-gray-400'}`}>
                        {item.category}
                      </div>
                    )}
                  </div>
                  {item.shortcut && (
                    <kbd
                      className={`hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-gray-700/50 text-gray-400`}
                    >
                      {item.shortcut}
                    </kbd>
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div
          className={`px-5 py-3 border-t border-gray-200/50 dark:border-gray-700/50 flex items-center justify-between text-xs text-gray-400`}
        >
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700/50">↑↓</kbd>
              <span>Navigate</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700/50">Enter</kbd>
              <span>Select</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700/50">Esc</kbd>
              <span>Close</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default React.memo(CommandPalette);
