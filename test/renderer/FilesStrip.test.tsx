import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/core/types.js';
import { EmptyState } from '../../src/renderer/components/EmptyState.js';
import { filterLabel } from '../../src/renderer/components/ExtensionFilter.js';
import { FilesStrip, type FilesStripProps } from '../../src/renderer/components/FilesStrip.js';
import { useEscapeKey } from '../../src/renderer/components/useDialogKeys.js';

function stripProps(over: Partial<FilesStripProps> = {}): FilesStripProps {
  return {
    sources: ['/photos/Hawaii 2024', '/photos/beach.jpg'],
    files: {
      sources: [
        { path: '/photos/Hawaii 2024', name: 'Hawaii 2024', isFolder: true, count: 212 },
        { path: '/photos/beach.jpg', name: 'beach.jpg', isFolder: false, count: 1 },
      ],
      total: 213,
      extensionsFound: ['heic', 'jpg', 'txt'],
      unreadableFolders: [],
    },
    scanning: false,
    metadata: null,
    filter: DEFAULT_SETTINGS.filter,
    onFilter: vi.fn(),
    onPick: vi.fn(),
    onRemoveSource: vi.fn(),
    ...over,
  };
}

function renderStrip(over: Partial<FilesStripProps> = {}) {
  const props = stripProps(over);
  render(<FilesStrip {...props} />);
  return props;
}

/** A bare useEscapeKey consumer, to simulate another layer opening on top of the add menu. */
function EscapeProbe({ onEscape }: { onEscape(): void }) {
  useEscapeKey(onEscape);
  return null;
}

