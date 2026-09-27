import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPlan, type PlanInput } from '../../src/core/planner.js';
import {
  DEFAULT_SETTINGS,
  type FileEntry,
  type FileMetadata,
  type FsView,
  type Platform,
  type RenameSettings,
} from '../../src/core/types.js';
import { makeEntry, makeMeta, wc } from './helpers.js';

type SettingsPatch = { pattern?: string } & {
  [K in Exclude<keyof RenameSettings, 'pattern'>]?: Partial<RenameSettings[K]>;
};

function settings(patch: SettingsPatch): RenameSettings {
  return {
    ...DEFAULT_SETTINGS,
    pattern: patch.pattern ?? DEFAULT_SETTINGS.pattern,
    sequence: { ...DEFAULT_SETTINGS.sequence, ...patch.sequence },
    findReplace: (patch.findReplace as RenameSettings['findReplace'] | undefined) ?? [],
    cleanup: { ...DEFAULT_SETTINGS.cleanup, ...patch.cleanup },
    move: { ...DEFAULT_SETTINGS.move, ...patch.move },
    dates: { ...DEFAULT_SETTINGS.dates, ...patch.dates },
    filter: { ...DEFAULT_SETTINGS.filter, ...patch.filter },
  };
}

function fakeFs(
  dirs: Record<string, string[]>,
  opts: { devs?: Record<string, number>; readOnly?: string[] } = {},
): FsView {
  return {
    listDir: (dir) => dirs[dir] ?? null,
    nearestExisting: (p) => {
      let c = p;
      while (!(c in dirs) && c !== '/') c = path.posix.dirname(c);
      return c;
    },
    deviceOf: (p) => opts.devs?.[p] ?? 1,
    isWritableDir: (d) => !(opts.readOnly ?? []).includes(d),
  };
}

function plan(
  entries: FileEntry[],
  patch: SettingsPatch,
  metas: Record<string, Partial<FileMetadata>> = {},
  fs: FsView = fakeFs({ '/photos': entries.map((e) => path.posix.basename(e.path)) }),
  platform: Platform = 'darwin',
  extra: Partial<PlanInput> = {},
) {
  const metadata = new Map(Object.entries(metas).map(([p, m]) => [p, makeMeta(m)]));
  for (const e of entries) if (!metadata.has(e.path)) metadata.set(e.path, makeMeta());
  return buildPlan({ entries, metadata, settings: settings(patch), fs, platform, timeZone: 'UTC', path: path.posix, planId: 'p1', ...extra });
}

const targets = (p: ReturnType<typeof plan>) => p.items.map((i) => path.posix.basename(i.target));
const codes = (p: ReturnType<typeof plan>, i: number) => p.items[i]?.flags.map((f) => f.code) ?? [];

