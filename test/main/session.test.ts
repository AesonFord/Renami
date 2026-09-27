import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CancelledError,
  DEFAULT_SETTINGS,
  MetadataReader,
  type BirthtimeSetter,
  type ExifToolLike,
  type Platform,
  type RenameSettings,
} from '../../src/core/index.js';
import {
  BUSY_MESSAGE,
  PROGRESS_INTERVAL_MS,
  Session,
  throttle,
  UNDO_READ_WAIT_MS,
  type SessionOptions,
} from '../../src/main/session.js';
import type { MetadataStatus, ProgressView, ScanFilter } from '../../src/shared/ipc.js';

const MEDIA = path.resolve('test/fixtures/media');
const reader = new MetadataReader({ timeZone: 'Pacific/Honolulu' });
afterAll(() => reader.end());

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tempDir(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'renami-session-'));
  dirs.push(d);
  return d;
}

/** A Session that tells a test how many files' details it holds. */
class InspectableSession extends Session {
  detailsHeld(): number {
    return this.metadata.size;
  }

  hashesHeld(): number {
    return this.hashes.size;
  }
}

function setup(extra: Partial<SessionOptions> = {}) {
  const metadata: MetadataStatus[] = [];
  const execute: ProgressView[] = [];
  const session = new InspectableSession({
    platform: process.platform as Platform,
    presetsFile: path.join(tempDir(), 'presets.json'),
    events: { metadataProgress: (s) => metadata.push(s), executeProgress: (p) => execute.push(p) },
    reader,
    timeZone: 'Pacific/Honolulu',
    ...extra,
  });
  return { session, metadata, execute };
}

/**
 * A fake ExifTool whose reads answer at once until hold() is called. After that, every read
 * (or only those `only` picks) waits until release(), so a test can act while a background
 * read is still in flight.
 */
function heldReads() {
  let gate: Promise<void> | null = null;
  let held: (file: string) => boolean = () => true;
  let open = (): void => {};
  let markStarted = (): void => {};
  let calls = 0;
  const exiftool = {
    readRaw: async (file: string) => {
      calls += 1;
      if (gate && held(file)) {
        markStarted();
        await gate;
      }
      return {};
    },
    end: async () => {},
    version: async () => '12.0',
  } as unknown as ExifToolLike;
  return {
    reader: new MetadataReader({ exiftool, timeZone: 'UTC' }),
    calls: () => calls,
    /** Holds every read from now on, or only those `only` picks. Resolves once a held read is in flight. */
    hold(only: (file: string) => boolean = () => true): Promise<void> {
      held = only;
      gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      return new Promise<void>((resolve) => {
        markStarted = resolve;
      });
    },
    release(): void {
      gate = null;
      open();
    },
  };
}

/**
 * A created-date setter that holds a batch until release(), or rejects once the batch is
 * cancelled, so a test can act while a rename is running. Rollback calls it without a signal.
 * After holdCancel(), a cancel only rejects once releaseCancel() is called, so a test can act
 * while a cancelled batch is still settling.
 */
function heldBatch() {
  let markStarted = (): void => {};
  let open = (): void => {};
  let cancelGate: Promise<void> = Promise.resolve();
  let openCancel = (): void => {};
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const birthtime: BirthtimeSetter = {
    supported: true,
    set: (_items, signal) =>
      signal
        ? new Promise<void>((resolve, reject) => {
            open = resolve;
            markStarted();
            signal.addEventListener('abort', () => void cancelGate.then(() => reject(new CancelledError())));
          })
        : Promise.resolve(),
  };
  return {
    birthtime,
    started,
    release: () => open(),
    holdCancel: () => {
      cancelGate = new Promise<void>((resolve) => {
        openCancel = resolve;
      });
    },
    releaseCancel: () => openCancel(),
  };
}

const ALL: ScanFilter = { includeSubfolders: false, extensions: null };
const settings = (patch: Partial<RenameSettings> = {}): RenameSettings => ({ ...DEFAULT_SETTINGS, ...patch });

describe('Session.scan', () => {
  it('summarizes each source with its file count', async () => {
    const dir = tempDir();
    mkdirSync(path.join(dir, 'a'));
    writeFileSync(path.join(dir, 'a', '1.txt'), 'x');
    writeFileSync(path.join(dir, 'a', '2.jpg'), 'x');
    const loose = path.join(dir, 'loose.txt');
    writeFileSync(loose, 'x');
    const { session } = setup();

    expect(await session.scan([path.join(dir, 'a'), loose], ALL)).toEqual({
      sources: [
        { path: path.join(dir, 'a'), name: 'a', isFolder: true, count: 2 },
        { path: loose, name: 'loose.txt', isFolder: false, count: 1 },
      ],
      total: 3,
      extensionsFound: ['jpg', 'txt'],
      unreadableFolders: [],
    });
    await session.whenRead();
  });

  it('applies the extension filter to the counts but lists every extension found', async () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, '1.txt'), 'x');
    writeFileSync(path.join(dir, '2.jpg'), 'x');
    const { session } = setup();
    const summary = await session.scan([dir], { includeSubfolders: false, extensions: ['jpg'] });
    expect(summary?.total).toBe(1);
    expect(summary?.sources[0]?.count).toBe(1);
    expect(summary?.extensionsFound).toEqual(['jpg', 'txt']);
    await session.whenRead();
  });

  it.skipIf(process.platform === 'win32')('shows a symlinked folder source as an empty file source, as the scanner skips it', async () => {
    const dir = tempDir();
    mkdirSync(path.join(dir, 'real'));
    writeFileSync(path.join(dir, 'real', '1.txt'), 'x');
    const link = path.join(dir, 'link');
    symlinkSync(path.join(dir, 'real'), link, 'dir');
    const { session } = setup();

    expect(await session.scan([link], ALL)).toMatchObject({
      sources: [{ path: link, name: 'link', isFolder: false, count: 0 }],
      total: 0,
    });
    await session.whenRead();
  });

  it('resolves null for a scan that a newer scan replaced', async () => {
    const a = tempDir();
    const b = tempDir();
    writeFileSync(path.join(b, 'only.txt'), 'x');
    const { session } = setup();
    const [first, second] = await Promise.all([session.scan([a], ALL), session.scan([b], ALL)]);
    expect(first).toBeNull();
    expect(second?.total).toBe(1);
    await session.whenRead();
  });
});

