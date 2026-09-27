import { useRef, useState, type FormEvent } from 'react';
import { nameKey } from '../../core/names.js';
import type { PresetView } from '../../shared/ipc.js';
import { TrashIcon } from './icons.js';
import { Popover } from './Popover.js';

interface PresetPickerProps {
  presets: PresetView[];
  /** The preset last loaded or saved. */
  current: string | null;
  /** '' means "None": keep the settings, forget the preset name. */
  onLoad(name: string): void;
  onSave(name: string): Promise<void>;
  onDelete(name: string): Promise<void>;
}

/** Presets: pick, save and delete named settings. */
export function PresetPicker({ presets, current, onLoad, onSave, onDelete }: PresetPickerProps) {
  const [mode, setMode] = useState<'closed' | 'save' | 'delete'>('closed');
  const [name, setName] = useState('');
  const anchor = useRef<HTMLDivElement>(null);
  const trimmed = name.trim();
  const existing = trimmed === '' ? undefined : presets.find((p) => nameKey(p.name) === nameKey(trimmed));
  const close = (): void => setMode('closed');

  const save = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (trimmed === '') return;
    await onSave(trimmed);
    close();
  };

  return (
    <div className="preset-picker" ref={anchor}>
      <label className="inline">
        Preset:
        <select className="field" aria-label="Preset" value={current ?? ''} onChange={(e) => onLoad(e.target.value)}>
          <option value="">None</option>
          {presets.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="btn btn-small"
        onClick={() => {
          setName(current ?? '');
          setMode('save');
        }}
      >
        Save
      </button>
      {current !== null && (
        <button type="button" className="icon-btn" aria-label={`Delete preset ${current}`} onClick={() => setMode('delete')}>
          <TrashIcon />
        </button>
      )}
      {mode === 'save' && (
        <Popover label="Save preset" anchor={anchor} onClose={close} style={{ right: 0, top: 'calc(100% + 6px)' }}>
          <form className="token-form" onSubmit={(e) => void save(e)}>
            <label>
              Name
              <input className="field" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            {existing && <p className="hint">This replaces the saved preset "{existing.name}".</p>}
            <p className="hint">Saves the pattern and every option, but not the files.</p>
            <div className="dialog-actions">
              <button type="button" className="btn btn-small" onClick={close}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary btn-small" disabled={trimmed === ''}>
                Save preset
              </button>
            </div>
          </form>
        </Popover>
      )}
      {mode === 'delete' && current !== null && (
        <Popover label="Delete preset" anchor={anchor} onClose={close} style={{ right: 0, top: 'calc(100% + 6px)' }}>
          <p>Delete the preset "{current}"?</p>
          <div className="dialog-actions">
            <button type="button" className="btn btn-small" onClick={close}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-small btn-danger"
              onClick={() => {
                void onDelete(current).then(close);
              }}
            >
              Delete
            </button>
          </div>
        </Popover>
      )}
    </div>
  );
}
