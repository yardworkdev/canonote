import React, { createContext, useContext, useMemo } from 'react';
import { useStorage } from '../hooks/useStorage';
import { useAuth } from '../hooks/useAuth';
import { useNotes } from '../hooks/useNotes';
import { useEditor } from '../hooks/useEditor';
import { PLACEHOLDER_NOTE_ID } from '../constants/notes';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  // Initialize storage first (can work without user initially)
  const storage = useStorage(null);

  // Initialize auth with storage
  const auth = useAuth(storage);

  // Update storage with user when auth changes
  const storageWithUser = useStorage(auth?.user || null);

  // Initialize notes only when we have a user
  const notes = useNotes(auth?.user || null, storageWithUser);

  // Initialize editor - a plain markdown textarea surface
  const editor = useEditor(
    auth?.user || null,
    storageWithUser,
    notes?.currentNoteId || PLACEHOLDER_NOTE_ID,
    notes
  );

  const value = useMemo(() => ({
    auth,
    storage: storageWithUser || storage,
    notes,
    editor: {
      ...editor,
      editorRef: editor?.editorRef,
    },
  }), [auth, storageWithUser, storage, notes, editor]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within AppProvider');
  }
  return context;
}
