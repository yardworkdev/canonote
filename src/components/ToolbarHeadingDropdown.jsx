import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Type, ChevronDown } from 'lucide-react';

export default function ToolbarHeadingDropdown({ onClick }) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef(null);
  const dropdownRef = useRef(null);

  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPosition({
        top: rect.bottom + window.scrollY + 6,
        left: rect.left + window.scrollX,
      });
    }
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        buttonRef.current &&
        dropdownRef.current &&
        !buttonRef.current.contains(event.target) &&
        !dropdownRef.current.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };

    const handleScroll = () => setIsOpen(false);

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      window.addEventListener('scroll', handleScroll, true);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [isOpen]);

  const handleSelect = (level) => {
    onClick(level);
    setIsOpen(false);
  };

  const headings = [
    { level: 1, label: 'H1', title: 'Heading 1 (Markdown: #)' },
    { level: 2, label: 'H2', title: 'Heading 2 (Markdown: ##)' },
    { level: 3, label: 'H3', title: 'Heading 3 (Markdown: ###)' },
  ];

  return (
    <>
      <div className="relative" ref={buttonRef}>
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg pl-2.5 pr-2 transition-[transform,background-color,color,box-shadow,border-color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 active:scale-[0.96] sm:min-h-10 sm:rounded-lg sm:pl-3 sm:pr-2.5 ${
            isOpen
              ? 'border border-accent-500/20 bg-accent-600/20 text-accent-300 shadow-soft'
              : ' hover:bg-white/10 hover:text-gray-200'
          }`}
          title="Insert Heading"
          aria-label="Insert Heading"
          aria-expanded={isOpen}
          aria-haspopup="true"
        >
          <Type className="h-3.5 w-3.5 -ml-px text-gray-300" />
          <span className="text-xs font-bold text-gray-300">H</span>
          <ChevronDown
            className={`h-3 w-3 text-gray-300 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          />
        </button>
      </div>

      {isOpen &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-[100] overflow-hidden rounded-[18px] border border-gray-700/50 bg-gray-800/95 shadow-lg animate-in fade-in zoom-in-95 duration-200"
            style={{ top: `${position.top}px`, left: `${position.left}px` }}
            role="region"
            aria-label="Heading levels"
          >
            <div className="p-1" role="menu" aria-label="Heading levels">
              {headings.map((heading) => (
                <button
                  type="button"
                  key={heading.level}
                  onClick={() => handleSelect(heading.level)}
                  className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-gray-200 transition-[transform,background-color,color] duration-200 hover:bg-gray-700/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/50 active:scale-[0.96]"
                  role="menuitem"
                  title={heading.title}
                  aria-label={heading.title}
                >
                  <Type className="h-3.5 w-3.5 -ml-px text-gray-300" />
                  <span className="text-xs font-bold text-gray-300">{heading.label}</span>
                </button>
              ))}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
