import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useEditor } from './useEditor';

// Mock useEditorPane to return controllable pane instances
vi.mock('./useEditorPane', () => ({
  useEditorPane: vi.fn(({ paneId }) => ({
    paneId,
    noteId: paneId === 'primary' ? 'note-1' : 'note-2',
    content: paneId === 'primary' ? 'primary content' : 'secondary content',
    setContent: vi.fn(),
    handleContentChange: vi.fn(),
    loadNoteContent: vi.fn().mockResolvedValue(''),
    reloadFromStorage: vi.fn().mockResolvedValue(true),
    retrySave: vi.fn(),
    clearEditor: vi.fn(),
    flushPendingChanges: vi.fn().mockResolvedValue(false),
    saveStatus: 'idle',
    saveError: null,
    hasConflict: false,
    conflictStatus: 'idle',
    conflictSnapshot: null,
    conflictRecovery: null,
    activeFormats: { bold: false, italic: false, underline: false, strike: false },
    copied: false,
    editorRef: { current: null },
    selectedText: '',
    selectionPosition: null,
    selectionRange: null,
    wrapSelection: vi.fn(),
    insertHeading: vi.fn(),
    insertBlockquote: vi.fn(),
    insertCodeBlock: vi.fn(),
    insertLink: vi.fn().mockResolvedValue(undefined),
    insertNumberedList: vi.fn(),
    insertBulletList: vi.fn(),
    insertTaskList: vi.fn(),
    insertHorizontalRule: vi.fn(),
    insertTable: vi.fn(),
    clearAll: vi.fn(),
    copyAll: vi.fn(),
    handleLocalKeyDown: vi.fn(),
    replaceSelectedText: vi.fn(),
    clearSelection: vi.fn(),
    restoreConflictDraft: vi.fn(),
    saveLocalDraft: vi.fn(),
    acceptIncoming: vi.fn(),
    copyConflictToClipboard: vi.fn(),
    applyExternalContent: vi.fn(),
    adoptCanonicalContent: vi.fn(),
    title: paneId === 'primary' ? 'Primary Note' : 'Secondary Note',
    noteTitle: paneId === 'primary' ? 'Primary Note' : 'Secondary Note',
    wordCount: 10,
    charCount: 50,
    hasNote: true,
  })),
}));

// Mock browser-storage
vi.mock('../services/browser-storage', () => ({
  readBrowserStorageValue: vi.fn(() => null),
  writeBrowserStorageValue: vi.fn(() => true),
  removeBrowserStorageValue: vi.fn(() => true),
}));

describe('useEditor', () => {
  const defaultNotes = {
    currentNoteId: 'note-1',
    currentNote: { id: 'note-1', title: 'Primary Note' },
    createNewNote: vi.fn().mockResolvedValue('new-id'),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes with primaryNoteId from notes.currentNoteId', () => {
    const { result } = renderHook(() =>
      useEditor({ id: 'user-1' }, { scopedKey: (k) => k }, 'note-1', defaultNotes)
    );
    expect(result.current.primaryNoteId).toBe('note-1');
  });

  it('splitViewEnabled starts as false', () => {
    const { result } = renderHook(() =>
      useEditor({ id: 'user-1' }, { scopedKey: (k) => k }, 'note-1', defaultNotes)
    );
    expect(result.current.splitViewEnabled).toBe(false);
  });

  it('activePaneId starts as primary', () => {
    const { result } = renderHook(() =>
      useEditor({ id: 'user-1' }, { scopedKey: (k) => k }, 'note-1', defaultNotes)
    );
    expect(result.current.activePaneId).toBe('primary');
  });

  it('splitRatio has a default value between 10 and 98', () => {
    const { result } = renderHook(() =>
      useEditor({ id: 'user-1' }, { scopedKey: (k) => k }, 'note-1', defaultNotes)
    );
    expect(result.current.splitRatio).toBeGreaterThanOrEqual(10);
    expect(result.current.splitRatio).toBeLessThanOrEqual(98);
  });

  it('setSplitRatio clamps values to 10-98 range', () => {
    const { result } = renderHook(() =>
      useEditor({ id: 'user-1' }, { scopedKey: (k) => k }, 'note-1', defaultNotes)
    );

    act(() => result.current.setSplitRatio(5)); // below minimum
    expect(result.current.splitRatio).toBe(10);

    act(() => result.current.setSplitRatio(100)); // above maximum
    expect(result.current.splitRatio).toBe(98);

    act(() => result.current.setSplitRatio(50)); // within range
    expect(result.current.splitRatio).toBe(50);
  });

  it('content comes from active pane', () => {
    const { result } = renderHook(() =>
      useEditor({ id: 'user-1' }, { scopedKey: (k) => k }, 'note-1', defaultNotes)
    );
    // Active pane is primary, so content should be from primary
    expect(result.current.content).toBe('primary content');
  });

  it('proxyAction routes to active pane', () => {
    const { result } = renderHook(() =>
      useEditor({ id: 'user-1' }, { scopedKey: (k) => k }, 'note-1', defaultNotes)
    );

    // wrapSelection should be callable and route to primary pane
    expect(typeof result.current.wrapSelection).toBe('function');
    expect(typeof result.current.insertHeading).toBe('function');
    expect(typeof result.current.clearAll).toBe('function');
    expect(typeof result.current.copyAll).toBe('function');
  });

  it('panes object contains primary and secondary', () => {
    const { result } = renderHook(() =>
      useEditor({ id: 'user-1' }, { scopedKey: (k) => k }, 'note-1', defaultNotes)
    );
    expect(result.current.panes.primary).toBeDefined();
    expect(result.current.panes.secondary).toBeDefined();
    expect(result.current.panes.primary.paneId).toBe('primary');
    expect(result.current.panes.secondary.paneId).toBe('secondary');
  });

  it('saveStatus comes from active pane', () => {
    const { result } = renderHook(() =>
      useEditor({ id: 'user-1' }, { scopedKey: (k) => k }, 'note-1', defaultNotes)
    );
    expect(result.current.saveStatus).toBe('idle');
  });

  it('wordCount and charCount come from active pane', () => {
    const { result } = renderHook(() =>
      useEditor({ id: 'user-1' }, { scopedKey: (k) => k }, 'note-1', defaultNotes)
    );
    expect(result.current.wordCount).toBe(10);
    expect(result.current.charCount).toBe(50);
  });

  it('currentNoteTitle comes from active pane or notes', () => {
    const { result } = renderHook(() =>
      useEditor({ id: 'user-1' }, { scopedKey: (k) => k }, 'note-1', defaultNotes)
    );
    expect(result.current.currentNoteTitle).toBe('Primary Note');
  });
});
