import React, { useEffect, useState } from 'react';
import { AlertCircle, HardDrive } from 'lucide-react';
import { getBrowserStorage } from '../services/browser-storage';
import { getStorageMode } from '../services/storage-adapter';
import { probeBrowserStorage, probeStorageAdapter } from '../services/storage-failure';

/**
 * StorageMode — where the notes live, stated once, as status.
 *
 * Status, not a control: plain muted text and an icon, no border, no surface
 * fill, no hover treatment, nothing to click. The chip this replaces sat in the
 * toolbar with the same chrome as the buttons beside it and read as a control
 * that did nothing (dogfood, 2026-10-07: "the Local chip reads like a button").
 * Where notes live is a fact about the notebook, so it belongs in the status
 * row with the save state — see BRAND.md, Components.
 *
 * The fact has to be true, and a browser that blocks storage is the case where
 * it was not: the row said "Stored in this browser" while every write was
 * refused and the text was gone on reload (2026-10-13). So the component asks
 * the browser once on mount and, when it will not store anything, says that
 * instead of the claim.
 *
 * It asks the store the notes are on — the seam — rather than Web Storage: the
 * notes live in IndexedDB now, and a browser can block one store while allowing
 * the other, so the answer has to come from the store the app is really using.
 * The Web Storage probe is the fallback for a page with no seam at all.
 */
const UNAVAILABLE_STATUS = {
  full: 'Notes are not being saved — storage is full',
  blocked: 'Notes are not being saved — this browser blocks storage',
};

export default function StorageMode() {
  const [probe, setProbe] = useState(null);
  const [mode, setMode] = useState({ mode: 'local', folderName: null });

  useEffect(() => {
    let isActive = true;
    setMode(getStorageMode());
    const seam = typeof window !== 'undefined' ? window.storage : null;
    const question = seam?.set
      ? probeStorageAdapter(seam)
      : Promise.resolve(probeBrowserStorage(getBrowserStorage()));

    question.then((result) => {
      if (isActive) setProbe(result);
    });

    return () => {
      isActive = false;
    };
  }, []);

  if (probe && !probe.available) {
    return (
      <span className="flex items-center gap-1.5 text-red-600 dark:text-red-400">
        <AlertCircle className="w-3 h-3" aria-hidden="true" />
        <span>{UNAVAILABLE_STATUS[probe.reason] || UNAVAILABLE_STATUS.blocked}</span>
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1.5 text-gray-400">
      <HardDrive className="w-3 h-3 text-gray-500" aria-hidden="true" />
      <span>
        {mode.mode === 'folder' ? `Stored in “${mode.folderName}”` : 'Stored in this browser'}
      </span>
    </span>
  );
}