describe('Session metadata', () => {
  it('reads metadata in the background, reports progress and feeds the preview', async () => {
    const dir = tempDir();
    copyFileSync(path.join(MEDIA, 'photo.jpg'), path.join(dir, 'photo.jpg'));
    copyFileSync(path.join(MEDIA, 'notes.txt'), path.join(dir, 'notes.txt'));
    const { session, metadata } = setup();

    await session.scan([dir], ALL);
    await session.whenRead();

    expect(metadata[0]).toEqual({ done: 0, total: 2, finished: false, exiftoolFailed: false });
    expect(metadata.at(-1)).toEqual({ done: 2, total: 2, finished: true, exiftoolFailed: false });
    const view = await session.buildPlan({ settings: settings({ pattern: '{date_taken}' }), excluded: [] });
    const photo = view.rows.find((r) => r.currentName === 'photo.jpg');
    expect(photo?.newName).toBe('2024-07-04.jpg');
    expect(photo?.dateUsed).toBe('2024-07-04 14:30');
    expect(photo?.dateSource).toBe('taken');
  });

  it('gives up on ExifTool after repeated failures and keeps going with file dates', async () => {
    const dir = tempDir();
    const total = 60;
    for (let i = 0; i < total; i += 1) writeFileSync(path.join(dir, `${i}.jpg`), 'x');
    let readRawCalls = 0;
    const broken = new MetadataReader({
      exiftool: {
        readRaw: async () => {
          readRawCalls += 1;
          throw new Error('exiftool died');
        },
        end: async () => {},
        version: async () => {
          throw new Error('exiftool died');
        },
      } as unknown as ExifToolLike,
      timeZone: 'UTC',
    });
    const { session, metadata } = setup({ reader: broken });

    await session.scan([dir], ALL);
    await session.whenRead();

    expect(metadata.at(-1)).toMatchObject({ finished: true, exiftoolFailed: true });
    const last = metadata.at(-1);
    // Reading actually stopped early: not every file was read, and not every file was even attempted.
    expect(last?.done).toBeLessThan(total);
    expect(readRawCalls).toBeLessThan(total * 2);
    expect((await session.buildPlan({ settings: settings(), excluded: [] })).rows).toHaveLength(total);
  });

  it('waits for the ExifTool check before finishing when the failing streak is at the tail', async () => {
    const dir = tempDir();
    // Names sort before the failing ones, so the scanner orders them first: readable files,
    // then a streak of failures right at the end of the batch, with nothing left to read
    // afterwards. That's the race: readAll's workers can drain, and its promise settle, before
    // the isWorking() probe the streak triggered has resolved.
    for (let i = 0; i < 4; i += 1) writeFileSync(path.join(dir, `a_good${i}.jpg`), 'x');
    for (let i = 0; i < 8; i += 1) writeFileSync(path.join(dir, `z_bad${i}.jpg`), 'x');
    const broken = new MetadataReader({
      exiftool: {
        readRaw: async (file: string) => {
          if (path.basename(file).startsWith('z_bad')) throw new Error('cannot read this file');
          return {};
        },
        end: async () => {},
        version: async () => {
          // Settles well after every file has already been read, reproducing the race: only a
          // macrotask (unlike the reads, which never leave the microtask queue) is guaranteed to
          // run after readAll has fully drained.
          await new Promise((resolve) => setTimeout(resolve, 20));
          throw new Error('exiftool died');
        },
      } as unknown as ExifToolLike,
      timeZone: 'UTC',
    });
    const { session, metadata } = setup({ reader: broken });

    await session.scan([dir], ALL);
    await session.whenRead();

    // whenRead() must not resolve until the probe's verdict is in: the final, finished: true
    // event has to carry exiftoolFailed: true, not the stale false a race would report.
    expect(metadata.at(-1)).toEqual({ done: 12, total: 12, finished: true, exiftoolFailed: true });
  });

  it('stops reading when reporting a result throws, drops later results, and never claims ExifTool broke', async () => {
    const dir = tempDir();
    for (let i = 0; i < 6; i += 1) writeFileSync(path.join(dir, `f${i}.txt`), String(i));
    const reads = heldReads();
    const events: MetadataStatus[] = [];
    let calls = 0;
    const { session } = setup({
      reader: reads.reader,
      events: {
        metadataProgress: (s) => {
          calls += 1;
          if (calls === 3) throw new Error('the window is gone');
          events.push(s);
        },
        executeProgress: () => {},
      },
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Each report comes a full interval after the last, so none is held for later: the report
    // for f1.txt is the third call, and it throws inside onResult.
    let now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => (now += PROGRESS_INTERVAL_MS));
    try {
      // f5.txt is still open when the report for f1.txt throws.
      const held = reads.hold((file) => path.basename(file) === 'f5.txt');
      await session.scan([dir], ALL);
      await held;
      await new Promise((resolve) => setImmediate(resolve));
      // Reading hasn't ended while a file is still open.
      expect(events.filter((e) => e.finished)).toEqual([]);
      reads.release();
      await session.whenRead();

      expect(error).toHaveBeenCalledTimes(1);
      expect(error.mock.calls[0]?.[0]).toBe('Reading metadata stopped:');
    } finally {
      clock.mockRestore();
      error.mockRestore();
    }
    expect(events.filter((e) => e.exiftoolFailed)).toEqual([]);
    // Only f0.txt and f1.txt count. f2.txt to f5.txt finished reading after the throw and were dropped.
    expect(session.detailsHeld()).toBe(2);
    expect(events.at(-1)).toEqual({ done: 2, total: 6, finished: true, exiftoolFailed: false });
    // Reading ended with one final event, and nothing came after it.
    expect(events.findIndex((e) => e.finished)).toBe(events.length - 1);
  });

  it('drops the results and final event of a read that a rescan replaced', async () => {
    const a = tempDir();
    const b = tempDir();
    for (let i = 0; i < 6; i += 1) writeFileSync(path.join(a, `a${i}.txt`), String(i));
    for (let i = 0; i < 2; i += 1) writeFileSync(path.join(b, `b${i}.txt`), String(i));
    const reads = heldReads();
    const { session, metadata } = setup({ reader: reads.reader });

    // A's other files are read, so its progress reporter has an event waiting; a5.txt is held.
    const held = reads.hold((file) => path.basename(file) === 'a5.txt');
    await session.scan([a], ALL);
    const readingA = session.whenRead();
    await held;
    // Let A's other results arrive before the rescan.
    await new Promise((resolve) => setImmediate(resolve));

    await session.scan([b], ALL);
    await session.whenRead();
    // Longer than A's reporter would hold its waiting event.
    await new Promise((resolve) => setTimeout(resolve, PROGRESS_INTERVAL_MS + 50));
    reads.release();
    await readingA;

    const firstB = metadata.findIndex((m) => m.total === 2);
    expect(firstB).toBeGreaterThan(0);
    expect(metadata.slice(firstB).map((m) => m.total)).toEqual(metadata.slice(firstB).map(() => 2));
    expect(metadata.at(-1)).toEqual({ done: 2, total: 2, finished: true, exiftoolFailed: false });
    const view = await session.buildPlan({ settings: settings(), excluded: [] });
    expect(view.rows.map((r) => r.currentName)).toEqual(['b0.txt', 'b1.txt']);
    expect(session.tokenValues()?.fileName).toBe('b0.txt');
  });

  it('keeps reading past a run of per-file failures when ExifTool itself is fine', async () => {
    const dir = tempDir();
    for (let i = 0; i < 6; i += 1) writeFileSync(path.join(dir, `bad${i}.jpg`), 'x');
    for (let i = 0; i < 6; i += 1) writeFileSync(path.join(dir, `good${i}.jpg`), 'x');
    const flaky = new MetadataReader({
      exiftool: {
        readRaw: async (file: string) => {
          if (path.basename(file).startsWith('bad')) throw new Error('cannot read this file');
          return {};
        },
        end: async () => {},
        version: async () => '12.0',
      } as unknown as ExifToolLike,
      timeZone: 'UTC',
    });
    const { session, metadata } = setup({ reader: flaky });

    await session.scan([dir], ALL);
    await session.whenRead();

    expect(metadata.at(-1)).toEqual({ done: 12, total: 12, finished: true, exiftoolFailed: false });
    const view = await session.buildPlan({ settings: settings(), excluded: [] });
    expect(view.rows).toHaveLength(12);
    const badRows = view.rows.filter((r) => r.currentName.startsWith('bad'));
    expect(badRows).toHaveLength(6);
    for (const row of badRows) expect(row.flags.some((f) => f.code === 'metadata-unreadable')).toBe(true);
  });
});

describe('Session.buildPlan', () => {
  it('keeps excluded files in the preview but leaves them out of the batch', async () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'a.txt'), 'x');
    writeFileSync(path.join(dir, 'b.txt'), 'x');
    const { session } = setup();
    await session.scan([dir], ALL);
    await session.whenRead();
    const view = await session.buildPlan({ settings: settings({ pattern: '{seq}' }), excluded: [path.join(dir, 'a.txt')] });
    expect(view.rows.map((r) => [r.currentName, r.kind, r.newName])).toEqual([
      ['a.txt', 'excluded', ''],
      ['b.txt', 'rename', '001.txt'],
    ]);
  });

  it('replaces malformed settings from the renderer with defaults', async () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'a.txt'), 'x');
    const { session } = setup();
    await session.scan([dir], ALL);
    await session.whenRead();
    const bad = settings({ pattern: '{seq}', sequence: { ...DEFAULT_SETTINGS.sequence, digits: 99 } });
    expect((await session.buildPlan({ settings: bad, excluded: [] })).rows[0]?.newName).toBe('001.txt');
  });

  it('reports a pattern error without throwing', async () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'a.txt'), 'x');
    const { session } = setup();
    await session.scan([dir], ALL);
    await session.whenRead();
    const view = await session.buildPlan({ settings: settings({ pattern: 'x{nope}' }), excluded: [] });
    expect(view.patternError).toMatch(/Unknown token/);
  });
});