describe('buildPlan: naming', () => {
  const a = makeEntry('/photos/IMG_4822.HEIC');
  const b = makeEntry('/photos/IMG_4821.HEIC');
  const shot = makeEntry('/photos/Screenshot.png');
  const metas = {
    [a.path]: { dateTaken: wc(2024, 7, 4, 14, 31) },
    [b.path]: { dateTaken: wc(2024, 7, 4, 14, 30) },
    [shot.path]: { created: wc(2024, 7, 5, 9, 12) },
  };

  it('renders the headline example in date order', () => {
    const p = plan([a, b, shot], { pattern: 'Hawaii_{date_taken:YYYY-MM-DD}_{seq:3}' }, metas);
    expect(targets(p)).toEqual(['Hawaii_2024-07-04_001.HEIC', 'Hawaii_2024-07-04_002.HEIC', 'Hawaii_2024-07-05_003.png']);
    expect(p.items.map((i) => i.kind)).toEqual(['rename', 'rename', 'rename']);
    expect(codes(p, 2)).toEqual(['fallback-date']);
    expect(p.items[2]?.dateUsed).toEqual({ value: wc(2024, 7, 5, 9, 12), source: 'created' });
    expect(p.errorCount).toBe(0);
    expect(p.id).toBe('p1');
  });

  it('numbers {seq} from the Sequence tab\'s Start at, padded to its Digits', () => {
    const p = plan([a, b, shot], { pattern: 'Hawaii_{seq}', sequence: { start: 3, digits: 6 } }, metas);
    expect(targets(p)).toEqual(['Hawaii_000003.HEIC', 'Hawaii_000004.HEIC', 'Hawaii_000005.png']);
  });

  it('lowercases the extension only when asked', () => {
    const p = plan([b], { pattern: 'x', cleanup: { lowercaseExtension: true } }, metas);
    expect(targets(p)).toEqual(['x.heic']);
  });

  it('applies find & replace before {name}', () => {
    const p = plan([b], { pattern: '{name}', findReplace: [{ find: 'IMG', replace: 'Hawaii', regex: false, matchCase: false }] }, metas);
    expect(targets(p)).toEqual(['Hawaii_4821.HEIC']);
  });

  it('marks unchanged files', () => {
    expect(plan([b], { pattern: '{name}' }).items[0]?.kind).toBe('unchanged');
  });

  it('treats a case-only change as a rename, not a conflict', () => {
    const e = makeEntry('/photos/img.jpg');
    const p = plan([e], { pattern: '{name}', cleanup: { caseMode: 'upper' } });
    expect(targets(p)).toEqual(['IMG.jpg']);
    expect(p.items[0]?.kind).toBe('rename');
    expect(codes(p, 0)).toEqual([]);
  });

  it('turns every file into an error when the pattern is invalid', () => {
    const p = plan([a, b], { pattern: '{nope}' });
    expect(p.patternError).toBe('Unknown token "{nope}"');
    expect(p.items.map((i) => i.kind)).toEqual(['error', 'error']);
    expect(p.items[0]?.target).toBe(p.items[0]?.source.path);
    expect(p.errorCount).toBe(2);
  });

  it('turns every file into an error when a regex rule is invalid', () => {
    const p = plan([a], { pattern: '{name}', findReplace: [{ find: '(', replace: '', regex: true, matchCase: false }] });
    expect(p.patternError).toMatch(/^Find & replace rule 1: /);
  });

  it('flags an empty name as an error', () => {
    const p = plan([a], { pattern: '{artist}' });
    expect(p.items[0]?.kind).toBe('error');
    expect(codes(p, 0)).toEqual(['missing-value', 'empty-segment']);
  });
});

