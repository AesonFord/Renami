import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ActionBar, type ActionBarProps } from '../../src/renderer/components/ActionBar.js';
import { OutcomeDialog } from '../../src/renderer/components/OutcomeDialog.js';
import { dialogTitle, isDialogOutcome, noticeText, reportText } from '../../src/renderer/lib/outcome.js';
import { summarize } from '../../src/renderer/lib/summary.js';
import type { Outcome } from '../../src/renderer/state/useSession.js';
import { flag, row } from './fixtures.js';

function renderBar(over: Partial<ActionBarProps> = {}) {
  const props: ActionBarProps = {
    summary: summarize([
      row({ path: '/1' }),
      row({ path: '/2', flags: [flag('fallback-date', 'warning')] }),
      row({ path: '/3', flags: [flag('suffix-added', 'warning')] }),
    ]),
    busy: null,
    progress: null,
    blockedReason: null,
    canUndo: false,
    canExclude: false,
    excludedCount: 0,
    notice: null,
    onRename: vi.fn(),
    onCancel: vi.fn(),
    onUndo: vi.fn(),
    onExcludeErrors: vi.fn(),
    onIncludeExcluded: vi.fn(),
    onDismiss: vi.fn(),
    ...over,
  };
  render(<ActionBar {...props} />);
  return props;
}

describe('ActionBar', () => {
  it('summarizes the batch and renames', async () => {
    const props = renderBar();
    // Each part is <span><strong>3</strong> <span>will be renamed</span></span>; check the whole part.
    const part = (text: string) => screen.getByText(text).parentElement;
    expect(part('will be renamed')).toHaveTextContent('3 will be renamed');
    expect(part('used a fallback date')).toHaveTextContent('1 used a fallback date');
    expect(part('got a suffix')).toHaveTextContent('1 got a suffix');
    expect(screen.getByRole('button', { name: 'Undo last rename' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Rename 3 files' }));
    expect(props.onRename).toHaveBeenCalled();
  });

  it('disables Rename and says why', () => {
    renderBar({ blockedReason: 'Fix or exclude the files with errors' });
    const rename = screen.getByRole('button', { name: 'Rename 3 files' });
    expect(rename).toBeDisabled();
    expect(rename).toHaveAttribute('title', 'Fix or exclude the files with errors');
  });

  it('offers to exclude files with errors, and to put them back', async () => {
    const props = renderBar({ canExclude: true, excludedCount: 2 });
    await userEvent.click(screen.getByRole('button', { name: 'Exclude these files' }));
    expect(props.onExcludeErrors).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Put back 2 excluded files' }));
    expect(props.onIncludeExcluded).toHaveBeenCalled();
  });

  it('shows progress with Cancel while renaming', async () => {
    const props = renderBar({ busy: 'renaming', progress: { done: 12, total: 48 } });
    expect(screen.getByRole('status')).toHaveTextContent('Renaming 12 of 48');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onCancel).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Rename 3 files' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Undo last rename' })).toBeDisabled();
  });

  it('confirms a finished rename with an Undo link', async () => {
    const props = renderBar({ canUndo: true, notice: { kind: 'renamed', renamed: 248, datesChanged: 0 } });
    expect(screen.getByRole('status')).toHaveTextContent('Renamed 248 files.');
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(props.onUndo).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(props.onDismiss).toHaveBeenCalled();
  });
});

