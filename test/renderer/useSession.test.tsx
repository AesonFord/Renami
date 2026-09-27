import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/core/types.js';
import { ipcMessage, PLAN_DEBOUNCE_MS, useSession } from '../../src/renderer/state/useSession.js';
import type { FilesSummary, PlanView } from '../../src/shared/ipc.js';
import { createFakeApi, deferred, PLAN, summaryFor, type FakeApi } from './fakeApi.js';

async function started(api: FakeApi, paths = ['/photos']) {
  const hook = renderHook(() => useSession(api));
  act(() => hook.result.current[1].addPaths(paths));
  await waitFor(() => expect(hook.result.current[0].plan).not.toBeNull());
  return hook;
}

describe('useSession', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads the platform, presets and undo state on start', async () => {
    const api = createFakeApi({ canUndo: vi.fn(async () => true) });
    const { result } = renderHook(() => useSession(api));
    await waitFor(() => expect(result.current[0].platform).toBe('darwin'));
    expect(result.current[0].canUndo).toBe(true);
    expect(api.listPresets).toHaveBeenCalled();
  });

  it('scans added paths once each and builds the preview', async () => {
    const api = createFakeApi();
    const { result } = await started(api);
    act(() => result.current[1].addPaths(['/photos']));
    expect(result.current[0].sources).toEqual(['/photos']);
    expect(api.scan).toHaveBeenCalledTimes(1);
    expect(api.scan).toHaveBeenCalledWith(['/photos'], DEFAULT_SETTINGS.filter);
    expect(result.current[0].files?.total).toBe(2);
    expect(result.current[0].plan).toEqual(PLAN);
  });

  it('rescans when the filter changes and ignores the older scan when it answers late', async () => {
    const slow = deferred<FilesSummary | null>();
    const api = createFakeApi();
    vi.mocked(api.scan).mockImplementationOnce(() => slow.promise);
    const { result } = renderHook(() => useSession(api));
    act(() => result.current[1].addPaths(['/photos']));
    act(() => result.current[1].updateSettings((s) => ({ ...s, filter: { ...s.filter, includeSubfolders: true } })));
    await waitFor(() => expect(result.current[0].files).not.toBeNull());
    await act(async () => slow.resolve({ ...summaryFor(['/photos']), total: 99 }));
    expect(api.scan).toHaveBeenLastCalledWith(['/photos'], { ...DEFAULT_SETTINGS.filter, includeSubfolders: true });
    expect(result.current[0].files?.total).toBe(2);
  });

  it('debounces preview rebuilds while the pattern is typed', async () => {
    const api = createFakeApi();
    const { result } = await started(api);
    vi.mocked(api.buildPlan).mockClear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      act(() => result.current[1].updateSettings((s) => ({ ...s, pattern: 'a' })));
      act(() => result.current[1].updateSettings((s) => ({ ...s, pattern: 'ab' })));
      act(() => result.current[1].updateSettings((s) => ({ ...s, pattern: 'abc' })));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(PLAN_DEBOUNCE_MS);
      });
      expect(api.buildPlan).toHaveBeenCalledTimes(1);
      expect(vi.mocked(api.buildPlan).mock.calls[0]?.[0].settings.pattern).toBe('abc');
    } finally {
      vi.useRealTimers();
    }
  });

  it('rebuilds the preview as metadata arrives', async () => {
    const api = createFakeApi();
    const { result } = await started(api);
    vi.mocked(api.buildPlan).mockClear();
    act(() => api.emitMetadata({ done: 1, total: 2, finished: false, exiftoolFailed: false }));
    expect(result.current[0].metadata?.done).toBe(1);
    await waitFor(() => expect(api.buildPlan).toHaveBeenCalledTimes(1));
  });

  it('says a rebuild is pending from the moment one is due until the new preview arrives', async () => {
    const api = createFakeApi();
    const { result } = await started(api);
    expect(result.current[0].planPending).toBe(false);

    // Reading finishes after a complete preview was already shown. The event schedules one more
    // rebuild; until it lands, the plan on screen is one main has already replaced, and Rename
    // must not offer to run it.
    const slow = deferred<PlanView>();
    vi.mocked(api.buildPlan).mockImplementationOnce(() => slow.promise);
    act(() => api.emitMetadata({ done: 2, total: 2, finished: true, exiftoolFailed: false }));
    expect(result.current[0].planPending).toBe(true);
    await waitFor(() => expect(api.buildPlan).toHaveBeenCalledTimes(2));
    expect(result.current[0].planPending).toBe(true);
    expect(result.current[0].plan).toEqual(PLAN);
    await act(async () => slow.resolve({ ...PLAN, planId: 'plan-2' }));
    expect(result.current[0].plan?.planId).toBe('plan-2');
    expect(result.current[0].planPending).toBe(false);
  });

  it('is no longer pending once a rebuild fails', async () => {
    const api = createFakeApi();
    const { result } = await started(api);
    vi.mocked(api.buildPlan).mockRejectedValueOnce(new Error('boom'));
    act(() => result.current[1].updateSettings((s) => ({ ...s, pattern: 'x' })));
    expect(result.current[0].planPending).toBe(true);
    await waitFor(() => expect(result.current[0].outcome).toEqual({ kind: 'message', text: "Couldn't build the preview: boom" }));
    expect(result.current[0].planPending).toBe(false);
  });

  it('rebuilds the preview once more when reading finishes', async () => {
    const api = createFakeApi();
    const { result } = await started(api);
    act(() => api.emitMetadata({ done: 2, total: 2, finished: false, exiftoolFailed: false }));
    await waitFor(() => expect(api.buildPlan).toHaveBeenCalledTimes(2));
    // Same count, only `finished` flips: the plan built now is the one Rename may run.
    act(() => api.emitMetadata({ done: 2, total: 2, finished: true, exiftoolFailed: false }));
    expect(result.current[0].metadata?.finished).toBe(true);
    await waitFor(() => expect(api.buildPlan).toHaveBeenCalledTimes(3));
  });

  it('renames the previewed plan, then rescans the updated sources', async () => {
    const api = createFakeApi({
      execute: vi.fn(async () => ({ status: 'done' as const, renamed: 2, datesChanged: 0, changes: [], sourcesAfter: ['/photos', '/new.jpg'] })),
      canUndo: vi.fn(async () => true),
    });
    const { result } = await started(api);
    await act(() => result.current[1].rename());
    expect(api.execute).toHaveBeenCalledWith('plan-1');
    expect(result.current[0].outcome).toEqual({ kind: 'renamed', renamed: 2, datesChanged: 0 });
    expect(result.current[0].busy).toBeNull();
    expect(result.current[0].canUndo).toBe(true);
    await waitFor(() => expect(api.scan).toHaveBeenLastCalledWith(['/photos', '/new.jpg'], expect.anything()));
  });

  it('tracks progress while renaming', async () => {
    const running = deferred<Awaited<ReturnType<FakeApi['execute']>>>();
    const api = createFakeApi({ execute: vi.fn(() => running.promise) });
    const { result } = await started(api);
    let done!: Promise<void>;
    act(() => {
      done = result.current[1].rename();
    });
    expect(result.current[0].busy).toBe('renaming');
    act(() => api.emitProgress({ done: 1, total: 4 }));
    expect(result.current[0].progress).toEqual({ done: 1, total: 4 });
    act(() => result.current[1].cancel());
    expect(api.cancel).toHaveBeenCalled();
    await act(async () => {
      running.resolve({ status: 'cancelled', error: null, rollback: { complete: true, stranded: [] } });
      await done;
    });
    expect(result.current[0].outcome).toEqual({ kind: 'cancelled', action: 'rename', rollback: { complete: true, stranded: [] } });
    expect(result.current[0].progress).toBeNull();
  });

  it('reports a failed rename with its rollback, and a not-ready plan as a message', async () => {
    const rollback = { complete: false, stranded: [{ original: '/a', current: '/b' }] };
    const api = createFakeApi();
    vi.mocked(api.execute)
      .mockResolvedValueOnce({ status: 'failed', error: 'disk full', rollback })
      .mockResolvedValueOnce({ status: 'not-ready', reason: 'File details are still loading.' });
    const { result } = await started(api);
    await act(() => result.current[1].rename());
    expect(result.current[0].outcome).toEqual({ kind: 'failed', action: 'rename', error: 'disk full', rollback, skipped: [] });
    await waitFor(() => expect(result.current[0].plan).not.toBeNull());
    await act(() => result.current[1].rename());
    expect(result.current[0].outcome).toEqual({ kind: 'message', text: 'File details are still loading.' });
  });

  it('undoes and passes on skipped files', async () => {
    const skipped = [{ path: '/photos/x.jpg', reason: 'Changed since the rename' }];
    const api = createFakeApi({
      undo: vi.fn(async () => ({ status: 'done' as const, restored: 1, skipped, error: null, rollback: null, sourcesAfter: ['/photos'] })),
    });
    const { result } = await started(api);
    await act(() => result.current[1].undo());
    expect(result.current[0].outcome).toEqual({ kind: 'undone', restored: 1, skipped });
  });

  it('excludes files and puts them back', async () => {
    const api = createFakeApi();
    const { result } = await started(api);
    act(() => result.current[1].exclude(['/photos/a.jpg']));
    await waitFor(() =>
      expect(api.buildPlan).toHaveBeenLastCalledWith({
        settings: DEFAULT_SETTINGS,
        excluded: ['/photos/a.jpg'],
        overrides: {},
        manualOrder: [],
      }),
    );
    act(() => result.current[1].includeExcluded());
    await waitFor(() =>
      expect(api.buildPlan).toHaveBeenLastCalledWith({ settings: DEFAULT_SETTINGS, excluded: [], overrides: {}, manualOrder: [] }),
    );
  });

  it('puts back only the files it is given', async () => {
    const api = createFakeApi();
    const { result } = await started(api);
    act(() => result.current[1].exclude(['/photos/a.jpg', '/photos/b.jpg']));
    act(() => result.current[1].include(['/photos/a.jpg', '/photos/never-excluded.jpg']));
    expect(result.current[0].excluded).toEqual(['/photos/b.jpg']);
    await waitFor(() =>
      expect(api.buildPlan).toHaveBeenLastCalledWith({ settings: DEFAULT_SETTINGS, excluded: ['/photos/b.jpg'], overrides: {}, manualOrder: [] }),
    );
  });

  it('saves, loads and deletes presets', async () => {
    const api = createFakeApi();
    const { result } = await started(api);
    act(() => result.current[1].updateSettings((s) => ({ ...s, pattern: 'Trip_{seq}' })));
    await act(() => result.current[1].savePreset(' Trip '));
    expect(api.savePreset).toHaveBeenCalledWith(' Trip ', expect.objectContaining({ pattern: 'Trip_{seq}' }));
    expect(result.current[0].presetName).toBe('Trip');

    act(() => result.current[1].updateSettings((s) => ({ ...s, pattern: 'other' })));
    act(() => result.current[1].loadPreset('Trip'));
    expect(result.current[0].settings.pattern).toBe('Trip_{seq}');

    await act(() => result.current[1].deletePreset('trip'));
    expect(result.current[0].presets).toEqual([]);
    expect(result.current[0].presetName).toBeNull();
  });

  it('turns main-process errors into a readable message', async () => {
    const api = createFakeApi({
      savePreset: vi.fn(async () => {
        throw new Error("Error invoking remote method 'presets:save': Error: A preset needs a name");
      }),
    });
    const { result } = renderHook(() => useSession(api));
    await act(() => result.current[1].savePreset(''));
    expect(result.current[0].outcome).toEqual({ kind: 'message', text: 'A preset needs a name' });
  });

  it('picks files and a destination folder through the native dialogs', async () => {
    const api = createFakeApi();
    const { result } = renderHook(() => useSession(api));
    await act(() => result.current[1].pick('folder'));
    expect(api.pickPaths).toHaveBeenCalledWith('folder');
    expect(result.current[0].sources).toEqual(['/picked']);
    await act(() => result.current[1].chooseDestination());
    expect(result.current[0].settings.move.destinationRoot).toBe('/dest');
  });

  it('clears everything when the last source is removed', async () => {
    const api = createFakeApi();
    const { result } = await started(api);
    act(() => result.current[1].removeSource('/photos'));
    expect(result.current[0].sources).toEqual([]);
    expect(result.current[0].files).toBeNull();
    expect(result.current[0].plan).toBeNull();
  });

  it('drops a stale preview reply after the last source is removed', async () => {
    const slow = deferred<PlanView>();
    const api = createFakeApi();
    vi.mocked(api.buildPlan).mockImplementationOnce(() => slow.promise);
    const { result } = renderHook(() => useSession(api));
    act(() => result.current[1].addPaths(['/photos']));
    await waitFor(() => expect(api.buildPlan).toHaveBeenCalled());
    act(() => result.current[1].removeSource('/photos'));
    expect(result.current[0].plan).toBeNull();
    await act(async () => {
      slow.resolve(PLAN);
    });
    expect(result.current[0].plan).toBeNull();
    await act(() => result.current[1].rename());
    expect(api.execute).not.toHaveBeenCalled();
  });

  it('turns a start-up listPresets failure into a message outcome', async () => {
    const api = createFakeApi({
      listPresets: vi.fn(async () => {
        throw new Error("Error invoking remote method 'presets:list': Error: The presets file is damaged (foo)");
      }),
    });
    const { result } = renderHook(() => useSession(api));
    await waitFor(() =>
      expect(result.current[0].outcome).toEqual({ kind: 'message', text: 'The presets file is damaged (foo)' }),
    );
  });

  it('turns a tokenValues failure into a message outcome and resolves null', async () => {
    const api = createFakeApi({
      tokenValues: vi.fn(async () => {
        throw new Error("Error invoking remote method 'plan:token-values': Error: no plan");
      }),
    });
    const { result } = await started(api);
    await act(async () => {
      await expect(result.current[1].tokenValues()).resolves.toBeNull();
    });
    expect(result.current[0].outcome).toEqual({ kind: 'message', text: 'no plan' });
  });

  it('locks the source list and settings while a batch runs', async () => {
    const running = deferred<Awaited<ReturnType<FakeApi['execute']>>>();
    const api = createFakeApi({ execute: vi.fn(() => running.promise) });
    const { result } = await started(api);
    const sourcesBefore = result.current[0].sources;
    const settingsBefore = result.current[0].settings;

    act(() => {
      void result.current[1].rename();
      // Same frame, before anything re-renders: the lock must already hold.
      void result.current[1].rename();
      void result.current[1].savePreset('Blocked');
    });
    expect(result.current[0].busy).toBe('renaming');
    vi.mocked(api.scan).mockClear();
    vi.mocked(api.pickPaths).mockClear();
    vi.mocked(api.buildPlan).mockClear();

    act(() => result.current[1].addPaths(['/more']));
    await act(() => result.current[1].pick('files'));
    act(() => result.current[1].removeSource('/photos'));
    act(() => result.current[1].updateSettings((s) => ({ ...s, pattern: 'blocked' })));
    await act(() => result.current[1].savePreset('Blocked'));
    await act(() => result.current[1].deletePreset('Blocked'));

    expect(api.execute).toHaveBeenCalledTimes(1);
    expect(api.savePreset).not.toHaveBeenCalled();
    expect(api.deletePreset).not.toHaveBeenCalled();
    expect(api.scan).not.toHaveBeenCalled();
    expect(api.pickPaths).not.toHaveBeenCalled();
    expect(api.buildPlan).not.toHaveBeenCalled();
    expect(result.current[0].sources).toEqual(sourcesBefore);
    expect(result.current[0].settings).toEqual(settingsBefore);

    await act(async () => {
      running.resolve({ status: 'done', renamed: 2, datesChanged: 0, changes: [], sourcesAfter: ['/photos'] });
    });
    expect(result.current[0].busy).toBeNull();
  });

  it('keeps the renamed outcome when canUndo fails right after', async () => {
    const api = createFakeApi({
      canUndo: vi.fn().mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('boom')),
    });
    const { result } = await started(api);
    await act(() => result.current[1].rename());
    expect(result.current[0].outcome).toEqual({ kind: 'renamed', renamed: 2, datesChanged: 0 });
  });

  it('loadPreset finds a preset whatever its case', async () => {
    const api = createFakeApi({
      listPresets: vi.fn(async () => [{ name: 'Trip', settings: { ...DEFAULT_SETTINGS, pattern: 'T_{seq}' } }]),
    });
    const { result } = await started(api);
    await waitFor(() => expect(result.current[0].presets).toHaveLength(1));
    act(() => result.current[1].loadPreset('trip'));
    expect(result.current[0].settings.pattern).toBe('T_{seq}');
    expect(result.current[0].presetName).toBe('Trip');
  });

  it('removing a source drops the exclusions inside it and keeps the others', async () => {
    const api = createFakeApi();
    const { result } = renderHook(() => useSession(api));
    act(() => result.current[1].addPaths(['/a', '/b']));
    await waitFor(() => expect(result.current[0].plan).not.toBeNull());
    act(() => result.current[1].exclude(['/a/x.jpg', '/b/y.jpg']));
    act(() => result.current[1].removeSource('/a'));
    expect(result.current[0].excluded).toEqual(['/b/y.jpg']);

    const api2 = createFakeApi();
    const { result: result2 } = renderHook(() => useSession(api2));
    act(() => result2.current[1].addPaths(['C:\\a', 'C:\\b']));
    await waitFor(() => expect(result2.current[0].plan).not.toBeNull());
    act(() => result2.current[1].exclude(['C:\\a\\x.jpg', 'C:\\b\\y.jpg']));
    act(() => result2.current[1].removeSource('C:\\a'));
    expect(result2.current[0].excluded).toEqual(['C:\\b\\y.jpg']);
  });

  it('drops every exclusion under a root source when it is removed', async () => {
    // A second source stays, so sources never reach zero: this exercises removeSource's own
    // filtering, not the separate reset that clears every exclusion once the list is empty.
    const api = createFakeApi();
    const { result } = renderHook(() => useSession(api));
    act(() => result.current[1].addPaths(['/', '/other']));
    await waitFor(() => expect(result.current[0].plan).not.toBeNull());
    act(() => result.current[1].exclude(['/x.jpg', '/a/x.jpg']));
    act(() => result.current[1].removeSource('/'));
    expect(result.current[0].sources).toEqual(['/other']);
    expect(result.current[0].excluded).toEqual([]);

    const api2 = createFakeApi();
    const { result: result2 } = renderHook(() => useSession(api2));
    act(() => result2.current[1].addPaths(['C:\\', 'D:\\other']));
    await waitFor(() => expect(result2.current[0].plan).not.toBeNull());
    act(() => result2.current[1].exclude(['C:\\x.jpg', 'C:\\a\\x.jpg']));
    act(() => result2.current[1].removeSource('C:\\'));
    expect(result2.current[0].sources).toEqual(['D:\\other']);
    expect(result2.current[0].excluded).toEqual([]);
  });

  it('keeps an exclusion when another remaining source still covers it', async () => {
    const api = createFakeApi();
    const { result } = renderHook(() => useSession(api));
    // /a is nested inside /, so removing /a alone must not drop exclusions / still covers.
    act(() => result.current[1].addPaths(['/', '/a']));
    await waitFor(() => expect(result.current[0].plan).not.toBeNull());
    act(() => result.current[1].exclude(['/a/x.jpg']));
    act(() => result.current[1].removeSource('/a'));
    expect(result.current[0].excluded).toEqual(['/a/x.jpg']);
  });

  it('removes two sources queued in the same tick, both taking effect', async () => {
    const api = createFakeApi();
    const { result } = renderHook(() => useSession(api));
    act(() => result.current[1].addPaths(['/a', '/b', '/c']));
    await waitFor(() => expect(result.current[0].plan).not.toBeNull());
    act(() => result.current[1].exclude(['/a/x.jpg', '/b/y.jpg']));

    act(() => {
      // Same synchronous batch: the second call must not compute `remaining` from the same
      // stale sources it started with, or the first removal would be silently undone.
      result.current[1].removeSource('/a');
      result.current[1].removeSource('/b');
    });

    expect(result.current[0].sources).toEqual(['/c']);
    expect(result.current[0].excluded).toEqual([]);
  });

  it('keeps exclusions still covered by a remaining source, removing two others in the same tick', async () => {
    const api = createFakeApi();
    const { result } = renderHook(() => useSession(api));
    act(() => result.current[1].addPaths(['/', '/a', '/b']));
    await waitFor(() => expect(result.current[0].plan).not.toBeNull());
    act(() => result.current[1].exclude(['/a/x.jpg', '/b/y.jpg']));

    act(() => {
      result.current[1].removeSource('/a');
      result.current[1].removeSource('/b');
    });

    // Both excluded files are still under the root source that's left.
    expect(result.current[0].sources).toEqual(['/']);
    expect(result.current[0].excluded).toEqual(['/a/x.jpg', '/b/y.jpg']);
  });

  it('removing the last source tells main to forget the files', async () => {
    const api = createFakeApi();
    const { result } = await started(api);
    act(() => result.current[1].exclude(['/photos/x.jpg']));
    act(() => result.current[1].removeSource('/photos'));
    await waitFor(() => expect(api.clear).toHaveBeenCalledTimes(1));
    expect(result.current[0].excluded).toEqual([]);

    // A filter change with no sources left must not call clear() a second time.
    act(() => result.current[1].updateSettings((s) => ({ ...s, filter: { ...s.filter, includeSubfolders: true } })));
    expect(api.clear).toHaveBeenCalledTimes(1);
  });

  it('shows a message without rescanning when there is nothing to undo', async () => {
    const api = createFakeApi({
      canUndo: vi.fn(async () => true),
      undo: vi.fn(async () => ({
        status: 'nothing-to-undo' as const,
        restored: 0,
        skipped: [],
        error: null,
        rollback: null,
        sourcesAfter: ['/photos'],
      })),
    });
    const { result } = await started(api);
    await waitFor(() => expect(result.current[0].canUndo).toBe(true));
    vi.mocked(api.scan).mockClear();
    await act(() => result.current[1].undo());
    expect(result.current[0].outcome).toEqual({ kind: 'message', text: 'There is nothing to undo.' });
    expect(api.scan).not.toHaveBeenCalled();
    expect(result.current[0].canUndo).toBe(false);
  });

  it('shows the reason without rescanning when undo is refused as not-ready', async () => {
    const api = createFakeApi({
      undo: vi.fn(async () => ({
        status: 'not-ready' as const,
        reason: 'A rename or undo is already running.',
        sourcesAfter: ['/photos'],
      })),
    });
    const { result } = await started(api);
    vi.mocked(api.scan).mockClear();
    await act(() => result.current[1].undo());
    expect(result.current[0].outcome).toEqual({ kind: 'message', text: 'A rename or undo is already running.' });
    expect(api.scan).not.toHaveBeenCalled();
  });

  it('reports a failed undo and a cancelled undo, both rescanning', async () => {
    const rollback = { complete: false, stranded: [{ original: '/a', current: '/b' }] };
    const api = createFakeApi();
    vi.mocked(api.undo)
      .mockResolvedValueOnce({ status: 'failed', restored: 0, skipped: [], error: 'disk full', rollback, sourcesAfter: ['/photos'] })
      .mockResolvedValueOnce({ status: 'cancelled', restored: 0, skipped: [], error: null, rollback: null, sourcesAfter: ['/photos'] });
    const { result } = await started(api);
    vi.mocked(api.scan).mockClear();
    await act(() => result.current[1].undo());
    expect(result.current[0].outcome).toEqual({ kind: 'failed', action: 'undo', error: 'disk full', rollback, skipped: [] });
    await waitFor(() => expect(api.scan).toHaveBeenCalledTimes(1));

    vi.mocked(api.scan).mockClear();
    await act(() => result.current[1].undo());
    expect(result.current[0].outcome).toEqual({
      kind: 'cancelled',
      action: 'undo',
      rollback: { complete: true, stranded: [] },
    });
    await waitFor(() => expect(api.scan).toHaveBeenCalledTimes(1));
  });

  it('reports an undo whose IPC call fails, and rescans', async () => {
    const api = createFakeApi();
    vi.mocked(api.undo).mockRejectedValueOnce(new Error("Error invoking remote method 'batch:undo': Error: boom"));
    const { result } = await started(api);
    vi.mocked(api.scan).mockClear();
    await act(() => result.current[1].undo());
    expect(result.current[0].outcome).toEqual({ kind: 'failed', action: 'undo', error: 'boom', rollback: null, skipped: [] });
    expect(result.current[0].busy).toBeNull();
    // Main may have stopped the background read before the call failed; only a rescan restarts it.
    await waitFor(() => expect(api.scan).toHaveBeenCalledTimes(1));
    expect(api.scan).toHaveBeenLastCalledWith(['/photos'], expect.anything());
  });

  it('rescans after undo even when the source list is unchanged', async () => {
    const api = createFakeApi();
    const { result } = await started(api);
    vi.mocked(api.scan).mockClear();
    await act(() => result.current[1].undo());
    expect(result.current[0].sources).toEqual(['/photos']);
    await waitFor(() => expect(api.scan).toHaveBeenCalled());
  });

  it('stops the scanning state when the current scan answers null', async () => {
    const api = createFakeApi({ scan: vi.fn(async () => null) });
    const { result } = renderHook(() => useSession(api));
    act(() => result.current[1].addPaths(['/photos']));
    expect(result.current[0].scanning).toBe(true);
    await waitFor(() => expect(result.current[0].scanning).toBe(false));
  });

  it('does not request a preview while a batch runs', async () => {
    const running = deferred<Awaited<ReturnType<FakeApi['execute']>>>();
    const api = createFakeApi({ execute: vi.fn(() => running.promise) });
    const { result } = await started(api);
    act(() => {
      void result.current[1].rename();
    });
    expect(result.current[0].busy).toBe('renaming');
    vi.mocked(api.buildPlan).mockClear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      act(() => api.emitMetadata({ done: 1, total: 2, finished: false, exiftoolFailed: false }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(PLAN_DEBOUNCE_MS);
      });
      expect(api.buildPlan).not.toHaveBeenCalled();

      await act(async () => {
        running.resolve({ status: 'done', renamed: 2, datesChanged: 0, changes: [], sourcesAfter: ['/photos'] });
      });
      // The rescan after the batch triggers a fresh rebuild: the guard only blocks during the batch.
      await waitFor(() => expect(api.buildPlan).toHaveBeenCalled());
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-requests a preview skipped while a batch was running, once the batch ends without rescanning', async () => {
    const running = deferred<Awaited<ReturnType<FakeApi['execute']>>>();
    const api = createFakeApi({ execute: vi.fn(() => running.promise) });
    const { result } = await started(api);
    vi.mocked(api.buildPlan).mockClear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      // Click Rename before the debounce fires: the pattern change's rebuild request is skipped.
      act(() => result.current[1].updateSettings((s) => ({ ...s, pattern: 'new' })));
      let done!: Promise<void>;
      act(() => {
        done = result.current[1].rename();
      });
      expect(result.current[0].busy).toBe('renaming');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(PLAN_DEBOUNCE_MS);
      });
      expect(api.buildPlan).not.toHaveBeenCalled();

      // The batch exits 'not-ready', which doesn't rescan, so the skipped request must come back.
      await act(async () => {
        running.resolve({ status: 'not-ready', reason: 'File details are still loading.' });
        await done;
      });
      expect(result.current[0].busy).toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(PLAN_DEBOUNCE_MS);
      });
      expect(api.buildPlan).toHaveBeenCalled();
      expect(vi.mocked(api.buildPlan).mock.calls.at(-1)?.[0].settings.pattern).toBe('new');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows several start-up failures together', async () => {
    const api = createFakeApi({
      platform: vi.fn(async () => {
        throw new Error('no display');
      }),
      listPresets: vi.fn(async () => {
        throw new Error('presets missing');
      }),
    });
    const { result } = renderHook(() => useSession(api));
    await waitFor(() => {
      expect(result.current[0].outcome?.kind).toBe('message');
      const text = (result.current[0].outcome as { kind: 'message'; text: string }).text;
      expect(text).toContain('no display');
      expect(text).toContain('presets missing');
    });
  });

  it('builds the preview from metadata that has actually finished reading', async () => {
    // The real background read reports `finished: false` at once and `finished: true` only
    // once this test releases `finishedGate` — held past the first debounced buildPlan call,
    // instead of racing a fixed setTimeout(0) against the 100 ms debounce (which always loses:
    // both would otherwise land before the first buildPlan call ever fires, hiding a rebuild
    // that never actually ran off the finished metadata).
    const finishedGate = deferred<void>();
    let api!: FakeApi;
    api = createFakeApi({
      scan: vi.fn(async (paths: string[]) => {
        const summary = summaryFor(paths);
        api.emitMetadata({ done: 0, total: summary.total, finished: false, exiftoolFailed: false });
        void finishedGate.promise.then(() => {
          api.emitMetadata({ done: summary.total, total: summary.total, finished: true, exiftoolFailed: false });
        });
        return summary;
      }),
    });
    const { result } = renderHook(() => useSession(api));
    // Records, for every buildPlan call, whether the metadata driving it had finished reading.
    const finishedAtCall: boolean[] = [];
    vi.mocked(api.buildPlan).mockImplementation(async () => {
      finishedAtCall.push(result.current[0].metadata?.finished ?? false);
      return PLAN;
    });

    act(() => result.current[1].addPaths(['/photos']));
    await waitFor(() => expect(finishedAtCall.length).toBeGreaterThan(0));
    // The first rebuild ran while reading was still going: proves the mid-read case is real,
    // not skipped past by the fake's timing.
    expect(finishedAtCall.at(-1)).toBe(false);

    await act(async () => {
      finishedGate.resolve();
    });
    // The plan Rename may run is built again once metadata has actually finished reading. If
    // metadataDone/metadataFinished dropped out of the plan effect's deps, this event would
    // never trigger a rebuild and this wait would time out.
    await waitFor(() => expect(finishedAtCall.at(-1)).toBe(true));
  });
});