describe('buildPlan: conflicts', () => {
  const files = ['/photos/a.jpg', '/photos/b.jpg', '/photos/c.jpg'].map((p) => makeEntry(p));

  it('suffixes later files in sequence order', () => {
    const p = plan(files, { pattern: 'Trip', sequence: { sortBy: 'name' } });
    expect(targets(p)).toEqual(['Trip.jpg', 'Trip_2.jpg', 'Trip_3.jpg']);
    expect(codes(p, 0)).toEqual([]);
    expect(codes(p, 1)).toEqual(['suffix-added']);
  });

  it('keeps names of files on disk that are not in the batch, comparing case-insensitively', () => {
    const fs = fakeFs({ '/photos': ['a.jpg', 'TRIP.JPG'] });
    const p = plan([files[0]!], { pattern: 'Trip' }, {}, fs);
    expect(targets(p)).toEqual(['Trip_2.jpg']);
  });

  it('detects a conflict with an NFC-equivalent name already on disk', () => {
    // On disk: "Cafe" + U+0301 (combining acute accent) = NFD. The pattern renders the
    // precomposed form "Caf" + U+00E9 = NFC. nameKey() normalizes both, so they must collide.
    const decomposed = `Cafe\u0301.jpg`;
    const precomposed = `Caf\u00e9`;
    const fs = fakeFs({ '/photos': ['original.jpg', decomposed] });
    const p = plan([makeEntry('/photos/original.jpg')], { pattern: precomposed }, {}, fs);
    expect(targets(p)).toEqual([`${precomposed}_2.jpg`]);
    expect(codes(p, 0)).toEqual(['suffix-added']);
  });

  it('does not mix up folders whose names contain spaces when picking suffixes', () => {
    // '/Trip' + '2024 Beach.jpg' and '/Trip 2024' + 'Beach.jpg' read the same when joined
    // with a space. Neither file needs a new name, so neither may get a suffix.
    const a = makeEntry('/Trip/2024 Beach.jpg');
    const b = makeEntry('/Trip 2024/Beach.jpg');
    const fs = fakeFs({ '/Trip': ['2024 Beach.jpg'], '/Trip 2024': ['Beach.jpg'] });
    const p = plan([a, b], { pattern: '{name}' }, {}, fs);
    expect(p.items.map((i) => [i.kind, i.flags.map((f) => f.code)])).toEqual([
      ['unchanged', []],
      ['unchanged', []],
    ]);
  });

  it('keeps stem and extension apart when picking suffixes', () => {
    // 'a.b' + '.c' and 'a.b.c' (no extension) share a full name but take suffixes in different
    // places, so one's search must not skip the other's free 'a.b.c_2'.
    const withExtension = makeEntry('/p/a1.c');
    const noExtension = makeEntry('/p/zz');
    const fs = fakeFs({ '/p': ['a1.c', 'zz', 'a.b.c', 'a.b_2.c'] });
    const p = plan([withExtension, noExtension], {
      pattern: '{name}',
      sequence: { sortBy: 'name' },
      findReplace: [
        { find: '^a1$', replace: 'a.b', regex: true, matchCase: true },
        { find: '^zz$', replace: 'a.b.c', regex: true, matchCase: true },
      ],
    }, {}, fs);
    expect(targets(p)).toEqual(['a.b_3.c', 'a.b.c_2']);
  });

  it('lets batch files take names that other batch files are giving up (swap)', () => {
    const one = makeEntry('/photos/1.jpg');
    const two = makeEntry('/photos/2.jpg');
    const p = plan([one, two], { pattern: '{seq:1}', sequence: { sortBy: 'dateTaken' } }, {
      [one.path]: { dateTaken: wc(2024, 7, 5) },
      [two.path]: { dateTaken: wc(2024, 7, 4) },
    });
    expect(p.items.map((i) => [path.posix.basename(i.source.path), path.posix.basename(i.target)]))
      .toEqual([['2.jpg', '1.jpg'], ['1.jpg', '2.jpg']]);
    expect(p.items.every((i) => i.flags.length === 0)).toBe(true);
  });
});

describe('buildPlan: same-name groups', () => {
  const nef = makeEntry('/photos/DSC_0193.NEF');
  const jpg = makeEntry('/photos/DSC_0193.JPG');
  const next = makeEntry('/photos/DSC_0194.JPG');
  const metas = {
    [nef.path]: { dateTaken: wc(2024, 7, 4, 16, 5) },
    [jpg.path]: { dateTaken: wc(2024, 7, 4, 16, 5) },
    [next.path]: { dateTaken: wc(2024, 7, 4, 16, 6) },
  };

  it('gives a pair one sequence number and a Paired flag', () => {
    const p = plan([jpg, next, nef], { pattern: 'Trip_{seq:3}' }, metas);
    expect(targets(p)).toEqual(['Trip_001.NEF', 'Trip_001.JPG', 'Trip_002.JPG']);
    expect(p.items[0]?.groupId).toBe(p.items[1]?.groupId);
    expect(p.items[0]?.groupId).not.toBeNull();
    expect(p.items[2]?.groupId).toBeNull();
    expect(codes(p, 0)).toEqual(['paired']);
  });

  it('gives the whole pair the same suffix', () => {
    const fs = fakeFs({ '/photos': ['DSC_0193.NEF', 'DSC_0193.JPG', 'Trip_001.JPG'] });
    const p = plan([jpg, nef], { pattern: 'Trip_{seq:3}' }, metas, fs);
    expect(targets(p)).toEqual(['Trip_001_2.NEF', 'Trip_001_2.JPG']);
  });

  it('numbers each file separately when the option is off', () => {
    const p = plan([jpg, nef], { pattern: 'Trip_{seq:3}', sequence: { keepGroupsTogether: false } }, metas);
    expect(targets(p).sort()).toEqual(['Trip_001.JPG', 'Trip_002.NEF']);
  });

  it('splits a same-name group whose members would render identical names', () => {
    // Linux-style: same stem, extension differs only by case. With lowercaseExtension the
    // two members of one group would otherwise both render to "IMG.jpg".
    const upper = makeEntry('/photos/IMG.JPG');
    const lower = makeEntry('/photos/IMG.jpg');
    const fs = fakeFs({ '/photos': ['IMG.JPG', 'IMG.jpg'] });
    const p = plan([upper, lower], { pattern: '{name}', cleanup: { lowercaseExtension: true } }, {}, fs);
    expect(p.items).toHaveLength(2);
    expect(p.items.every((i) => i.kind !== 'error')).toBe(true);
    const distinct = new Set(p.items.map((i) => i.target));
    expect(distinct.size).toBe(2);
  });
});

