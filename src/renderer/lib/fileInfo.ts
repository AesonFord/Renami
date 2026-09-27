import type { Platform } from '../../core/types.js';

/** "2.4 MB": decimal units, like Finder and the size filter. */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** "1:05", or "1:02:05" from an hour up. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** What each platform calls showing a file in its folder. */
export function showInFolderLabel(platform: Platform | null): string {
  if (platform === 'darwin') return 'Show in Finder';
  if (platform === 'win32') return 'Show in Explorer';
  return 'Show in folder';
}
