import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUSY_QUIT, disposeBounded, QUIT_WAITING, quitDecision, QUITTING, waitForIdle } from '../../src/main/quitGuard.js';

/** A session whose batch ends at batchEndsAt ms (idle when null) and whose dispose never ends. */
function fakeSession(batchEndsAt: number | null) {
  let busy = batchEndsAt !== null;
  const idle =
    batchEndsAt === null
      ? Promise.resolve()
      : new Promise<void>((resolve) =>
          setTimeout(() => {
            busy = false;
            resolve();
          }, batchEndsAt),
        );
  return {
    isBusy: () => busy,
    whenIdle: () => (busy ? idle : Promise.resolve()),
    dispose: vi.fn(() => new Promise<void>(() => {})),
  };
}

describe('waitForIdle', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves when the batch settles, noting the wait once when it runs long', async () => {
    vi.useFakeTimers();
    const onLongWait = vi.fn();
    let done = false;
    void waitForIdle(fakeSession(25_000), { noteAfterMs: 10_000, onLongWait }).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(9999);
    expect(onLongWait).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onLongWait).toHaveBeenCalledTimes(1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(done).toBe(true);
    expect(onLongWait).toHaveBeenCalledTimes(1);
  });

  it('says nothing about a batch that settles in time, or when idle', async () => {
    vi.useFakeTimers();
    const onLongWait = vi.fn();
    const quick = waitForIdle(fakeSession(5000), { noteAfterMs: 10_000, onLongWait });
    await vi.advanceTimersByTimeAsync(5000);
    await quick;
    await waitForIdle(fakeSession(null), { noteAfterMs: 10_000, onLongWait });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onLongWait).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('QUIT_WAITING', () => {
  it('tells a second launch that Renami is finishing a batch', () => {
    expect(QUIT_WAITING.message).toBe('Renami is finishing a rename or undo');
    expect(QUIT_WAITING.detail).toBe('Try again in a moment.');
    expect(QUITTING.message).not.toMatch(/rename/);
  });
});

describe('quitDecision', () => {
  it('refuses to quit while busy', () => {
    expect(quitDecision({ busy: true, canUndo: true })).toBe('refuse');
  });

  it('asks before quitting when undo is available', () => {
    expect(quitDecision({ busy: false, canUndo: true })).toBe('ask');
  });

  it('quits outright when idle and nothing to undo', () => {
    expect(quitDecision({ busy: false, canUndo: false })).toBe('quit');
  });
});

describe('BUSY_QUIT', () => {
  it('covers undo too, not just a rename', () => {
    expect(BUSY_QUIT.message).toBe('Files are still being renamed');
    expect(BUSY_QUIT.detail).toContain('undo');
  });
});

describe('disposeBounded', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('gives up on a stuck dispose after the timeout when no batch runs', async () => {
    vi.useFakeTimers();
    const s = fakeSession(null);
    let done = false;
    void disposeBounded(s, 3000).then(() => {
      done = true;
    });
    expect(s.dispose).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });

  it('never cuts a running batch short: the timeout starts once it has settled', async () => {
    vi.useFakeTimers();
    const s = fakeSession(20_000);
    let done = false;
    void disposeBounded(s, 3000).then(() => {
      done = true;
    });
    expect(s.dispose).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20_000 + 2999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });

  it('notes a long wait for the batch once, while it waits', async () => {
    vi.useFakeTimers();
    const s = fakeSession(20_000);
    const onLongWait = vi.fn();
    void disposeBounded(s, 3000, { noteAfterMs: 10_000, onLongWait });
    await vi.advanceTimersByTimeAsync(9999);
    expect(onLongWait).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onLongWait).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(onLongWait).toHaveBeenCalledTimes(1);
  });

  it('finishes as soon as dispose does, and passes on its error', async () => {
    const error = new Error('end failed');
    const failing = { isBusy: () => false, whenIdle: () => Promise.resolve(), dispose: () => Promise.reject(error) };
    await expect(disposeBounded(failing, 3000)).rejects.toBe(error);
    const ok = { isBusy: () => false, whenIdle: () => Promise.resolve(), dispose: () => Promise.resolve() };
    await expect(disposeBounded(ok, 60_000)).resolves.toBeUndefined();
  });
});
