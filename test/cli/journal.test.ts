import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BatchRecord } from '../../src/core/index.js';
import { JournalError, readJournal, writeJournal } from '../../src/cli/journal.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tempDir(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'renami-journal-'));
  dirs.push(d);
  return d;
}

const record: BatchRecord = {
  id: 'abc12345',
  files: [
    { from: '/a/IMG_1.jpg', to: '/a/Trip_001.jpg', sizeAfter: 10, mtimeMsAfter: 1_700_000_000_123.456, originalTimes: null },
    {
      from: '/a/IMG_2.jpg',
      to: '/a/Trip_002.jpg',
      sizeAfter: 20,
      mtimeMsAfter: 1_700_000_000_000,
      originalTimes: { atimeMs: 1, mtimeMs: 2, birthtimeMs: null },
    },
  ],
  createdDirs: ['/a/new'],
  finishedAt: 1_700_000_001_000,
};

describe('journal', () => {
  it('round-trips a batch record exactly, and leaves no temp file', async () => {
    const dir = tempDir();
    const file = path.join(dir, 'undo.json');
    await writeJournal(file, record);
    expect(readdirSync(dir)).toEqual(['undo.json']);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ version: 1, tool: 'renami' });
    expect(await readJournal(file)).toEqual(record);
  });

  it('fails when the folder does not exist, writing nothing', async () => {
    const file = path.join(tempDir(), 'missing', 'undo.json');
    await expect(writeJournal(file, record)).rejects.toThrow();
  });

  it('refuses files that are not renami journals', async () => {
    const dir = tempDir();
    const write = (name: string, text: string) => {
      const file = path.join(dir, name);
      writeFileSync(file, text);
      return file;
    };
    await expect(readJournal(path.join(dir, 'none.json'))).rejects.toThrow(JournalError);
    await expect(readJournal(write('bad.json', '{nope'))).rejects.toThrow(/can't read the journal/);
    await expect(readJournal(write('other.json', '{"version":1,"tool":"x","record":{}}'))).rejects.toThrow(/is not a renami journal/);
    await expect(readJournal(write('v2.json', '{"version":2,"tool":"renami","record":{}}'))).rejects.toThrow(
      /is a version 2 journal; this renami reads version 1/,
    );
    const damaged = { version: 1, tool: 'renami', record: { ...record, files: [{ from: '/a' }] } };
    await expect(readJournal(write('damaged.json', JSON.stringify(damaged)))).rejects.toThrow(/is damaged/);
  });
});