describe('useSession error paths', () => {
  const failing = (message: string) => vi.fn(async () => { throw new Error(`Error invoking remote method 'x': Error: ${message}`); });

  it('reports a scan that fails and stops looking', async () => {
    const api = createFakeApi({ scan: failing('disk went away') });
    const { result } = renderHook(() => useSession(api));
    act(() => result.current[1].addPaths(['/photos']));
    await waitFor(() => expect(result.current[0].outcome).toEqual({ kind: 'message', text: "Couldn't list the files: disk went away" }));
    expect(result.current[0].scanning).toBe(false);
    expect(result.current[0].files).toBeNull();
  });

  it('reports a preview that cannot be built and keeps the last one', async () => {
    const api = createFakeApi();
    const { result } = await started(api);
    vi.mocked(api.buildPlan).mockRejectedValueOnce(new Error('bad plan'));
    act(() => result.current[1].updateSettings((s) => ({ ...s, pattern: '{name}_x' })));
    await waitFor(() => expect(result.current[0].outcome).toEqual({ kind: 'message', text: "Couldn't build the preview: bad plan" }));
    expect(result.current[0].plan).toEqual(PLAN);
  });

  it('reports a stale plan and rescans the same sources', async () => {
    const api = createFakeApi({ execute: vi.fn(async () => ({ status: 'stale' as const, changed: ['/photos/a.jpg'] })) });
    const { result } = await started(api);
    vi.mocked(api.scan).mockClear();
    await act(() => result.current[1].rename());
    expect(result.current[0].outcome).toEqual({ kind: 'stale', changed: ['/photos/a.jpg'] });
    await waitFor(() => expect(api.scan).toHaveBeenCalledTimes(1));
    expect(api.scan).toHaveBeenLastCalledWith(['/photos'], expect.anything());
  });

  it('reports a rename whose IPC call fails, without a rollback report, and unlocks', async () => {
    const api = createFakeApi({ execute: failing('boom') });
    const { result } = await started(api);
    vi.mocked(api.scan).mockClear();
    await act(() => result.current[1].rename());
    expect(result.current[0].outcome).toEqual({ kind: 'failed', action: 'rename', error: 'boom', rollback: null, skipped: [] });
    expect(result.current[0].busy).toBeNull();
    // Nothing was touched, so there is nothing to rescan.
    expect(api.scan).not.toHaveBeenCalled();
  });

  it('shows the reason when a rename is refused as not-ready, without rescanning', async () => {
    const api = createFakeApi({ execute: vi.fn(async () => ({ status: 'not-ready' as const, reason: 'Still reading' })) });
    const { result } = await started(api);
    vi.mocked(api.scan).mockClear();
    await act(() => result.current[1].rename());
    expect(result.current[0].outcome).toEqual({ kind: 'message', text: 'Still reading' });
    expect(api.scan).not.toHaveBeenCalled();
  });

  it('does nothing on rename before there is a plan', async () => {
    const api = createFakeApi();
    const { result } = renderHook(() => useSession(api));
    await act(() => result.current[1].rename());
    expect(api.execute).not.toHaveBeenCalled();
    expect(result.current[0].busy).toBeNull();
  });

  it('turns a failed native picker into a message', async () => {
    const api = createFakeApi({ pickPaths: failing('no dialog') });
    const { result } = renderHook(() => useSession(api));
    await act(() => result.current[1].pick('files'));
    expect(result.current[0].outcome).toEqual({ kind: 'message', text: 'no dialog' });
    expect(result.current[0].sources).toEqual([]);
  });

  it('leaves the destination alone when the folder dialog is cancelled, and reports one that fails', async () => {
    const api = createFakeApi({ pickFolder: vi.fn(async () => null) });
    const { result } = renderHook(() => useSession(api));
    await act(() => result.current[1].chooseDestination());
    expect(result.current[0].settings.move.destinationRoot).toBeNull();
    expect(result.current[0].outcome).toBeNull();

    vi.mocked(api.pickFolder).mockRejectedValueOnce(new Error('closed'));
    await act(() => result.current[1].chooseDestination());
    expect(result.current[0].outcome).toEqual({ kind: 'message', text: 'closed' });
  });

  it('reports a cancel request, a copy and a preset deletion that fail', async () => {
    const api = createFakeApi({ cancel: failing('nothing running'), copyText: failing('no clipboard'), deletePreset: failing('locked') });
    const { result } = renderHook(() => useSession(api));
    act(() => result.current[1].cancel());
    await waitFor(() => expect(result.current[0].outcome).toEqual({ kind: 'message', text: 'nothing running' }));
    act(() => result.current[1].copyText('report'));
    await waitFor(() => expect(result.current[0].outcome).toEqual({ kind: 'message', text: 'no clipboard' }));
    await act(() => result.current[1].deletePreset('Old'));
    expect(result.current[0].outcome).toEqual({ kind: 'message', text: 'locked' });
  });

  it('reports a failure to forget the files after the last source goes', async () => {
    const api = createFakeApi({ clear: failing('main is gone') });
    const { result } = await started(api);
    act(() => result.current[1].removeSource('/photos'));
    await waitFor(() => expect(result.current[0].outcome).toEqual({ kind: 'message', text: 'main is gone' }));
    expect(result.current[0].files).toBeNull();
  });

  it('shows start-up failures of the platform and undo answers as messages', async () => {
    const api = createFakeApi({ platform: failing('no platform'), canUndo: failing('no history') });
    const { result } = renderHook(() => useSession(api));
    await waitFor(() => expect(result.current[0].outcome?.kind).toBe('message'));
    await waitFor(() => {
      const text = (result.current[0].outcome as { text: string }).text;
      expect(text).toContain('no platform');
      expect(text).toContain('no history');
    });
    expect(result.current[0].platform).toBeNull();
    expect(result.current[0].canUndo).toBe(false);
  });

  it('forgets the current preset name when asked to load one that no longer exists', async () => {
    const api = createFakeApi({ listPresets: vi.fn(async () => [{ name: 'Music', settings: { ...DEFAULT_SETTINGS, pattern: 'M' } }]) });
    const { result } = renderHook(() => useSession(api));
    await waitFor(() => expect(result.current[0].presets).toHaveLength(1));
    act(() => result.current[1].loadPreset('Music'));
    expect(result.current[0].presetName).toBe('Music');
    act(() => result.current[1].loadPreset('Gone'));
    expect(result.current[0].presetName).toBeNull();
    // The settings from the last real preset stay.
    expect(result.current[0].settings.pattern).toBe('M');
  });

  it('refuses to exclude, include or undo while a batch runs', async () => {
    const running = deferred<Awaited<ReturnType<FakeApi['execute']>>>();
    const api = createFakeApi({ execute: vi.fn(() => running.promise) });
    const { result } = await started(api);
    act(() => result.current[1].exclude(['/photos/a.jpg']));
    expect(result.current[0].excluded).toEqual(['/photos/a.jpg']);

    act(() => void result.current[1].rename());
    expect(result.current[0].busy).toBe('renaming');
    act(() => result.current[1].exclude(['/photos/b.jpg']));
    act(() => result.current[1].includeExcluded());
    await act(() => result.current[1].undo());
    expect(result.current[0].excluded).toEqual(['/photos/a.jpg']);
    expect(api.undo).not.toHaveBeenCalled();

    await act(async () => running.resolve({ status: 'done', renamed: 2, datesChanged: 0, changes: [], sourcesAfter: ['/photos'] }));
    act(() => result.current[1].includeExcluded());
    expect(result.current[0].excluded).toEqual([]);
  });

  it('ignores an empty drop and repeated paths', async () => {
    const api = createFakeApi();
    const { result } = await started(api);
    const before = result.current[0].sources;
    act(() => result.current[1].addPaths([]));
    act(() => result.current[1].addPaths(['/photos']));
    expect(result.current[0].sources).toBe(before);
    expect(api.scan).toHaveBeenCalledTimes(1);
  });

  it('strips the IPC wrapper from error text and passes other values through', () => {
    expect(ipcMessage(new Error("Error invoking remote method 'files:scan': Error: no such folder"))).toBe('no such folder');
    expect(ipcMessage(new Error("Error invoking remote method 'files:scan': plain text"))).toBe('plain text');
    expect(ipcMessage(new Error('local failure'))).toBe('local failure');
    expect(ipcMessage('just a string')).toBe('just a string');
    expect(ipcMessage(42)).toBe('42');
  });
});

