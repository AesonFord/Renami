import { useEffect, useRef, useState } from 'react';
import { DEFAULT_SETTINGS, type RenameSettings } from '../../core/types.js';
import { ChevronIcon } from './icons.js';
import { Popover } from './Popover.js';

type Filter = RenameSettings['filter'];

export interface FileFilterProps {
  filter: Filter;
  onChange(patch: Partial<Filter>): void;
}

const MB = 1024 * 1024;

/** "Files", "Folders", or "Files · 2 filters" when name, size or date filters are on. */
export function filterSummary(f: Filter): string {
  const active = [
    f.name.text !== '',
    f.minBytes !== null || f.maxBytes !== null,
    f.modifiedFrom !== null || f.modifiedTo !== null,
  ].filter(Boolean).length;
  const what = f.mode === 'folders' ? 'Folders' : 'Files';
  return active === 0 ? what : `${what} · ${active} ${active === 1 ? 'filter' : 'filters'}`;
}

/** A typed size in MB as bytes; null when blank, not a number, or negative. */
export function mbToBytes(text: string): number | null {
  if (text.trim() === '') return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * MB) : null;
}

export function bytesToMb(bytes: number | null): string {
  return bytes === null ? '' : String(Math.round((bytes / MB) * 100) / 100);
}

/** A size box that keeps what the user typed ("1.") until it means something else. */
function SizeField({ label, bytes, onChange }: { label: string; bytes: number | null; onChange(bytes: number | null): void }) {
  const [draft, setDraft] = useState(bytesToMb(bytes));
  useEffect(() => {
    setDraft((current) => (mbToBytes(current) === bytes ? current : bytesToMb(bytes)));
  }, [bytes]);
  return (
    <label className="inline">
      {label}
      <input
        className="field"
        style={{ width: 72 }}
        inputMode="decimal"
        aria-label={label}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          onChange(mbToBytes(e.target.value));
        }}
      />
    </label>
  );
}

/** The files strip's filter menu: files or folders, and name, size and date limits. */
export function FileFilter({ filter, onChange }: FileFilterProps) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const folders = filter.mode === 'folders';
  return (
    <div className="menu-anchor" ref={anchor}>
      <button type="button" className="field inline" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {filterSummary(filter)}
        <ChevronIcon />
      </button>
      {open && (
        <Popover label="Filters" anchor={anchor} onClose={() => setOpen(false)} style={{ top: 'calc(100% + 4px)', left: 0, minWidth: 320 }}>
          <div className="rules">
            <div role="radiogroup" aria-label="Rename" className="inline">
              Rename
              <label className="check">
                <input type="radio" name="scan-mode" checked={!folders} onChange={() => onChange({ mode: 'files' })} />
                Files
              </label>
              <label className="check">
                <input type="radio" name="scan-mode" checked={folders} onChange={() => onChange({ mode: 'folders' })} />
                Folders
              </label>
            </div>
            {folders && (
              <p className="hint">Folder mode renames the folders directly inside each source. Subfolders and file types don't apply.</p>
            )}
            <label className="inline">
              Name contains
              <input
                className="field mono"
                aria-label="Name contains"
                value={filter.name.text}
                onChange={(e) => onChange({ name: { ...filter.name, text: e.target.value } })}
              />
            </label>
            <label className="check">
              <input type="checkbox" checked={filter.name.regex} onChange={(e) => onChange({ name: { ...filter.name, regex: e.target.checked } })} />
              Regex
            </label>
            <div className="inline">
              <SizeField label="Size from (MB)" bytes={filter.minBytes} onChange={(minBytes) => onChange({ minBytes })} />
              <SizeField label="Size to (MB)" bytes={filter.maxBytes} onChange={(maxBytes) => onChange({ maxBytes })} />
            </div>
            <div className="inline">
              <label className="inline">
                Modified from
                <input
                  type="date"
                  className="field"
                  value={filter.modifiedFrom ?? ''}
                  onChange={(e) => onChange({ modifiedFrom: e.target.value === '' ? null : e.target.value })}
                />
              </label>
              <label className="inline">
                Modified to
                <input
                  type="date"
                  className="field"
                  value={filter.modifiedTo ?? ''}
                  onChange={(e) => onChange({ modifiedTo: e.target.value === '' ? null : e.target.value })}
                />
              </label>
            </div>
            <div>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => {
                  const { name, minBytes, maxBytes, modifiedFrom, modifiedTo } = DEFAULT_SETTINGS.filter;
                  onChange({ name, minBytes, maxBytes, modifiedFrom, modifiedTo });
                }}
              >
                Clear filters
              </button>
            </div>
          </div>
        </Popover>
      )}
    </div>
  );
}
