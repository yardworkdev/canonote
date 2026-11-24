import React from 'react';
import Tooltip from './Tooltip';

export default function ToolbarIconButton({ icon: Icon, onClick, title, ariaLabel, disabled }) {
  const handleClick = (e) => {
    e.preventDefault();
    onClick?.(e);
  };

  return (
    <Tooltip label={title}>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        className="group inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-300 transition-[transform,background-color,color,box-shadow] duration-200 hover:bg-white/10 hover:text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:bg-transparent sm:h-10 sm:w-10 sm:rounded-lg"
        aria-label={ariaLabel}
      >
        <Icon className="h-4 w-4 transition-transform duration-200 group-" />
      </button>
    </Tooltip>
  );
}
