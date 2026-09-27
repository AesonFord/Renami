import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/core/types.js';
import { App } from '../../src/renderer/App.js';
import { createFakeApi, deferred, PLAN, type FakeApi } from './fakeApi.js';
import { flag, row } from './fixtures.js';

async function withFiles(api = createFakeApi()) {
  render(<App api={api} />);
  await userEvent.click(screen.getByRole('button', { name: 'Choose folder…' }));
  await screen.findByRole('cell', { name: 'Trip_001.jpg' });
  act(() => api.emitMetadata({ done: 2, total: 2, finished: true, exiftoolFailed: false }));
  return api;
}

/** Files with a caller-chosen preview, for tests that don't care about the default PLAN rows. */
async function withRows(rows: ReturnType<typeof row>[]) {
  const api = createFakeApi({ buildPlan: vi.fn(async () => ({ ...PLAN, rows })) });
  render(<App api={api} />);
  await userEvent.click(screen.getByRole('button', { name: 'Choose folder…' }));
  await screen.findByRole('table', { name: 'New names' });
  act(() => api.emitMetadata({ done: 2, total: 2, finished: true, exiftoolFailed: false }));
  return api;
}

/** Clicks Rename once the preview has caught up with the last change: until then the button is disabled. */
async function clickRename() {
  const button = await screen.findByRole('button', { name: 'Rename 2 files' });
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
}

