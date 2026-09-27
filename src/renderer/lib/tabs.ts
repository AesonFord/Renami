import { DEFAULT_SETTINGS, type Platform, type RenameSettings } from '../../core/types.js';

export type TabId = 'sequence' | 'findReplace' | 'cleanup' | 'move' | 'dates';

/** Option tabs, in the order they're shown. */
export const TABS: { id: TabId; label: string }[] = [
  { id: 'sequence', label: 'Sequence' },
  { id: 'findReplace', label: 'Find & replace' },
  { id: 'cleanup', label: 'Case & cleanup' },
  { id: 'move', label: 'Move into folders' },
  { id: 'dates', label: 'File dates' },
];

const SEQUENCE_KEYS = ['sortBy', 'direction', 'start', 'step', 'digits', 'restartPerFolder', 'restartEvery', 'keepGroupsTogether'] as const;

/**
 * How many settings on each tab are active, i.e. differ from the defaults, for each
 * tab's count badge. On Linux, `setCreated` doesn't count: the app can't act on it there.
 */
export function tabCounts(s: RenameSettings, platform: Platform | null): Record<TabId, number> {
  const d = DEFAULT_SETTINGS;
  const n = (b: boolean): number => (b ? 1 : 0);
  const setCreated = platform === 'linux' ? false : s.dates.setCreated;
  return {
    sequence: SEQUENCE_KEYS.filter((k) => s.sequence[k] !== d.sequence[k]).length,
    findReplace: s.findReplace.filter((r) => r.find !== '').length,
    cleanup:
      n(s.cleanup.caseMode !== 'none') +
      n(s.cleanup.spacesToUnderscores) +
      n(s.cleanup.lowercaseExtension) +
      n(s.cleanup.stripDiacritics) +
      n(s.cleanup.asciiOnly) +
      n(s.cleanup.extensionRules.length > 0),
    move: n(s.move.destinationRoot !== null),
    dates: n(s.dates.setModified) + n(setCreated) + n(s.dates.shiftMinutes !== 0) + n(!s.dates.useNameDate),
  };
}
