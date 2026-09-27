import { useEffect, useRef, useState } from 'react';
import { TOKENS, type TokenName } from '../../core/template/tokens.js';
import type { TokenValues } from '../../shared/ipc.js';
import { tokenLabel } from '../lib/pattern.js';
import { useEscapeKey, useFocusTrap } from './useDialogKeys.js';

interface AllTokensDialogProps {
  load(): Promise<TokenValues | null>;
  onInsert(name: TokenName): void;
  onClose(): void;
}

const ALL = Object.keys(TOKENS) as TokenName[];

/** "All tokens…" opens a searchable list showing each token's value for the first file. */
export function AllTokensDialog({ load, onInsert, onClose }: AllTokensDialogProps) {
  // undefined = still loading; null = no files.
  const [values, setValues] = useState<TokenValues | null | undefined>(undefined);
  const [query, setQuery] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    void load().then((v) => {
      if (live) setValues(v);
    });
    return () => {
      live = false;
    };
  }, [load]);

  useEscapeKey(onClose);
  useFocusTrap(dialogRef);

  const q = query.trim().toLowerCase();
  const names = ALL.filter((n) => q === '' || n.includes(q) || TOKENS[n].label.toLowerCase().includes(q));
  const caption =
    values === undefined ? 'Loading values…' : values === null ? 'Add files to see their values.' : `Values for ${values.fileName}`;

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialogRef} className="dialog" role="dialog" aria-modal="true" aria-labelledby="all-tokens-title">
        <h2 id="all-tokens-title">All tokens</h2>
        <p className="hint">{caption}</p>
        <input
          type="search"
          className="field"
          aria-label="Search tokens"
          placeholder="Search"
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
        />
        <ul className="token-list dialog-body">
          {names.map((n) => (
            <li key={n}>
              <button
                type="button"
                className="token-row"
                onClick={() => {
                  onInsert(n);
                  onClose();
                }}
              >
                <span className="mono tok">{`{${n}}`}</span>
                <span>{tokenLabel(n)}</span>
                <span className="muted ellip">{values ? (values.values[n] ?? 'No value') : ''}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
