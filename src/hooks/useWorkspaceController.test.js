import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWorkspaceController } from './useWorkspaceController';
import { dialog } from '../utils/dialog';

const createMockEditor = (overrides = {}) => ({
  splitViewEnabled: false,
  activePaneId: 'primary',
  primaryNoteId: 'note-1',
  secondaryNoteId: null,
  setActivePaneId: vi.fn(),
  setSecondaryNoteId: vi.fn(),
  openSplitView: vi.fn().mockResolvedValue('note-2'),
  closeSplitView: vi.fn(),
  ...overrides,
});

const createMockNotes = (overrides = {}) => ({
  notes: [
    { id: 'note-1', title: 'Note 1', updated: 1000 },
    { id: 'note-2', title: 'Note 2', updated: 2000 },
  ],
  switchNote: vi.fn().mockResolvedValue('note-1'),
  createNewNote: vi.fn().mockResolvedValue('note-new'),
  deleteNote: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

const createMockPane = (overrides = {}) => ({
  hasNote: true,
  flushPendingChanges: vi.fn().mockResolvedValue(false),
  loadNoteContent: vi.fn().mockResolvedValue('content'),
  ...overrides,
});

describe('useWorkspaceController', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Mock dialog.confirm to auto-confirm
    vi.spyOn(dialog, 'confirm').mockResolvedValue(true);
  });

  it('focusPane calls setActivePaneId for primary', () => {
    const editor = createMockEditor();
    const { result } = renderHook(() =>
      useWorkspaceController({
        editor,
        notes: createMockNotes(),
        primaryPane: createMockPane(),
        secondaryPane: createMockPane(),
        showNotice: vi.fn(),
      })
    );

    act(() => result.current.focusPane('primary'));
    expect(editor.setActivePaneId).toHaveBeenCalledWith('primary');
  });

  it('focusPane does nothing for secondary when split view is disabled', () => {
    const editor = createMockEditor({ splitViewEnabled: false });
    const { result } = renderHook(() =>
      useWorkspaceController({
        editor,
        notes: createMockNotes(),
        primaryPane: createMockPane(),
        secondaryPane: createMockPane(),
        showNotice: vi.fn(),
      })
    );

    act(() => result.current.focusPane('secondary'));
    expect(editor.setActivePaneId).not.toHaveBeenCalled();
  });

  it('handleSwitchNote returns early for null noteId', async () => {
    const editor = createMockEditor();
    const notes = createMockNotes();
    const { result } = renderHook(() =>
      useWorkspaceController({
        editor,
        notes,
        primaryPane: createMockPane(),
        secondaryPane: createMockPane(),
        showNotice: vi.fn(),
      })
    );

    await act(async () => result.current.handleSwitchNote(null));
    expect(notes.switchNote).not.toHaveBeenCalled();
  });

  it('handleSwitchNote switches to primary pane', async () => {
    const editor = createMockEditor({ primaryNoteId: 'note-1' });
    const notes = createMockNotes();
    const primaryPane = createMockPane();
    const { result } = renderHook(() =>
      useWorkspaceController({
        editor,
        notes,
        primaryPane,
        secondaryPane: createMockPane(),
        showNotice: vi.fn(),
      })
    );

    await act(async () => result.current.handleSwitchNote('note-2', 'primary'));
    expect(notes.switchNote).toHaveBeenCalledWith('note-2');
    expect(primaryPane.loadNoteContent).toHaveBeenCalledWith('note-2', { shouldFocus: true });
    expect(editor.setActivePaneId).toHaveBeenCalledWith('primary');
  });

  it('handleSwitchNote focuses existing pane when note already open', async () => {
    const editor = createMockEditor({
      primaryNoteId: 'note-1',
      secondaryNoteId: 'note-2',
      splitViewEnabled: true,
    });
    const notes = createMockNotes();
    const { result } = renderHook(() =>
      useWorkspaceController({
        editor,
        notes,
        primaryPane: createMockPane(),
        secondaryPane: createMockPane(),
        showNotice: vi.fn(),
      })
    );

    // Try to switch to note-1 which is already in primary
    await act(async () => result.current.handleSwitchNote('note-1', 'primary'));
    expect(editor.setActivePaneId).toHaveBeenCalledWith('primary');
    expect(notes.switchNote).not.toHaveBeenCalled();
  });

  it('says so when the note is already open in the other pane', async () => {
    // The notice names a catalog key, so the words are the catalog's and the
    // tone standard is applied to them in `notices.test.js`.
    const editor = createMockEditor({
      primaryNoteId: 'note-1',
      secondaryNoteId: 'note-2',
      splitViewEnabled: true,
    });
    const showNotice = vi.fn();
    const { result } = renderHook(() =>
      useWorkspaceController({
        editor,
        notes: createMockNotes(),
        primaryPane: createMockPane(),
        secondaryPane: createMockPane(),
        showNotice,
      })
    );

    await act(async () => result.current.handleSwitchNote('note-2', 'primary'));

    expect(showNotice).toHaveBeenCalledWith('noteAlreadyOpen');
  });

  it('names the failure when a delete is refused', async () => {
    const editor = createMockEditor({ primaryNoteId: 'note-1' });
    const notes = createMockNotes({
      deleteNote: vi.fn().mockRejectedValue(new Error('boom')),
    });
    const showNotice = vi.fn();
    const { result } = renderHook(() =>
      useWorkspaceController({
        editor,
        notes,
        primaryPane: createMockPane(),
        secondaryPane: createMockPane(),
        showNotice,
      })
    );

    await act(async () => result.current.handleDeleteNote('note-1'));

    expect(showNotice).toHaveBeenCalledWith('deleteFailed');
  });

  it('handleSwitchNote loads the note when the pane holds its id but no note', async () => {
    // The pane can point at a note it never loaded (the placeholder it opened
    // on), so a row click must load the content rather than only focusing.
    const editor = createMockEditor({ primaryNoteId: 'note-1' });
    const notes = createMockNotes();
    const primaryPane = createMockPane({ hasNote: false });
    const { result } = renderHook(() =>
      useWorkspaceController({
        editor,
        notes,
        primaryPane,
        secondaryPane: createMockPane(),
        showNotice: vi.fn(),
      })
    );

    await act(async () => result.current.handleSwitchNote('note-1', 'primary'));
    expect(primaryPane.loadNoteContent).toHaveBeenCalledWith('note-1', { shouldFocus: true });
    expect(editor.setActivePaneId).toHaveBeenCalledWith('primary');
  });

  it('handleCreateNote creates in primary pane', async () => {
    const editor = createMockEditor();
    const notes = createMockNotes();
    const primaryPane = createMockPane();
    const { result } = renderHook(() =>
      useWorkspaceController({
        editor,
        notes,
        primaryPane,
        secondaryPane: createMockPane(),
        showNotice: vi.fn(),
      })
    );

    let newId;
    await act(async () => { newId = await result.current.handleCreateNote('primary'); });
    expect(notes.createNewNote).toHaveBeenCalled();
    expect(primaryPane.loadNoteContent).toHaveBeenCalledWith('note-new', { shouldFocus: true });
    expect(newId).toBe('note-new');
  });

  it('handleDeleteNote calls dialog.confirm then deleteNote', async () => {
    const editor = createMockEditor({ primaryNoteId: 'note-1' });
    const notes = createMockNotes();
    const { result } = renderHook(() =>
      useWorkspaceController({
        editor,
        notes,
        primaryPane: createMockPane(),
        secondaryPane: createMockPane(),
        showNotice: vi.fn(),
      })
    );

    await act(async () => result.current.handleDeleteNote('note-1'));
    expect(dialog.confirm).toHaveBeenCalled();
    expect(notes.deleteNote).toHaveBeenCalledWith('note-1');
  });

  it('handleDeleteNote does not delete when dialog is cancelled', async () => {
    vi.spyOn(dialog, 'confirm').mockResolvedValue(false);
    const editor = createMockEditor();
    const notes = createMockNotes();
    const { result } = renderHook(() =>
      useWorkspaceController({
        editor,
        notes,
        primaryPane: createMockPane(),
        secondaryPane: createMockPane(),
        showNotice: vi.fn(),
      })
    );

    await act(async () => result.current.handleDeleteNote('note-1'));
    expect(notes.deleteNote).not.toHaveBeenCalled();
  });

  it('handleDeleteNotes confirms the count, then deletes the whole selection once', async () => {
    const editor = createMockEditor({ primaryNoteId: 'note-9' });
    const notes = createMockNotes({ deleteNotes: vi.fn().mockResolvedValue(undefined) });
    const { result } = renderHook(() =>
      useWorkspaceController({
        editor,
        notes,
        primaryPane: createMockPane(),
        secondaryPane: createMockPane(),
        showNotice: vi.fn(),
      })
    );

    await act(async () => result.current.handleDeleteNotes(['note-1', 'note-2', 'note-1']));

    expect(dialog.confirm).toHaveBeenCalledWith('Delete 2 notes?', expect.any(Object));
    expect(notes.deleteNotes).toHaveBeenCalledTimes(1);
    expect(notes.deleteNotes).toHaveBeenCalledWith(['note-1', 'note-2']);
  });

  it('handleDeleteNotes does nothing when the dialog is cancelled', async () => {
    vi.spyOn(dialog, 'confirm').mockResolvedValue(false);
    const notes = createMockNotes({ deleteNotes: vi.fn().mockResolvedValue(undefined) });
    const { result } = renderHook(() =>
      useWorkspaceController({
        editor: createMockEditor(),
        notes,
        primaryPane: createMockPane(),
        secondaryPane: createMockPane(),
        showNotice: vi.fn(),
      })
    );

    await act(async () => result.current.handleDeleteNotes(['note-1', 'note-2']));

    expect(notes.deleteNotes).not.toHaveBeenCalled();
  });

  it('handleDeleteNotes moves the editor off a note it just deleted', async () => {
    const editor = createMockEditor({ primaryNoteId: 'note-1' });
    const notes = createMockNotes({ deleteNotes: vi.fn().mockResolvedValue(undefined) });
    const { result } = renderHook(() =>
      useWorkspaceController({
        editor,
        notes,
        primaryPane: createMockPane(),
        secondaryPane: createMockPane(),
        showNotice: vi.fn(),
      })
    );

    await act(async () => result.current.handleDeleteNotes(['note-1']));

    // note-2 is the only row left, so the editor opens it rather than sitting on
    // a note that no longer exists.
    expect(notes.switchNote).toHaveBeenCalledWith('note-2');
  });

  it('handleToggleSplitView opens split view when closed', async () => {
    const editor = createMockEditor({ splitViewEnabled: false });
    const secondaryPane = createMockPane();
    const { result } = renderHook(() =>
      useWorkspaceController({
        editor,
        notes: createMockNotes(),
        primaryPane: createMockPane(),
        secondaryPane,
        showNotice: vi.fn(),
      })
    );

    await act(async () => result.current.handleToggleSplitView());
    expect(editor.openSplitView).toHaveBeenCalled();
    expect(secondaryPane.loadNoteContent).toHaveBeenCalled();
  });

  it('handleToggleSplitView closes split view when open', async () => {
    const editor = createMockEditor({ splitViewEnabled: true });
    const { result } = renderHook(() =>
      useWorkspaceController({
        editor,
        notes: createMockNotes(),
        primaryPane: createMockPane(),
        secondaryPane: createMockPane(),
        showNotice: vi.fn(),
      })
    );

    await act(async () => result.current.handleToggleSplitView());
    expect(editor.closeSplitView).toHaveBeenCalled();
  });

  it('handleClosePane delegates to secondary or primary handler', async () => {
    const editor = createMockEditor({ splitViewEnabled: true });
    const { result } = renderHook(() =>
      useWorkspaceController({
        editor,
        notes: createMockNotes(),
        primaryPane: createMockPane(),
        secondaryPane: createMockPane(),
        showNotice: vi.fn(),
      })
    );

    await act(async () => result.current.handleClosePane('secondary'));
    expect(editor.closeSplitView).toHaveBeenCalled();
  });
});
