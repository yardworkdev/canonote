import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';

// The bar's overflow: a narrow window cannot hold every control, and hiding one
// is how a feature becomes unreachable on a phone. Whatever the bar drops at the
// current width is offered here instead, from the same control definitions.
//
// Keyboard path: Tab to the trigger, Enter/Space opens it, ArrowDown walks in,
// Enter activates, Escape closes and hands the focus back to the trigger.

const MENU_WIDTH = 264;

export default function ToolbarOverflowMenu({ buttonClass, items, label = 'More controls' }) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const itemRefs = useRef([]);

  useEffect(() => {
    if (!isOpen || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    // Anchored to the trigger, but never off the right edge of a phone.
    const left = Math.max(
      8,
      Math.min(rect.left + window.scrollX, window.innerWidth - MENU_WIDTH - 8)
    );
    setPosition({ top: rect.bottom + window.scrollY + 6, left });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleClickOutside = (event) => {
      if (buttonRef.current?.contains(event.target)) return;
      if (menuRef.current?.contains(event.target)) return;
      setIsOpen(false);
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        buttonRef.current?.focus();
        return;
      }

      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

      const reachable = itemRefs.current.filter((node) => node && !node.disabled);
      if (reachable.length === 0) return;

      event.preventDefault();
      const index = reachable.indexOf(document.activeElement);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const next = (index + step + reachable.length) % reachable.length;
      reachable[index === -1 ? 0 : next]?.focus();
    };

    const handleScroll = () => setIsOpen(false);

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleScroll, true);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [isOpen]);

  return (
    <>
      <button
        type="button"
        ref={buttonRef}
        onClick={() => setIsOpen((prev) => !prev)}
        className={buttonClass}
        title="More controls"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {isOpen &&
        createPortal(
          // A menu that portals to the body leaves the page's landmarks behind,
          // and content outside every landmark is unreachable by landmark
          // navigation — so the popup carries its own region.
          <div
            role="region"
            aria-label="More formatting and note actions"
            className="fixed z-[100] w-[264px] overflow-hidden rounded-[18px] border border-gray-700/50 bg-gray-800/95 p-1 shadow-lg animate-in fade-in zoom-in-95 duration-200"
            style={{ top: `${position.top}px`, left: `${position.left}px` }}
          >
            <div ref={menuRef} role="menu" aria-label="More formatting and note actions">
              {items.map((item, index) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    ref={(node) => {
                      itemRefs.current[index] = node;
                    }}
                    type="button"
                    role="menuitem"
                    disabled={item.disabled}
                    onClick={() => {
                      setIsOpen(false);
                      item.onSelect?.();
                    }}
                    title={item.title}
                    className={`flex min-h-10 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm transition-[background-color,color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/50 disabled:cursor-not-allowed disabled:opacity-50 ${
                      item.tone === 'danger'
                        ? 'text-red-300 hover:bg-red-500/10'
                        : 'text-gray-200 hover:bg-gray-700/50'
                    } ${item.className ?? ''}`}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {/* The hint is in the tooltip; keeping it out of the
                      accessible name is what makes the item nameable. */}
                    {item.hint ? (
                      <span aria-hidden="true" className="shrink-0 text-xs text-gray-400">
                        {item.hint}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
