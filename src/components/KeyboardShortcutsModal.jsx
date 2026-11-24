import React, { useRef } from 'react';
import { X, Command, Keyboard, Type, List, Search, Sparkles } from 'lucide-react';
import { useFocusTrap } from '../hooks/useFocusTrap';

const shortcutCategories = [
  {
    id: 'editor',
    label: 'Text Formatting',
    icon: Type,
    shortcuts: [
      { key: 'Ctrl/Cmd + B', description: 'Bold' },
      { key: 'Ctrl/Cmd + I', description: 'Italic' },
      { key: 'Ctrl/Cmd + U', description: 'Underline' },
      { key: '**text**', description: 'Bold (markdown)' },
      { key: '*text*', description: 'Italic (markdown)' },
      { key: '_text_', description: 'Underline (markdown)' },
      { key: '~~text~~', description: 'Strikethrough' },
      { key: '`code`', description: 'Inline code' },
      { key: '> quote', description: 'Blockquote' },
    ],
  },
  {
    id: 'structure',
    label: 'Structure & Lists',
    icon: List,
    shortcuts: [
      { key: '# ', description: 'Heading 1' },
      { key: '## ', description: 'Heading 2' },
      { key: '### ', description: 'Heading 3' },
      { key: '- ', description: 'Bullet list' },
      { key: '1. ', description: 'Numbered list' },
      { key: '- [ ]', description: 'Task list' },
      { key: '---', description: 'Horizontal rule' },
      { key: '```', description: 'Code block' },
      { key: 'Tab', description: 'Indent' },
      { key: 'Shift + Tab', description: 'Outdent' },
    ],
  },
  {
    id: 'commands',
    label: 'Slash Commands',
    icon: Command,
    shortcuts: [
      { key: '/todo', description: 'Insert todo list' },
      { key: '/now', description: 'Insert timestamp' },
      { key: '/today', description: 'Insert date' },
    ],
  },
  {
    id: 'navigation',
    label: 'Navigation & Search',
    icon: Search,
    shortcuts: [
      { key: 'Ctrl/Cmd + K', description: 'Command palette' },
      { key: 'Ctrl/Cmd + F', description: 'Find & Replace' },
      { key: 'Ctrl/Cmd + \\', description: 'Toggle notes sidebar' },
      { key: 'Ctrl/Cmd + ?', description: 'Keyboard shortcuts' },
      { key: 'Esc', description: 'Close modal/menu' },
    ],
  },
  {
    id: 'ai',
    label: 'AI Features',
    icon: Sparkles,
    shortcuts: [
      { key: 'Select text', description: 'Inline AI toolbar appears' },
      { key: 'Toolbar AI button', description: 'Open AI assistant panel' },
    ],
  },
];

export default function KeyboardShortcutsModal({ isOpen, onClose }) {
  const containerRef = useRef(null);
  const closeButtonRef = useRef(null);

  // This dialog tells the reader that Esc closes a modal and then did not
  // answer Esc itself, moved no focus into it and let Tab walk out behind it
  // (2026-10-15). One hook, three fixes.
  useFocusTrap(containerRef, isOpen, { onClose, initialFocusRef: closeButtonRef });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div
        ref={containerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="bg-gray-800 rounded-lg shadow-lg max-w-2xl w-full max-h-[80vh] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-gray-700">
              <Keyboard className="w-5 h-5 text-gray-300" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-100">Keyboard Shortcuts</h2>
              <p className="text-sm text-gray-400">The shortcuts the notebook answers to</p>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Close keyboard shortcuts"
            className="p-2 rounded-lg transition-colors hover:bg-gray-700 text-gray-400 hover:text-gray-200"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content — scrollable, so it takes focus for keyboard scrolling. */}
        <div className="flex-1 overflow-y-auto p-6" tabIndex={0}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {shortcutCategories.map((category) => {
              const Icon = category.icon;
              return (
                <div key={category.id} className="rounded-lg border border-gray-700 bg-gray-750">
                  {/* Category Header */}
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-700">
                    <Icon className="w-4 h-4 text-gray-400" />
                    <h3 className="font-medium text-sm text-gray-200">{category.label}</h3>
                  </div>

                  {/* Shortcuts List */}
                  <div className="p-2">
                    {category.shortcuts.map((shortcut, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between px-2 py-2 rounded-lg hover:bg-gray-700/50 transition-colors"
                      >
                        <span className="text-sm text-gray-300">{shortcut.description}</span>
                        <kbd className="px-2 py-1 rounded text-xs font-mono bg-gray-700 text-gray-300 border border-gray-600">
                          {shortcut.key}
                        </kbd>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Tip — a fact about the keys, not a "pro tip". */}
          <div className="mt-6 p-4 rounded-lg bg-white/[0.04] border border-gray-700">
            <p className="text-sm text-gray-300">
              Press{' '}
              <kbd className="px-1.5 py-0.5 rounded text-xs font-mono mx-1 bg-gray-700/60">Tab</kbd>{' '}
              to indent a list, and{' '}
              <kbd className="px-1.5 py-0.5 rounded text-xs font-mono mx-1 bg-gray-700/60">
                Shift+Tab
              </kbd>{' '}
              to outdent it.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-700 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg font-medium transition-colors bg-gray-700 text-gray-200 hover:bg-gray-600"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
