import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Hover and focus help, in one place.
 *
 * Native `title` tooltips are invisible for about a second, unstyled, and never
 * appear for a disabled control — which is exactly when a person needs to know
 * why a button will not answer. This shows one grey line after a short pause,
 * over anything (a portal, so no scroll container can clip it), and the wrapper
 * still receives hover events when the button inside is disabled.
 */
const OFFSET = 8;

export default function Tooltip({ label, children, side = 'bottom', delay = 150 }) {
  const [position, setPosition] = useState(null);
  const timer = useRef(null);
  const wrapRef = useRef(null);

  const clear = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setPosition(null);
  }, []);

  useEffect(() => clear, [clear]);

  const show = useCallback(() => {
    if (!label) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const node = wrapRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      setPosition({
        left: Math.min(Math.max(rect.left + rect.width / 2, 90), window.innerWidth - 90),
        top: side === 'bottom' ? rect.bottom + OFFSET : rect.top - OFFSET,
        side,
      });
    }, delay);
  }, [delay, label, side]);

  if (!label) return children;

  return (
    <span
      ref={wrapRef}
      className="inline-flex"
      onMouseEnter={show}
      onMouseLeave={clear}
      onFocus={show}
      onBlur={clear}
      onMouseDown={clear}
    >
      {children}
      {position &&
        createPortal(
          <span
            role="tooltip"
            className="pointer-events-none fixed z-[100] max-w-[240px] rounded-md border border-white/10 bg-neutral-900/95 px-2 py-1 text-center text-[11px] font-normal leading-snug text-gray-200 shadow-lg shadow-black/40"
            style={{
              left: `${position.left}px`,
              top: `${position.top}px`,
              transform: `translate(-50%, ${position.side === 'bottom' ? '0' : '-100%'})`,
            }}
          >
            {label}
          </span>,
          document.body
        )}
    </span>
  );
}
