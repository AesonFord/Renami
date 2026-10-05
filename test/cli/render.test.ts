import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Flag, type Plan, type PlanItem, type PlanItemKind } from '../../src/core/index.js';
import { planJson, planText, resultText, shown, summarize, summaryLine } from '../../src/cli/render.js';
import { makeEntry, wc } from '../core/helpers.js';

const cwd = path.resolve('/work');
const at = (name: string) => path.join(cwd, name);

function item(from: string, to: string, kind: PlanItemKind, flags: Flag[] = []): PlanItem {
  const source = { ...makeEntry('/x/' + from), path: at(from), dir: cwd };
  return {
    source,
    target: at(to),
    kind,
    flags,
    seq: 1,
    groupId: null,
    dateUsed: { value: wc(2024, 7, 4, 9, 5, 0), source: 'taken' },
    stem: path.parse(to).name,
    ext: path.parse(to).ext.slice(1),
    setDates: {},
  };
}

const warning: Flag = { level: 'warning', code: 'fallback-date', message: 'No date taken; used the modified date' };
const error: Flag = { level: 'error', code: 'segment-too-long', message: 'The new name is longer than 255 bytes' };
const info: Flag = { level: 'info', code: 'paired', message: 'Renamed with its pair' };

const plan: Plan = {
  id: 'p1',
  items: [
    item('a.jpg', 'Trip_001.jpg', 'rename', [info]),
    item('b.jpg', 'Trip_002.jpg', 'rename', [warning]),
    item('c.jpg', 'c.jpg', 'unchanged'),
    item('d.jpg', 'd.jpg', 'error', [error]),
  ],
  patternError: null,
  errorCount: 1,
  settings: DEFAULT_SETTINGS,
};

describe('render', () => {
  it('summarizes a plan', () => {
    expect(summarize(plan)).toEqual({ total: 4, toRename: 2, unchanged: 1, warnings: 1, errors: 1 });
    expect(summaryLine(summarize(plan))).toBe('2 to rename, 1 unchanged, 1 warning, 1 error');
    expect(summaryLine({ total: 3, toRename: 3, unchanged: 0, warnings: 0, errors: 0 })).toBe('3 to rename, 0 unchanged, 0 errors');
  });

  it('shows paths relative to cwd when they are inside it', () => {
    expect(shown(at('a.jpg'), cwd)).toBe('a.jpg');
    expect(shown(path.resolve('/elsewhere/a.jpg'), cwd)).toBe(path.resolve('/elsewhere/a.jpg'));
  });

  it('prints one line per file, warnings and errors under it, then the summary', () => {
    expect(planText(plan, cwd)).toBe(
      [
        'a.jpg -> Trip_001.jpg',
        'b.jpg -> Trip_002.jpg',
        '    warning: No date taken; used the modified date',
        'c.jpg (unchanged)',
        'd.jpg (not renamed)',
        '    error: The new name is longer than 255 bytes',
        '2 to rename, 1 unchanged, 1 warning, 1 error',
        '',
      ].join('\n'),
    );
  });

  it('prints the plan as JSON, with the result when there is one', () => {
    const json = JSON.parse(planJson(plan, { status: 'done', renamed: 2, datesChanged: 0, journal: null }));
    expect(json.plan[0]).toEqual({
      source: at('a.jpg'),
      target: at('Trip_001.jpg'),
      kind: 'rename',
      flags: [info],
      dateUsed: { value: '2024-07-04T09:05:00', source: 'taken' },
    });
    expect(json.summary).toEqual(summarize(plan));
    expect(json.patternError).toBeNull();
    expect(json.result).toEqual({ status: 'done', renamed: 2, datesChanged: 0, journal: null });
    expect('result' in JSON.parse(planJson(plan))).toBe(false);
  });

  it('describes each outcome', () => {
    expect(resultText({ status: 'done', renamed: 2, datesChanged: 1, journal: at('undo.json') }, cwd)).toBe(
      'Renamed 2 files, set dates on 1 file.\nUndo with: renami undo "undo.json"\n',
    );
    expect(resultText({ status: 'stale', changed: [at('a.jpg')] }, cwd)).toBe(
      'Nothing was renamed: these files changed after the plan was made. Run it again.\n  a.jpg\n',
    );
    expect(resultText({ status: 'cancelled', error: null, rollback: { complete: true, stranded: [] } }, cwd)).toBe(
      'Cancelled. Every file was put back.\n',
    );
    expect(
      resultText(
        { status: 'failed', error: 'EACCES', rollback: { complete: false, stranded: [{ original: at('a.jpg'), current: at('t.tmp') }] } },
        cwd,
      ),
    ).toBe('The rename failed: EACCES. These files could not be put back:\n  t.tmp (was a.jpg)\n');
  });
});
