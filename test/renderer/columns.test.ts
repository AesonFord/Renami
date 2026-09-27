import { describe, expect, it } from 'vitest';
import {
  cellText,
  clampWidths,
  COLUMNS,
  contentWidth,
  DEFAULT_TEMPLATE,
  fitWidth,
  loadWidths,
  MAX_WIDTH,
  resize,
  saveWidths,
  template,
  WIDTHS_KEY,
} from '../../src/renderer/lib/columns.js';
import { row } from './fixtures.js';

/** A Storage stand-in; `broken` makes every call throw, like blocked site data. */
function memoryStorage(initial: Record<string, string> = {}, broken = false) {
  const data = new Map(Object.entries(initial));
  const guard = () => {
    if (broken) throw new Error('storage unavailable');
  };
  return {
    data,
    getItem: (k: string) => (guard(), data.get(k) ?? null),
    setItem: (k: string, v: string) => (guard(), void data.set(k, v)),
    removeItem: (k: string) => (guard(), void data.delete(k)),
  };
}

const widths = [300, 320, 190, 140, 300];

describe('column layout', () => {
  it('uses the fluid default layout until widths are set, then fixed pixel tracks', () => {
    expect(template(null)).toBe(DEFAULT_TEMPLATE);
    expect(template(widths)).toBe('300px 320px 190px 140px 300px');
  });

  it('measures the full row: columns, the gaps between them and the side padding', () => {
    expect(contentWidth(widths)).toBe(1250 + 4 * 16 + 2 * 24);
  });

  it('resizes one column without touching the others or the input', () => {
    const next = resize(widths, 1, 500);
    expect(next).toEqual([300, 500, 190, 140, 300]);
    expect(widths[1]).toBe(320);
  });

  it("never makes a column narrower than its minimum or wider than the maximum", () => {
    expect(resize(widths, 0, 5)[0]).toBe(COLUMNS[0]!.min);
    expect(resize(widths, 0, 99_999)[0]).toBe(MAX_WIDTH);
  });

  it('brings widths read off the screen within every column’s limits', () => {
    expect(clampWidths([10, 320.4, 190, 99_999, 0])).toEqual([COLUMNS[0]!.min, 320, 190, MAX_WIDTH, COLUMNS[4]!.min]);
  });
});

describe('fitWidth', () => {
  it('fits the widest content plus a little room, rounded up', () => {
    expect(fitWidth(1, [120, 431.2, 88])).toBe(436);
  });

  it('keeps the column minimum when every value is narrow, or there are none', () => {
    expect(fitWidth(2, [10])).toBe(COLUMNS[2]!.min);
    expect(fitWidth(2, [])).toBe(COLUMNS[2]!.min);
  });

  it('handles a very large table without overflowing the call stack', () => {
    const many = Array.from({ length: 200_000 }, (_, i) => i % 500);
    expect(fitWidth(0, many)).toBe(499 + 4);
  });
});

describe('cellText', () => {
  it('gives the text each text column shows for a row', () => {
    const r = row({ currentName: 'IMG_1.HEIC', newName: 'Trip_001.heic', dateUsed: '2024-07-04 14:30', dateSource: 'created', folder: 'Hawaii' });
    expect([0, 1, 2, 3].map((c) => cellText(r, c))).toEqual(['IMG_1.HEIC', 'Trip_001.heic', '2024-07-04 14:30 (created)', 'Hawaii']);
  });

  it('shows a dash for a missing new name or date, and no source for a real date taken', () => {
    const r = row({ newName: '', dateUsed: null });
    expect(cellText(r, 1)).toBe('—');
    expect(cellText(r, 2)).toBe('—');
    expect(cellText(row({ dateUsed: '2024-07-04 14:30', dateSource: 'taken' }), 2)).toBe('2024-07-04 14:30');
  });
});

describe('saved widths', () => {
  it('round-trips through storage', () => {
    const storage = memoryStorage();
    saveWidths(storage, widths);
    expect(loadWidths(storage)).toEqual(widths);
  });

  it('clears the saved value when widths go back to the default layout', () => {
    const storage = memoryStorage({ [WIDTHS_KEY]: JSON.stringify(widths) });
    saveWidths(storage, null);
    expect(storage.data.has(WIDTHS_KEY)).toBe(false);
  });

  it('ignores a missing, malformed or out-of-range saved value', () => {
    for (const bad of [undefined, 'not json', '{}', '[1,2,3]', '[300,320,190,140,"x"]', '[300,320,190,140,1]', '[300,320,190,140,null]']) {
      const storage = memoryStorage(bad === undefined ? {} : { [WIDTHS_KEY]: bad });
      expect(loadWidths(storage)).toBeNull();
    }
  });

  it('works without storage, or when storage throws', () => {
    expect(loadWidths(null)).toBeNull();
    expect(loadWidths(memoryStorage({}, true))).toBeNull();
    expect(() => saveWidths(memoryStorage({}, true), widths)).not.toThrow();
    expect(() => saveWidths(null, widths)).not.toThrow();
  });
});
