import React, { useState, useEffect, useRef } from 'react';
import { dialog } from '../utils/dialog';
import { useFocusTrap } from '../hooks/useFocusTrap';

/**
 * Renders the active confirm/prompt dialog triggered via dialog.confirm() or dialog.prompt().
 * Mount once near the root of the app (inside the theme provider so dark mode works).
 */
export default function DialogContainer() {
  const [state, setState] = useState(null);
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef(null);
  const confirmBtnRef = useRef(null);
  const containerRef = useRef(null);

  // Register this container as the dialog handler
  useEffect(() => {
    dialog._register(setState);
    return () => {
      dialog._drain('dialog-container-unmounted');
      dialog._register(null);
    };
  }, []);

  useFocusTrap(containerRef, Boolean(state), {
    onClose: () => dialog._respond(state?.type === 'prompt' ? null : false),
  });

  // Focus the right element when a dialog opens
  useEffect(() => {
    if (!state) return;
    if (state.type === 'prompt') {
      setInputValue(state.defaultValue || '');
      requestAnimationFrame(() => {
        try {
          inputRef.current?.focus({ preventScroll: true });
        } catch {
          inputRef.current?.focus();
        }
      });
    } else {
      requestAnimationFrame(() => {
        try {
          confirmBtnRef.current?.focus({ preventScroll: true });
        } catch {
          confirmBtnRef.current?.focus();
        }
      });
    }
  }, [state]);

  if (!state) return null;

  const isDanger = state.variant === 'danger';

  const handleConfirm = () => {
    dialog._respond(state.type === 'prompt' ? inputValue.trim() || null : true);
  };

  const handleCancel = () => {
    dialog._respond(state.type === 'prompt' ? null : false);
  };

  const handleBackdropKeyDown = (e) => {
    if (e.key === 'Escape') handleCancel();
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-[9999] p-4"
      onClick={handleCancel}
      onKeyDown={handleBackdropKeyDown}
      role="presentation"
    >
      <div
        ref={containerRef}
        className="rounded-lg shadow-lg max-w-sm w-full p-6 bg-gray-900 border border-gray-700"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={state.title ? 'dialog-title' : undefined}
        aria-describedby="dialog-message"
      >
        {state.title && (
          <h3 id="dialog-title" className="text-base font-semibold mb-2 text-white">
            {state.title}
          </h3>
        )}

        <p id="dialog-message" className="text-sm mb-5 text-gray-300">
          {state.message}
        </p>

        {state.type === 'prompt' && (
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') handleConfirm();
              if (e.key === 'Escape') handleCancel();
            }}
            placeholder={state.placeholder}
            className="w-full px-3 py-2 rounded-lg text-sm border mb-4 focus-visible:outline-none focus-visible:ring-2 bg-gray-800 border-gray-600 text-white placeholder-gray-500 focus-visible:border-accent-500 focus-visible:ring-accent-500/20"
          />
        )}

        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 bg-gray-800 text-gray-300 hover:bg-gray-700 focus-visible:ring-gray-500"
          >
            {state.cancelLabel}
          </button>
          <button
            type="button"
            ref={confirmBtnRef}
            onClick={handleConfirm}
            className={`px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors focus-visible:outline-none focus-visible:ring-2 ${
              isDanger
                ? 'bg-red-600 hover:bg-red-700 focus-visible:ring-red-500'
                : 'bg-accent-600 hover:bg-accent-700 focus-visible:ring-accent-500'
            }`}
          >
            {state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
