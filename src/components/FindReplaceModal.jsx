import React, { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useFocusTrap } from '../hooks/useFocusTrap';

export default function FindReplaceModal({ content, editorRef, onFind, onReplace, onClose }) {
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const containerRef = useRef(null);
  const findInputRef = useRef(null);

  // Escape (even when focus is not inside the panel — after a click on Find the
  // focus can land outside it), Tab that stays in the panel, focus into the
  // find field on open and back to the editor when it closes. The panel's own
  // key handlers for Escape were three copies of the same rule; the hook is the
  // one place it now lives.
  useFocusTrap(containerRef, true, { onClose, initialFocusRef: findInputRef });

  const handleFind = () => {
    if (onFind) {
      onFind(findText);
    }
  };

  const handleReplace = () => {
    if (!findText) return;
    if (onReplace) {
      onReplace(findText, replaceText);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-start justify-center pt-20 z-30 transition-opacity duration-200 animate-in fade-in"
      onClick={onClose}
      ref={containerRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby="find-replace-title"
    >
      <div
        className="bg-gray-800/95 border-gray-700/50 rounded-lg shadow-lg border p-5 w-96 transform transition-transform duration-200 scale-100 animate-in zoom-in-95"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 id="find-replace-title" className="text-sm font-semibold text-gray-200">
            Find & Replace
          </h3>
          <button
            onClick={onClose}
            className="p-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 transition-colors duration-200 focus-visible:ring-accent-500 hover:bg-gray-700/50 hover:text-gray-300"
            aria-label="Close Find & Replace"
          >
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>
        <div className="space-y-4">
          <input
            ref={findInputRef}
            type="text"
            placeholder="Find..."
            value={findText}
            onChange={(e) => setFindText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleFind();
              }
            }}
            className="w-full px-4 py-2.5 rounded-lg text-sm transition-colors duration-200 shadow-soft placeholder:opacity-50 bg-gray-700/50 text-gray-300 border-gray-600/50 placeholder-gray-500 focus-visible:border-accent-500/50 focus-visible:ring-accent-500/30 focus:bg-gray-700/70 border focus-visible:outline-none focus-visible:ring-2"
            aria-label="Find text"
          />
          <input
            type="text"
            placeholder="Replace with..."
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleReplace();
              }
            }}
            className="w-full px-4 py-2.5 rounded-lg text-sm transition-colors duration-200 shadow-soft placeholder:opacity-50 bg-gray-700/50 text-gray-300 border-gray-600/50 placeholder-gray-500 focus-visible:border-accent-500/50 focus-visible:ring-accent-500/30 focus:bg-gray-700/70 border focus-visible:outline-none focus-visible:ring-2"
            aria-label="Replace with"
          />
          <div className="flex gap-2.5">
            <button
              onClick={handleFind}
              className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium focus-visible:outline-none focus-visible:ring-2 min-h-[44px] transition-colors duration-200 shadow-soft bg-gray-700/50 hover:bg-gray-600/50 text-gray-300 focus-visible:ring-accent-500 border border-gray-600/30"
            >
              Find
            </button>
            <button
              onClick={handleReplace}
              className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium focus-visible:outline-none focus-visible:ring-2 min-h-[44px] transition-colors duration-200 shadow-soft-lg bg-accent-600/20 hover:bg-accent-600/30 text-gray-100 border border-accent-500/20 focus-visible:ring-accent-500"
            >
              Replace All
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
