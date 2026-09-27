import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeExtension } from './extensions.js';
import { nameKey } from './names.js';
import { DEFAULT_SETTINGS, type RenameSettings } from './types.js';

export interface Preset {
  name: string;
  settings: RenameSettings;
}

interface PresetFile {
  version: 1;
  presets: unknown[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

// Type validation helpers
const bool = (v: unknown, fallback: boolean): boolean => typeof v === 'boolean' ? v : fallback;
const oneOf = <T extends readonly unknown[]>(v: unknown, options: T, fallback: T[number]): T[number] => options.includes(v) ? (v as T[number]) : fallback;
const int = (v: unknown, fallback: number, min?: number, max?: number): number => {
  if (!Number.isInteger(v)) return fallback;
  const n = v as number;
  if (min !== undefined && n < min) return fallback;
  if (max !== undefined && n > max) return fallback;
  return n;
};
const stringOrNull = (v: unknown, fallback: string | null): string | null => typeof v === 'string' || v === null ? (v as string | null) : fallback;
const stringArray = (v: unknown, fallback: string[] | null): string[] | null => {
  if (Array.isArray(v) && v.every((e) => typeof e === 'string')) return v as string[];
  return v === null ? null : fallback;
};
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const dateOrNull = (v: unknown): string | null => (typeof v === 'string' && DATE_ONLY.test(v) ? v : null);
const intOrNull = (v: unknown, min: number): number | null =>
  Number.isInteger(v) && (v as number) >= min ? (v as number) : null;

/** Fills in anything an older or hand-edited preset file lacks. */
export function withDefaults(partial: unknown): RenameSettings {
  const p = (isObject(partial) ? partial : {}) as Record<string, unknown>;

  const seq = isObject(p.sequence) ? (p.sequence as Record<string, unknown>) : {};
  const cleanup = isObject(p.cleanup) ? (p.cleanup as Record<string, unknown>) : {};
  const move = isObject(p.move) ? (p.move as Record<string, unknown>) : {};
  const dates = isObject(p.dates) ? (p.dates as Record<string, unknown>) : {};

  return {
    pattern: typeof p.pattern === 'string' ? p.pattern : DEFAULT_SETTINGS.pattern,
    sequence: {
      sortBy: oneOf(seq.sortBy, ['dateTaken', 'created', 'modified', 'name', 'manual'] as const, DEFAULT_SETTINGS.sequence.sortBy),
      direction: oneOf(seq.direction, ['asc', 'desc'] as const, DEFAULT_SETTINGS.sequence.direction),
      start: int(seq.start, DEFAULT_SETTINGS.sequence.start, 0, 999_999_999),
      step: int(seq.step, DEFAULT_SETTINGS.sequence.step, 1, 1_000_000),
      digits: int(seq.digits, DEFAULT_SETTINGS.sequence.digits, 1, 10),
      restartPerFolder: bool(seq.restartPerFolder, DEFAULT_SETTINGS.sequence.restartPerFolder),
      restartEvery: oneOf(seq.restartEvery, ['never', 'day', 'month', 'year'] as const, DEFAULT_SETTINGS.sequence.restartEvery),
      keepGroupsTogether: bool(seq.keepGroupsTogether, DEFAULT_SETTINGS.sequence.keepGroupsTogether),
    },
    findReplace: Array.isArray(p.findReplace)
      ? p.findReplace
          .filter(
            (item): item is { find: string; replace: string; regex: boolean; matchCase: boolean; scope?: unknown } =>
              isObject(item) && typeof item.find === 'string' && typeof item.replace === 'string' &&
              typeof item.regex === 'boolean' && typeof item.matchCase === 'boolean',
          )
          .map((item) => {
            const rule: RenameSettings['findReplace'][number] = {
              find: item.find, replace: item.replace, regex: item.regex, matchCase: item.matchCase,
            };
            if (item.scope === 'original' || item.scope === 'result') rule.scope = item.scope;
            return rule;
          })
      : [],
    cleanup: {
      caseMode: oneOf(
        cleanup.caseMode,
        ['none', 'lower', 'upper', 'title', 'sentence', 'snake', 'kebab', 'camel'] as const,
        DEFAULT_SETTINGS.cleanup.caseMode,
      ),
      spacesToUnderscores: bool(cleanup.spacesToUnderscores, DEFAULT_SETTINGS.cleanup.spacesToUnderscores),
      lowercaseExtension: bool(cleanup.lowercaseExtension, DEFAULT_SETTINGS.cleanup.lowercaseExtension),
      stripDiacritics: bool(cleanup.stripDiacritics, DEFAULT_SETTINGS.cleanup.stripDiacritics),
      asciiOnly: bool(cleanup.asciiOnly, DEFAULT_SETTINGS.cleanup.asciiOnly),
      extensionRules: Array.isArray(cleanup.extensionRules)
        ? cleanup.extensionRules
            .filter((r): r is { from: string; to: string } => isObject(r) && typeof r.from === 'string' && typeof r.to === 'string')
            .map((r) => ({ from: normalizeExtension(r.from), to: normalizeExtension(r.to) }))
            .filter((r) => r.from !== '')
        : [],
    },
    move: {
      destinationRoot: stringOrNull(move.destinationRoot, DEFAULT_SETTINGS.move.destinationRoot),
    },
    dates: {
      setModified: bool(dates.setModified, DEFAULT_SETTINGS.dates.setModified),
      setCreated: bool(dates.setCreated, DEFAULT_SETTINGS.dates.setCreated),
      shiftMinutes: int(dates.shiftMinutes, DEFAULT_SETTINGS.dates.shiftMinutes, -1_000_000, 1_000_000),
      useNameDate: bool(dates.useNameDate, DEFAULT_SETTINGS.dates.useNameDate),
    },
    filter: filterWithDefaults(p.filter),
  };
}

/** A scan filter from untrusted input (a preset file or the renderer), with defaults filled in. */
export function filterWithDefaults(v: unknown): RenameSettings['filter'] {
  const filter = isObject(v) ? v : {};
  return {
    includeSubfolders: bool(filter.includeSubfolders, DEFAULT_SETTINGS.filter.includeSubfolders),
    extensions: stringArray(filter.extensions, DEFAULT_SETTINGS.filter.extensions),
    mode: oneOf(filter.mode, ['files', 'folders'] as const, DEFAULT_SETTINGS.filter.mode),
    name: {
      text: isObject(filter.name) && typeof filter.name.text === 'string' ? filter.name.text : '',
      regex: isObject(filter.name) ? bool(filter.name.regex, false) : false,
    },
    minBytes: intOrNull(filter.minBytes, 0),
    maxBytes: intOrNull(filter.maxBytes, 0),
    modifiedFrom: dateOrNull(filter.modifiedFrom),
    modifiedTo: dateOrNull(filter.modifiedTo),
  };
}

export class PresetStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly file: string) {}

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async readRaw(): Promise<unknown[]> {
    let text: string;
    try {
      text = await readFile(this.file, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error(`The presets file is damaged (${this.file}): ${(e as Error).message}`);
    }
    const presets = isObject(data) && Array.isArray(data.presets) ? data.presets : [];
    return presets;
  }

  async list(): Promise<Preset[]> {
    const raw = await this.readRaw();
    return raw
      .filter((p): p is { name: string; settings: unknown } => isObject(p) && typeof p.name === 'string')
      .map((p) => ({ name: p.name, settings: withDefaults(p.settings) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async save(name: string, settings: RenameSettings): Promise<void> {
    return this.serialize(async () => {
      const trimmed = name.trim();
      if (trimmed === '') throw new Error('A preset needs a name');
      const raw = await this.readRaw();
      const filtered = raw.filter(
        (p) => !(isObject(p) && typeof p.name === 'string' && nameKey(p.name) === nameKey(trimmed))
      );
      filtered.push({ name: trimmed, settings });
      await this.write(filtered);
    });
  }

  async remove(name: string): Promise<void> {
    return this.serialize(async () => {
      const trimmed = name.trim();
      const raw = await this.readRaw();
      const filtered = raw.filter(
        (p) => !(isObject(p) && typeof p.name === 'string' && nameKey(p.name) === nameKey(trimmed))
      );
      await this.write(filtered);
    });
  }

  private async write(presets: unknown[]): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    const body: PresetFile = { version: 1, presets };
    await writeFile(tmp, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
    await rename(tmp, this.file);
  }
}
