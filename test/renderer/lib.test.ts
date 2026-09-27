import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/core/types.js';
import { badgesFor, needsLook, rowTone, statusTitle } from '../../src/renderer/lib/flags.js';
import {
  appendSeq,
  chipLabel,
  highlight,
  PALETTE,
  replaceRange,
  seqProblem,
  tokenAt,
  tokenLabel,
  tokenText,
} from '../../src/renderer/lib/pattern.js';
import { renameBlockedReason, renameLabel, summarize, summaryParts } from '../../src/renderer/lib/summary.js';
import { tabCounts } from '../../src/renderer/lib/tabs.js';
import { flag, row } from './fixtures.js';

describe('highlight', () => {
  it('splits a pattern into text, tokens and separators with their positions', () => {
    expect(highlight('Hawaii_{date_taken:YYYY}/{seq:3}')).toEqual([
      { text: 'Hawaii_', kind: 'text', start: 0 },
      { text: '{date_taken:YYYY}', kind: 'token', start: 7 },
      { text: '/', kind: 'separator', start: 24 },
      { text: '{seq:3}', kind: 'token', start: 25 },
    ]);
  });

  it('marks everything from a pattern error onwards', () => {
    expect(highlight('a{nope}b')).toEqual([
      { text: 'a', kind: 'text', start: 0 },
      { text: '{nope}b', kind: 'error', start: 1 },
    ]);
    expect(highlight('')).toEqual([]);
  });
});

describe('pattern editing', () => {
  it('finds the token the caret is strictly inside', () => {
    expect(tokenAt('x{seq:3}y', 3)).toMatchObject({ name: 'seq', start: 1, end: 8 });
    expect(tokenAt('x{seq:3}y', 1)).toBeNull();
    expect(tokenAt('x{seq:3}y', 8)).toBeNull();
  });

  it('writes token source text', () => {
    expect(tokenText('date_taken', 'YYYY', null)).toBe('{date_taken:YYYY}');
    expect(tokenText('artist', null, 'Unknown')).toBe('{artist|Unknown}');
    expect(tokenText('name', null, null)).toBe('{name}');
  });

  it('replaces a range and reports where the caret goes', () => {
    expect(replaceRange('ab', 1, 1, '{seq}')).toEqual({ pattern: 'a{seq}b', caret: 6 });
    expect(replaceRange('a{x}b', 1, 4, '')).toEqual({ pattern: 'ab', caret: 1 });
  });

  it("tells when the Sequence tab's numbers don't reach the names", () => {
    expect(seqProblem('{name}')).toEqual({ kind: 'noSeq' });
    expect(seqProblem('Trip_{seq:3}')).toEqual({ kind: 'fixedDigits', token: '{seq:3}' });
    expect(seqProblem('{seq:3}_{seq}')).toBeNull();
    expect(seqProblem('{name}_{seq}')).toBeNull();
    // A broken pattern already shows its own error.
    expect(seqProblem('{nme}')).toBeNull();
    expect(seqProblem('')).toBeNull();
  });

  it('appends {seq}, with an underscore unless the pattern already ends in a separator', () => {
    expect(appendSeq('{name}')).toBe('{name}_{seq}');
    expect(appendSeq('Trip-')).toBe('Trip-{seq}');
    expect(appendSeq('{date_taken:YYYY}/')).toBe('{date_taken:YYYY}/{seq}');
    expect(appendSeq('Trip ')).toBe('Trip {seq}');
  });

  it('labels tokens in sentence case', () => {
    expect(tokenLabel('date_taken')).toBe('Date taken');
    expect(tokenLabel('iso')).toBe('ISO');
  });

  it('labels palette chips, overriding tokenLabel only where the two differ', () => {
    expect(chipLabel('camera_model')).toBe('Camera');
    expect(chipLabel('date_taken')).toBe('Date taken');
    const expected: Record<string, string> = {
      date_taken: 'Date taken',
      created: 'Created',
      modified: 'Modified',
      seq: 'Sequence',
      name: 'Name',
      folder: 'Folder',
      camera_model: 'Camera',
      lens: 'Lens',
      artist: 'Artist',
      album: 'Album',
      track: 'Track',
      parent: 'Parent',
      ext: 'Extension',
      size: 'Size',
      aperture: 'Aperture',
      shutter: 'Shutter',
      composer: 'Composer',
    };
    const tokens = PALETTE.flatMap((g) => g.tokens.map((t) => t.token));
    expect(tokens.map((t) => chipLabel(t))).toEqual(tokens.map((t) => expected[t]));
  });
});