describe('buildPlan: moving', () => {
  const e = makeEntry('/photos/IMG.jpg');
  const metas = { [e.path]: { dateTaken: wc(2024, 7, 4) } };

  it('moves into folders from the pattern, relative to the current folder', () => {
    const p = plan([e], { pattern: '{date_taken:YYYY}/{name}' }, metas);
    expect(p.items[0]?.target).toBe('/photos/2024/IMG.jpg');
    expect(p.items[0]?.kind).toBe('move');
  });

  it('moves relative to a chosen destination, even without a separator', () => {
    const fs = fakeFs({ '/photos': ['IMG.jpg'], '/sorted': [] });
    expect(plan([e], { pattern: '{name}', move: { destinationRoot: '/sorted' } }, metas, fs).items[0]?.target)
      .toBe('/sorted/IMG.jpg');
  });

  it('flags a move to another drive', () => {
    const fs = fakeFs({ '/photos': ['IMG.jpg'], '/ext': [] }, { devs: { '/ext': 2 } });
    const p = plan([e], { pattern: '{date_taken:YYYY}/{name}', move: { destinationRoot: '/ext' } }, metas, fs);
    expect(p.items[0]?.kind).toBe('cross-drive-move');
    expect(codes(p, 0)).toEqual(['cross-drive']);
  });

  it('flags an unwritable destination as an error', () => {
    const fs = fakeFs({ '/photos': ['IMG.jpg'] }, { readOnly: ['/photos'] });
    const p = plan([e], { pattern: 'x' }, metas, fs);
    expect(p.items[0]?.kind).toBe('error');
    expect(codes(p, 0)).toEqual(['destination-unwritable']);
  });

  it('checks the 260-character limit only on Windows', () => {
    const root = `/${'d'.repeat(250)}`;
    const fs = fakeFs({ '/photos': ['IMG.jpg'], [root]: [] });
    const patch = { pattern: '{name}_long_name', move: { destinationRoot: root } };
    expect(plan([e], patch, metas, fs, 'win32').items[0]?.kind).toBe('error');
    expect(plan([e], patch, metas, fs, 'darwin').items[0]?.kind).toBe('move');
  });

  it('treats a destination with a trailing slash as the same folder', () => {
    // A real filesystem's readdir tolerates a trailing slash and returns the same listing;
    // the fake mirrors that here so the un-normalized '/photos/' key resolves too.
    const fs = fakeFs({ '/photos': ['IMG.jpg'], '/photos/': ['IMG.jpg'] });
    const p = plan([e], { pattern: '{name}', move: { destinationRoot: '/photos/' } }, metas, fs);
    expect(p.items[0]?.kind).toBe('unchanged');
    expect(p.items[0]?.flags).toEqual([]);
  });

  it('rejects a relative destination', () => {
    const fs = fakeFs({ '/photos': ['IMG.jpg'] });
    const p = plan([e], { pattern: '{name}', move: { destinationRoot: 'out' } }, metas, fs);
    expect(p.items.map((i) => i.kind)).toEqual(['error']);
    expect(codes(p, 0)).toEqual(['destination-unwritable']);
    expect(p.items[0]?.flags[0]?.message).toBe('The destination folder must be a full path');
  });
});

