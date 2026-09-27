import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OPEN_DELAY_MS, PreviewTable } from '../../src/renderer/components/PreviewTable.js';
import { badgesFor } from '../../src/renderer/lib/flags.js';
import { COLUMNS, contentWidth, WIDTHS_KEY } from '../../src/renderer/lib/columns.js';
import type { PreviewRow } from '../../src/shared/ipc.js';
import { flag, row } from './fixtures.js';

function Harness({ rows, excluded: initial = [] }: { rows: PreviewRow[]; excluded?: string[] }) {
  const [only, setOnly] = useState(false);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set(initial));
  const onToggle = (paths: string[], include: boolean) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      for (const p of paths) {
        if (include) next.delete(p);
        else next.add(p);
      }
      return next;
    });
  return <PreviewTable rows={rows} onlyNeedsLook={only} onOnlyNeedsLook={setOnly} excluded={excluded} onToggle={onToggle} />;
}

const NONE: ReadonlySet<string> = new Set();

const bodyRows = () => screen.getAllByRole('row').slice(1);

describe('PreviewTable', () => {
  it('shows the five columns and one row per file', () => {
    render(
      <Harness
        rows={[
          row({ path: '/p/a', currentName: 'IMG_1.HEIC', newName: 'Trip_001.heic', folder: 'Hawaii', folderPath: '/p/Hawaii' }),
          row({ path: '/p/b', currentName: 'IMG_2.HEIC', newName: '2024/Trip_002.heic', kind: 'move' }),
        ]}
      />,
    );
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Current name', 'New name', 'Date used', 'From folder', 'Status',
    ]);
    const [first, second] = bodyRows();
    expect(within(first!).getAllByRole('cell').map((c) => c.textContent)).toEqual([
      'IMG_1.HEIC', 'Trip_001.heic', '2024-07-04 14:30', 'Hawaii', 'Ready',
    ]);
    expect(within(first!).getByText('Hawaii')).toHaveAttribute('title', '/p/Hawaii');
    // The checkbox doesn't leak into the name cell's accessible name, which is how rows are found.
    expect(within(first!).getByRole('cell', { name: 'IMG_1.HEIC' })).toBeInTheDocument();
    expect(within(second!).getByRole('cell', { name: '2024/Trip_002.heic' })).toBeInTheDocument();
    expect(within(second!).getByText('Will move')).toBeInTheDocument();
  });

  it('tints flagged rows, explains badges on hover and names fallback dates', () => {
    render(
      <Harness
        rows={[
          row({
            path: '/p/a',
            dateSource: 'created',
            flags: [flag('fallback-date', 'warning', 'No date taken in this file; used created date'), flag('paired', 'info', 'Paired')],
          }),
          row({ path: '/p/b', kind: 'error', newName: '', flags: [flag('empty-segment', 'error', 'The name is empty')] }),
        ]}
      />,
    );
    const [warn, error] = bodyRows();
    expect(warn).toHaveClass('row-warn');
    expect(within(warn!).getByText('Fallback date')).toHaveAttribute('title', 'No date taken in this file; used created date\nPaired');
    expect(within(warn!).getByText('+1')).toBeInTheDocument();
    expect(within(warn!).getByText('(created)')).toBeInTheDocument();
    expect(error).toHaveClass('row-error');
    expect(within(error!).getAllByRole('cell')[1]).toHaveTextContent('—');
    expect(within(error!).getByText('Empty name')).toBeInTheDocument();
  });

  it('gives the +N badge the tone of the most serious hidden badge', () => {
    render(
      <Harness
        rows={[
          row({
            path: '/p/a',
            kind: 'error',
            newName: '',
            flags: [flag('empty-segment', 'error'), flag('fallback-date', 'warning')],
          }),
        ]}
      />,
    );
    const [only] = bodyRows();
    expect(within(only!).getByText('Empty name')).toHaveClass('tone-error');
    expect(within(only!).getByText('+1')).toHaveClass('tone-warn');
  });

  it('shows no date suffix when there is no date used', () => {
    render(<Harness rows={[row({ path: '/p/a', dateUsed: null, dateSource: 'created' })]} />);
    const [only] = bodyRows();
    expect(within(only!).getAllByRole('cell')[2]).toHaveTextContent('—');
    expect(within(only!).queryByText('(created)')).not.toBeInTheDocument();
  });

  it('filters to the files that need a look', async () => {
    render(
      <Harness
        rows={[
          row({ path: '/p/a', currentName: 'fine.jpg' }),
          row({ path: '/p/b', currentName: 'paired.jpg', flags: [flag('paired', 'info')] }),
          row({ path: '/p/c', currentName: 'look.jpg', flags: [flag('suffix-added', 'warning')] }),
        ]}
      />,
    );
    await userEvent.click(screen.getByRole('checkbox', { name: /Show only files that need a look/ }));
    expect(bodyRows().map((r) => within(r).getAllByRole('cell')[0]?.textContent)).toEqual(['look.jpg']);
  });

  it('hides the filter when nothing needs a look', () => {
    render(<Harness rows={[row()]} />);
    expect(screen.queryByRole('checkbox', { name: /need a look/ })).not.toBeInTheDocument();
  });

  it('renders only the rows in view for a large batch', () => {
    const rows = Array.from({ length: 5000 }, (_, i) => row({ path: `/p/${i}`, currentName: `IMG_${i}.jpg` }));
    render(<Harness rows={rows} />);
    const shown = bodyRows();
    expect(shown.length).toBeGreaterThan(10);
    expect(shown.length).toBeLessThan(60);
    expect(screen.getByRole('table')).toHaveAttribute('aria-rowcount', '5001');
  });
});