describe('flags', () => {
  it('shows the most serious flag first', () => {
    const r = row({ flags: [flag('paired', 'info'), flag('suffix-added', 'warning'), flag('empty-segment', 'error')] });
    expect(badgesFor(r)).toEqual([
      { label: 'Empty name', tone: 'error' },
      { label: 'Suffix added', tone: 'suffix' },
      { label: 'Paired', tone: 'accent' },
    ]);
    expect(rowTone(r)).toBe('error');
  });

  it('describes rows without flags by what will happen', () => {
    expect(badgesFor(row())).toEqual([{ label: 'Ready', tone: 'neutral' }]);
    expect(badgesFor(row({ kind: 'move' }))).toEqual([{ label: 'Will move', tone: 'neutral' }]);
    expect(badgesFor(row({ kind: 'unchanged' }))).toEqual([{ label: 'Unchanged', tone: 'neutral' }]);
    expect(badgesFor(row({ kind: 'unchanged', setsDates: true }))).toEqual([{ label: 'Dates only', tone: 'neutral' }]);
    expect(badgesFor(row({ kind: 'excluded' }))).toEqual([{ label: 'Left out', tone: 'neutral' }]);
    expect(statusTitle(row({ kind: 'excluded' }))).toBe('Left out of this rename; the file stays as it is');
  });

  it('explains a badge with every flag message', () => {
    const r = row({ flags: [flag('fallback-date', 'warning', 'No date taken; used created date'), flag('paired', 'info', 'Paired with IMG_1.NEF')] });
    expect(statusTitle(r)).toBe('No date taken; used created date\nPaired with IMG_1.NEF');
    expect(statusTitle(row())).toBe('Will be renamed');
  });

  it('only warnings and errors need a look; paired is information', () => {
    expect(needsLook(row({ flags: [flag('paired', 'info')] }))).toBe(false);
    expect(needsLook(row({ flags: [flag('missing-value', 'warning')] }))).toBe(true);
  });
});

describe('summary', () => {
  const rows = [
    row({ path: '/1' }),
    row({ path: '/2', flags: [flag('fallback-date', 'warning')] }),
    row({ path: '/3', flags: [flag('fallback-date', 'warning'), flag('suffix-added', 'warning')] }),
    row({ path: '/4', kind: 'unchanged' }),
    row({ path: '/5', kind: 'unchanged', setsDates: true }),
    row({ path: '/6', kind: 'error', newName: '', flags: [flag('empty-segment', 'error')] }),
    row({ path: '/7', kind: 'excluded', newName: '', dateUsed: null, dateSource: null }),
  ];

  it('counts what will happen', () => {
    expect(summarize(rows)).toEqual({
      total: 7,
      toChange: 3,
      datesOnly: 1,
      excluded: 1,
      errors: 1,
      counts: { 'fallback-date': 2, 'suffix-added': 1, 'empty-segment': 1 },
    });
  });

  it('uses the action bar wording', () => {
    expect(summaryParts(summarize(rows)).map((p) => `${p.count} ${p.text}`)).toEqual([
      '3 will be renamed',
      '1 will only get new dates',
      '1 is left out',
      '2 used a fallback date',
      '1 got a suffix',
      '1 has errors',
    ]);
    expect(summaryParts(summarize([row({ kind: 'excluded' }), row({ kind: 'excluded' })]))).toContainEqual({
      count: 2, text: 'are left out', tone: 'neutral',
    });
  });

  it('labels the Rename button', () => {
    expect(renameLabel(summarize([row()]))).toBe('Rename 1 file');
    expect(renameLabel(summarize(rows))).toBe('Rename 3 files');
    expect(renameLabel(summarize([row({ kind: 'unchanged', setsDates: true })]))).toBe('Change dates on 1 file');
    expect(renameLabel(summarize([]))).toBe('Rename files');
  });

  it('explains why renaming is blocked', () => {
    const plan = { planId: 'p', rows: [row()], patternError: null, errorCount: 0, complete: true };
    const ok = summarize(plan.rows);
    const finished = { done: 1, total: 1, finished: true, exiftoolFailed: false };
    const ready = { plan, scanning: false, metadata: finished, summary: ok, planPending: false };
    expect(renameBlockedReason(ready)).toBeNull();
    expect(renameBlockedReason({ ...ready, plan: null, metadata: null })).toBe('Add files first');
    expect(renameBlockedReason({ ...ready, scanning: true })).toBe('Looking for files…');
    expect(renameBlockedReason({ ...ready, metadata: { ...finished, finished: false } })).toBe('Reading file details…');
    // Reading has finished, but the preview shown was built before it did.
    expect(renameBlockedReason({ ...ready, plan: { ...plan, complete: false } })).toBe('Reading file details…');
    // The preview shown is about to be replaced; running it would only get "The preview changed".
    expect(renameBlockedReason({ ...ready, planPending: true })).toBe('Updating the preview…');
    expect(renameBlockedReason({ ...ready, plan: { ...plan, patternError: 'bad' } })).toBe('Fix the pattern first');
    expect(renameBlockedReason({ ...ready, summary: summarize(rows) })).toBe('Fix or exclude the files with errors');
    expect(renameBlockedReason({ ...ready, summary: summarize([row({ kind: 'unchanged' })]) })).toBe('Nothing to rename');
    expect(renameBlockedReason({ ...ready, summary: summarize([row({ kind: 'excluded' })]) })).toBe('Nothing to rename');
  });
});

