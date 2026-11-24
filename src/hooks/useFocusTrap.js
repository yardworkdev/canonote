import { useEffect } from 'react';

const FOCUSABLE = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Keeps the keyboard inside a dialog for as long as it is open.
 *
 * Three things a dialog owes a keyboard user, in one place so no surface can
 * forget one of them:
 *
 * - Tab and Shift+Tab cycle the dialog's own controls instead of walking out
 *   into the page behind it (a `role="dialog"` with `aria-modal="true"` that
 *   lets Tab escape is a lie to a screen reader).
 * - Escape closes it, listened for on the document — a click inside the panel
 *   can leave focus outside the container, and a container-level listener then
 *   never sees the key press.
 * - Focus moves into the dialog when it opens and goes back to the control
 *   that opened it when it closes. Dropping the caret on `<body>` costs the
 *   user their place: the next Tab starts at the top of the page.
 *
 * The container is the fallback target when no `initialFocusRef` is given, so
 * a dialog using that fallback needs `tabIndex={-1}` to be focusable at all.
 */
export function useFocusTrap(ref, active = true, { onClose, initialFocusRef } = {}) {
  useEffect(() => {
    if (!active || !onClose) return undefined;

    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [active, onClose]);

  useEffect(() => {
    if (!active || !ref.current) return undefined;
    const container = ref.current;
    const returnFocusTo = document.activeElement;

    const moveFocus = (element) => {
      if (!element) return;
      try {
        element.focus({ preventScroll: true });
      } catch {
        element.focus();
      }
    };

    moveFocus(initialFocusRef?.current || container);

    const handleKeyDown = (e) => {
      if (e.key !== 'Tab') return;
      const focusable = Array.from(container.querySelectorAll(FOCUSABLE));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          moveFocus(last);
        }
      } else if (document.activeElement === last) {
        e.preventDefault();
        moveFocus(first);
      }
    };

    container.addEventListener('keydown', handleKeyDown);
    return () => {
      container.removeEventListener('keydown', handleKeyDown);
      // The opener is usually a toolbar button. A dialog that closes onto
      // nothing makes the keyboard start over from the top of the page.
      if (
        returnFocusTo instanceof HTMLElement &&
        returnFocusTo !== document.body &&
        document.contains(returnFocusTo)
      ) {
        moveFocus(returnFocusTo);
      }
    };
  }, [ref, active, initialFocusRef]);
}