describe('Session.tokenValues', () => {
  it('is null before there is a plan, then describes the first file', async () => {
    const dir = tempDir();
    copyFileSync(path.join(MEDIA, 'photo.jpg'), path.join(dir, 'photo.jpg'));
    const { session } = setup();
    expect(session.tokenValues()).toBeNull();

    await session.scan([dir], ALL);
    await session.whenRead();
    await session.buildPlan({ settings: settings(), excluded: [] });

    const values = session.tokenValues();
    expect(values?.fileName).toBe('photo.jpg');
    expect(values?.values.date_taken).toBe('2024-07-04');
    expect(values?.values.camera_model).toBe('EOS R5');
    expect(values?.values.artist).toBeNull();
  });

  it('describes the first file that is not excluded', async () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'a.txt'), 'x');
    writeFileSync(path.join(dir, 'b.txt'), 'x');
    const { session } = setup();
    await session.scan([dir], ALL);
    await session.whenRead();
    await session.buildPlan({ settings: settings({ sequence: { ...DEFAULT_SETTINGS.sequence, sortBy: 'name' } }), excluded: [path.join(dir, 'a.txt')] });
    expect(session.tokenValues()?.fileName).toBe('b.txt');
    expect(session.tokenValues()?.values.seq).toBe('001');
  });
});

async function ready(session: Session, sources: string[], patch: Partial<RenameSettings>) {
  await session.scan(sources, ALL);
  await session.whenRead();
  return session.buildPlan({ settings: settings(patch), excluded: [] });
}

const byName = { ...DEFAULT_SETTINGS.sequence, sortBy: 'name' as const };

/** A session with a rename of one photo held inside its created-date step. */
async function runningBatch(extra: Partial<SessionOptions> = {}) {
  const dir = tempDir();
  copyFileSync(path.join(MEDIA, 'photo.jpg'), path.join(dir, 'photo.jpg'));
  const held = heldBatch();
  const s = setup({ birthtime: held.birthtime, platform: 'darwin', ...extra });
  const view = await ready(s.session, [dir], { pattern: 'Trip', dates: { ...DEFAULT_SETTINGS.dates, setCreated: true } });
  const running = s.session.execute(view.planId);
  await held.started;
  return { ...s, dir, view, running, release: held.release, holdCancel: held.holdCancel, releaseCancel: held.releaseCancel };
}

