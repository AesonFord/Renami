import { appendFileSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';

/** One log line: ISO time, a tag, the error (stack when it has one). */
export function logLine(tag: string, error: unknown, now: Date = new Date()): string {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  return `${now.toISOString()} [${tag}] ${message}\n`;
}

/** Fire-and-forget append; a failing log must never become a second error. */
export function appendLog(file: string, tag: string, error: unknown): void {
  void appendFile(file, logLine(tag, error), 'utf8').catch(() => {});
}

/** Synchronous append for a line that must land before the process exits. Never throws. */
export function appendLogSync(file: string, tag: string, error: unknown): void {
  try {
    appendFileSync(file, logLine(tag, error), 'utf8');
  } catch {
    // A failing log must never become a second error.
  }
}

/**
 * The error box shown when the window keeps crashing. While a rename or undo runs, Renami waits
 * for it (and any rollback) to finish before quitting, and says so.
 */
export function crashLoopMessage(opts: {
  crashes: number;
  windowSeconds: number;
  reason: string;
  logFile: string;
  busy: boolean;
}): string {
  const when = opts.busy ? 'Renami will quit when the current rename or undo finishes' : 'Renami will quit';
  return `The window crashed ${opts.crashes} times within ${opts.windowSeconds} seconds (${opts.reason}), so ${when}. Details are in ${opts.logFile}.`;
}

/**
 * Sliding-window limit for crash reloads: a renderer that dies on every load (launch-failed,
 * integrity-failure, persistent OOM) would otherwise be reloaded forever. Returns a function that
 * says whether one more reload is allowed now; only allowed reloads count toward the window.
 */
export function reloadLimiter({
  max,
  windowMs,
  now = Date.now,
}: {
  max: number;
  windowMs: number;
  now?: () => number;
}): () => boolean {
  const recent: number[] = [];
  return () => {
    const t = now();
    while (recent.length > 0 && t - recent[0]! >= windowMs) recent.shift();
    if (recent.length >= max) return false;
    recent.push(t);
    return true;
  };
}