describe('buildPlan: file dates', () => {
  const e = makeEntry('/photos/IMG.jpg');
  const noDate = makeEntry('/photos/shot.png');
  const taken = wc(2024, 7, 4, 14, 30);
  const metas = { [e.path]: { dateTaken: taken } };
  const patch = { pattern: '{name}', dates: { setModified: true, setCreated: true } };

  it('plans both dates on macOS and Windows', () => {
    expect(plan([e], patch, metas).items[0]?.setDates).toEqual({ modified: taken, created: taken });
  });
  it('never plans a created date on Linux', () => {
    const fs = fakeFs({ '/photos': ['IMG.jpg'] });
    expect(plan([e], patch, metas, fs, 'linux').items[0]?.setDates).toEqual({ modified: taken });
  });
  it('skips files with no real date taken and flags them', () => {
    const p = plan([noDate], patch);
    expect(p.items[0]?.setDates).toEqual({});
    expect(codes(p, 0)).toEqual(['no-date-taken']);
  });
  it('does not flag a missing date taken on Linux when only the created date, which Linux never sets, was asked for', () => {
    const createdOnly = { pattern: '{name}', dates: { setModified: false, setCreated: true } };
    const linux = plan([noDate], createdOnly, {}, undefined, 'linux');
    expect(linux.items[0]?.setDates).toEqual({});
    expect(codes(linux, 0)).toEqual([]);
    expect(linux.items[0]?.kind).toBe('unchanged');

    const mac = plan([noDate], createdOnly, {}, undefined, 'darwin');
    expect(codes(mac, 0)).toEqual(['no-date-taken']);
  });
});

describe('buildPlan: metadata', () => {
  it('falls back to filesystem dates for files not read yet', () => {
    const e = makeEntry('/photos/IMG.jpg', { mtimeMs: Date.UTC(2024, 6, 9, 12), birthtimeMs: null });
    const p = buildPlan({
      entries: [e], metadata: new Map(), settings: settings({ pattern: '{date_taken}' }),
      fs: fakeFs({ '/photos': ['IMG.jpg'] }), platform: 'darwin', timeZone: 'UTC', path: path.posix,
    });
    expect(targets(p)).toEqual(['2024-07-09.jpg']);
  });

  it('warns when metadata could not be read', () => {
    const e = makeEntry('/photos/IMG.jpg');
    const p = plan([e], { pattern: '{name}' }, { [e.path]: { readError: 'corrupt file' } });
    expect(p.items[0]?.flags).toContainEqual({
      level: 'warning', code: 'metadata-unreadable', message: "Couldn't read metadata: corrupt file",
    });
  });
});