describe('tabCounts', () => {
  it('is zero for the defaults and counts each active setting', () => {
    expect(tabCounts(DEFAULT_SETTINGS, 'darwin')).toEqual({ sequence: 0, findReplace: 0, cleanup: 0, move: 0, dates: 0 });
    const s = {
      ...DEFAULT_SETTINGS,
      sequence: { ...DEFAULT_SETTINGS.sequence, digits: 4, restartPerFolder: true },
      findReplace: [
        { find: 'IMG', replace: '', regex: false, matchCase: false },
        { find: '', replace: 'x', regex: false, matchCase: false },
      ],
      cleanup: { ...DEFAULT_SETTINGS.cleanup, caseMode: 'lower' as const, spacesToUnderscores: true },
      move: { destinationRoot: '/sorted' },
      dates: { ...DEFAULT_SETTINGS.dates, setModified: true },
    };
    expect(tabCounts(s, 'darwin')).toEqual({ sequence: 2, findReplace: 1, cleanup: 2, move: 1, dates: 1 });
  });

  it('counts the new sequence, cleanup and dates settings', () => {
    const s = {
      ...DEFAULT_SETTINGS,
      sequence: { ...DEFAULT_SETTINGS.sequence, direction: 'desc' as const, step: 2, restartEvery: 'day' as const },
      cleanup: { ...DEFAULT_SETTINGS.cleanup, stripDiacritics: true, asciiOnly: true, extensionRules: [{ from: 'jpeg', to: 'jpg' }] },
      dates: { ...DEFAULT_SETTINGS.dates, shiftMinutes: 30, useNameDate: false },
    };
    expect(tabCounts(s, 'darwin')).toEqual({ sequence: 3, findReplace: 0, cleanup: 3, move: 0, dates: 2 });
  });

  it("doesn't count setCreated on Linux, which can't act on it", () => {
    const s = { ...DEFAULT_SETTINGS, dates: { ...DEFAULT_SETTINGS.dates, setCreated: true } };
    expect(tabCounts(s, 'linux').dates).toBe(0);
    expect(tabCounts(s, 'darwin').dates).toBe(1);
  });
});

describe('summary parts for the rarer flags', () => {
  const flagged = (code: Parameters<typeof flag>[0], n: number) =>
    Array.from({ length: n }, (_, i) => row({ path: `/p/${code}/${i}`, flags: [flag(code, 'warning')] }));
  const texts = (rows: ReturnType<typeof row>[]) => summaryParts(summarize(rows)).map((p) => `${p.count} ${p.text}`);

  it('uses singular verbs for one file', () => {
    expect(texts(flagged('missing-value', 1))).toContain('1 is missing a value');
    expect(texts(flagged('cross-drive', 1))).toContain('1 moves to another drive');
    expect(texts(flagged('metadata-unreadable', 1))).toContain("1 couldn't be read");
    expect(texts(flagged('no-date-taken', 1))).toContain('1 has no date taken');
  });

  it('uses plural verbs for several files', () => {
    expect(texts(flagged('missing-value', 2))).toContain('2 are missing a value');
    expect(texts(flagged('cross-drive', 2))).toContain('2 move to another drive');
    expect(texts(flagged('metadata-unreadable', 3))).toContain("3 couldn't be read");
    expect(texts(flagged('no-date-taken', 2))).toContain('2 have no date taken');
  });

  it('gives each part its tone and keeps the order', () => {
    const rows = [
      ...flagged('no-date-taken', 1),
      ...flagged('metadata-unreadable', 1),
      ...flagged('cross-drive', 1),
      ...flagged('missing-value', 1),
      row({ path: '/p/dates', kind: 'unchanged', setsDates: true }),
    ];
    expect(summaryParts(summarize(rows)).map((p) => [p.text, p.tone])).toEqual([
      ['will be renamed', 'strong'],
      ['will only get new dates', 'neutral'],
      ['is missing a value', 'warn'],
      ['moves to another drive', 'warn'],
      ["couldn't be read", 'warn'],
      ['has no date taken', 'warn'],
    ]);
  });

  it('counts a file once per flag even when the flag repeats on it', () => {
    const twice = row({ flags: [flag('missing-value', 'warning', 'artist'), flag('missing-value', 'warning', 'album')] });
    expect(summarize([twice]).counts['missing-value']).toBe(1);
  });
});
