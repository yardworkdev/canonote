import JSZip from 'jszip';

/**
 * Export all notes as a ZIP file containing individual .md files
 */
export const exportAllNotes = async (notes, storage) => {
  const zip = new JSZip();
  const notesFolder = zip.folder('notes');

  for (const note of notes) {
    let content = '';
    try {
      const contentResult = await storage.get(storage.noteStorageKey(note.id));
      content = contentResult?.value || '';
    } catch (e) {
      console.error('Failed to read note content:', e);
    }

    const timestamp = note.updated ? new Date(note.updated).toISOString() : new Date().toISOString();

    const frontmatter = `---
title: ${note.title || 'Untitled'}
date: ${timestamp}
${note.tags?.length ? `tags: [${note.tags.join(', ')}]` : ''}
---

`;

    const filename = `${(note.title || 'untitled').replace(/[^a-z0-9]/gi, '_').substring(0, 50)}.md`;
    notesFolder.file(filename, frontmatter + content);
  }

  let url;
  try {
    const blob = await zip.generateAsync({ type: 'blob' });
    url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `notes-export-${new Date().toISOString().split('T')[0]}.zip`;
    a.click();
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
};



