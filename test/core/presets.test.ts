import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PresetStore, withDefaults } from '../../src/core/presets.js';
import { DEFAULT_SETTINGS } from '../../src/core/types.js';

const root = mkdtempSync(path.join(tmpdir(), 'renami-presets-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let n = 0;
const freshFile = () => path.join(root, `case-${(n += 1)}`, 'nested', 'presets.json');

const vacation = { ...DEFAULT_SETTINGS, pattern: 'Hawaii_{date_taken:YYYY-MM-DD}_{seq:3}' };

describe('PresetStore', () => {
  it('lists nothing when the file does not exist', async () => {
    expect(await new PresetStore(freshFile()).list()).toEqual([]);
  });

  it('saves (creating folders), lists sorted by name, and writes version 1', async () => {
    const file = freshFile();
    const store = new PresetStore(file);
    await store.save('Vacation photos', vacation);
    await store.save('Music library', { ...DEFAULT_SETTINGS, pattern: '{artist}/{album}/{track:2} {title}' });
    expect((await store.list()).map((p) => p.name)).toEqual(['Music library', 'Vacation photos']);
    expect(JSON.parse(readFileSync(file, 'utf8')).version).toBe(1);
  });

  it('replaces a preset with the same name, ignoring case', async () => {
    const store = new PresetStore(freshFile());
    await store.save('Vacation', vacation);
    await store.save('vacation', { ...vacation, pattern: '{name}' });
    const presets = await store.list();
    expect(presets).toHaveLength(1);
    expect(presets[0]).toEqual({ name: 'vacation', settings: { ...vacation, pattern: '{name}' } });
  });

  it('removes by name, ignoring case', async () => {
    const store = new PresetStore(freshFile());
    await store.save('Vacation', vacation);
    await store.remove('VACATION');
    expect(await store.list()).toEqual([]);
  });

  it('rejects an empty name', async () => {
    await expect(new PresetStore(freshFile()).save('  ', vacation)).rejects.toThrow(/needs a name/);
  });

  it('fills settings missing from older files with defaults', async () => {
    const file = path.join(root, 'old.json');
    writeFileSync(file, JSON.stringify({ version: 1, presets: [{ name: 'Old', settings: { pattern: '{seq}', sequence: { digits: 4 } } }] }));
    const [preset] = await new PresetStore(file).list();
    expect(preset?.settings).toEqual({
      ...DEFAULT_SETTINGS,
      pattern: '{seq}',
      sequence: { ...DEFAULT_SETTINGS.sequence, digits: 4 },
    });
  });

  it('explains a damaged file instead of silently dropping presets', async () => {
    const file = path.join(root, 'broken.json');
    writeFileSync(file, '{ not json');
    await expect(new PresetStore(file).list()).rejects.toThrow(/presets file is damaged/i);
  });

  it('does not lose updates when saves overlap', async () => {
    const file = freshFile();
    const store = new PresetStore(file);
    const settingsA = { ...DEFAULT_SETTINGS, pattern: 'A' };
    const settingsB = { ...DEFAULT_SETTINGS, pattern: 'B' };
    await Promise.all([store.save('A', settingsA), store.save('B', settingsB), store.remove('A')]);
    const presets = await store.list();
    expect(presets).toHaveLength(1);
    expect(presets[0]?.name).toBe('B');
  });

  it('does not lose updates with 20 overlapping saves of distinct names', async () => {
    const file = freshFile();
    const store = new PresetStore(file);
    const saves = Array.from({ length: 20 }, (_, i) => {
      const name = String.fromCharCode(65 + i); // A-T
      return store.save(name, { ...DEFAULT_SETTINGS, pattern: name });
    });
    await Promise.all(saves);
    const presets = await store.list();
    expect(presets).toHaveLength(20);
    expect(presets.map((p) => p.name).sort()).toEqual(
      Array.from({ length: 20 }, (_, i) => String.fromCharCode(65 + i))
    );
  });

  it('keeps entries it cannot read when saving', async () => {
    const file = freshFile();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        presets: [{ name: 'Old', settings: { pattern: '{seq}' } }, 42, { settings: {} }],
      })
    );
    const store = new PresetStore(file);
    const settingsNew = { ...DEFAULT_SETTINGS, pattern: 'New' };
    await store.save('New', settingsNew);

    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    expect(parsed.presets).toContainEqual(42);
    expect(parsed.presets).toContainEqual({ settings: {} });

    const listed = await store.list();
    expect(listed.map((p) => p.name).sort()).toEqual(['New', 'Old']);
  });

  it('replaces wrongly typed settings with defaults', async () => {
    const file = freshFile();
    mkdirSync(path.dirname(file), { recursive: true });
    const store = new PresetStore(file);
    const badSettings = {
      pattern: 7,
      sequence: { digits: '3', start: 2, sortBy: 'size' },
      cleanup: { caseMode: 'loud' },
      filter: { extensions: 'jpg' },
      findReplace: [
        { find: 'a', replace: 'b', regex: false, matchCase: false },
        { find: 1 },
      ],
    };
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        presets: [{ name: 'Bad', settings: badSettings }],
      })
    );
    const [preset] = await store.list();
    expect(preset?.settings.pattern).toBe(DEFAULT_SETTINGS.pattern);
    expect(preset?.settings.sequence.digits).toBe(DEFAULT_SETTINGS.sequence.digits);
    expect(preset?.settings.sequence.start).toBe(2);
    expect(preset?.settings.sequence.sortBy).toBe(DEFAULT_SETTINGS.sequence.sortBy);
    expect(preset?.settings.cleanup.caseMode).toBe('none');
    expect(preset?.settings.filter.extensions).toBe(null);
    expect(preset?.settings.findReplace).toHaveLength(1);
    expect(preset?.settings.findReplace[0]).toEqual({
      find: 'a',
      replace: 'b',
      regex: false,
      matchCase: false,
    });
  });

  it('round-trips non-default valid settings', async () => {
    const file = freshFile();
    const store = new PresetStore(file);
    const nonDefaultSettings: typeof DEFAULT_SETTINGS = {
      pattern: '{name}_{seq:2}',
      sequence: {
        sortBy: 'modified',
        direction: 'desc',
        start: 5,
        step: 2,
        digits: 4,
        restartPerFolder: true,
        restartEvery: 'day',
        keepGroupsTogether: false,
      },
      findReplace: [
        { find: 'old', replace: 'new', regex: false, matchCase: true },
        { find: '^test', replace: 'prod', regex: true, matchCase: false, scope: 'result' },
      ],
      cleanup: {
        caseMode: 'upper',
        spacesToUnderscores: true,
        lowercaseExtension: true,
        stripDiacritics: true,
        asciiOnly: true,
        extensionRules: [{ from: 'jpeg', to: 'jpg' }],
      },
      move: {
        destinationRoot: '/custom/path',
      },
      dates: {
        setModified: true,
        setCreated: true,
        shiftMinutes: -60,
        useNameDate: false,
      },
      filter: {
        includeSubfolders: true,
        extensions: ['jpg', 'png', 'gif'],
        mode: 'folders',
        name: { text: 'IMG', regex: true },
        minBytes: 1024,
        maxBytes: 1_048_576,
        modifiedFrom: '2024-01-01',
        modifiedTo: '2024-12-31',
      },
    };
    await store.save('FullConfig', nonDefaultSettings);
    const [preset] = await store.list();
    expect(preset?.settings).toEqual(nonDefaultSettings);
  });
});

