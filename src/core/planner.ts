import nodePath from 'node:path';
import { cleanSegment, utf8Bytes, type CleanupOptions } from './cleanup.js';
import { effectiveMetadata, fsMetadata, resolveDate, sortKeyToDateKind } from './dates.js';
import { applyExtensionRules } from './extensions.js';
import { applyFindReplace, rulesFor, validateRules } from './findReplace.js';
import { buildGroups, choosePrimary, type FileGroup } from './groups.js';
import { nameKey } from './names.js';
import { assignSequence, sortGroups } from './sequencer.js';
import { parsePattern, type PatternNode } from './template/parse.js';
import { renderPattern } from './template/render.js';
import type {
  FileEntry,
  FileMetadata,
  Flag,
  FsView,
  Plan,
  PlanItem,
  PlannedDates,
  Platform,
  RenameSettings,
  WallClock,
} from './types.js';
import { systemTimeZone } from './wallclock.js';

export type PathApi = Pick<typeof nodePath, 'join' | 'basename' | 'resolve' | 'isAbsolute'>;

export interface PlanInput {
  entries: readonly FileEntry[];
  metadata: ReadonlyMap<string, FileMetadata>;
  settings: RenameSettings;
  fs: FsView;
  platform: Platform;
  /** IANA zone for filesystem dates of files not read yet. Defaults to the system zone. */
  timeZone?: string;
  /** Defaults to node:path. Tests pass path.posix. */
  path?: PathApi;
  planId?: string;
  /** New name stems the user typed or imported, by source path. Cleanup still applies. */
  overrides?: ReadonlyMap<string, string>;
  /** Source paths in the user's order, for sortBy 'manual'. */
  manualOrder?: readonly string[];
  /**
   * Source paths the user left out of the batch. They keep their place in the order and their
   * names on disk, but take no sequence number and are never touched.
   */
  excluded?: ReadonlySet<string>;
}

const MAX_SEGMENT_BYTES = 255;
const WINDOWS_MAX_PATH = 260;

interface Draft {
  entry: FileEntry;
  group: FileGroup;
  seq: number;
  targetDir: string;
  stem: string;
  ext: string;
  flags: Flag[];
  error: boolean;
  excluded: boolean;
  dateUsed: PlanItem['dateUsed'];
  setDates: PlannedDates;
}

const withExt = (stem: string, ext: string): string => (ext ? `${stem}.${ext}` : stem);
const fileNameOf = (e: FileEntry): string => withExt(e.stem, e.ext);
const error = (code: Flag['code'], message: string): Flag => ({ level: 'error', code, message });
const warning = (code: Flag['code'], message: string): Flag => ({ level: 'warning', code, message });

let planCounter = 0;
const newPlanId = (): string => `plan-${Date.now().toString(36)}-${(planCounter += 1)}`;

