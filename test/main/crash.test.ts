import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { appendLogSync, crashLoopMessage, logLine, reloadLimiter } from '../../src/main/crash.js';

describe('crashLoopMessage', () => {
  const base = { crashes: 4, windowSeconds: 60, reason: 'crashed', logFile: '/logs/renami.log' };

  it('says Renami will quit, with the count, reason and log file', () => {
    const text = crashLoopMessage({ ...base, busy: false });
    expect(text).toBe('The window crashed 4 times within 60 seconds (crashed), so Renami will quit. Details are in /logs/renami.log.');
  });

  it('says Renami waits for a running rename or undo before it quits', () => {
    const text = crashLoopMessage({ ...base, busy: true });
    expect(text).toContain('Renami will quit when the current rename or undo finishes');
    expect(text).toContain('/logs/renami.log');
  });
});

describe('logLine', () => {
  it('writes time, tag, and the stack of an Error', () => {
    const error = new Error('boom');
    const line = logLine('uncaught', error, new Date('2026-09-25T10:00:00Z'));
    expect(line).toMatch(/^2026-09-25T10:00:00\.000Z \[uncaught\] Error: boom/);
    expect(line.endsWith('\n')).toBe(true);
  });

  it('stringifies a non-Error value', () => {
    expect(logLine('renderer-gone', 'oom', new Date('2026-09-25T10:00:00Z'))).toBe(
      '2026-09-25T10:00:00.000Z [renderer-gone] oom\n',
    );
  });
});

describe('appendLogSync', () => {
  it('has the line on disk as soon as it returns', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'renami-log-')), 'renami.log');
    appendLogSync(file, 'startup', new Error('no window'));
    expect(readFileSync(file, 'utf8')).toMatch(/\[startup\] Error: no window/);
  });

  it('swallows a write that fails', () => {
    const missing = path.join(tmpdir(), 'no-such-dir-renami', 'x', 'renami.log');
    expect(() => appendLogSync(missing, 'startup', 'x')).not.toThrow();
  });
});

describe('reloadLimiter', () => {
  const clock = (start = 0) => {
    let t = start;
    return { now: () => t, advance: (ms: number) => (t += ms) };
  };

  it('allows exactly max reloads in the window, then refuses', () => {
    const c = clock();
    const allow = reloadLimiter({ max: 3, windowMs: 60_000, now: c.now });
    expect([allow(), allow(), allow()]).toEqual([true, true, true]);
    expect(allow()).toBe(false);
    c.advance(59_999);
    expect(allow()).toBe(false);
  });

  it('slides the window: old reloads stop counting once they are windowMs old', () => {
    const c = clock();
    const allow = reloadLimiter({ max: 3, windowMs: 60_000, now: c.now });
    allow(); // t=0
    c.advance(30_000);
    allow(); // t=30s
    allow(); // t=30s
    c.advance(30_000); // t=60s: the t=0 reload has left the window
    expect(allow()).toBe(true);
    expect(allow()).toBe(false); // t=30s, 30s, 60s still inside
    c.advance(30_000); // t=90s: both t=30s reloads have left
    expect(allow()).toBe(true);
    expect(allow()).toBe(true);
    expect(allow()).toBe(false);
  });

  it('does not count refused attempts against the window', () => {
    const c = clock();
    const allow = reloadLimiter({ max: 1, windowMs: 10_000, now: c.now });
    expect(allow()).toBe(true);
    c.advance(5000);
    expect(allow()).toBe(false);
    c.advance(5000); // t=10s: only the t=0 reload counted, and it has left
    expect(allow()).toBe(true);
  });
});
