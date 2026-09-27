import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { lastSegment } from '../../core/names.js';
import type { RenameSettings } from '../../core/types.js';
import type { FilesSummary, MetadataStatus, PickKind } from '../../shared/ipc.js';
import { ExtensionFilter } from './ExtensionFilter.js';
import { FileFilter } from './FileFilter.js';
import { FileIcon, FolderIcon, XIcon } from './icons.js';
import { Popover } from './Popover.js';

export interface FilesStripProps {
  sources: string[];
  files: FilesSummary | null;
  scanning: boolean;
  metadata: MetadataStatus | null;
  filter: RenameSettings['filter'];
  onFilter(patch: Partial<RenameSettings['filter']>): void;
  onPick(kind: PickKind): void;
  onRemoveSource(path: string): void;
  /** Right end of the strip: the preset picker. */
  children?: ReactNode;
}

/** The files strip: sources, add, Subfolders, extension filter, progress, presets. */
export function FilesStrip(props: FilesStripProps) {
  const { sources, files, scanning, metadata } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const addAnchor = useRef<HTMLDivElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  /** Metadata progress while a read is still running, else null. */
  const reading = metadata !== null && !metadata.finished && metadata.total > 0 ? metadata : null;
  const unreadable = files?.unreadableFolders ?? [];
  const summaries = useMemo(() => new Map(files?.sources.map((s) => [s.path, s])), [files]);

  const menuItems = (): HTMLButtonElement[] =>
    Array.from(addAnchor.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);

  // Focus the first item whenever the menu opens.
  useEffect(() => {
    if (!menuOpen) return;
    menuItems()[0]?.focus();
  }, [menuOpen]);

  // Closes the menu and returns focus to the button that opened it. Used both for picking an item
  // and as Popover's onClose (Escape and an outside mouse-down), so Escape has exactly one path —
  // through useEscapeKey's stack — instead of also closing directly from a keydown inside the menu,
  // which could close this menu even when a layer opened on top of it is the one that should.
  const closeMenu = (): void => {
    setMenuOpen(false);
    addButtonRef.current?.focus();
  };

  const pick = (kind: PickKind): void => {
    closeMenu();
    props.onPick(kind);
  };

  // Arrow keys and Home/End move focus within the menu.
  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (!menuOpen) return;
    const items = menuItems();
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const focusAt = (i: number): void => items[i]?.focus();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusAt(current < 0 ? 0 : (current + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusAt(current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusAt(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusAt(items.length - 1);
    }
  };

  return (
    <section className="files-strip" aria-label="Files">
      {sources.map((path) => {
        const summary = summaries.get(path);
        const name = summary?.name ?? lastSegment(path);
        return (
          <span key={path} className="chip chip-source" title={path}>
            {summary?.isFolder === false ? <FileIcon /> : <FolderIcon />}
            {name}
            <span className="count">{summary ? summary.count : '…'}</span>
            <button type="button" className="icon-btn" aria-label={`Remove ${name}`} onClick={() => props.onRemoveSource(path)}>
              <XIcon />
            </button>
          </span>
        );
      })}
      <div className="menu-anchor" ref={addAnchor} onKeyDown={onMenuKeyDown}>
        <button
          ref={addButtonRef}
          type="button"
          className="chip chip-add"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          + Add files or folders
        </button>
        {menuOpen && (
          <Popover label="Add" role="menu" anchor={addAnchor} onClose={closeMenu} style={{ top: 'calc(100% + 4px)', left: 0 }}>
            <button type="button" role="menuitem" className="menu-item" onClick={() => pick('files')}>
              Files…
            </button>
            <button type="button" role="menuitem" className="menu-item" onClick={() => pick('folder')}>
              Folder…
            </button>
          </Popover>
        )}
      </div>
      <span className="sep" />
      <label className="check" title={props.filter.mode === 'folders' ? 'Folder mode renames the folders directly inside each source' : undefined}>
        <input
          type="checkbox"
          checked={props.filter.includeSubfolders}
          disabled={props.filter.mode === 'folders'}
          onChange={(e) => props.onFilter({ includeSubfolders: e.target.checked })}
        />
        Subfolders
      </label>
      <span className="sep" />
      <ExtensionFilter found={files?.extensionsFound ?? []} selected={props.filter.extensions} onChange={(extensions) => props.onFilter({ extensions })} />
      <span className="sep" />
      <FileFilter filter={props.filter} onChange={props.onFilter} />
      {scanning && (
        <span className="muted" role="status">
          Looking for files…
        </span>
      )}
      {reading && (
        <span className="inline" role="status">
          Reading file details {reading.done} of {reading.total}
          <span className="progress" aria-hidden="true">
            <span style={{ width: `${Math.round((reading.done / reading.total) * 100)}%` }} />
          </span>
        </span>
      )}
      {unreadable.length > 0 && (
        <span className="text-warn" title={unreadable.join('\n')}>
          {unreadable.length === 1 ? "1 folder couldn't be opened" : `${unreadable.length} folders couldn't be opened`}
        </span>
      )}
      <span className="spacer" />
      {props.children}
    </section>
  );
}
