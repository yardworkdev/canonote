import React, { useMemo } from 'react';
import { Tag, Link2, FileText, Hash } from 'lucide-react';
import { formatRelativeTime } from '../utils/time';
import { PanelHeader, PanelEmpty } from './HelperPanel';

export default function TagsReferences({ content, notes, currentNoteId, onNoteClick, onTagClick }) {
  // Extract tags (format: #tag or tags: tag1, tag2)
  const tags = useMemo(() => {
    if (!content) return [];
    const tagPatterns = [
      /#(\w+)/g, // Hashtags
      /tags?:\s*([^\n]+)/gi, // tags: tag1, tag2
    ];

    const foundTags = new Set();
    tagPatterns.forEach((pattern) => {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        if (pattern === tagPatterns[0]) {
          foundTags.add(match[1].toLowerCase());
        } else {
          match[1].split(',').forEach((tag) => {
            foundTags.add(tag.trim().toLowerCase());
          });
        }
      }
    });

    return Array.from(foundTags);
  }, [content]);

  // Extract wikilinks (format: [[note-name]])
  const references = useMemo(() => {
    if (!content) return [];
    const wikilinkPattern = /\[\[([^\]]+)\]\]/g;
    const found = [];
    let match;
    while ((match = wikilinkPattern.exec(content)) !== null) {
      found.push(match[1]);
    }
    return [...new Set(found)];
  }, [content]);

  // Find notes that match referenced names
  const linkedNotes = useMemo(() => {
    if (!notes || !references.length) return [];
    return references
      .map((ref) => {
        const matching = notes.find(
          (n) =>
            n.title.toLowerCase() === ref.toLowerCase() ||
            n.id === ref ||
            n.id.replace(/^note-/, '') === ref
        );
        return matching ? { ...matching, linkText: ref } : null;
      })
      .filter(Boolean);
  }, [notes, references]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PanelHeader label="Tags & References" />

      <div className="flex-1 overflow-y-auto p-5 space-y-6">
        {/* Tags Section */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Hash className="w-4 h-4 text-gray-400" />
            <h2 className="text-sm font-semibold text-gray-200">Tags ({tags.length})</h2>
          </div>
          {tags.length === 0 ? (
            <PanelEmpty message="No tags found — write #tag or tags: tag1, tag2 in the note." />
          ) : (
            <div className="flex flex-wrap gap-2">
              {tags.map((tag, idx) => (
                <button
                  key={idx}
                  onClick={() => onTagClick?.(tag)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 bg-emerald-900/20 text-emerald-300 border border-emerald-800 hover:bg-emerald-900/30 focus-visible:ring-emerald-600"
                  title={`Search notes tagged ${tag}`}
                >
                  <Tag className="w-3 h-3" />
                  {tag}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* References Section */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Link2 className="w-4 h-4 text-gray-400" />
            <h2 className="text-sm font-semibold text-gray-200">
              References ({references.length})
            </h2>
          </div>
          {references.length === 0 ? (
            <PanelEmpty message="No references found — link another note with [[Note Title]], and the title has to match an existing note." />
          ) : (
            <div className="space-y-2">
              {references.map((ref, idx) => {
                const linkedNote = linkedNotes.find((n) => n.linkText === ref);
                return (
                  <div key={idx} className="flex items-center gap-2 p-2 rounded bg-gray-800">
                    <FileText className="w-4 h-4 text-gray-400" />
                    <span className="text-sm flex-1 text-gray-300">[[{ref}]]</span>
                    {linkedNote ? (
                      <button
                        onClick={() => onNoteClick?.(linkedNote.id)}
                        className="text-xs px-2 py-1 rounded transition-colors bg-emerald-600 text-white hover:bg-emerald-700"
                      >
                        Open
                      </button>
                    ) : (
                      <span className="text-xs text-gray-400">Not found</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