describe('useSession: more features', () => {
  it('adds the paths the OS opened the app with, and later ones as they arrive', async () => {
    const api = createFakeApi({ takeOpenPaths: vi.fn(async () => ['/opened']) });
    const { result } = renderHook(() => useSession(api));
    await waitFor(() => expect(result.current[0].sources).toEqual(['/opened']));
    act(() => api.emitOpenPaths(['/later']));
    expect(result.current[0].sources).toEqual(['/opened', '/later']);
  });

  it('passes the whole filter to the scanner', async () => {
    const api = createFakeApi();
    const { result } = await started(api);
    act(() => result.current[1].updateSettings((s) => ({ ...s, filter: { ...s.filter, mode: 'folders' } })));
    await waitFor(() => expect(api.scan).toHaveBeenLastCalledWith(['/photos'], { ...DEFAULT_SETTINGS.filter, mode: 'folders' }));
  });

  it('sends typed names and the manual order with the preview, and clears them after a rename', async () => {
    const api = createFakeApi();
    const { result } = await started(api);
    act(() => result.current[1].setOverride('/photos/a.jpg', 'beach'));
    await waitFor(() => expect(vi.mocked(api.buildPlan).mock.lastCall?.[0].overrides).toEqual({ '/photos/a.jpg': 'beach' }));
    act(() => result.current[1].reorder(['/photos/b.jpg', '/photos/a.jpg']));
    expect(result.current[0].settings.sequence.sortBy).toBe('manual');
    await waitFor(() => expect(vi.mocked(api.buildPlan).mock.lastCall?.[0].manualOrder).toEqual(['/photos/b.jpg', '/photos/a.jpg']));
    act(() => result.current[1].setOverride('/photos/a.jpg', null));
    expect(result.current[0].overrides).toEqual({});
    act(() => result.current[1].setOverride('/photos/b.jpg', 'sunset'));
    await act(async () => result.current[1].rename());
    expect(result.current[0].overrides).toEqual({});
    expect(result.current[0].manualOrder).toEqual([]);
  });

  // I3: a rolled-back batch (stale, cancelled or failed) changed nothing on disk, so the user's
  // typed names and drag order must survive it; only a batch that actually finished clears them.
  it('keeps typed names and the manual order after a stale, cancelled or failed rename', async () => {
    const api = createFakeApi();
    vi.mocked(api.execute)
      .mockResolvedValueOnce({ status: 'stale', changed: ['/photos/a.jpg'] })
      .mockResolvedValueOnce({ status: 'cancelled', error: null, rollback: { complete: true, stranded: [] } })
      .mockResolvedValueOnce({ status: 'failed', error: 'disk full', rollback: { complete: false, stranded: [] } });
    const { result } = await started(api);
    act(() => result.current[1].setOverride('/photos/a.jpg', 'beach'));
    await waitFor(() => expect(result.current[0].overrides).toEqual({ '/photos/a.jpg': 'beach' }));
    act(() => result.current[1].reorder(['/photos/b.jpg', '/photos/a.jpg']));
    expect(result.current[0].manualOrder).toEqual(['/photos/b.jpg', '/photos/a.jpg']);

    await act(() => result.current[1].rename());
    expect(result.current[0].outcome).toEqual({ kind: 'stale', changed: ['/photos/a.jpg'] });
    expect(result.current[0].overrides).toEqual({ '/photos/a.jpg': 'beach' });
    expect(result.current[0].manualOrder).toEqual(['/photos/b.jpg', '/photos/a.jpg']);

    await waitFor(() => expect(result.current[0].plan).not.toBeNull());
    await act(() => result.current[1].rename());
    expect(result.current[0].outcome).toMatchObject({ kind: 'cancelled', action: 'rename' });
    expect(result.current[0].overrides).toEqual({ '/photos/a.jpg': 'beach' });
    expect(result.current[0].manualOrder).toEqual(['/photos/b.jpg', '/photos/a.jpg']);

    await waitFor(() => expect(result.current[0].plan).not.toBeNull());
    await act(() => result.current[1].rename());
    expect(result.current[0].outcome).toEqual({
      kind: 'failed',
      action: 'rename',
      error: 'disk full',
      rollback: { complete: false, stranded: [] },
      skipped: [],
    });
    expect(result.current[0].overrides).toEqual({ '/photos/a.jpg': 'beach' });
    expect(result.current[0].manualOrder).toEqual(['/photos/b.jpg', '/photos/a.jpg']);
  });

  // I3, undo half: an undo that didn't finish (cancelled or failed) is a rollback too.
  it('keeps typed names and the manual order after a cancelled or failed undo, but clears them once undo finishes', async () => {
    const rollback = { complete: true, stranded: [] };
    const api = createFakeApi();
    vi.mocked(api.undo)
      .mockResolvedValueOnce({ status: 'cancelled', restored: 0, skipped: [], error: null, rollback, sourcesAfter: ['/photos'] })
      .mockResolvedValueOnce({ status: 'done', restored: 2, skipped: [], error: null, rollback: null, sourcesAfter: ['/photos'] });
    const { result } = await started(api);
    act(() => result.current[1].setOverride('/photos/a.jpg', 'beach'));
    await waitFor(() => expect(result.current[0].overrides).toEqual({ '/photos/a.jpg': 'beach' }));

    await act(() => result.current[1].undo());
    expect(result.current[0].outcome).toEqual({ kind: 'cancelled', action: 'undo', rollback });
    expect(result.current[0].overrides).toEqual({ '/photos/a.jpg': 'beach' });

    await act(() => result.current[1].undo());
    expect(result.current[0].outcome).toEqual({ kind: 'undone', restored: 2, skipped: [] });
    expect(result.current[0].overrides).toEqual({});
  });

  it('drops typed names and order entries whose source is removed', async () => {
    const api = createFakeApi();
    const { result } = await started(api, ['/photos', '/other']);
    act(() => result.current[1].setOverride('/photos/a.jpg', 'beach'));
    act(() => result.current[1].setOverride('/other/x.jpg', 'gone'));
    act(() => result.current[1].reorder(['/other/x.jpg', '/photos/a.jpg']));
    act(() => result.current[1].removeSource('/other'));
    await waitFor(() => expect(result.current[0].overrides).toEqual({ '/photos/a.jpg': 'beach' }));
    expect(result.current[0].manualOrder).toEqual(['/photos/a.jpg']);
  });

  it('exports the preview, and the last rename once there is one', async () => {
    const api = createFakeApi({
      execute: vi.fn(async () => ({
        status: 'done' as const, renamed: 2, datesChanged: 0, sourcesAfter: ['/photos'],
        changes: [{ from: '/photos/a.jpg', to: '/photos/Trip_001.jpg' }],
      })),
    });
    const { result } = await started(api);
    await act(async () => result.current[1].exportPreview());
    expect(api.saveText).toHaveBeenCalledWith('renami-preview.csv', expect.stringMatching(/^Current name,New name/));
    expect(result.current[0].outcome).toEqual({ kind: 'message', text: 'Saved the preview.' });
    expect(result.current[0].lastChanges).toEqual([]);
    await act(async () => result.current[1].rename());
    expect(result.current[0].lastChanges).toEqual([{ from: '/photos/a.jpg', to: '/photos/Trip_001.jpg' }]);
    await act(async () => result.current[1].exportLastBatch());
    expect(api.saveText).toHaveBeenLastCalledWith('renami-renamed.csv', 'From,To\r\n/photos/a.jpg,/photos/Trip_001.jpg\r\n');
  });

  it('says nothing when the save dialog is cancelled, and reports a failed save', async () => {
    const api = createFakeApi({ saveText: vi.fn(async () => false) });
    const { result } = await started(api);
    await act(async () => result.current[1].exportPreview());
    expect(result.current[0].outcome).toBeNull();
    vi.mocked(api.saveText).mockRejectedValueOnce(new Error('disk full'));
    await act(async () => result.current[1].exportPreview());
    expect(result.current[0].outcome).toEqual({ kind: 'message', text: 'disk full' });
  });

  it('imports a name list into typed names', async () => {
    const api = createFakeApi({ readText: vi.fn(async () => ({ name: 'names.txt', text: 'beach\nsunset\nextra' })) });
    const { result } = await started(api);
    await act(async () => result.current[1].importNames());
    expect(result.current[0].overrides).toEqual({ '/photos/a.jpg': 'beach', '/photos/b.jpg': 'sunset' });
    expect(result.current[0].outcome).toEqual({ kind: 'message', text: "Imported 2 names from names.txt; 1 didn't match a file." });
  });

  it('does nothing when the import dialog is cancelled', async () => {
    const api = createFakeApi();
    const { result } = await started(api);
    await act(async () => result.current[1].importNames());
    expect(result.current[0].overrides).toEqual({});
    expect(result.current[0].outcome).toBeNull();
  });
});