describe('choosing files', () => {
  const five = () =>
    Array.from({ length: 5 }, (_, i) => row({ path: `/p/${i + 1}`, currentName: `IMG_${i + 1}.jpg` }));
  const box = (name: string) => screen.getByRole('checkbox', { name: `Rename ${name}` });
  const all = () => screen.getByRole('checkbox', { name: 'Rename all files shown' });
  const checked = () => bodyRows().map((r) => (within(r).getByRole('checkbox') as HTMLInputElement).checked);

  it('checks every file to start, and dims a file once it is unchecked', async () => {
    render(<Harness rows={five()} />);
    expect(checked()).toEqual([true, true, true, true, true]);
    expect(all()).toBeChecked();

    await userEvent.click(box('IMG_2.jpg'));
    expect(box('IMG_2.jpg')).not.toBeChecked();
    expect(bodyRows()[1]).toHaveClass('row-excluded');
    expect(bodyRows()[0]).not.toHaveClass('row-excluded');

    await userEvent.click(box('IMG_2.jpg'));
    expect(box('IMG_2.jpg')).toBeChecked();
    expect(bodyRows()[1]).not.toHaveClass('row-excluded');
  });

  it('shows a file left out of the plan with no new name', () => {
    render(<Harness rows={[row({ path: '/p/1', kind: 'excluded', newName: '', dateUsed: null })]} excluded={['/p/1']} />);
    const [only] = bodyRows();
    expect(within(only!).getByRole('checkbox')).not.toBeChecked();
    expect(within(only!).getAllByRole('cell')[1]).toHaveTextContent('—');
    expect(within(only!).getByText('Left out')).toBeInTheDocument();
  });

  it('shows the header box as mixed, and checks or unchecks every file with it', async () => {
    render(<Harness rows={five()} excluded={['/p/3']} />);
    expect(all()).not.toBeChecked();
    expect(all()).toHaveProperty('indeterminate', true);

    await userEvent.click(all());
    expect(checked()).toEqual([true, true, true, true, true]);
    expect(all()).toHaveProperty('indeterminate', false);

    await userEvent.click(all());
    expect(checked()).toEqual([false, false, false, false, false]);
    expect(all()).not.toBeChecked();
  });

  it('only changes the files shown when the list is filtered', async () => {
    const rows = five();
    rows[1] = { ...rows[1]!, flags: [flag('suffix-added', 'warning')] };
    rows[3] = { ...rows[3]!, flags: [flag('suffix-added', 'warning')] };
    render(<Harness rows={rows} />);
    await userEvent.click(screen.getByRole('checkbox', { name: /Show only files that need a look/ }));
    await userEvent.click(all());
    await userEvent.click(screen.getByRole('checkbox', { name: /Show only files that need a look/ }));
    expect(checked()).toEqual([true, false, true, false, true]);
  });

  it('sets a whole range with Shift-click, to the state of the file clicked', async () => {
    const user = userEvent.setup();
    render(<Harness rows={five()} />);
    await user.click(box('IMG_2.jpg'));
    await user.keyboard('{Shift>}');
    await user.click(box('IMG_4.jpg'));
    await user.keyboard('{/Shift}');
    expect(checked()).toEqual([true, false, false, false, true]);

    // The range runs upwards too, from the last file clicked.
    await user.keyboard('{Shift>}');
    await user.click(box('IMG_1.jpg'));
    await user.keyboard('{/Shift}');
    expect(checked()).toEqual([false, false, false, false, true]);
  });

  it('toggles a focused box with Space', async () => {
    const user = userEvent.setup();
    render(<Harness rows={five()} />);
    box('IMG_1.jpg').focus();
    await user.keyboard(' ');
    expect(box('IMG_1.jpg')).not.toBeChecked();
  });
});

