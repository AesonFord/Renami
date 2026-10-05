import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import type { BatchFileRecord, BatchRecord } from '../core/index.js';

export const JOURNAL_VERSION = 1;

/** A journal file that can't be read or isn't one renami wrote. Exit code 1. */
export class JournalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JournalError';
  }
}

/** Writes the batch record to a temp file next to `file`, then renames it into place. */
export async function writeJournal(file: string, record: BatchRecord): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  const body = { version: JOURNAL_VERSION, tool: 'renami', record };
  try {
    await writeFile(tmp, `${JSON.stringify(body, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await rename(tmp, file);
  } catch (e) {
    await unlink(tmp).catch(() => undefined);
    throw e;
  }
}

export async function readJournal(file: string): Promise<BatchRecord> {
  let data: unknown;
  try {
    data = JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    throw new JournalError(`can't read the journal ${file}: ${(e as Error).message}`);
  }
  if (!isObject(data) || data.tool !== 'renami') throw new JournalError(`${file} is not a renami journal`);
  if (data.version !== JOURNAL_VERSION) {
    throw new JournalError(`${file} is a version ${String(data.version)} journal; this renami reads version ${JOURNAL_VERSION}`);
  }
  if (!isRecord(data.record)) throw new JournalError(`${file} is damaged: its batch record is incomplete`);
  return data.record;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isTimes = (v: unknown): boolean =>
  v === null || (isObject(v) && isNumber(v.atimeMs) && isNumber(v.mtimeMs) && (v.birthtimeMs === null || isNumber(v.birthtimeMs)));
const isFile = (v: unknown): v is BatchFileRecord =>
  isObject(v) &&
  typeof v.from === 'string' &&
  typeof v.to === 'string' &&
  isNumber(v.sizeAfter) &&
  isNumber(v.mtimeMsAfter) &&
  isTimes(v.originalTimes);
const isRecord = (v: unknown): v is BatchRecord =>
  isObject(v) &&
  typeof v.id === 'string' &&
  Array.isArray(v.files) &&
  v.files.every(isFile) &&
  Array.isArray(v.createdDirs) &&
  v.createdDirs.every((d) => typeof d === 'string') &&
  isNumber(v.finishedAt);
