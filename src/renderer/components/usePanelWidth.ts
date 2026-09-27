import { useEffect, useState } from 'react';
import { storage } from '../lib/storage.js';

const KEY = 'renami.previewPanelWidth';
/** Spec P2: 280px to 60% of the window, 360px at first. */
export const PANEL_MIN = 280;
export const PANEL_DEFAULT = 360;
export const PANEL_MAX_SHARE = 0.6;

/** The widest the panel may be in a window this wide. */
export function clampPanelWidth(width: number, windowWidth: number): number {
  const max = Math.max(PANEL_MIN, Math.floor(windowWidth * PANEL_MAX_SHARE));
  return Math.round(Math.min(max, Math.max(PANEL_MIN, width)));
}

function load(): number {
  try {
    const n = Number(storage()?.getItem(KEY));
    return Number.isFinite(n) && n > 0 ? n : PANEL_DEFAULT;
  } catch {
    return PANEL_DEFAULT;
  }
}

/** The preview panel's width, remembered across launches. */
export function usePanelWidth(): [number, (width: number) => void] {
  const [width, setWidth] = useState(load);
  useEffect(() => {
    try {
      storage()?.setItem(KEY, String(width));
    } catch {
      // Storage full or blocked: the width just isn't remembered.
    }
  }, [width]);
  return [width, setWidth];
}