describe('ActionBar import and export', () => {
  it('shows no import or export controls until handlers are given', () => {
    renderBar();
    expect(screen.queryByRole('button', { name: 'Import names…' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export…' })).not.toBeInTheDocument();
  });

  it('imports names, and exports the preview or the last rename from a menu', async () => {
    const props = renderBar({ onImportNames: vi.fn(), onExportPreview: vi.fn(), onExportLast: vi.fn(), hasLastBatch: false });
    await userEvent.click(screen.getByRole('button', { name: 'Import names…' }));
    expect(props.onImportNames).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Export…' }));
    const menu = screen.getByRole('menu', { name: 'Export' });
    expect(within(menu).getByRole('menuitem', { name: 'Last rename as CSV…' })).toBeDisabled();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Preview as CSV…' }));
    expect(props.onExportPreview).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu', { name: 'Export' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export…' })).toHaveFocus();
  });

  it('exports the last rename once there is one', async () => {
    const props = renderBar({ onExportPreview: vi.fn(), onExportLast: vi.fn(), hasLastBatch: true });
    await userEvent.click(screen.getByRole('button', { name: 'Export…' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Last rename as CSV…' }));
    expect(props.onExportLast).toHaveBeenCalledTimes(1);
  });

  it('closes the export menu on Escape', async () => {
    renderBar({ onExportPreview: vi.fn(), onExportLast: vi.fn() });
    await userEvent.click(screen.getByRole('button', { name: 'Export…' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu', { name: 'Export' })).not.toBeInTheDocument();
  });

  it('disables the new controls while a batch runs', () => {
    renderBar({ busy: 'renaming', onImportNames: vi.fn(), onExportPreview: vi.fn(), onExportLast: vi.fn() });
    expect(screen.getByRole('button', { name: 'Import names…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Export…' })).toBeDisabled();
  });
});

describe('outcome text', () => {
  const rollback = { complete: false, stranded: [{ original: '/p/a.jpg', current: '/p/.renami-x-0.tmp' }], datesNotRestored: ['/p/b.jpg'] };

  it('decides which outcomes need a dialog', () => {
    expect(isDialogOutcome({ kind: 'renamed', renamed: 1, datesChanged: 0 })).toBe(false);
    expect(isDialogOutcome({ kind: 'cancelled', action: 'rename', rollback: { complete: true, stranded: [] } })).toBe(false);
    expect(isDialogOutcome({ kind: 'cancelled', action: 'rename', rollback })).toBe(true);
    expect(isDialogOutcome({ kind: 'failed', action: 'rename', error: 'x', rollback: null, skipped: [] })).toBe(true);
    expect(isDialogOutcome({ kind: 'undone', restored: 1, skipped: [] })).toBe(false);
    expect(isDialogOutcome({ kind: 'undone', restored: 1, skipped: [{ path: '/a', reason: 'r' }] })).toBe(true);
    expect(isDialogOutcome({ kind: 'stale', changed: ['a'] })).toBe(false);
    expect(isDialogOutcome({ kind: 'message', text: 'x' })).toBe(false);
  });

  it('writes the inline notices', () => {
    expect(noticeText({ kind: 'renamed', renamed: 1, datesChanged: 0 })).toBe('Renamed 1 file.');
    expect(noticeText({ kind: 'renamed', renamed: 3, datesChanged: 3 })).toBe('Renamed 3 files and changed dates on 3.');
    expect(noticeText({ kind: 'renamed', renamed: 0, datesChanged: 2 })).toBe('Changed dates on 2 files.');
    expect(noticeText({ kind: 'undone', restored: 4, skipped: [] })).toBe('Undid the last rename (4 files).');
    expect(noticeText({ kind: 'stale', changed: ['/a'] })).toBe(
      'Some files changed since the preview, so nothing was renamed. The preview is up to date now; check it and try again.',
    );
    expect(noticeText({ kind: 'cancelled', action: 'rename', rollback: { complete: true, stranded: [] } })).toBe(
      'Cancelled. Every file is back where it was.',
    );
    expect(noticeText({ kind: 'message', text: 'Hello' })).toBe('Hello');
  });

  it('writes a plain-text report listing every file', () => {
    const outcome: Outcome = { kind: 'failed', action: 'rename', error: 'Disk full', rollback, skipped: [] };
    expect(reportText(outcome)).toBe(
      [
        "The rename didn't finish",
        'Disk full',
        '',
        "These files couldn't be put back:",
        '/p/a.jpg -> now at /p/.renami-x-0.tmp',
        '',
        "These files are back, but their dates couldn't be restored:",
        '/p/b.jpg',
      ].join('\n'),
    );
  });
});

describe('OutcomeDialog', () => {
  it('lists what failed and copies the report', async () => {
    const onCopy = vi.fn();
    const onClose = vi.fn();
    const outcome: Outcome = {
      kind: 'failed',
      action: 'rename',
      error: 'Disk full',
      rollback: { complete: false, stranded: [{ original: '/p/a.jpg', current: '/p/.renami-x-0.tmp' }] },
      skipped: [],
    };
    render(<OutcomeDialog outcome={outcome} onCopy={onCopy} onClose={onClose} />);
    const dialog = screen.getByRole('alertdialog', { name: "The rename didn't finish" });
    expect(dialog).toHaveTextContent('Disk full');
    expect(dialog).toHaveTextContent('/p/a.jpg is now at /p/.renami-x-0.tmp');
    await userEvent.click(screen.getByRole('button', { name: 'Copy report' }));
    expect(onCopy).toHaveBeenCalledWith(reportText(outcome));
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('confirms a complete rollback', () => {
    const outcome: Outcome = { kind: 'failed', action: 'rename', error: 'Permission denied', rollback: { complete: true, stranded: [] }, skipped: [] };
    render(<OutcomeDialog outcome={outcome} onCopy={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Every file was put back where it was.');
  });

  it('lists files an undo skipped, with the reason', () => {
    const outcome: Outcome = { kind: 'undone', restored: 2, skipped: [{ path: '/p/x.jpg', reason: 'Changed since the rename' }] };
    render(<OutcomeDialog outcome={outcome} onCopy={vi.fn()} onClose={vi.fn()} />);
    const dialog = screen.getByRole('alertdialog', { name: "Some files weren't put back" });
    expect(dialog).toHaveTextContent('/p/x.jpg: Changed since the rename');
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    const outcome: Outcome = { kind: 'failed', action: 'rename', error: 'Disk full', rollback: null, skipped: [] };
    render(<OutcomeDialog outcome={outcome} onCopy={vi.fn()} onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('wraps Tab from the last button to the first', async () => {
    const outcome: Outcome = { kind: 'failed', action: 'rename', error: 'Disk full', rollback: null, skipped: [] };
    render(<OutcomeDialog outcome={outcome} onCopy={vi.fn()} onClose={vi.fn()} />);
    const close = screen.getByRole('button', { name: 'Close' });
    const copy = screen.getByRole('button', { name: 'Copy report' });
    expect(close).toHaveFocus();
    await userEvent.tab();
    expect(copy).toHaveFocus();
  });

  it('keeps focus on the autoFocus Close button under StrictMode double-invoked effects', async () => {
    const outcome: Outcome = { kind: 'failed', action: 'rename', error: 'Disk full', rollback: null, skipped: [] };
    function StrictHarness() {
      const [open, setOpen] = useState(false);
      return (
        <StrictMode>
          <button type="button" onClick={() => setOpen(true)}>
            Opener
          </button>
          {open && <OutcomeDialog outcome={outcome} onCopy={vi.fn()} onClose={vi.fn()} />}
        </StrictMode>
      );
    }
    render(<StrictHarness />);
    await userEvent.click(screen.getByRole('button', { name: 'Opener' }));
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });
});

describe('dialog text', () => {
  const complete = { complete: true, stranded: [] };

  it('titles the dialog by what was running and how it ended', () => {
    expect(dialogTitle({ kind: 'failed', action: 'rename', error: null, rollback: null, skipped: [] })).toBe("The rename didn't finish");
    expect(dialogTitle({ kind: 'failed', action: 'undo', error: null, rollback: null, skipped: [] })).toBe("The undo didn't finish");
    expect(dialogTitle({ kind: 'cancelled', action: 'rename', rollback: complete })).toBe('The rename was cancelled');
    expect(dialogTitle({ kind: 'cancelled', action: 'undo', rollback: complete })).toBe('The undo was cancelled');
    expect(dialogTitle({ kind: 'undone', restored: 1, skipped: [{ path: '/a', reason: 'r' }] })).toBe("Some files weren't put back");
    // Outcomes that never get a dialog fall back to their notice.
    expect(dialogTitle({ kind: 'message', text: 'Hello' })).toBe('Hello');
    expect(dialogTitle({ kind: 'renamed', renamed: 2, datesChanged: 0 })).toBe('Renamed 2 files.');
  });

  it('uses the dialog title as the notice for a failure, and words a cancelled undo', () => {
    expect(noticeText({ kind: 'failed', action: 'undo', error: 'x', rollback: null, skipped: [] })).toBe("The undo didn't finish");
    expect(noticeText({ kind: 'cancelled', action: 'undo', rollback: complete })).toBe('Undo cancelled. Nothing changed.');
  });

  it('reports a complete rollback in one line', () => {
    expect(reportText({ kind: 'cancelled', action: 'rename', rollback: complete })).toBe(
      ['The rename was cancelled', '', 'Every file was put back where it was.'].join('\n'),
    );
  });

  it('lists the files an undo left alone, with the reason for each', () => {
    const skipped = [
      { path: '/p/a.jpg', reason: 'Changed since the rename' },
      { path: '/p/b.jpg', reason: 'Its original name is taken by another file' },
    ];
    expect(reportText({ kind: 'undone', restored: 1, skipped })).toBe(
      [
        "Some files weren't put back",
        '',
        'These files were left where they are:',
        '/p/a.jpg: Changed since the rename',
        '/p/b.jpg: Its original name is taken by another file',
      ].join('\n'),
    );
  });

  it('reports a failure with no error text, no rollback and skipped files', () => {
    const outcome: Outcome = { kind: 'failed', action: 'undo', error: null, rollback: null, skipped: [{ path: '/p/c.jpg', reason: 'Gone' }] };
    expect(reportText(outcome)).toBe(["The undo didn't finish", '', 'These files were left where they are:', '/p/c.jpg: Gone'].join('\n'));
  });
});

describe('OutcomeDialog sections', () => {
  it('lists files whose dates could not be restored, and says the rest were put back', () => {
    const outcome: Outcome = {
      kind: 'cancelled',
      action: 'rename',
      rollback: { complete: false, stranded: [], datesNotRestored: ['/p/a.jpg', '/p/b.jpg'] },
    };
    render(<OutcomeDialog outcome={outcome} onCopy={vi.fn()} onClose={vi.fn()} />);
    const dialog = screen.getByRole('alertdialog', { name: 'The rename was cancelled' });
    expect(dialog).toHaveTextContent("These files are back, but their dates couldn't be restored:");
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['/p/a.jpg', '/p/b.jpg']);
    expect(dialog).not.toHaveTextContent("couldn't be put back");
  });

  it('lists the files an undo skipped, with their reasons', () => {
    const outcome: Outcome = { kind: 'undone', restored: 3, skipped: [{ path: '/p/c.jpg', reason: 'Changed since the rename' }] };
    render(<OutcomeDialog outcome={outcome} onCopy={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('alertdialog', { name: "Some files weren't put back" })).toHaveTextContent('These files were left where they are:');
    expect(screen.getByRole('listitem')).toHaveTextContent('/p/c.jpg: Changed since the rename');
  });

  it('says every file was put back after a complete rollback, with no lists', () => {
    const outcome: Outcome = { kind: 'failed', action: 'rename', error: 'Disk full', rollback: { complete: true, stranded: [] }, skipped: [] };
    render(<OutcomeDialog outcome={outcome} onCopy={vi.fn()} onClose={vi.fn()} />);
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Disk full');
    expect(dialog).toHaveTextContent('Every file was put back where it was.');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('closes on Escape and gives focus back to what opened it', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Show
          </button>
          {open && (
            <OutcomeDialog outcome={{ kind: 'failed', action: 'rename', error: 'x', rollback: null, skipped: [] }} onCopy={vi.fn()} onClose={() => setOpen(false)} />
          )}
        </>
      );
    }
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show' })).toHaveFocus();
  });
});