describe('FilesStrip', () => {
  it('shows each source with its file count and removes it', async () => {
    const props = renderStrip();
    expect(screen.getByTitle('/photos/Hawaii 2024')).toHaveTextContent('Hawaii 2024212');
    await userEvent.click(screen.getByRole('button', { name: 'Remove beach.jpg' }));
    expect(props.onRemoveSource).toHaveBeenCalledWith('/photos/beach.jpg');
  });

  it('shows a placeholder count while the first scan runs', () => {
    renderStrip({ files: null, scanning: true });
    expect(screen.getByTitle('/photos/Hawaii 2024')).toHaveTextContent('Hawaii 2024…');
    expect(screen.getByRole('status')).toHaveTextContent('Looking for files…');
  });

  it('adds files or a folder from the add menu', async () => {
    const props = renderStrip();
    const addButton = screen.getByRole('button', { name: '+ Add files or folders' });
    await userEvent.click(addButton);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Folder…' }));
    expect(props.onPick).toHaveBeenCalledWith('folder');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await userEvent.click(addButton);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Files…' }));
    expect(props.onPick).toHaveBeenCalledWith('files');
    expect(addButton).toHaveFocus();
  });

  it('closes the add menu with Escape and returns focus to the add button', async () => {
    renderStrip();
    const addButton = screen.getByRole('button', { name: '+ Add files or folders' });
    await userEvent.click(addButton);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(addButton).toHaveFocus();
  });

  it('closes the add menu on an outside mouse-down', async () => {
    renderStrip();
    await userEvent.click(screen.getByRole('button', { name: '+ Add files or folders' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await userEvent.click(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('leaves a layer opened on top of the add menu as the only one Escape closes', async () => {
    const other = vi.fn();
    const props = stripProps();
    // Render inside a stable Fragment from the start so the later rerender only adds a sibling,
    // instead of remounting FilesStrip (and losing menuOpen) by changing the tree's root type.
    const { rerender } = render(
      <>
        <FilesStrip {...props} />
        {null}
      </>,
    );
    // Opens the add menu; focus lands inside it, on "Files…", and stays there — nothing here
    // clicks anything else, so this isolates FilesStrip's own Escape wiring from focus movement.
    await userEvent.click(screen.getByRole('button', { name: '+ Add files or folders' }));
    expect(screen.getByRole('menuitem', { name: 'Files…' })).toHaveFocus();

    // A second layer opens on top of the still-open add menu (e.g. another popover), without
    // moving focus out of the menu.
    rerender(
      <>
        <FilesStrip {...props} />
        <EscapeProbe onEscape={other} />
      </>,
    );

    await userEvent.keyboard('{Escape}');
    expect(other).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('moves focus in the add menu with arrow keys, wrapping, and jumps with Home/End', async () => {
    renderStrip();
    await userEvent.click(screen.getByRole('button', { name: '+ Add files or folders' }));
    const files = screen.getByRole('menuitem', { name: 'Files…' });
    const folder = screen.getByRole('menuitem', { name: 'Folder…' });
    expect(files).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(folder).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(files).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(folder).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(files).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(folder).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(files).toHaveFocus();
  });

  it('toggles subfolders', async () => {
    const props = renderStrip();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Subfolders' }));
    expect(props.onFilter).toHaveBeenCalledWith({ includeSubfolders: true });
  });

  it('narrows and widens the extension filter', async () => {
    const props = renderStrip();
    await userEvent.click(screen.getByRole('button', { name: 'All types' }));
    await userEvent.click(screen.getByRole('checkbox', { name: '.txt' }));
    expect(props.onFilter).toHaveBeenLastCalledWith({ extensions: ['heic', 'jpg'] });
  });

  it('turns the filter back into "all" when every type is checked again', async () => {
    const props = renderStrip({ filter: { ...DEFAULT_SETTINGS.filter, extensions: ['heic', 'jpg'] } });
    await userEvent.click(screen.getByRole('button', { name: 'Only: .heic .jpg' }));
    await userEvent.click(screen.getByRole('checkbox', { name: '.txt' }));
    expect(props.onFilter).toHaveBeenLastCalledWith({ extensions: null });
  });

  it('resets the extension filter with "Show all types"', async () => {
    const props = renderStrip({ filter: { ...DEFAULT_SETTINGS.filter, extensions: ['heic'] } });
    await userEvent.click(screen.getByRole('button', { name: 'Only: .heic' }));
    await userEvent.click(screen.getByRole('button', { name: 'Show all types' }));
    expect(props.onFilter).toHaveBeenCalledWith({ extensions: null });
  });

  it('disables the extension filter when nothing was found', () => {
    renderStrip({ files: { sources: [], total: 0, extensionsFound: [], unreadableFolders: [] } });
    expect(screen.getByRole('button', { name: 'All types' })).toBeDisabled();
  });

  it('closes the extension filter popover on Escape, with no Escape handling of its own', async () => {
    renderStrip();
    await userEvent.click(screen.getByRole('button', { name: 'All types' }));
    expect(screen.getByRole('dialog', { name: 'File types' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'File types' })).not.toBeInTheDocument();
  });

  it('shows reading progress and folders it could not open', () => {
    renderStrip({
      metadata: { done: 3, total: 10, finished: false, exiftoolFailed: false },
      files: {
        sources: [],
        total: 10,
        extensionsFound: ['jpg'],
        unreadableFolders: ['/photos/locked', '/photos/other'],
      },
    });
    expect(screen.getByRole('status')).toHaveTextContent('Reading file details 3 of 10');
    expect(screen.getByText("2 folders couldn't be opened")).toHaveAttribute('title', '/photos/locked\n/photos/other');
  });
});

describe('FilesStrip filters', () => {
  it('shows the filter button and passes changes on', async () => {
    const props = renderStrip();
    await userEvent.click(screen.getByRole('button', { name: /^Files/ }));
    await userEvent.click(screen.getByLabelText('Folders'));
    expect(props.onFilter).toHaveBeenCalledWith({ mode: 'folders' });
  });

  it('disables Subfolders in folder mode', () => {
    renderStrip({ filter: { ...DEFAULT_SETTINGS.filter, mode: 'folders' } });
    expect(screen.getByLabelText('Subfolders')).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Folders/ })).toBeInTheDocument();
  });
});

describe('filterLabel', () => {
  it('summarizes the selection', () => {
    expect(filterLabel(['a', 'b'], null)).toBe('All types');
    expect(filterLabel(['a', 'b'], ['a', 'b'])).toBe('All types');
    expect(filterLabel(['a', 'b'], [])).toBe('No types');
    expect(filterLabel(['a', 'b', 'c', 'd', 'e'], ['a', 'b', 'c', 'd'])).toBe('Only: .a .b .c +1');
    expect(filterLabel(['', 'jpg'], [''])).toBe('Only: (no extension)');
  });
});

describe('EmptyState', () => {
  it('offers both kinds of picker', async () => {
    const onPick = vi.fn();
    render(<EmptyState onPick={onPick} />);
    expect(screen.getByRole('heading', { name: 'Drop files or folders here' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Choose files…' }));
    await userEvent.click(screen.getByRole('button', { name: 'Choose folder…' }));
    expect(onPick.mock.calls).toEqual([['files'], ['folder']]);
  });
});
