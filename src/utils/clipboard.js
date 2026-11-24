/**
 * Copy text to the clipboard.
 *
 * `navigator.clipboard` rejects when the page lacks clipboard permission (an
 * embedded frame, a hardened browser, a headless run) and an unhandled
 * rejection both loses the copy and spams the console. This falls back to the
 * legacy textarea + execCommand path and reports whether the copy happened, so
 * callers can tell the truth to the user instead of showing "copied" anyway.
 */
export const copyTextToClipboard = async (text) => {
  const value = String(text ?? '');

  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through to the legacy path.
  }

  try {
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(area);
    return copied;
  } catch {
    return false;
  }
};