describe('Session.execute and undo', () => {
  it('renames, reports progress, and undoes it', async () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'a.txt'), 'a');
    writeFileSync(path.join(dir, 'b.txt'), 'b');
    const { session, execute } = setup();
    const view = await ready(session, [dir], { pattern: 'Trip_{seq}', sequence: byName });

    expect(await session.execute(view.planId)).toEqual({
      status: 'done',
      renamed: 2,
      datesChanged: 0,
      sourcesAfter: [dir],
      changes: [
        { from: path.join(dir, 'a.txt'), to: path.join(dir, 'Trip_001.txt') },
        { from: path.join(dir, 'b.txt'), to: path.join(dir, 'Trip_002.txt') },
      ],
    });
    expect(readdirSync(dir).sort()).toEqual(['Trip_001.txt', 'Trip_002.txt']);
    expect(execute.at(-1)).toEqual({ done: 4, total: 4 });
    expect(session.canUndo()).toBe(true);

    expect(await session.undo()).toMatchObject({ status: 'done', restored: 2, skipped: [], sourcesAfter: [dir] });
    expect(readdirSync(dir).sort()).toEqual(['a.txt', 'b.txt']);
    expect(session.canUndo()).toBe(false);
  });

  it('swaps a file source for its new path after renaming, and back after undo', async () => {
    const dir = tempDir();
    const file = path.join(dir, 'a.txt');
    writeFileSync(file, 'a');
    const { session } = setup();
    const view = await ready(session, [file], { pattern: 'renamed' });

    const renamed = path.join(dir, 'renamed.txt');
    expect(await session.execute(view.planId)).toMatchObject({ status: 'done', sourcesAfter: [renamed] });
    await session.scan([renamed], ALL);
    await session.whenRead();
    expect((await session.undo()).sourcesAfter).toEqual([file]);
  });

  it('refuses a plan the preview is no longer showing, and never runs one plan twice', async () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'a.txt'), 'a');
    const { session } = setup();
    const old = await ready(session, [dir], { pattern: 'x' });
    const current = await session.buildPlan({ settings: settings({ pattern: 'y' }), excluded: [] });

    expect(await session.execute(old.planId)).toMatchObject({ status: 'not-ready' });
    expect(readdirSync(dir)).toEqual(['a.txt']);
    expect(await session.execute(current.planId)).toMatchObject({ status: 'done' });
    expect(await session.execute(current.planId)).toMatchObject({ status: 'not-ready' });
  });

  it('refuses a plan built before reading finished, and runs one rebuilt after', async () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'a.txt'), 'a');
    const reads = heldReads();
    const { session } = setup({ reader: reads.reader });
    const reading = reads.hold();
    await session.scan([dir], ALL);
    await reading;
    const early = await session.buildPlan({ settings: settings({ pattern: 'x' }), excluded: [] });

    reads.release();
    await session.whenRead();
    // Reading has finished now, but this plan was built before the last file's details arrived.
    expect(await session.execute(early.planId)).toEqual({
      status: 'not-ready',
      reason: 'The preview is still catching up. Try again in a moment.',
    });
    expect(readdirSync(dir)).toEqual(['a.txt']);
    expect(early.complete).toBe(false);

    const rebuilt = await session.buildPlan({ settings: settings({ pattern: 'x' }), excluded: [] });
    expect(rebuilt.complete).toBe(true);
    expect(await session.execute(rebuilt.planId)).toMatchObject({ status: 'done' });
    expect(readdirSync(dir)).toEqual(['x.txt']);
  });

  it('stops the background read and waits for it before undoing', async () => {
    const dir = tempDir();
    const count = 10;
    for (let i = 0; i < count; i += 1) writeFileSync(path.join(dir, `f${i}.txt`), String(i));
    const reads = heldReads();
    const { session, metadata } = setup({ reader: reads.reader });
    const view = await ready(session, [dir], { pattern: 'Trip_{seq}', sequence: byName });
    expect(await session.execute(view.planId)).toMatchObject({ status: 'done', renamed: count });
    const renamed = readdirSync(dir).sort();

    // The renderer rescans after a rename, so ExifTool is reading the renamed files when Undo is offered.
    const reading = reads.hold();
    const eventsBefore = metadata.length;
    await session.scan([dir], ALL);
    await reading;
    const callsBefore = reads.calls();
    const undoing = session.undo();
    await new Promise((resolve) => setTimeout(resolve, 20));
    // A file ExifTool has open can't be renamed on Windows, so undo must not touch anything yet.
    expect(readdirSync(dir).sort()).toEqual(renamed);
    expect(session.isBusy()).toBe(true);

    reads.release();
    expect(await undoing).toMatchObject({ status: 'done', restored: count });
    expect(readdirSync(dir).sort()).toEqual(Array.from({ length: count }, (_, i) => `f${i}.txt`).sort());
    // The read was stopped, not left to finish: files it hadn't started were never read.
    expect(reads.calls() - callsBefore).toBe(0);
    // The stopped read sends no final event; the renderer's rescan after the undo replaces it.
    expect(metadata.slice(eventsBefore).filter((m) => m.finished)).toEqual([]);
  });

  it('leaves a background read alone when there is nothing to undo', async () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'a.txt'), 'a');
    const reads = heldReads();
    const { session, metadata } = setup({ reader: reads.reader });
    const reading = reads.hold();
    await session.scan([dir], ALL);
    await reading;

    expect(await session.undo()).toMatchObject({ status: 'nothing-to-undo', restored: 0, sourcesAfter: [dir] });

    // Nothing to undo means nothing was stopped: the read finishes on its own, sending its
    // own final event, instead of being left to hang like a stopped read (no rescan
    // follows this outcome, so nobody else will ever ask reading to finish).
    reads.release();
    await session.whenRead();
    expect(metadata.some((m) => m.finished)).toBe(true);

    // Reading really finished (not left stuck), so a plan built now can run at once.
    const view = await session.buildPlan({ settings: settings({ pattern: 'x' }), excluded: [] });
    expect(await session.execute(view.planId)).toMatchObject({ status: 'done' });
    expect(readdirSync(dir)).toEqual(['x.txt']);
  });

  it('stops waiting for a hung read after UNDO_READ_WAIT_MS', async () => {
    const dir = tempDir();
    for (let i = 0; i < 3; i += 1) writeFileSync(path.join(dir, `f${i}.txt`), String(i));
    const reads = heldReads();
    const { session } = setup({ reader: reads.reader });
    const view = await ready(session, [dir], { pattern: 'Trip_{seq}', sequence: byName });
    expect(await session.execute(view.planId)).toMatchObject({ status: 'done', renamed: 3 });
    const renamed = readdirSync(dir).sort();

    // ExifTool hangs on a file the rescan is reading, and never answers.
    const reading = reads.hold();
    await session.scan([dir], ALL);
    await reading;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const undoing = session.undo();
    try {
      await vi.advanceTimersByTimeAsync(UNDO_READ_WAIT_MS - 1);
      expect(readdirSync(dir).sort()).toEqual(renamed);
      await vi.advanceTimersByTimeAsync(1);
    } finally {
      vi.useRealTimers();
    }
    expect(await undoing).toMatchObject({ status: 'done', restored: 3 });
    expect(readdirSync(dir).sort()).toEqual(['f0.txt', 'f1.txt', 'f2.txt']);
    reads.release();
    await session.whenRead();
  });

  it('drops a rescan whose folder walk is still running when undo starts', async () => {
    const dir = tempDir();
    for (let i = 0; i < 4; i += 1) writeFileSync(path.join(dir, `f${i}.txt`), String(i));
    const reads = heldReads();
    const { session } = setup({ reader: reads.reader });
    const view = await ready(session, [dir], { pattern: 'Trip_{seq}', sequence: byName });
    expect(await session.execute(view.planId)).toMatchObject({ status: 'done' });
    const callsBefore = reads.calls();

    // The renderer's rescan after the rename is still walking the folder when the user clicks Undo.
    const rescan = session.scan([dir], ALL);
    const undone = await session.undo();

    expect(undone).toMatchObject({ status: 'done', restored: 4 });
    expect(await rescan).toBeNull();
    await session.whenRead();
    // ExifTool never opened a file the undo was moving.
    expect(reads.calls() - callsBefore).toBe(0);
    expect(readdirSync(dir).sort()).toEqual(['f0.txt', 'f1.txt', 'f2.txt', 'f3.txt']);
  });

  it('maps the sources of a scan still walking when undo starts, not the last finished one', async () => {
    const a = tempDir();
    const b = tempDir();
    writeFileSync(path.join(a, 'a1.txt'), 'a');
    writeFileSync(path.join(b, 'b1.txt'), 'b');
    const { session } = setup();
    const view = await ready(session, [a], { pattern: 'x_{seq}' });
    expect(await session.execute(view.planId)).toMatchObject({ status: 'done' });
    await session.scan([a], ALL);
    await session.whenRead();

    // The user adds folder b; its scan is still walking when they click Undo.
    const walk = session.scan([a, b], ALL);
    const undone = await session.undo();
    expect(await walk).toBeNull();
    expect(undone).toMatchObject({ status: 'done', sourcesAfter: [a, b] });
  });

  it('keeps a source removed while the next scan was still walking when undo starts', async () => {
    const a = tempDir();
    const c = tempDir();
    writeFileSync(path.join(a, 'a1.txt'), 'a');
    writeFileSync(path.join(c, 'c1.txt'), 'c');
    const { session } = setup();
    const view = await ready(session, [a, c], { pattern: 'x_{seq}' });
    expect(await session.execute(view.planId)).toMatchObject({ status: 'done' });

    // The user removes folder c; the rescan of a alone is still walking when they click Undo.
    const walk = session.scan([a], ALL);
    const undone = await session.undo();
    expect(await walk).toBeNull();
    expect(undone).toMatchObject({ status: 'done', sourcesAfter: [a] });
  });

  it('maps the sources of a scan after clear() that is still walking when undo starts', async () => {
    const a = tempDir();
    const d = tempDir();
    writeFileSync(path.join(a, 'a1.txt'), 'a');
    writeFileSync(path.join(d, 'd1.txt'), 'd');
    const { session } = setup();
    const view = await ready(session, [a], { pattern: 'x_{seq}' });
    expect(await session.execute(view.planId)).toMatchObject({ status: 'done' });
    session.clear();

    // The user drops folder d on the empty window; its scan is still walking when they click Undo.
    const walk = session.scan([d], ALL);
    const undone = await session.undo();
    expect(await walk).toBeNull();
    expect(undone).toMatchObject({ status: 'done', sourcesAfter: [d] });
  });

  it('resolves a scan started while a batch runs to null and changes nothing', async () => {
    const { session, metadata, dir, running, release } = await runningBatch();
    const eventsBefore = metadata.length;

    expect(await session.scan([dir], ALL)).toBeNull();
    release();
    expect(await running).toMatchObject({ status: 'done' });
    await session.whenRead();
    expect(session.canUndo()).toBe(true);
    expect(session.tokenValues()).toBeNull();
    // No read started on the files the rename was moving.
    expect(metadata.length).toBe(eventsBefore);
  });

  it('refuses to build a plan while a batch runs', async () => {
    const { session, running, release } = await runningBatch();
    await expect(session.buildPlan({ settings: settings(), excluded: [] })).rejects.toThrow(BUSY_MESSAGE);
    release();
    expect(await running).toMatchObject({ status: 'done' });
  });

  it('makes an older plan unrunnable as soon as a scan starts, even while its walk runs', async () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'a.txt'), 'a');
    const { session } = setup();
    const view = await ready(session, [dir], { pattern: 'x' });

    const walk = session.scan([dir], ALL);
    expect(await session.execute(view.planId)).toMatchObject({ status: 'not-ready' });
    expect(readdirSync(dir)).toEqual(['a.txt']);
    await walk;
    await session.whenRead();
  });

  it('refuses to run while file details are still loading, or while a batch runs', async () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'a.txt'), 'a');
    const reads = heldReads();
    const { session } = setup({ reader: reads.reader });
    const held = reads.hold();
    await session.scan([dir], ALL);
    await held;
    const early = await session.buildPlan({ settings: settings({ pattern: 'x' }), excluded: [] });
    expect(await session.execute(early.planId)).toEqual({ status: 'not-ready', reason: 'File details are still loading.' });
    reads.release();
    await session.whenRead();
    expect(readdirSync(dir)).toEqual(['a.txt']);

    const batch = await runningBatch();
    expect(await batch.session.execute(batch.view.planId)).toEqual({ status: 'not-ready', reason: BUSY_MESSAGE });
    batch.release();
    expect(await batch.running).toMatchObject({ status: 'done' });
  });

  it('keeps a file source that undo skipped at its renamed path', async () => {
    const dir = tempDir();
    const a = path.join(dir, 'a.txt');
    const b = path.join(dir, 'b.txt');
    writeFileSync(a, 'a');
    writeFileSync(b, 'b');
    const { session } = setup();
    const view = await ready(session, [a, b], { pattern: 'Trip_{seq}', sequence: byName });
    const trip1 = path.join(dir, 'Trip_001.txt');
    const trip2 = path.join(dir, 'Trip_002.txt');
    expect(await session.execute(view.planId)).toMatchObject({ status: 'done', sourcesAfter: [trip1, trip2] });
    // The renderer rescans the renamed files.
    await session.scan([trip1, trip2], ALL);
    await session.whenRead();

    // A new size since the rename tells undo the file was changed, so it leaves it alone.
    writeFileSync(trip2, 'changed after the rename');
    expect(await session.undo()).toMatchObject({
      status: 'done',
      restored: 1,
      skipped: [{ path: trip2, reason: 'Changed since the rename' }],
      sourcesAfter: [a, trip2],
    });
    expect(readdirSync(dir).sort()).toEqual(['Trip_002.txt', 'a.txt']);
  });

  it('sends rename progress at most once per interval, ending with the total', async () => {
    const dir = tempDir();
    const count = 40;
    for (let i = 0; i < count; i += 1) writeFileSync(path.join(dir, `f${String(i).padStart(2, '0')}.txt`), String(i));
    const { session, execute } = setup({ reader: heldReads().reader });
    const view = await ready(session, [dir], { pattern: 'Trip_{seq}', sequence: byName });

    expect(await session.execute(view.planId)).toMatchObject({ status: 'done', renamed: count });
    expect(execute.length).toBeGreaterThan(0);
    expect(execute.length).toBeLessThan(count);
    expect(execute.at(-1)).toEqual({ done: count * 2, total: count * 2 });
    // Nothing arrives after the batch has finished.
    const sent = execute.length;
    await new Promise((resolve) => setTimeout(resolve, PROGRESS_INTERVAL_MS + 50));
    expect(execute.length).toBe(sent);
  });

  it('keeps no undo record for a batch that changed nothing', async () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'a.txt'), 'a');
    const { session } = setup();
    const view = await ready(session, [dir], { pattern: '{name}' });

    expect(await session.execute(view.planId)).toMatchObject({ status: 'done', renamed: 0, datesChanged: 0 });
    expect(session.canUndo()).toBe(false);
  });

  it('answers an undo while a batch runs with not-ready', async () => {
    const { session, dir, running, release } = await runningBatch();
    expect(await session.undo()).toEqual({ status: 'not-ready', reason: BUSY_MESSAGE, sourcesAfter: [dir] });
    release();
    expect(await running).toMatchObject({ status: 'done' });
  });

  it('waits for an ExifTool check in flight before undoing', async () => {
    const dir = tempDir();
    for (let i = 0; i < 6; i += 1) writeFileSync(path.join(dir, `f${i}.txt`), String(i));
    let failing = false;
    let answer = (): void => {};
    let markAsked = (): void => {};
    const asked = new Promise<void>((resolve) => {
      markAsked = resolve;
    });
    const reader = new MetadataReader({
      exiftool: {
        readRaw: async () => {
          if (failing) throw new Error('cannot read this file');
          return {};
        },
        end: async () => {},
        // Held until the test answers, like a slow ExifTool.
        version: () => {
          markAsked();
          return new Promise<string>((resolve) => {
            answer = () => resolve('12.0');
          });
        },
      } as unknown as ExifToolLike,
      timeZone: 'UTC',
    });
    const { session, metadata } = setup({ reader });
    const view = await ready(session, [dir], { pattern: 'Trip_{seq}', sequence: byName });
    expect(await session.execute(view.planId)).toMatchObject({ status: 'done', renamed: 6 });
    const renamed = readdirSync(dir).sort();

    // Every renamed file fails to read, so the session asks ExifTool whether it still works.
    failing = true;
    const eventsBefore = metadata.length;
    await session.scan([dir], ALL);
    await asked;
    const undoing = session.undo();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(readdirSync(dir).sort()).toEqual(renamed);

    answer();
    expect(await undoing).toMatchObject({ status: 'done', restored: 6 });
    expect(readdirSync(dir).sort()).toEqual(['f0.txt', 'f1.txt', 'f2.txt', 'f3.txt', 'f4.txt', 'f5.txt']);
    // The stopped read sends no final event, and never claims ExifTool broke.
    const after = metadata.slice(eventsBefore);
    expect(after.filter((m) => m.finished || m.exiftoolFailed)).toEqual([]);
  });

  it('reports files that changed after the preview as stale and touches nothing', async () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'a.txt'), 'a');
    const { session } = setup();
    const view = await ready(session, [dir], { pattern: 'x' });
    writeFileSync(path.join(dir, 'a.txt'), 'changed since the preview');

    expect(await session.execute(view.planId)).toMatchObject({ status: 'stale' });
    expect(readdirSync(dir)).toEqual(['a.txt']);
  });

  it('cancels a running batch and puts everything back', async () => {
    const dir = tempDir();
    copyFileSync(path.join(MEDIA, 'photo.jpg'), path.join(dir, 'photo.jpg'));
    let markStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    // Blocks inside the created-date step until cancelled. Rollback calls it without a signal.
    const birthtime: BirthtimeSetter = {
      supported: true,
      set: (_items, signal) =>
        signal
          ? new Promise<void>((_resolve, reject) => {
              markStarted();
              signal.addEventListener('abort', () => reject(new CancelledError()));
            })
          : Promise.resolve(),
    };
    const { session } = setup({ birthtime, platform: 'darwin' });
    const view = await ready(session, [dir], { pattern: 'Trip', dates: { ...DEFAULT_SETTINGS.dates, setCreated: true } });

    const running = session.execute(view.planId);
    await started;
    expect(session.isBusy()).toBe(true);
    session.cancel();

    expect(await running).toMatchObject({ status: 'cancelled', rollback: { complete: true } });
    expect(readdirSync(dir)).toEqual(['photo.jpg']);
    expect(session.isBusy()).toBe(false);
  });
});