describe('column widths', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  const table = () => screen.getByRole('table');
  const layout = () => table().style.getPropertyValue('--cols');
  const divider = (label: string) => screen.getByRole('separator', { name: `Resize ${label} column` });
  const saved = () => JSON.parse(localStorage.getItem(WIDTHS_KEY) ?? 'null') as unknown;

  it('puts a divider on every column header and starts with the layout that fills the window', () => {
    render(<Harness rows={[row()]} />);
    expect(screen.getAllByRole('separator').map((s) => s.getAttribute('aria-label'))).toEqual(
      COLUMNS.map((c) => `Resize ${c.label} column`),
    );
    expect(layout()).toBe('');
  });

  it('resizes a column from the keyboard, fixes every column at its width, and remembers it', () => {
    render(<Harness rows={[row()]} />);
    // jsdom lays out every element 1000px wide (setup.ts), so the first resize starts from there.
    fireEvent.keyDown(divider('New name'), { key: 'ArrowRight' });
    const widths = [1000, 1010, 1000, 1000, 1000];
    expect(divider('New name')).toHaveAttribute('aria-valuenow', '1010');
    expect(layout()).toBe('1000px 1010px 1000px 1000px 1000px');
    expect(screen.getAllByRole('row')[0]).toHaveStyle({ minWidth: `${contentWidth(widths)}px` });
    expect(saved()).toEqual(widths);

    fireEvent.keyDown(divider('New name'), { key: 'ArrowLeft' });
    fireEvent.keyDown(divider('New name'), { key: 'ArrowLeft' });
    expect(divider('New name')).toHaveAttribute('aria-valuenow', '990');
  });

  it('starts with the widths saved last time', () => {
    localStorage.setItem(WIDTHS_KEY, JSON.stringify([200, 400, 150, 120, 250]));
    render(<Harness rows={[row()]} />);
    expect(layout()).toBe('200px 400px 150px 120px 250px');
    expect(divider('Date used')).toHaveAttribute('aria-valuenow', '150');
  });

  it('fits a column to its longest value on double-click, counting rows scrolled out of view', () => {
    // jsdom has no canvas; measure 7px per character.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      font: '',
      measureText: (text: string) => ({ width: text.length * 7 }),
    } as unknown as CanvasRenderingContext2D);
    const rows = Array.from({ length: 5000 }, (_, i) => row({ path: `/p/${i}`, newName: `IMG_${i}.jpg` }));
    rows[4999] = row({ path: '/p/last', newName: 'a_much_longer_new_name_than_the_rest.jpg' });
    render(<Harness rows={rows} />);
    expect(screen.queryByText('a_much_longer_new_name_than_the_rest.jpg')).not.toBeInTheDocument();

    fireEvent.doubleClick(divider('New name'));
    expect(divider('New name')).toHaveAttribute('aria-valuenow', String(Math.ceil(40 * 7 + 4)));
  });

  it('resets every column from the header menu and forgets the saved widths', async () => {
    localStorage.setItem(WIDTHS_KEY, JSON.stringify([200, 400, 150, 120, 250]));
    render(<Harness rows={[row()]} />);
    fireEvent.contextMenu(screen.getAllByRole('columnheader')[0]!);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Reset column widths' }));
    expect(layout()).toBe('');
    expect(saved()).toBeNull();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('column resizing with the pointer', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  const table = () => screen.getByRole('table');
  const layout = () => table().style.getPropertyValue('--cols');
  const divider = (label: string) => screen.getByRole('separator', { name: `Resize ${label} column` });

  it('drags a divider, fixing the layout on the first real move and following the pointer from there', () => {
    render(<Harness rows={[row()]} />);
    const handle = divider('Current name');
    fireEvent.pointerDown(handle, { button: 0, clientX: 100, pointerId: 1 });
    // Same spot: no move yet, so the fluid default layout stays.
    fireEvent.pointerMove(handle, { clientX: 100, pointerId: 1 });
    expect(layout()).toBe('');

    fireEvent.pointerMove(handle, { clientX: 140, pointerId: 1 });
    expect(layout()).toBe('1040px 1000px 1000px 1000px 1000px');
    // Every move is measured from where the drag started, not from the last move.
    fireEvent.pointerMove(handle, { clientX: 60, pointerId: 1 });
    expect(divider('Current name')).toHaveAttribute('aria-valuenow', '960');

    fireEvent.pointerUp(handle, { pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 500, pointerId: 1 });
    expect(divider('Current name')).toHaveAttribute('aria-valuenow', '960');
  });

  it('never lets a drag take a column past its limits', () => {
    render(<Harness rows={[row()]} />);
    const handle = divider('From folder');
    fireEvent.pointerDown(handle, { button: 0, clientX: 1000, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 0, pointerId: 1 });
    expect(divider('From folder')).toHaveAttribute('aria-valuenow', String(COLUMNS[3].min));
    fireEvent.pointerMove(handle, { clientX: 5000, pointerId: 1 });
    expect(divider('From folder')).toHaveAttribute('aria-valuenow', '2000');
  });

  it('leaves the default layout alone after a plain click on a divider', () => {
    render(<Harness rows={[row()]} />);
    const handle = divider('New name');
    fireEvent.pointerDown(handle, { button: 0, clientX: 100, pointerId: 1 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(layout()).toBe('');
    expect(localStorage.getItem(WIDTHS_KEY)).toBeNull();
  });

  it('ignores a drag that starts with the right button', () => {
    render(<Harness rows={[row()]} />);
    const handle = divider('New name');
    fireEvent.pointerDown(handle, { button: 2, clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 300, pointerId: 1 });
    expect(layout()).toBe('');
  });

  it('stops following the pointer once the drag is cancelled', () => {
    render(<Harness rows={[row()]} />);
    const handle = divider('New name');
    fireEvent.pointerDown(handle, { button: 0, clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 120, pointerId: 1 });
    fireEvent.pointerCancel(handle, { pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 400, pointerId: 1 });
    expect(divider('New name')).toHaveAttribute('aria-valuenow', '1020');
  });

  it('ignores keys other than the left and right arrows on a divider', () => {
    render(<Harness rows={[row()]} />);
    fireEvent.keyDown(divider('New name'), { key: 'Enter' });
    fireEvent.keyDown(divider('New name'), { key: 'ArrowUp' });
    expect(layout()).toBe('');
  });

  it('keeps the header in step with sideways scrolling of the body', () => {
    render(<Harness rows={[row()]} />);
    const [head, body] = screen.getAllByRole('rowgroup');
    body!.scrollLeft = 120;
    fireEvent.scroll(body!);
    expect(head!.scrollLeft).toBe(120);
  });

  it('fits the Current name column to its longest name, counting the checkbox', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      font: '',
      measureText: (text: string) => ({ width: text.length * 7 }),
    } as unknown as CanvasRenderingContext2D);
    render(<Harness rows={[row({ path: '/p/a', currentName: 'a_rather_long_name.jpg' })]} />);
    fireEvent.doubleClick(divider('Current name'));
    // The name, the checkbox and its gap, plus the fit slack.
    expect(divider('Current name')).toHaveAttribute('aria-valuenow', String(Math.ceil(22 * 7 + 22 + 4)));
  });

  it('fits the Status column to its widest badge pair, counting the +N badge', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      font: '',
      measureText: (text: string) => ({ width: text.length * 7 }),
    } as unknown as CanvasRenderingContext2D);
    const busy = row({ path: '/p/busy', flags: [flag('fallback-date', 'warning'), flag('suffix-added', 'warning')] });
    render(<Harness rows={[row({ path: '/p/plain' }), busy]} />);
    fireEvent.doubleClick(divider('Status'));
    const badges = badgesFor(busy);
    // First badge, the gap, the "+1" badge, each with the badge padding, plus the fit slack.
    const expected = Math.ceil(badges[0]!.label.length * 7 + 16 + 4 + '+1'.length * 7 + 16 + 4);
    expect(divider('Status')).toHaveAttribute('aria-valuenow', String(expected));
  });

  it('falls back to the column minimum when text cannot be measured', () => {
    // Where the platform has no canvas, getContext returns null, so only the header label (0px here) counts.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    render(<Harness rows={[row({ newName: 'a_very_long_name_indeed_that_would_be_wide.jpg' })]} />);
    fireEvent.doubleClick(divider('New name'));
    expect(divider('New name')).toHaveAttribute('aria-valuenow', String(COLUMNS[1].min));
    fireEvent.doubleClick(divider('Status'));
    expect(divider('Status')).toHaveAttribute('aria-valuenow', String(COLUMNS[4].min));
  });

  it('closes the header menu on Escape without changing anything', async () => {
    localStorage.setItem(WIDTHS_KEY, JSON.stringify([200, 400, 150, 120, 250]));
    render(<Harness rows={[row()]} />);
    fireEvent.contextMenu(screen.getAllByRole('columnheader')[0]!);
    expect(screen.getByRole('menu', { name: 'Columns' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(layout()).toBe('200px 400px 150px 120px 250px');
  });
});

describe('editing and reordering', () => {
  const three = () => [
    row({ path: '/p/a', currentName: 'a.jpg', newName: 'Trip_001.jpg', stem: 'Trip_001' }),
    row({ path: '/p/b', currentName: 'b.jpg', newName: 'Trip_002.jpg', stem: 'Trip_002' }),
    row({ path: '/p/c', currentName: 'c.jpg', newName: 'Trip_003.jpg', stem: 'Trip_003' }),
  ];
  const newNameCell = (i: number) => within(bodyRows()[i]!).getAllByRole('cell')[1]!;
  const dataTransfer = () => ({ setData: vi.fn(), getData: vi.fn(), effectAllowed: 'none', dropEffect: 'none' });

  it('offers no editing or dragging without handlers', () => {
    render(<PreviewTable excluded={NONE} onToggle={() => {}} rows={three()} onlyNeedsLook={false} onOnlyNeedsLook={() => {}} />);
    fireEvent.doubleClick(newNameCell(0));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(bodyRows()[0]).not.toHaveAttribute('draggable', 'true');
  });

  it('edits a new name in place on double-click and reports the stem on Enter', async () => {
    const onEditName = vi.fn();
    render(<PreviewTable excluded={NONE} onToggle={() => {}} rows={three()} onlyNeedsLook={false} onOnlyNeedsLook={() => {}} onEditName={onEditName} />);
    fireEvent.doubleClick(newNameCell(0));
    const input = screen.getByRole('textbox', { name: 'New name for a.jpg' });
    expect(input).toHaveValue('Trip_001');
    await userEvent.clear(input);
    await userEvent.type(input, 'beach{Enter}');
    expect(onEditName).toHaveBeenCalledTimes(1);
    expect(onEditName).toHaveBeenCalledWith('/p/a', 'beach');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('offers no name to type for a file left out', () => {
    render(<PreviewTable excluded={new Set(['/p/a'])} onToggle={() => {}} rows={three()} onlyNeedsLook={false} onOnlyNeedsLook={() => {}} onEditName={vi.fn()} />);
    fireEvent.doubleClick(newNameCell(0));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    fireEvent.keyDown(bodyRows()[0]!, { key: 'Enter' });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    fireEvent.doubleClick(newNameCell(1));
    expect(screen.getByRole('textbox', { name: 'New name for b.jpg' })).toBeInTheDocument();
  });

  it('clears the typed name when emptied, and cancels on Escape', async () => {
    const onEditName = vi.fn();
    render(<PreviewTable excluded={NONE} onToggle={() => {}} rows={three()} onlyNeedsLook={false} onOnlyNeedsLook={() => {}} onEditName={onEditName} />);
    fireEvent.doubleClick(newNameCell(1));
    await userEvent.clear(screen.getByRole('textbox'));
    await userEvent.keyboard('{Enter}');
    expect(onEditName).toHaveBeenCalledWith('/p/b', null);

    fireEvent.doubleClick(newNameCell(2));
    await userEvent.type(screen.getByRole('textbox'), 'zzz{Escape}');
    expect(onEditName).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('commits on blur, even right after an earlier edit was cancelled with Escape', async () => {
    const onEditName = vi.fn();
    render(<PreviewTable excluded={NONE} onToggle={() => {}} rows={three()} onlyNeedsLook={false} onOnlyNeedsLook={() => {}} onEditName={onEditName} />);
    fireEvent.doubleClick(newNameCell(0));
    await userEvent.keyboard('{Escape}');
    fireEvent.doubleClick(newNameCell(1));
    await userEvent.type(screen.getByRole('textbox'), 'x');
    fireEvent.blur(screen.getByRole('textbox'));
    expect(onEditName).toHaveBeenCalledTimes(1);
    expect(onEditName).toHaveBeenCalledWith('/p/b', 'Trip_002x');
  });

  it('opens the editor with Enter on a focused row', async () => {
    render(<PreviewTable excluded={NONE} onToggle={() => {}} rows={three()} onlyNeedsLook={false} onOnlyNeedsLook={() => {}} onEditName={vi.fn()} />);
    bodyRows()[2]!.focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('textbox', { name: 'New name for c.jpg' })).toHaveValue('Trip_003');
  });

  it('reorders by dropping one row on another', () => {
    const onReorder = vi.fn();
    render(<PreviewTable excluded={NONE} onToggle={() => {}} rows={three()} onlyNeedsLook={false} onOnlyNeedsLook={() => {}} onReorder={onReorder} />);
    const rows = bodyRows();
    expect(rows[0]).toHaveAttribute('draggable', 'true');
    const dt = dataTransfer();
    fireEvent.dragStart(rows[0]!, { dataTransfer: dt });
    fireEvent.dragOver(rows[2]!, { dataTransfer: dt });
    fireEvent.drop(rows[2]!, { dataTransfer: dt });
    expect(onReorder).toHaveBeenCalledWith(['/p/b', '/p/c', '/p/a']);
  });

  it('moves a focused row with Alt and the arrow keys', async () => {
    const onReorder = vi.fn();
    render(<PreviewTable excluded={NONE} onToggle={() => {}} rows={three()} onlyNeedsLook={false} onOnlyNeedsLook={() => {}} onReorder={onReorder} />);
    bodyRows()[1]!.focus();
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
    expect(onReorder).toHaveBeenLastCalledWith(['/p/b', '/p/a', '/p/c']);
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(onReorder).toHaveBeenLastCalledWith(['/p/a', '/p/c', '/p/b']);
  });

  // I4: with "Show only files that need a look" on, dragging or arrow-moving a visible row must
  // not rip the hidden rows out of their place in the full order.
  const withFilter = () => [
    row({ path: '/p/a', currentName: 'a.jpg', newName: 'A.jpg', stem: 'A', flags: [flag('missing-value', 'warning')] }),
    row({ path: '/p/b', currentName: 'b.jpg', newName: 'B.jpg', stem: 'B' }),
    row({ path: '/p/c', currentName: 'c.jpg', newName: 'C.jpg', stem: 'C' }),
    row({ path: '/p/d', currentName: 'd.jpg', newName: 'D.jpg', stem: 'D', flags: [flag('missing-value', 'warning')] }),
  ];

  it('drops against the full row list, leaving rows the filter hides in place', () => {
    const onReorder = vi.fn();
    render(<PreviewTable excluded={NONE} onToggle={() => {}} rows={withFilter()} onlyNeedsLook onOnlyNeedsLook={() => {}} onReorder={onReorder} />);
    const visible = bodyRows();
    expect(visible).toHaveLength(2); // only a and d need a look; b and c are hidden
    const dt = dataTransfer();
    fireEvent.dragStart(visible[0]!, { dataTransfer: dt });
    fireEvent.dragOver(visible[1]!, { dataTransfer: dt });
    fireEvent.drop(visible[1]!, { dataTransfer: dt });
    expect(onReorder).toHaveBeenCalledWith(['/p/b', '/p/c', '/p/d', '/p/a']);
  });

  it('moves a focused row past its nearest visible neighbour, not a hidden one', async () => {
    const onReorder = vi.fn();
    render(<PreviewTable excluded={NONE} onToggle={() => {}} rows={withFilter()} onlyNeedsLook onOnlyNeedsLook={() => {}} onReorder={onReorder} />);
    bodyRows()[1]!.focus(); // the visible "d" row
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
    expect(onReorder).toHaveBeenLastCalledWith(['/p/d', '/p/a', '/p/b', '/p/c']);
  });
});

describe('empty preview', () => {
  it('says there are no files', () => {
    render(<Harness rows={[]} />);
    expect(screen.getByText('No files to show.')).toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveAttribute('aria-rowcount', '1');
  });

  it('says nothing needs a look when the filter hides every row', () => {
    render(<PreviewTable rows={[row()]} onlyNeedsLook onOnlyNeedsLook={() => {}} excluded={new Set()} onToggle={() => {}} />);
    expect(screen.getByText('Nothing needs a look.')).toBeInTheDocument();
    expect(screen.queryByRole('cell')).not.toBeInTheDocument();
    // The toggle stays so the user can turn the filter off again.
    expect(screen.getByRole('checkbox', { name: /need a look/ })).toBeChecked();
  });
});

describe('PreviewTable selection', () => {
  function Selecting({ rows, onPanel }: { rows: PreviewRow[]; onPanel: (event: string) => void }) {
    const [selected, setSelected] = useState<string | null>(null);
    const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
    return (
      <PreviewTable
        rows={rows}
        onlyNeedsLook={false}
        onOnlyNeedsLook={() => {}}
        excluded={excluded}
        onToggle={(paths, include) =>
          setExcluded((prev) => {
            const next = new Set(prev);
            for (const p of paths) {
              if (include) next.delete(p);
              else next.add(p);
            }
            return next;
          })
        }
        selected={selected}
        onSelect={(path, open) => {
          setSelected(path);
          onPanel(open ? `open ${path}` : `select ${path}`);
        }}
        onTogglePanel={() => onPanel('toggle')}
        onClosePanel={() => onPanel('close')}
      />
    );
  }

  const ROWS = [
    row({ path: '/p/a', currentName: 'a.jpg' }),
    row({ path: '/p/b', currentName: 'b.jpg' }),
    row({ path: '/p/c', currentName: 'c.jpg' }),
  ];
  const rowOf = (name: string) => screen.getByRole('cell', { name }).closest('[role="row"]') as HTMLElement;

  it('selects and opens on a click, but not from the checkbox', async () => {
    const onPanel = vi.fn();
    render(<Selecting rows={ROWS} onPanel={onPanel} />);
    await userEvent.click(within(rowOf('b.jpg')).getByText('b.jpg'));
    // Selected at once; the panel opens once the double-click window has passed.
    expect(onPanel).toHaveBeenLastCalledWith('select /p/b');
    expect(rowOf('b.jpg')).toHaveAttribute('aria-current', 'true');
    await vi.waitFor(() => expect(onPanel).toHaveBeenLastCalledWith('open /p/b'));
    expect(rowOf('b.jpg')).toHaveClass('row-selected');
    onPanel.mockClear();
    await userEvent.click(within(rowOf('c.jpg')).getByRole('checkbox'));
    expect(onPanel).not.toHaveBeenCalled();
  });

  it('a double-click types a name without opening the panel', async () => {
    const onPanel = vi.fn();
    render(
      <PreviewTable
        rows={ROWS}
        onlyNeedsLook={false}
        onOnlyNeedsLook={() => {}}
        excluded={NONE}
        onToggle={() => {}}
        onEditName={() => {}}
        onSelect={(path, open) => onPanel(open ? `open ${path}` : `select ${path}`)}
      />,
    );
    await userEvent.dblClick(screen.getAllByRole('cell').find((c) => c.classList.contains('new'))!);
    expect(screen.getByRole('textbox', { name: 'New name for a.jpg' })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, OPEN_DELAY_MS + 50));
    expect(onPanel).not.toHaveBeenCalledWith('open /p/a');
  });

  it('moves with the arrow keys, Home and End, and focuses the row it lands on', async () => {
    const onPanel = vi.fn();
    render(<Selecting rows={ROWS} onPanel={onPanel} />);
    await userEvent.click(within(rowOf('a.jpg')).getByText('a.jpg'));
    await userEvent.keyboard('{ArrowDown}');
    expect(onPanel).toHaveBeenLastCalledWith('select /p/b');
    await vi.waitFor(() => expect(rowOf('b.jpg')).toHaveFocus());
    await userEvent.keyboard('{End}');
    expect(onPanel).toHaveBeenLastCalledWith('select /p/c');
    await vi.waitFor(() => expect(rowOf('c.jpg')).toHaveFocus());
    await userEvent.keyboard('{Home}');
    await vi.waitFor(() => expect(rowOf('a.jpg')).toHaveFocus());
    await userEvent.keyboard('{ArrowUp}');
    expect(rowOf('a.jpg')).toHaveAttribute('aria-current', 'true');
  });

  it('Space toggles the panel on the selected row and opens it on another; Escape closes it', async () => {
    const onPanel = vi.fn();
    render(<Selecting rows={ROWS} onPanel={onPanel} />);
    await userEvent.click(within(rowOf('a.jpg')).getByText('a.jpg'));
    await userEvent.keyboard(' ');
    expect(onPanel).toHaveBeenLastCalledWith('toggle');
    rowOf('b.jpg').focus();
    await userEvent.keyboard(' ');
    expect(onPanel).toHaveBeenLastCalledWith('open /p/b');
    await userEvent.keyboard('{Escape}');
    expect(onPanel).toHaveBeenLastCalledWith('close');
  });

  it('Delete leaves the file out and moves to the next one; on the last row it stays', async () => {
    const onPanel = vi.fn();
    render(<Selecting rows={ROWS} onPanel={onPanel} />);
    await userEvent.click(within(rowOf('b.jpg')).getByText('b.jpg'));
    await userEvent.keyboard('{Delete}');
    expect(within(rowOf('b.jpg')).getByRole('checkbox')).not.toBeChecked();
    expect(onPanel).toHaveBeenLastCalledWith('select /p/c');
    await vi.waitFor(() => expect(rowOf('c.jpg')).toHaveFocus());
    await userEvent.keyboard('{Backspace}');
    expect(within(rowOf('c.jpg')).getByRole('checkbox')).not.toBeChecked();
    expect(rowOf('c.jpg')).toHaveAttribute('aria-current', 'true');
  });

  it('Alt with the arrows still reorders instead of moving the selection', async () => {
    const onReorder = vi.fn();
    const onSelect = vi.fn();
    render(
      <PreviewTable
        rows={ROWS}
        onlyNeedsLook={false}
        onOnlyNeedsLook={() => {}}
        excluded={NONE}
        onToggle={() => {}}
        onReorder={onReorder}
        onSelect={onSelect}
      />,
    );
    rowOf('a.jpg').focus();
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(onReorder).toHaveBeenCalledWith(['/p/b', '/p/a', '/p/c']);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