describe('buildPlan: excluded files', () => {
  const a = makeEntry('/photos/IMG_4822.HEIC');
  const b = makeEntry('/photos/IMG_4821.HEIC');
  const shot = makeEntry('/photos/Screenshot.png');
  const metas = {
    [a.path]: { dateTaken: wc(2024, 7, 4, 14, 31) },
    [b.path]: { dateTaken: wc(2024, 7, 4, 14, 30) },
    [shot.path]: { created: wc(2024, 7, 5, 9, 12) },
  };
  const exclude = (entries: FileEntry[], patch: SettingsPatch, excluded: string[], m = metas, fs?: FsView) =>
    plan(entries, patch, m, fs ?? fakeFs({ '/photos': entries.map((e) => path.posix.basename(e.path)) }), 'darwin', {
      excluded: new Set(excluded),
    });

  it('keeps an excluded file in its place, unchanged, and numbers the rest without it', () => {
    const p = exclude([a, b, shot], { pattern: 'Hawaii_{seq:3}' }, [b.path]);
    expect(targets(p)).toEqual(['IMG_4821.HEIC', 'Hawaii_001.HEIC', 'Hawaii_002.png']);
    expect(p.items.map((i) => i.kind)).toEqual(['excluded', 'rename', 'rename']);
    expect(p.items[0]).toMatchObject({ target: b.path, flags: [], groupId: null, dateUsed: null, setDates: {} });
    expect(p.errorCount).toBe(0);
  });

  it('never plans new dates for an excluded file', () => {
    const p = exclude([a], { pattern: '{name}', dates: { setModified: true, setCreated: true } }, [a.path]);
    expect(p.items[0]?.setDates).toEqual({});
  });

  it('keeps an excluded file\'s name taken, so no other file can land on it', () => {
    const x = makeEntry('/photos/a.jpg');
    const y = makeEntry('/photos/b.jpg');
    const rule = [{ find: 'b', replace: 'a', regex: false, matchCase: false }];
    const p = exclude([x, y], { pattern: '{name}', findReplace: rule, sequence: { sortBy: 'name' } }, [x.path]);
    expect(targets(p)).toEqual(['a.jpg', 'a_2.jpg']);
    expect(p.items.map((i) => i.kind)).toEqual(['excluded', 'rename']);
  });

  it('keeps an excluded file even when the pattern is invalid, and does not count it as an error', () => {
    const p = exclude([a, b], { pattern: '{nope}' }, [a.path]);
    expect(p.items.map((i) => i.kind)).toEqual(['error', 'excluded']);
    expect(p.errorCount).toBe(1);
  });

  describe('in a same-name group', () => {
    const nef = makeEntry('/photos/DSC_0193.NEF');
    const jpg = makeEntry('/photos/DSC_0193.JPG');
    const mov = makeEntry('/photos/DSC_0193.MOV');
    const next = makeEntry('/photos/DSC_0194.JPG');
    const groupMetas = {
      [nef.path]: { dateTaken: wc(2024, 7, 4, 16, 5) },
      [jpg.path]: { dateTaken: wc(2024, 7, 4, 16, 5) },
      [mov.path]: { dateTaken: wc(2024, 7, 4, 16, 5) },
      [next.path]: { dateTaken: wc(2024, 7, 4, 16, 6) },
    };

    it('renames the rest of the group without pairing it to the excluded member', () => {
      const p = exclude([jpg, next, nef], { pattern: 'Trip_{seq:3}' }, [jpg.path], groupMetas);
      expect(targets(p)).toEqual(['Trip_001.NEF', 'DSC_0193.JPG', 'Trip_002.JPG']);
      expect(p.items.map((i) => i.kind)).toEqual(['rename', 'excluded', 'rename']);
      expect(p.items[0]?.groupId).toBeNull();
      expect(codes(p, 0)).toEqual([]);
    });

    it('gives a fully excluded group no number', () => {
      const p = exclude([jpg, next, nef], { pattern: 'Trip_{seq:3}' }, [jpg.path, nef.path], groupMetas);
      expect(targets(p)).toEqual(['DSC_0193.NEF', 'DSC_0193.JPG', 'Trip_001.JPG']);
    });

    it('still gives the members either side of an excluded one the same suffix, in their places', () => {
      const fs = fakeFs({ '/photos': ['DSC_0193.NEF', 'DSC_0193.JPG', 'DSC_0193.MOV', 'Trip_001.NEF'] });
      const p = exclude([nef, jpg, mov], { pattern: 'Trip_{seq:3}' }, [jpg.path], groupMetas, fs);
      expect(targets(p)).toEqual(['Trip_001_2.NEF', 'DSC_0193.JPG', 'Trip_001_2.MOV']);
      expect(p.items[0]?.groupId).toBe(p.items[2]?.groupId);
      expect(p.items[0]?.groupId).not.toBeNull();
    });

    it('takes the group\'s date from an included member when the usual one is excluded', () => {
      const m = { ...groupMetas, [nef.path]: { dateTaken: wc(2020, 1, 1) }, [jpg.path]: { dateTaken: wc(2024, 7, 4, 16, 5) } };
      const p = exclude([nef, jpg], { pattern: '{date_taken:YYYY}' }, [nef.path], m);
      expect(targets(p)).toEqual(['DSC_0193.NEF', '2024.JPG']);
    });
  });
});