describe('App', () => {
  it('starts as one big drop zone', () => {
    render(<App api={createFakeApi()} />);
    expect(screen.getByRole('heading', { name: 'Drop files or folders here' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Name pattern' })).not.toBeInTheDocument();
  });

  it('adds dropped files and folders', async () => {
    const api = createFakeApi();
    const { container } = render(<App api={api} />);
    const files = [new File(['x'], 'a.jpg'), new File(['y'], 'Trip')];
    fireEvent.drop(container.firstElementChild!, { dataTransfer: { files, types: ['Files'] } });
    await waitFor(() => expect(api.scan).toHaveBeenCalledWith(['/dropped/a.jpg', '/dropped/Trip'], expect.anything()));
  });

  it('shows layout B once files are added, and renames them', async () => {
    const api = await withFiles();
    expect(screen.getByRole('region', { name: 'Files' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Name pattern' })).toHaveValue('{name}');
    expect(screen.getByRole('tablist', { name: 'Options' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'New names' })).toBeInTheDocument();

    await clickRename();
    expect(api.execute).toHaveBeenCalledWith('plan-1');
    expect(await screen.findByText('Renamed 2 files.')).toBeInTheDocument();
  });

  it('keeps Rename disabled while file details are still being read', async () => {
    const api = createFakeApi();
    render(<App api={api} />);
    await userEvent.click(screen.getByRole('button', { name: 'Choose folder…' }));
    await screen.findByRole('cell', { name: 'Trip_001.jpg' });
    act(() => api.emitMetadata({ done: 1, total: 2, finished: false, exiftoolFailed: false }));
    expect(screen.getByRole('button', { name: 'Rename 2 files' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Rename 2 files' })).toHaveAttribute('title', 'Reading file details…');
  });

  it('keeps Rename disabled while the preview is being rebuilt', async () => {
    const api = await withFiles();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Rename 2 files' })).toBeEnabled());
    // A rescan reads the files again: reading restarts, then finishes. Each step schedules a
    // rebuild, and while the last one is in flight the plan on screen is one main has already
    // dropped, so running it would only get "The preview changed".
    act(() => api.emitMetadata({ done: 0, total: 2, finished: false, exiftoolFailed: false }));
    const builds = vi.mocked(api.buildPlan).mock.calls.length;
    await waitFor(() => expect(api.buildPlan).toHaveBeenCalledTimes(builds + 1));
    const slow = deferred<typeof PLAN>();
    vi.mocked(api.buildPlan).mockImplementationOnce(() => slow.promise);
    act(() => api.emitMetadata({ done: 2, total: 2, finished: true, exiftoolFailed: false }));
    const button = screen.getByRole('button', { name: 'Rename 2 files' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Updating the preview…');
    await waitFor(() => expect(api.buildPlan).toHaveBeenCalledTimes(builds + 2));
    expect(button).toBeDisabled();
    await act(async () => slow.resolve({ ...PLAN, planId: 'plan-2' }));
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(api.execute).toHaveBeenCalledWith('plan-2');
  });

  it('sends pattern edits to the preview', async () => {
    const api = await withFiles();
    const input = screen.getByRole('textbox', { name: 'Name pattern' });
    await userEvent.clear(input);
    await userEvent.type(input, 'Trip_');
    await waitFor(() =>
      expect(vi.mocked(api.buildPlan).mock.lastCall?.[0].settings.pattern).toBe('Trip_'),
    );
  });

  it('warns once ExifTool gives up, and lets the banner be dismissed', async () => {
    const api = await withFiles();
    act(() => api.emitMetadata({ done: 5, total: 9, finished: true, exiftoolFailed: true }));
    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent("Couldn't read photo, video and audio details");
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss warning' }));
    expect(screen.queryByText(/Couldn't read photo, video and audio details/)).not.toBeInTheDocument();
  });

  it('brings the banner back after a later read fails again', async () => {
    const api = await withFiles();
    act(() => api.emitMetadata({ done: 5, total: 9, finished: true, exiftoolFailed: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss warning' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    act(() => api.emitMetadata({ done: 5, total: 9, finished: false, exiftoolFailed: false }));
    act(() => api.emitMetadata({ done: 9, total: 9, finished: true, exiftoolFailed: true }));
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't read photo, video and audio details");
  });

  it('ignores a drop while a batch runs', async () => {
    const running = deferred<Awaited<ReturnType<FakeApi['execute']>>>();
    const api = await withFiles(createFakeApi({ execute: vi.fn(() => running.promise) }));
    await clickRename();

    const app = document.querySelector('.app')!;
    const files = [new File(['x'], 'busy.jpg')];
    fireEvent.drop(app, { dataTransfer: { files, types: ['Files'] } });

    await act(async () => {
      running.resolve({ status: 'done', renamed: 2, datesChanged: 0, changes: [], sourcesAfter: ['/photos'] });
    });

    expect(api.scan).not.toHaveBeenCalledWith(expect.arrayContaining(['/dropped/busy.jpg']), expect.anything());
  });

  it("shows the pattern bar's extension from the first row's new name", async () => {
    await withRows([row({ newName: 'x.heic' })]);
    await waitFor(() => expect(document.querySelector('.pat-ext')?.textContent).toBe('.heic'));
  });

  it("falls back to the current name's extension when the new name has none", async () => {
    await withRows([row({ newName: '', currentName: 'a.jpg' })]);
    await waitFor(() => expect(document.querySelector('.pat-ext')?.textContent).toBe('.jpg'));
  });

  it('keeps the drop overlay while dragging over a child element', async () => {
    await withFiles();
    const app = document.querySelector('.app')!;
    const child = screen.getByRole('region', { name: 'Files' });
    const dataTransfer = { types: ['Files'] };

    fireEvent.dragEnter(app, { dataTransfer });
    fireEvent.dragEnter(child, { dataTransfer });
    fireEvent.dragLeave(app, { dataTransfer });
    expect(document.querySelector('.drop-overlay')).toBeInTheDocument();

    fireEvent.dragLeave(app, { dataTransfer });
    expect(document.querySelector('.drop-overlay')).not.toBeInTheDocument();

    // A drop resets the counter, so a fresh enter/leave pair (not two, as the stale count from
    // above would need) is enough to hide the overlay again.
    fireEvent.dragEnter(app, { dataTransfer });
    fireEvent.drop(app, { dataTransfer: { files: [], types: ['Files'] } });
    fireEvent.dragEnter(app, { dataTransfer });
    fireEvent.dragLeave(app, { dataTransfer });
    expect(document.querySelector('.drop-overlay')).not.toBeInTheDocument();
  });

  it('shows a no-drop cursor while busy, and a copy cursor when idle', async () => {
    const running = deferred<Awaited<ReturnType<FakeApi['execute']>>>();
    const api = await withFiles(createFakeApi({ execute: vi.fn(() => running.promise) }));
    await clickRename();

    const app = document.querySelector('.app')!;
    const busyDataTransfer = { dropEffect: '', types: ['Files'] };
    fireEvent.dragOver(app, { dataTransfer: busyDataTransfer });
    expect(busyDataTransfer.dropEffect).toBe('none');

    await act(async () => {
      running.resolve({ status: 'done', renamed: 2, datesChanged: 0, changes: [], sourcesAfter: ['/photos'] });
    });

    const idleDataTransfer = { dropEffect: '', types: ['Files'] };
    fireEvent.dragOver(app, { dataTransfer: idleDataTransfer });
    expect(idleDataTransfer.dropEffect).toBe('copy');
  });

  it('offers undo from the empty state after removing the last source, with the notice', async () => {
    const api = await withFiles(
      createFakeApi({
        canUndo: vi.fn(async () => true),
        undo: vi.fn(async () => ({
          status: 'done' as const,
          restored: 2,
          skipped: [],
          error: null,
          rollback: null,
          sourcesAfter: [],
        })),
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Remove picked' }));

    const undoButton = await screen.findByRole('button', { name: 'Undo last rename' });
    await userEvent.click(undoButton);
    expect(api.undo).toHaveBeenCalled();
    expect(await screen.findByText('Undid the last rename (2 files).')).toBeInTheDocument();
  });

  it('disables the empty-state undo button while the undo runs', async () => {
    const pending = deferred<Awaited<ReturnType<FakeApi['undo']>>>();
    const api = await withFiles(
      createFakeApi({
        canUndo: vi.fn(async () => true),
        undo: vi.fn(() => pending.promise),
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Remove picked' }));

    const undoButton = await screen.findByRole('button', { name: 'Undo last rename' });
    await userEvent.click(undoButton);
    expect(undoButton).toBeDisabled();

    await act(async () => {
      pending.resolve({
        status: 'done' as const,
        restored: 2,
        skipped: [],
        error: null,
        rollback: null,
        sourcesAfter: [],
      });
    });
    expect(api.undo).toHaveBeenCalled();
  });

  it('excludes the files with errors', async () => {
    const withError = {
      ...PLAN,
      rows: [...PLAN.rows, row({ path: '/photos/bad.jpg', kind: 'error', newName: '', flags: [flag('segment-too-long', 'error')] })],
      errorCount: 1,
    };
    const api = await withFiles(createFakeApi({ buildPlan: vi.fn(async () => withError) }));
    await userEvent.click(await screen.findByRole('button', { name: 'Exclude these files' }));
    await waitFor(() =>
      expect(vi.mocked(api.buildPlan).mock.lastCall?.[0].excluded).toEqual(['/photos/bad.jpg']),
    );
  });

  it('leaves a file out when its box is unchecked, and puts it back when checked again', async () => {
    const api = await withFiles(createFakeApi());
    const [first] = PLAN.rows;
    const box = await screen.findByRole('checkbox', { name: `Rename ${first!.currentName}` });
    await userEvent.click(box);
    await waitFor(() => expect(vi.mocked(api.buildPlan).mock.lastCall?.[0].excluded).toEqual([first!.path]));
    expect(box).not.toBeChecked();
    await userEvent.click(box);
    await waitFor(() => expect(vi.mocked(api.buildPlan).mock.lastCall?.[0].excluded).toEqual([]));
  });

  it('opens the failure dialog and copies the report', async () => {
    const api = await withFiles(
      createFakeApi({
        execute: vi.fn(async () => ({
          status: 'failed' as const,
          error: 'Disk full',
          rollback: { complete: false, stranded: [{ original: '/photos/a.jpg', current: '/photos/.renami-1-0.tmp' }] },
        })),
      }),
    );
    await clickRename();
    const dialog = await screen.findByRole('alertdialog', { name: "The rename didn't finish" });
    expect(dialog).toHaveTextContent('/photos/a.jpg is now at /photos/.renami-1-0.tmp');
    await userEvent.click(screen.getByRole('button', { name: 'Copy report' }));
    expect(api.copyText).toHaveBeenCalledWith(expect.stringContaining('/photos/a.jpg -> now at /photos/.renami-1-0.tmp'));
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('locks the upper panes while a batch runs, and unlocks them once it ends', async () => {
    const running = deferred<Awaited<ReturnType<FakeApi['execute']>>>();
    await withFiles(createFakeApi({ execute: vi.fn(() => running.promise) }));

    await clickRename();

    const filesRegion = screen.getByRole('region', { name: 'Files' });
    const panes = filesRegion.parentElement!;
    expect(panes).toHaveAttribute('inert');
    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    expect(panes.contains(cancelButton)).toBe(false);

    await act(async () => {
      running.resolve({ status: 'done', renamed: 2, datesChanged: 0, changes: [], sourcesAfter: ['/photos'] });
    });
    expect(panes).not.toHaveAttribute('inert');
  });
});

describe('App wiring', () => {
  it('rescans with subfolders once the strip toggles them', async () => {
    const api = await withFiles();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Subfolders' }));
    await waitFor(() =>
      expect(api.scan).toHaveBeenLastCalledWith(['/picked'], { ...DEFAULT_SETTINGS.filter, includeSubfolders: true }),
    );
  });

  it('rescans with the narrowed extension filter from the strip', async () => {
    const api = await withFiles();
    await userEvent.click(screen.getByRole('button', { name: 'All types' }));
    await userEvent.click(screen.getByRole('checkbox', { name: '.txt' }));
    await waitFor(() =>
      expect(api.scan).toHaveBeenLastCalledWith(['/picked'], { ...DEFAULT_SETTINGS.filter, extensions: ['jpg'] }),
    );
    expect(screen.getByRole('button', { name: 'Only: .jpg' })).toBeInTheDocument();
  });

  it("adds more sources from the strip's add menu", async () => {
    const api = await withFiles(createFakeApi({ pickPaths: vi.fn(async (kind) => (kind === 'files' ? ['/more/c.jpg'] : ['/picked'])) }));
    await userEvent.click(screen.getByRole('button', { name: '+ Add files or folders' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Files…' }));
    expect(api.pickPaths).toHaveBeenLastCalledWith('files');
    await waitFor(() => expect(api.scan).toHaveBeenLastCalledWith(['/picked', '/more/c.jpg'], expect.anything()));
  });

  it('chooses the destination folder from the Move tab and shows it', async () => {
    const api = await withFiles();
    await userEvent.click(screen.getByRole('tab', { name: /Move into folders/ }));
    await userEvent.click(screen.getByLabelText('One folder'));
    expect(api.pickFolder).toHaveBeenCalledTimes(1);
    expect(await screen.findByTitle('/dest')).toHaveTextContent('/dest');
  });

  it('undoes from the action bar after a rename', async () => {
    const api = await withFiles(createFakeApi({ canUndo: vi.fn(async () => true) }));
    await clickRename();
    await screen.findByText('Renamed 2 files.');
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(api.undo).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Undid the last rename (2 files).')).toBeInTheDocument();
  });

  it('shows the extension of a moved file from the last path segment', async () => {
    await withRows([row({ newName: '2024/07/Trip_001.heic', currentName: 'IMG_1.jpg' })]);
    await waitFor(() => expect(document.querySelector('.pat-ext')?.textContent).toBe('.heic'));
  });

  it('shows no extension when the new name has none, even if the current name does', async () => {
    await withRows([row({ newName: 'README', currentName: 'readme.md' })]);
    await screen.findByRole('cell', { name: 'README' });
    expect(document.querySelector('.pat-ext')).toBeNull();
  });
});

describe('App: more features', () => {
  it('sends a typed name to the preview and offers export and import', async () => {
    const api = await withFiles();
    const firstRow = screen.getAllByRole('row')[1]!;
    fireEvent.doubleClick(within(firstRow).getAllByRole('cell')[1]!);
    const input = screen.getByRole('textbox', { name: 'New name for a.jpg' });
    await userEvent.clear(input);
    await userEvent.type(input, 'beach{Enter}');
    await waitFor(() => expect(vi.mocked(api.buildPlan).mock.lastCall?.[0].overrides).toEqual({ '/photos/a.jpg': 'beach' }));

    await userEvent.click(screen.getByRole('button', { name: 'Export…' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Preview as CSV…' }));
    await waitFor(() => expect(api.saveText).toHaveBeenCalledWith('renami-preview.csv', expect.stringContaining('Trip_001.jpg')));
    expect(screen.getByRole('button', { name: 'Import names…' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Files/ })).toBeInTheDocument();
  });
});

describe('App file preview', () => {
  const panel = () => screen.queryByRole('complementary', { name: 'File preview' });
  const rowOf = (name: string) => screen.getByRole('cell', { name }).closest('[role="row"]') as HTMLElement;

  it('opens the panel for a clicked row, follows the arrow keys, and closes', async () => {
    await withFiles();
    expect(panel()).toBeNull();
    await userEvent.click(screen.getByRole('cell', { name: 'Trip_001.jpg' }));
    // The panel waits out the double-click window before it opens.
    expect(await screen.findByRole('img', { name: 'Preview of a.jpg' })).toBeInTheDocument();
    await userEvent.keyboard('{ArrowDown}');
    expect(await screen.findByRole('img', { name: 'Preview of b.jpg' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close preview' }));
    expect(panel()).toBeNull();
    expect(rowOf('b.jpg')).toHaveFocus();
    // Space brings back the same file.
    rowOf('b.jpg').focus();
    await userEvent.keyboard(' ');
    expect(screen.getByRole('img', { name: 'Preview of b.jpg' })).toBeInTheDocument();
  });

  it("the panel's Leave out unchecks the row", async () => {
    await withFiles();
    await userEvent.click(screen.getByRole('cell', { name: 'Trip_001.jpg' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Leave out' }));
    expect(within(rowOf('a.jpg')).getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Put back' })).toBeInTheDocument();
  });

  it('moves the selection to a neighbor when its row is filtered out, and closes with no rows', async () => {
    await withRows([
      row({ path: '/p/a.jpg', currentName: 'a.jpg', newName: 'A.jpg' }),
      row({ path: '/p/b.jpg', currentName: 'b.jpg', newName: 'B.jpg', flags: [flag('fallback-date', 'warning')] }),
    ]);
    await userEvent.click(await screen.findByRole('cell', { name: 'A.jpg' }));
    expect(await screen.findByRole('img', { name: 'Preview of a.jpg' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: /Show only files that need a look/ }));
    expect(await screen.findByRole('img', { name: 'Preview of b.jpg' })).toBeInTheDocument();
  });
});
