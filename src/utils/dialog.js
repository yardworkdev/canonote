/**
 * Singleton dialog service.
 *
 * Lets any module — including non-React hooks — await user confirmations and
 * text prompts without needing to thread props through the component tree.
 * Falls back to the native browser APIs when DialogContainer isn't mounted
 * (e.g., during tests or early render).
 *
 * Usage:
 *   import { dialog } from '../utils/dialog';
 *   const ok = await dialog.confirm('Delete this note?', { variant: 'danger' });
 *   const url = await dialog.prompt('Enter URL:', { placeholder: 'https://' });
 */

let _setState = null;
let _pendingQueue = [];

export const dialog = {
  /** Called by DialogContainer on mount. */
  _register(setState) {
    _setState = setState;
  },

  /**
   * Reject all pending dialog promises.
   * Called by DialogContainer on unmount to prevent hung promises.
   */
  _drain(reason = 'dialog-unmounted') {
    while (_pendingQueue.length > 0) {
      const item = _pendingQueue.shift();
      if (item?.type === 'confirm') {
        item.resolve(false);
      } else {
        item.resolve(null);
      }
    }
    _setState?.(null);
  },

  /**
   * Show a confirmation dialog.
   * @returns {Promise<boolean>}
   */
  confirm(message, options = {}) {
    const {
      title = '',
      confirmLabel = 'Confirm',
      cancelLabel = 'Cancel',
      variant = 'default',
    } = options;
    if (!_setState) return Promise.resolve(window.confirm(message));
    return new Promise((resolve) => {
      _pendingQueue.push({ type: 'confirm', message, title, confirmLabel, cancelLabel, variant, resolve });
      if (_pendingQueue.length === 1) {
        _setState(_pendingQueue[0]);
      }
    });
  },

  /**
   * Show a text-input prompt dialog.
   * @returns {Promise<string | null>}  null = cancelled
   */
  prompt(message, options = {}) {
    const {
      title = '',
      placeholder = '',
      defaultValue = '',
      confirmLabel = 'OK',
      cancelLabel = 'Cancel',
    } = options;
    if (!_setState) return Promise.resolve(window.prompt(message, defaultValue));
    return new Promise((resolve) => {
      _pendingQueue.push({ type: 'prompt', message, title, placeholder, defaultValue, confirmLabel, cancelLabel, resolve });
      if (_pendingQueue.length === 1) {
        _setState(_pendingQueue[0]);
      }
    });
  },

  /** Internal — called by DialogContainer to resolve the pending promise. */
  _respond(value) {
    const item = _pendingQueue.shift();
    _setState?.(null);
    item?.resolve?.(value);
    if (_pendingQueue.length > 0) {
      _setState?.(_pendingQueue[0]);
    }
  },
};