describe('buildPlan: sequence direction, step and restart', () => {
  const a = makeEntry('/photos/a.jpg');
  const b = makeEntry('/photos/b.jpg');
  const metas = { '/photos/a.jpg': { dateTaken: wc(2024, 7, 4, 10) }, '/photos/b.jpg': { dateTaken: wc(2024, 7, 5, 10) } };
  it('numbers newest first with a step', () => {
    const p = plan([a, b], { pattern: '{seq}', sequence: { direction: 'desc', step: 10 } }, metas);
    expect(p.items.map((i) => [path.posix.basename(i.source.path), path.posix.basename(i.target)])).toEqual([['b.jpg', '001.jpg'], ['a.jpg', '011.jpg']]);
  });
  it('restarts each day', () => {
    const p = plan([a, b], { pattern: '{seq}', sequence: { restartEvery: 'day' } }, metas);
    expect(targets(p)).toEqual(['001.jpg', '001_2.jpg']);
  });
  it('restarts each day by date taken even when sorting by name', () => {
    const p = plan([a, b], { pattern: '{date_taken:DD}_{seq}', sequence: { sortBy: 'name', restartEvery: 'day' } }, metas);
    expect(targets(p)).toEqual(['04_001.jpg', '05_001.jpg']);
  });
  it('follows a manual order', () => {
    const p = plan([a, b], { pattern: '{seq}', sequence: { sortBy: 'manual' } }, metas, undefined, undefined, { manualOrder: ['/photos/b.jpg', '/photos/a.jpg'] });
    expect(p.items.map((i) => [path.posix.basename(i.source.path), path.posix.basename(i.target)])).toEqual([['b.jpg', '001.jpg'], ['a.jpg', '002.jpg']]);
  });
});

describe('buildPlan: find & replace, extension rules and ASCII', () => {
  const e = makeEntry('/photos/IMG_1.JPEG');
  it('applies result-scope rules to the rendered name, and original-scope rules to the stem', () => {
    const result = plan([e], { pattern: 'Trip_{seq}', findReplace: [{ find: 'Trip', replace: 'Hawaii', regex: false, matchCase: true, scope: 'result' }] });
    expect(targets(result)).toEqual(['Hawaii_001.JPEG']);
    const original = plan([e], { pattern: 'Trip_{seq}', findReplace: [{ find: 'Trip', replace: 'Hawaii', regex: false, matchCase: true }] });
    expect(targets(original)).toEqual(['Trip_001.JPEG']);
    const both = plan([e], { pattern: '{name}', findReplace: [{ find: 'IMG', replace: 'x', regex: false, matchCase: true }, { find: '^x_(\\d+)$', replace: 'photo-$1', regex: true, matchCase: true, scope: 'result' }] });
    expect(targets(both)).toEqual(['photo-1.JPEG']);
  });
  it('applies extension rules before the lowercase option', () => {
    expect(targets(plan([e], { pattern: '{name}', cleanup: { extensionRules: [{ from: 'jpeg', to: 'jpg' }] } }))).toEqual(['IMG_1.jpg']);
    expect(targets(plan([e], { pattern: '{name}', cleanup: { extensionRules: [{ from: 'jpeg', to: '' }] } }))).toEqual(['IMG_1']);
    expect(targets(plan([e], { pattern: '{name}', cleanup: { extensionRules: [{ from: 'png', to: 'x' }], lowercaseExtension: true } }))).toEqual(['IMG_1.jpeg']);
  });
  it('strips accents and forces ASCII when asked', () => {
    const f = makeEntry('/photos/Café.jpg');
    expect(targets(plan([f], { pattern: '{name}', cleanup: { stripDiacritics: true } }))).toEqual(['Cafe.jpg']);
    const g = makeEntry('/photos/日本 Café.jpg');
    expect(targets(plan([g], { pattern: '{name}', cleanup: { asciiOnly: true, spacesToUnderscores: true } }))).toEqual(['_Cafe.jpg']);
  });
});