describe('Session.clear', () => {
  it('forgets the files and drops a read in flight, then scans and renames as usual', async () => {
    const dir = tempDir();
    for (let i = 0; i < 3; i += 1) writeFileSync(path.join(dir, `f${i}.txt`), String(i));
    const reads = heldReads();
    const { session, metadata } = setup({ reader: reads.reader });
    const held = reads.hold();
    await session.scan([dir], ALL);
    const reading = session.whenRead();
    await held;

    const eventsBefore = metadata.length;
    session.clear();
    reads.release();
    await reading;
    expect(metadata.length).toBe(eventsBefore);
    expect(session.tokenValues()).toBeNull();
    expect(await session.buildPlan({ settings: settings(), excluded: [] })).toMatchObject({ rows: [], complete: true });

    const view = await ready(session, [dir], { pattern: 'x_{seq}', sequence: byName });
    expect(await session.execute(view.planId)).toMatchObject({ status: 'done', renamed: 3 });
  });

  it('does nothing while a batch runs', async () => {
    const { session, dir, running, release } = await runningBatch();
    session.clear();
    release();
    // The batch's sources survived, so both results still map them.
    expect(await running).toMatchObject({ status: 'done', sourcesAfter: [dir] });
    expect(session.canUndo()).toBe(true);
    expect(await session.undo()).toMatchObject({ status: 'done', restored: 1, sourcesAfter: [dir] });
  });
});

