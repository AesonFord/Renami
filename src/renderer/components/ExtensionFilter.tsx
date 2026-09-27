import { useRef, useState } from 'react';
import { ChevronIcon } from './icons.js';
import { Popover } from './Popover.js';

const show = (ext: string): string => (ext === '' ? '(no extension)' : `.${ext}`);

/** "All types", or "Only: .heic .jpg .nef +2" as in the mockup. */
export function filterLabel(found: string[], selected: string[] | null): string {
  if (selected === null) return 'All types';
  const shown = found.filter((e) => selected.includes(e));
  if (shown.length === 0) return 'No types';
  if (shown.length === found.length) return 'All types';
  const head = shown.slice(0, 3).map(show).join(' ');
  return shown.length > 3 ? `Only: ${head} +${shown.length - 3}` : `Only: ${head}`;
}

interface ExtensionFilterProps {
  /** Every extension the scan found. */
  found: string[];
  /** null = every type. */
  selected: string[] | null;
  onChange(value: string[] | null): void;
}

/** The extension filter: unchecking a type hides those files. */
export function ExtensionFilter({ found, selected, onChange }: ExtensionFilterProps) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const isOn = (ext: string): boolean => selected === null || selected.includes(ext);
  const toggle = (ext: string): void => {
    const current = selected ?? found;
    const next = isOn(ext) ? current.filter((e) => e !== ext) : [...current, ext];
    onChange(found.every((e) => next.includes(e)) ? null : [...next].sort());
  };
  return (
    <div className="menu-anchor" ref={anchor}>
      <button
        type="button"
        className="field inline"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={found.length === 0}
        onClick={() => setOpen((o) => !o)}
      >
        {filterLabel(found, selected)}
        <ChevronIcon />
      </button>
      {open && (
        <Popover label="File types" anchor={anchor} onClose={() => setOpen(false)} style={{ top: 'calc(100% + 4px)', left: 0 }}>
          <button type="button" className="menu-item" onClick={() => onChange(null)}>
            Show all types
          </button>
          {found.map((ext) => (
            <label key={ext} className="check menu-item">
              <input type="checkbox" checked={isOn(ext)} onChange={() => toggle(ext)} />
              {show(ext)}
            </label>
          ))}
        </Popover>
      )}
    </div>
  );
}
