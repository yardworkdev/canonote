import React from 'react';
import Tooltip from './Tooltip';

export default function ToolbarFormatButton({
  format,
  icon: Icon,
  active,
  onClick,
  title,
  ariaLabel,
  keyshortcuts,
}) {
  const handleClick = (e) => {
    e.preventDefault();
    onClick?.(format);
  };

  return (
    <Tooltip label={title}>
    <button
      type="button"
      onClick={handleClick}
      className={`group inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-[transform,background-color,color,box-shadow,border-color] duration-200 focus-visible:outline-none focus-visible:ring-2 active:scale-[0.96] sm:h-10 sm:w-10 sm:rounded-lg ${
        active
          ? 'border border-accent-500/20 bg-accent-600/20 text-accent-300 shadow-soft hover:bg-accent-600/30'
          : 'text-gray-300 hover:bg-white/10 hover:text-gray-200 focus-visible:ring-accent-500'
      } ${!active ? 'text-gray-300' : ''}`}
      aria-label={ariaLabel}
      aria-keyshortcuts={keyshortcuts}
      aria-pressed={active}
    >
      <Icon
        className={`h-4 w-4 transition-transform duration-200 ${active ? 'scale-[1.04]' : 'group-'}`}
      />
    </button>
    </Tooltip>
  );
}
