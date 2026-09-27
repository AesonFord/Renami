import { DEFAULT_DATE_FORMAT, formatWallClock } from '../dateFormat.js';
import { fallbackMessage, resolveDate } from '../dates.js';
import type { DateSource, Flag, WallClock } from '../types.js';
import type { PatternNode } from './parse.js';
import { TOKENS, type RenderContext, type TokenName } from './tokens.js';

/** One piece of a rendered segment. `token` marks text that came from a token (possibly empty). */
export interface Part {
  text: string;
  token: boolean;
}

export interface RenderResult {
  /** Folder segments first; the last segment is the file name without extension. */
  segments: Part[][];
  flags: Flag[];
  /** The date used by the first date token, for the preview's "Date used" column. */
  firstDate: { value: WallClock; source: DateSource } | null;
}

export function renderPattern(nodes: readonly PatternNode[], ctx: RenderContext): RenderResult {
  let current: Part[] = [];
  const segments: Part[][] = [current];
  const flags: Flag[] = [];
  let firstDate: RenderResult['firstDate'] = null;

  const addFlag = (flag: Flag): void => {
    if (!flags.some((f) => f.code === flag.code && f.message === flag.message)) flags.push(flag);
  };

  for (const node of nodes) {
    if (node.type === 'text') {
      current.push({ text: node.value, token: false });
      continue;
    }
    if (node.type === 'separator') {
      current = [];
      segments.push(current);
      continue;
    }

    const def = TOKENS[node.name];
    if (def.kind === 'date') {
      const r = resolveDate(ctx.meta, def.date);
      if (r.fellBack) {
        addFlag({ level: 'warning', code: 'fallback-date', message: fallbackMessage(def.date, r.source) });
      }
      firstDate ??= { value: r.value, source: r.source };
      current.push({ text: formatWallClock(r.value, node.format ?? DEFAULT_DATE_FORMAT), token: true });
      continue;
    }

    let value: string | undefined;
    if (def.kind === 'number') {
      const n = def.get(ctx);
      if (n !== undefined && Number.isFinite(n)) {
        const digits = node.format !== null ? Number(node.format) : def.defaultDigits(ctx);
        value = String(Math.trunc(n)).padStart(digits, '0');
      }
    } else {
      const s = def.get(ctx);
      value = s === undefined || s.trim() === '' ? undefined : s;
    }

    if (value === undefined) {
      if (node.fallback !== null) {
        value = node.fallback;
      } else {
        addFlag({ level: 'warning', code: 'missing-value', message: `No ${def.label} for this file` });
        value = '';
      }
    }
    current.push({ text: value, token: true });
  }

  return { segments, flags, firstDate };
}

/**
 * Every token's value for one file, as "All tokens…" shows it. null means the token
 * has no value here, so a pattern using it without a default would get a Missing value warning.
 */
export function tokenValues(ctx: RenderContext): Record<TokenName, string | null> {
  const out = {} as Record<TokenName, string | null>;
  for (const name of Object.keys(TOKENS) as TokenName[]) {
    const r = renderPattern([{ type: 'token', name, format: null, fallback: null }], ctx);
    out[name] = r.flags.some((f) => f.code === 'missing-value')
      ? null
      : r.segments.flat().map((p) => p.text).join('');
  }
  return out;
}