export function buildPlan(input: PlanInput): Plan {
  const { settings, fs, platform } = input;
  const p = input.path ?? nodePath;
  const timeZone = input.timeZone ?? systemTimeZone();
  const id = input.planId ?? newPlanId();
  // Grouping, sorting and drafting each ask for the same entries' metadata; work it out once.
  const metaCache = new Map<FileEntry, FileMetadata>();
  const getMeta = (e: FileEntry): FileMetadata => {
    let meta = metaCache.get(e);
    if (!meta) {
      meta = effectiveMetadata(input.metadata.get(e.path) ?? fsMetadata(e, timeZone), settings.dates);
      metaCache.set(e, meta);
    }
    return meta;
  };

  const excluded = input.excluded ?? new Set<string>();

  // Groups and order come from every file, so an excluded file keeps its place. Each group is
  // then planned as only its included members (`planned`), which is what gets numbered.
  const groups = buildGroups(input.entries, getMeta, settings.sequence.keepGroupsTogether);
  const sorted = sortGroups(groups, getMeta, settings.sequence.sortBy, settings.sequence.direction, input.manualOrder ?? []);
  const planned = new Map<FileGroup, FileGroup>();
  for (const g of sorted) {
    const members = g.members.filter((m) => !excluded.has(m.path));
    if (members.length === g.members.length) planned.set(g, g);
    else if (members.length > 0) {
      const primary = members.includes(g.primary) ? g.primary : choosePrimary(members, getMeta);
      planned.set(g, { id: members.length === 1 ? primary.path : g.id, members, primary });
    }
  }
  const sortKind = sortKeyToDateKind(settings.sequence.sortBy);
  // Restart periods come from the sort date, or the date taken (with its fallbacks) when sorting by name or by hand.
  const dateOf = (g: FileGroup): WallClock => resolveDate(getMeta(g.primary), sortKind ?? 'date_taken').value;
  const seqs = assignSequence([...planned.values()], settings.sequence, dateOf);
  const originalRules = rulesFor(settings.findReplace, 'original');
  const resultRules = rulesFor(settings.findReplace, 'result');
  const cleanupOpts: CleanupOptions = settings.cleanup;

  const excludedItem = (entry: FileEntry): PlanItem => ({
    source: entry,
    target: entry.path,
    kind: 'excluded',
    flags: [],
    seq: 0,
    groupId: null,
    dateUsed: null,
    stem: entry.stem,
    ext: entry.ext,
    setDates: {},
  });

  // Shared shape for a plan that is entirely errors: every included entry, in sequence order,
  // with its real seq/groupId but no target change and one flag.
  const allErrors = (flag: Flag): PlanItem[] =>
    sorted.flatMap((g) => {
      const pg = planned.get(g);
      return g.members.map((entry): PlanItem =>
        !pg || excluded.has(entry.path)
          ? excludedItem(entry)
          : {
              source: entry,
              target: entry.path,
              kind: 'error',
              flags: [flag],
              seq: seqs.get(pg.id) ?? 0,
              groupId: pg.members.length > 1 ? pg.id : null,
              dateUsed: null,
              stem: entry.stem,
              ext: entry.ext,
              setDates: {},
            },
      );
    });
  const errorCount = (items: readonly PlanItem[]): number => items.filter((i) => i.kind === 'error').length;

  const destinationRoot = settings.move.destinationRoot;
  if (destinationRoot !== null && !p.isAbsolute(destinationRoot)) {
    const items = allErrors(error('destination-unwritable', 'The destination folder must be a full path'));
    return { id, items, patternError: null, errorCount: errorCount(items), settings };
  }
  // p.resolve strips a trailing separator and any relative segments, so a destination folder
  // is compared and joined consistently everywhere below.
  const resolvedRoot = destinationRoot !== null ? p.resolve(destinationRoot) : null;

  const parsed = parsePattern(settings.pattern);
  const rulesError = validateRules(settings.findReplace);
  if (!parsed.ok || rulesError !== null) {
    const message = !parsed.ok ? parsed.error : (rulesError ?? '');
    const items = allErrors(error('pattern-error', message));
    return { id, items, patternError: message, errorCount: errorCount(items), settings };
  }

  const drafts = sorted.flatMap((g) => {
    const pg = planned.get(g);
    const included = pg ? draftGroup(pg, parsed.nodes, seqs.get(pg.id) ?? 0) : [];
    // Members stay in the group's order, excluded ones in between.
    return g.members.map((entry) => included.find((d) => d.entry === entry) ?? excludedDraft(entry, g));
  });
  const items = resolveConflicts(drafts);
  return { id, items, patternError: null, errorCount: errorCount(items), settings };

  function excludedDraft(entry: FileEntry, group: FileGroup): Draft {
    return {
      entry, group, seq: 0, targetDir: entry.dir, stem: entry.stem, ext: entry.ext,
      flags: [], error: false, excluded: true, dateUsed: null, setDates: {},
    };
  }

  function draftGroup(group: FileGroup, nodes: readonly PatternNode[], seq: number): Draft[] {
    const meta = getMeta(group.primary);
    const name = applyFindReplace(group.primary.stem, originalRules);
    const rendered = renderPattern(nodes, {
      entry: group.primary,
      meta,
      name,
      seq,
      defaultDigits: settings.sequence.digits,
    });
    const cleaned = rendered.segments.map((s) => cleanSegment(s, cleanupOpts));
    const folders = cleaned.slice(0, -1);
    let stem = cleaned[cleaned.length - 1] ?? '';
    // A typed name replaces what the pattern made, so the pattern's own warnings don't apply.
    const override = group.members
      .map((m) => input.overrides?.get(m.path))
      .find((o): o is string => o !== undefined && o.trim() !== '');
    const groupFlags: Flag[] = override === undefined ? [...rendered.flags] : [];
    if (override !== undefined) {
      stem = cleanSegment([{ text: override.trim(), token: false }], cleanupOpts);
      groupFlags.push({ level: 'info', code: 'edited', message: 'Name typed by hand' });
    } else if (resultRules.length > 0) {
      stem = cleanSegment([{ text: applyFindReplace(stem, resultRules), token: false }], cleanupOpts);
    }
    const baseDir = resolvedRoot ?? group.primary.dir;
    const targetDir = folders.length > 0 ? p.join(baseDir, ...folders) : baseDir;

    if (stem === '') groupFlags.push(error('empty-segment', 'The new name is empty'));
    else if (folders.includes('')) groupFlags.push(error('empty-segment', 'A folder name in the pattern is empty'));
    for (const folder of folders) {
      if (utf8Bytes(folder) > MAX_SEGMENT_BYTES) {
        groupFlags.push(error('segment-too-long', `Folder name "${folder.slice(0, 24)}…" is longer than 255 bytes`));
      }
    }

    let dateUsed: PlanItem['dateUsed'] = rendered.firstDate;
    if (!dateUsed && sortKind) {
      const r = resolveDate(meta, sortKind);
      dateUsed = { value: r.value, source: r.source };
    }

    const setDates: PlannedDates = {};
    // Linux has no settable created date, so asking only for it wants nothing there.
    const setCreated = settings.dates.setCreated && platform !== 'linux';
    const wantsDates = settings.dates.setModified || setCreated;
    if (wantsDates && meta.dateTaken) {
      if (settings.dates.setModified) setDates.modified = meta.dateTaken;
      if (setCreated) setDates.created = meta.dateTaken;
    } else if (wantsDates && !group.primary.isDir) {
      groupFlags.push(warning('no-date-taken', 'No date taken in this file; its dates are left unchanged'));
    }

    return group.members.map((entry) => {
      const flags = [...groupFlags];
      const memberMeta = getMeta(entry);
      if (memberMeta.readError) {
        flags.push(warning('metadata-unreadable', `Couldn't read metadata: ${memberMeta.readError}`));
      }
      if (group.members.length > 1) {
        const others = group.members.filter((m) => m !== entry).map(fileNameOf).join(', ');
        flags.push({ level: 'info', code: 'paired', message: `Paired with ${others}` });
      }
      const ext = entry.isDir
        ? ''
        : applyExtensionRules(entry.ext, settings.cleanup.extensionRules, settings.cleanup.lowercaseExtension);
      if (entry.isDir) {
        const self = nameKey(entry.path);
        const into = nameKey(targetDir);
        if (into === self || into.startsWith(`${self}/`) || into.startsWith(`${self}\\`)) {
          flags.push(error('destination-unwritable', "A folder can't be moved into itself"));
        }
      }
      if (stem !== '' && utf8Bytes(withExt(stem, ext)) > MAX_SEGMENT_BYTES) {
        flags.push(error('segment-too-long', 'The new name is longer than 255 bytes'));
      }
      const staysPut = targetDir === entry.dir && withExt(stem, ext) === fileNameOf(entry);
      if (!staysPut && !fs.isWritableDir(fs.nearestExisting(targetDir))) {
        flags.push(error('destination-unwritable', `Can't write to ${fs.nearestExisting(targetDir)}`));
      }
      return {
        entry,
        group,
        seq,
        targetDir,
        stem,
        ext,
        flags,
        error: flags.some((f) => f.level === 'error'),
        excluded: false,
        dateUsed,
        setDates: { ...setDates },
      };
    });
  }

  function resolveConflicts(all: Draft[]): PlanItem[] {
    // Names that batch files will give up, keyed by folder.
    // An excluded file keeps its name, so it never vacates one.
    const vacated = new Map<string, Set<string>>();
    for (const d of all) {
      if (d.error || d.excluded) continue;
      const key = nameKey(d.entry.dir);
      const set = vacated.get(key) ?? new Set<string>();
      set.add(nameKey(fileNameOf(d.entry)));
      vacated.set(key, set);
    }
    const occupiedCache = new Map<string, Set<string>>();
    const occupied = (dir: string): Set<string> => {
      const key = nameKey(dir);
      let set = occupiedCache.get(key);
      if (!set) {
        set = new Set((fs.listDir(dir) ?? []).map(nameKey));
        for (const k of vacated.get(key) ?? []) set.delete(k);
        occupiedCache.set(key, set);
      }
      return set;
    };
    const claimed = new Map<string, Set<string>>();
    const claimedIn = (dir: string): Set<string> => {
      const key = nameKey(dir);
      const set = claimed.get(key) ?? new Set<string>();
      claimed.set(key, set);
      return set;
    };
    // Claimed names only grow within one plan, so once a suffix search for a given candidate
    // base succeeds at n, no unit sharing that base can ever need a suffix below n+1 again.
    // Caching the next value to try avoids the O(k^2) restart-from-1 scan for k colliding units.
    const nextSuffix = new Map<string, number>();

    // Units share one suffix: a group, unless its members would collide with each other. An
    // excluded member stands alone and doesn't split the unit around it.
    const units: Draft[][] = [];
    let open: Draft[] | undefined;
    for (const d of all) {
      if (d.excluded) units.push([d]);
      else if (!d.error && open && open[0]?.group === d.group) open.push(d);
      else {
        const unit = [d];
        units.push(unit);
        open = d.error ? undefined : unit;
      }
    }
    const splitUnits = units.flatMap((u) => {
      const keys = u.map((d) => nameKey(withExt(d.stem, d.ext)));
      return new Set(keys).size === keys.length ? [u] : u.map((d) => [d]);
    });

    const items: PlanItem[] = [];
    for (const unit of splitUnits) {
      const first = unit[0];
      if (!first) continue;
      if (first.excluded) {
        items.push(excludedItem(first.entry));
        continue;
      }
      if (first.error) {
        items.push(toItem(first, first.entry.path, 'error', first.flags, first.stem));
        continue;
      }
      // JSON keeps folder, stem and extension apart: '/Trip' + '2024 Beach' must not equal '/Trip 2024' + 'Beach'.
      const baseKey = JSON.stringify(unit.map((d) => [nameKey(d.targetDir), nameKey(d.stem), nameKey(d.ext)]));
      let n = nextSuffix.get(baseKey) ?? 1;
      let names: string[] = [];
      for (;; n += 1) {
        const suffix = n === 1 ? '' : `_${n}`;
        names = unit.map((d) => withExt(d.stem + suffix, d.ext));
        const free = unit.every((d, i) => {
          const k = nameKey(names[i] ?? '');
          return !occupied(d.targetDir).has(k) && !claimedIn(d.targetDir).has(k);
        });
        if (free) break;
      }
      nextSuffix.set(baseKey, n + 1);
      const suffix = n === 1 ? '' : `_${n}`;
      unit.forEach((d, i) => {
        const stem = `${d.stem}${suffix}`;
        const name = names[i] ?? '';
        claimedIn(d.targetDir).add(nameKey(name));
        const target = p.join(d.targetDir, name);
        const flags = [...d.flags];
        if (n > 1) flags.push(warning('suffix-added', `Added _${n} because the name was already taken`));

        if (platform === 'win32' && target.length >= WINDOWS_MAX_PATH) {
          flags.push(error('path-too-long', 'The full path is longer than Windows allows (260 characters)'));
          items.push(toItem(d, d.entry.path, 'error', flags, stem));
          return;
        }
        if (target === d.entry.path) {
          items.push(toItem(d, target, 'unchanged', flags, stem));
        } else if (nameKey(d.targetDir) === nameKey(d.entry.dir)) {
          items.push(toItem(d, target, 'rename', flags, stem));
        } else if (fs.deviceOf(fs.nearestExisting(d.targetDir)) !== d.entry.dev) {
          if (d.entry.isDir) {
            flags.push(error('folder-cross-drive', "Folders can't be moved to another drive"));
            items.push(toItem(d, d.entry.path, 'error', flags, stem));
            return;
          }
          flags.push(warning('cross-drive', 'Moves to another drive: copied, checked, then the original is deleted. The copy gets a new created date.'));
          items.push(toItem(d, target, 'cross-drive-move', flags, stem));
        } else {
          items.push(toItem(d, target, 'move', flags, stem));
        }
      });
    }
    // A unit that continued past an excluded member put its items after it; restore draft order.
    if (excluded.size === 0) return items;
    const order = new Map(all.map((d, i) => [d.entry.path, i]));
    return items.sort((x, y) => (order.get(x.source.path) ?? 0) - (order.get(y.source.path) ?? 0));
  }

  function toItem(d: Draft, target: string, kind: PlanItem['kind'], flags: Flag[], stem: string): PlanItem {
    return {
      source: d.entry,
      target,
      kind,
      flags,
      seq: d.seq,
      groupId: d.group.members.length > 1 ? d.group.id : null,
      dateUsed: d.dateUsed,
      stem,
      ext: d.ext,
      setDates: kind === 'error' ? {} : d.setDates,
    };
  }
}