describe('buildPlan: name dates and date shift', () => {
  const e = makeEntry('/photos/a.jpg');
  it('shifts the date taken wherever it is used', () => {
    const p = plan([e], { pattern: '{date_taken:HH-mm}', dates: { shiftMinutes: -60 } }, { '/photos/a.jpg': { dateTaken: wc(2024, 7, 4, 14, 30) } });
    expect(targets(p)).toEqual(['13-30.jpg']);
    expect(p.items[0]?.dateUsed).toEqual({ value: wc(2024, 7, 4, 13, 30), source: 'taken' });
    const dated = plan([e], { pattern: '{name}', dates: { setModified: true, shiftMinutes: -60 } }, { '/photos/a.jpg': { dateTaken: wc(2024, 7, 4, 14, 30) } });
    expect(dated.items[0]?.setDates.modified).toEqual(wc(2024, 7, 4, 13, 30));
  });
  it('uses a date from the name unless that is turned off', () => {
    const metas = { '/photos/a.jpg': { nameDate: wc(2024, 1, 2, 10, 11, 12) } };
    const on = plan([e], { pattern: '{date_taken}' }, metas);
    expect(targets(on)).toEqual(['2024-01-02.jpg']);
    expect(on.items[0]?.dateUsed?.source).toBe('name');
    expect(codes(on, 0)).toContain('fallback-date');
    const off = plan([e], { pattern: '{date_taken}', dates: { useNameDate: false } }, metas);
    expect(targets(off)).toEqual(['2024-08-01.jpg']);
    expect(off.items[0]?.dateUsed?.source).toBe('modified');
  });
});

describe('buildPlan: typed names', () => {
  const a = makeEntry('/photos/a.jpg');
  const b = makeEntry('/photos/b.jpg');
  it('replaces the rendered name, keeps cleanup and adds the Edited flag', () => {
    const p = plan([a, b], { pattern: '{artist}', cleanup: { caseMode: 'upper' } }, {}, undefined, undefined, { overrides: new Map([['/photos/a.jpg', 'beach day']]) });
    expect(targets(p)).toEqual(['BEACH DAY.jpg', 'b.jpg']);
    expect(codes(p, 0)).toEqual(['edited']);
    expect(codes(p, 1)).toEqual(['missing-value', 'empty-segment']);
  });
  it('gives a same-name group the override of any member', () => {
    const nef = makeEntry('/photos/DSC_1.NEF');
    const jpg = makeEntry('/photos/DSC_1.JPG');
    const p = plan([nef, jpg], { pattern: '{name}' }, {}, undefined, undefined, { overrides: new Map([['/photos/DSC_1.JPG', 'sunset']]) });
    expect(targets(p)).toEqual(['sunset.NEF', 'sunset.JPG']);
  });
  it('ignores a blank override', () => {
    const p = plan([a], { pattern: '{name}' }, {}, undefined, undefined, { overrides: new Map([['/photos/a.jpg', '  ']]) });
    expect(targets(p)).toEqual(['a.jpg']);
    expect(codes(p, 0)).toEqual([]);
  });
});

describe('buildPlan: folder mode', () => {
  const sub = makeEntry('/photos/sub', { isDir: true, stem: 'sub', ext: '' });
  const trip = makeEntry('/photos/Trip 2024', { isDir: true, stem: 'Trip 2024', ext: '' });
  const fs = fakeFs({ '/photos': ['sub', 'Trip 2024'], '/photos/sub': [], '/photos/Trip 2024': [], '/ext': [] }, { devs: { '/ext': 2 } });
  it('renames folders without an extension', () => {
    const p = plan([sub, trip], { pattern: 'Album_{seq}', sequence: { sortBy: 'name' }, cleanup: { lowercaseExtension: true, extensionRules: [{ from: '', to: 'x' }] } }, {}, fs);
    expect(p.items.map((i) => i.target)).toEqual(['/photos/Album_001', '/photos/Album_002']);
    expect(p.items.map((i) => i.kind)).toEqual(['rename', 'rename']);
  });
  it('refuses to move a folder to another drive or into itself', () => {
    const drive = plan([sub], { pattern: '{name}', move: { destinationRoot: '/ext' } }, {}, fs);
    expect(drive.items[0]?.kind).toBe('error');
    expect(codes(drive, 0)).toEqual(['folder-cross-drive']);
    const inside = plan([sub], { pattern: '{name}/{name}' }, {}, fs);
    expect(inside.items[0]?.kind).toBe('error');
    expect(codes(inside, 0)).toEqual(['destination-unwritable']);
  });
  it('does not warn folders about a missing date taken', () => {
    const p = plan([sub], { pattern: '{name}', dates: { setModified: true } }, {}, fs);
    expect(codes(p, 0)).toEqual([]);
    expect(p.items[0]?.setDates).toEqual({});
  });
});
