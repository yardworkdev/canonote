import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Palette, Check } from 'lucide-react';
import { writeBrowserStorageValue } from '../services/browser-storage';

// Two, not three. Aurora was a third grey ramp that made no visible difference
// from the other two, so choosing a theme looked broken; a control that changes
// nothing is worse than no control (Ves, 2026-11-18).
const THEMES = [
  { id: 'midnight', name: 'Midnight', desc: 'Ink · no hue, all contrast', swatch: '#e5e5e5' },
  { id: 'sepia', name: 'Sepia', desc: 'Espresso · ember accent', swatch: '#e69636' },
];

function getInitialTheme() {
  if (typeof document !== 'undefined') {
    const attr = document.documentElement.getAttribute('data-theme');
    if (THEMES.some((t) => t.id === attr)) return attr;
  }
  return 'midnight';
}

export default function ThemeSwitcher({ className = '' }) {
  const [isOpen, setIsOpen] = useState(false);
  const [theme, setTheme] = useState(getInitialTheme);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef(null);
  const dropdownRef = useRef(null);

  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPosition({
        top: rect.bottom + window.scrollY + 6,
        left: rect.right + window.scrollX - 208,
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

  const applyTheme = (id) => {
    document.documentElement.setAttribute('data-theme', id);
    writeBrowserStorageValue('app-theme', id);
    setTheme(id);
    setIsOpen(false);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={className}
        title="Theme"
        aria-label="Change theme"
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        <Palette className="w-4 h-4" />
      </button>

      {isOpen &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-[100] w-52 overflow-hidden rounded-lg border border-gray-700/50 bg-gray-800/95 p-1.5 shadow-lg animate-in fade-in zoom-in-95 duration-200"
            style={{ top: `${position.top}px`, left: `${Math.max(8, position.left)}px` }}
            role="region"
            aria-label="Themes"
          >
            <div role="menu" aria-label="Themes">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                role="menuitemradio"
                aria-checked={theme === t.id}
                onClick={() => applyTheme(t.id)}
                className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors duration-150 hover:bg-gray-700/50 focus:bg-gray-700/50 focus-visible:outline-none"
              >
                <span
                  className="h-5 w-5 shrink-0 rounded-full border border-white/15"
                  style={{ background: t.swatch }}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-gray-200">{t.name}</span>
                  <span className="block text-[11px] text-gray-400">{t.desc}</span>
                </span>
                {theme === t.id && <Check className="h-4 w-4 shrink-0 text-accent-400" />}
              </button>
            ))}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