describe('withDefaults', () => {
  it('returns the defaults for garbage', () => {
    expect(withDefaults(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('replaces a sequence start outside 0 to 999,999,999 with the default, as it does digits', () => {
    const start = (value: number) => withDefaults({ sequence: { start: value } }).sequence.start;
    expect(start(-5)).toBe(DEFAULT_SETTINGS.sequence.start);
    expect(start(5_000_000_000)).toBe(DEFAULT_SETTINGS.sequence.start);
    expect(start(0)).toBe(0);
    expect(start(999_999_999)).toBe(999_999_999);
    expect(start(7)).toBe(7);
  });

  it('validates the new sequence, cleanup, dates and filter fields', () => {
    const s = withDefaults({
      sequence: { direction: 'sideways', step: 0, restartEvery: 'hour' },
      cleanup: { caseMode: 'snake', stripDiacritics: 'yes', asciiOnly: true, extensionRules: [{ from: '.JPEG', to: 'JPG' }, { from: '', to: 'x' }, { from: 'tif' }] },
      dates: { shiftMinutes: 1.5, useNameDate: false },
      filter: { mode: 'folders', name: { text: 'IMG', regex: 'no' }, minBytes: -1, maxBytes: 10, modifiedFrom: '2024-1-1', modifiedTo: '2024-12-31' },
    });
    expect(s.sequence.direction).toBe('asc');
    expect(s.sequence.step).toBe(1);
    expect(s.sequence.restartEvery).toBe('never');
    expect(s.cleanup.caseMode).toBe('snake');
    expect(s.cleanup.stripDiacritics).toBe(false);
    expect(s.cleanup.asciiOnly).toBe(true);
    expect(s.cleanup.extensionRules).toEqual([{ from: 'jpeg', to: 'jpg' }]);
    expect(s.dates.shiftMinutes).toBe(0);
    expect(s.dates.useNameDate).toBe(false);
    expect(s.filter.mode).toBe('folders');
    expect(s.filter.name).toEqual({ text: 'IMG', regex: false });
    expect(s.filter.minBytes).toBeNull();
    expect(s.filter.maxBytes).toBe(10);
    expect(s.filter.modifiedFrom).toBeNull();
    expect(s.filter.modifiedTo).toBe('2024-12-31');
  });

  it('keeps a valid find & replace scope and drops an invalid one', () => {
    const s = withDefaults({
      findReplace: [
        { find: 'a', replace: 'b', regex: false, matchCase: false, scope: 'result' },
        { find: 'c', replace: 'd', regex: false, matchCase: false, scope: 'everywhere' },
      ],
    });
    expect(s.findReplace).toEqual([
      { find: 'a', replace: 'b', regex: false, matchCase: false, scope: 'result' },
      { find: 'c', replace: 'd', regex: false, matchCase: false },
    ]);
  });
});