describe('Session.dispose', () => {
  it('ends ExifTool', async () => {
    const end = vi.fn(async () => {});
    const exiftool = { readRaw: async () => ({}), end, version: async () => '12.0' } as unknown as ExifToolLike;
    const { session } = setup({ reader: new MetadataReader({ exiftool, timeZone: 'UTC' }) });
    await session.dispose();
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('drops the results and events of files still open when it was called', async () => {
    const dir = tempDir();
    for (let i = 0; i < 3; i += 1) writeFileSync(path.join(dir, `f${i}.txt`), String(i));
    const reads = heldReads();
    const { session, metadata } = setup({ reader: reads.reader });
    const held = reads.hold();
    await session.scan([dir], ALL);
    const reading = session.whenRead();
    await held;

    const eventsBefore = metadata.length;
    await session.dispose();
    reads.release();
    await reading;
    // Longer than a progress event could wait.
    await new Promise((resolve) => setTimeout(resolve, PROGRESS_INTERVAL_MS + 50));

    expect(metadata.length).toBe(eventsBefore);
    expect(session.detailsHeld()).toBe(0);
    expect(session.tokenValues()).toBeNull();
  });

  it('cancels a running batch, which rolls back', async () => {
    // Its own reader: dispose() ends it, and the other tests share theirs.
    const own = new MetadataReader({ timeZone: 'Pacific/Honolulu' });
    try {
      const { session, dir, running } = await runningBatch({ reader: own });
      await session.dispose();
      expect(await running).toMatchObject({ status: 'cancelled', rollback: { complete: true } });
      expect(readdirSync(dir)).toEqual(['photo.jpg']);
    } finally {
      await own.end();
    }
  });

  it('waits for a cancelled batch to finish rolling back before it ends ExifTool', async () => {
    const own = new MetadataReader({ timeZone: 'Pacific/Honolulu' });
    try {
      const end = vi.spyOn(own, 'end');
      const { session, dir, running, holdCancel, releaseCancel } = await runningBatch({ reader: own });
      holdCancel();
      let disposed = false;
      const disposing = session.dispose().then(() => {
        disposed = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      // The cancel is still settling: quitting now could leave files under temp names.
      expect(disposed).toBe(false);
      expect(session.isBusy()).toBe(true);
      expect(end).not.toHaveBeenCalled();

      releaseCancel();
      await disposing;
      expect(session.isBusy()).toBe(false);
      expect(end).toHaveBeenCalledTimes(1);
      expect(await running).toMatchObject({ status: 'cancelled', rollback: { complete: true } });
      expect(readdirSync(dir)).toEqual(['photo.jpg']);
    } finally {
      await own.end();
    }
  });
});

describe('Session.whenIdle', () => {
  it('resolves at once when no rename or undo runs', async () => {
    const { session } = setup();
    await expect(session.whenIdle()).resolves.toBeUndefined();
  });

  it('resolves once the running rename has finished', async () => {
    const { session, running, release } = await runningBatch();
    let idle = false;
    let busyWhenIdle: boolean | null = null;
    const waiting = session.whenIdle().then(() => {
      idle = true;
      busyWhenIdle = session.isBusy();
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(idle).toBe(false);

    release();
    expect(await running).toMatchObject({ status: 'done' });
    await waiting;
    expect(busyWhenIdle).toBe(false);
  });

  it('resolves once a cancelled rename has rolled back', async () => {
    const { session, dir, running, holdCancel, releaseCancel } = await runningBatch();
    holdCancel();
    session.cancel();
    let idle = false;
    const waiting = session.whenIdle().then(() => {
      idle = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(idle).toBe(false);

    releaseCancel();
    await waiting;
    expect(readdirSync(dir)).toEqual(['photo.jpg']);
    expect(await running).toMatchObject({ status: 'cancelled', rollback: { complete: true } });
  });

  it('resolves once the running undo has finished', async () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'a.txt'), 'a');
    const reads = heldReads();
    const { session } = setup({ reader: reads.reader });
    const view = await ready(session, [dir], { pattern: 'renamed' });
    expect(await session.execute(view.planId)).toMatchObject({ status: 'done' });
    // Undo waits for the rescan's held read before it touches anything.
    const reading = reads.hold();
    await session.scan([dir], ALL);
    await reading;
    const undoing = session.undo();
    let idle = false;
    const waiting = session.whenIdle().then(() => {
      idle = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(idle).toBe(false);

    reads.release();
    await waiting;
    expect(readdirSync(dir)).toEqual(['a.txt']);
    expect(await undoing).toMatchObject({ status: 'done', restored: 1 });
  });
});

describe('throttle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Calls at t=0, t=50 and t=120; the clock stops at t=120. */
  function burst() {
    const seen: string[] = [];
    const report = throttle((v: string) => seen.push(v), 200);
    report('t0');
    vi.advanceTimersByTime(50);
    report('t50');
    vi.advanceTimersByTime(70);
    report('t120');
    return { seen, report };
  }

  it('runs the first call at once and the latest dropped call when the interval ends', () => {
    const { seen } = burst();
    expect(seen).toEqual(['t0']);
    vi.advanceTimersByTime(79);
    expect(seen).toEqual(['t0']);
    vi.advanceTimersByTime(1);
    expect(seen).toEqual(['t0', 't120']);
    vi.advanceTimersByTime(1000);
    expect(seen).toEqual(['t0', 't120']);
  });

  it('runs a forced call at once and drops the waiting call', () => {
    const { seen, report } = burst();
    report('forced', true);
    expect(seen).toEqual(['t0', 'forced']);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(seen).toEqual(['t0', 'forced']);
  });

  it('drops the waiting call on cancel()', () => {
    const { seen, report } = burst();
    report.cancel();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(seen).toEqual(['t0']);
  });
});

describe('Session presets', () => {
  it('saves, lists and deletes presets, cleaning the settings it is given', async () => {
    const { session } = setup();
    const bad = settings({ pattern: 'Trip_{seq}', sequence: { ...DEFAULT_SETTINGS.sequence, digits: 99 } });

    const saved = await session.savePreset('Vacation', bad);
    expect(saved.map((p) => p.name)).toEqual(['Vacation']);
    expect(saved[0]?.settings.pattern).toBe('Trip_{seq}');
    expect(saved[0]?.settings.sequence.digits).toBe(3);
    expect(await session.listPresets()).toEqual(saved);
    expect(await session.deletePreset('vacation')).toEqual([]);
  });

  it('rejects a preset without a name', async () => {
    const { session } = setup();
    await expect(session.savePreset('  ', settings())).rejects.toThrow('A preset needs a name');
  });
});

describe('Session: more features', () => {
  it('passes folder mode and the name filter to the scanner, renames folders and reports the changes', async () => {
    const dir = tempDir();
    mkdirSync(path.join(dir, 'beach'));
    mkdirSync(path.join(dir, 'city'));
    writeFileSync(path.join(dir, 'loose.txt'), 'x');
    const { session } = setup();
    const summary = await session.scan([dir], { ...ALL, mode: 'folders' });
    expect(summary?.total).toBe(2);
    expect(summary?.extensionsFound).toEqual([]);
    await session.whenRead();
    const view = await session.buildPlan({ settings: settings({ pattern: 'Album_{seq}', sequence: byName }), excluded: [] });
    expect(view.rows.map((r) => [r.currentName, r.newName])).toEqual([['beach', 'Album_001'], ['city', 'Album_002']]);
    const outcome = await session.execute(view.planId);
    expect(outcome.status).toBe('done');
    expect(readdirSync(dir).sort()).toEqual(['Album_001', 'Album_002', 'loose.txt']);
    expect(outcome.status === 'done' ? outcome.changes : null).toEqual([
      { from: path.join(dir, 'beach'), to: path.join(dir, 'Album_001') },
      { from: path.join(dir, 'city'), to: path.join(dir, 'Album_002') },
    ]);
    await session.undo();
    expect(readdirSync(dir).sort()).toEqual(['beach', 'city', 'loose.txt']);
    const filtered = await session.scan([dir], { ...ALL, mode: 'folders', name: { text: 'ci', regex: false } });
    expect(filtered?.total).toBe(1);
  });

  it('hashes files only when the pattern asks for it, and remembers the hashes', async () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'a.txt'), 'abc');
    const { session } = setup();
    await session.scan([dir], ALL);
    await session.whenRead();
    const plain = await session.buildPlan({ settings: settings({ pattern: '{name}' }), excluded: [] });
    expect(plain.rows[0]?.newName).toBe('a.txt');
    expect(session.hashesHeld()).toBe(0);
    const hashed = await session.buildPlan({ settings: settings({ pattern: '{crc32}_{md5}' }), excluded: [] });
    expect(hashed.rows[0]?.newName).toBe('352441c2_900150983cd24fb0d6963f7d28e17f72.txt');
    expect(session.hashesHeld()).toBe(1);
    expect(session.tokenValues()?.values.crc32).toBe('352441c2');
  });

  it('uses a date from the file name in the preview and in token values, unshifted and switchable', async () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'IMG_20240102_101112.txt'), 'x');
    const { session } = setup();
    await session.scan([dir], ALL);
    await session.whenRead();
    const view = await session.buildPlan({
      settings: settings({ pattern: '{date_taken:YYYY-MM-DD_HH-mm}', dates: { ...DEFAULT_SETTINGS.dates, shiftMinutes: 90 } }),
      excluded: [],
    });
    expect(view.rows[0]?.newName).toBe('2024-01-02_10-11.txt');
    expect(view.rows[0]?.dateSource).toBe('name');
    expect(session.tokenValues()?.values.date_taken).toBe('2024-01-02');
    const off = await session.buildPlan({
      settings: settings({ pattern: '{date_taken:YYYY}', dates: { ...DEFAULT_SETTINGS.dates, useNameDate: false } }),
      excluded: [],
    });
    // The name date is off, so date_taken falls through the filesystem chain. Which stop it
    // reaches depends on whether this OS records a birthtime for the temp file.
    expect(['created', 'modified']).toContain(off.rows[0]?.dateSource);
  });

  it('applies typed names and a manual order from the request', async () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'a.txt'), 'x');
    writeFileSync(path.join(dir, 'b.txt'), 'x');
    const { session } = setup();
    await session.scan([dir], ALL);
    await session.whenRead();
    const view = await session.buildPlan({
      settings: settings({ pattern: '{seq}', sequence: { ...DEFAULT_SETTINGS.sequence, sortBy: 'manual' } }),
      excluded: [],
      overrides: { [path.join(dir, 'a.txt')]: 'typed' },
      manualOrder: [path.join(dir, 'b.txt'), path.join(dir, 'a.txt')],
    });
    expect(view.rows.map((r) => [r.currentName, r.newName])).toEqual([['b.txt', '001.txt'], ['a.txt', 'typed.txt']]);
    expect(view.rows[1]?.flags.map((f) => f.code)).toContain('edited');
  });

  it('does not keep a plan built while a newer scan replaced the files', async () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'a.txt'), 'abc');
    const other = tempDir();
    writeFileSync(path.join(other, 'b.txt'), 'x');
    const { session } = setup();
    await session.scan([dir], ALL);
    await session.whenRead();
    const building = session.buildPlan({ settings: settings({ pattern: '{md5}' }), excluded: [] });
    await session.scan([other], ALL);
    const view = await building;
    expect(view.complete).toBe(false);
    expect(await session.execute(view.planId)).toMatchObject({ status: 'not-ready' });
  });

  // I2: two buildPlan calls can be in flight together (a debounced settings change firing while
  // an earlier, hashing build is still reading files). Whichever *started* last must win, even
  // when it *finishes* first, or Rename gets permanently stuck on "The preview changed."
  it('keeps the newer plan even when an older, slower (hashing) build finishes after it', async () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'a.txt'), 'abc');
    const { session } = setup();
    await session.scan([dir], ALL);
    await session.whenRead();

    // Started first, but hashing real files takes real I/O, so it resolves after the plain
    // build below even though nothing here awaits in between the two calls.
    const older = session.buildPlan({ settings: settings({ pattern: '{md5}' }), excluded: [] });
    const newer = await session.buildPlan({ settings: settings({ pattern: '{name}' }), excluded: [] });
    await older;

    // The renderer is showing `newer` (the plan build main answered last to be requested);
    // it must still be runnable, not overwritten by the older build finishing later.
    expect(await session.execute(newer.planId)).toMatchObject({ status: 'done' });
    expect(readdirSync(dir)).toEqual(['a.txt']);
  });
});

describe('preview access', () => {
  it('knows which files are in the batch, and forgets them on clear', async () => {
    const dir = tempDir();
    copyFileSync(path.join(MEDIA, 'photo.jpg'), path.join(dir, 'photo.jpg'));
    const { session } = setup();
    await session.scan([dir], ALL);
    await session.whenRead();
    const photo = path.join(dir, 'photo.jpg');
    expect(session.hasFile(photo)).toBe(true);
    expect(session.hasFile(path.join(dir, 'other.jpg'))).toBe(false);
    expect(session.fileDetails(photo)).toEqual({ size: 3514, width: 64, height: 48, durationSeconds: null });
    expect(session.fileDetails('/nowhere.jpg')).toBeNull();
    session.clear();
    expect(session.hasFile(photo)).toBe(false);
  });

  it('never lets the preview reach folders in folder mode', async () => {
    const dir = tempDir();
    mkdirSync(path.join(dir, 'Trip'));
    const { session } = setup();
    await session.scan([dir], { ...ALL, mode: 'folders' });
    expect(session.hasFile(path.join(dir, 'Trip'))).toBe(false);
    expect(await session.embeddedJpeg(path.join(dir, 'Trip'))).toBeNull();
  });
});
