import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { parsePattern } from '../../core/template/parse.js';
import type { TokenName } from '../../core/template/tokens.js';
import type { TokenValues } from '../../shared/ipc.js';
import { chipLabel, highlight, PALETTE, replaceRange, tokenAt, type Piece, type TokenSpan } from '../lib/pattern.js';
import { AllTokensDialog } from './AllTokensDialog.js';
import { TokenPopover } from './TokenPopover.js';

const PIECE_CLASS: Record<Piece['kind'], string | undefined> = {
  text: undefined,
  token: 'tok',
  separator: 'pat-sep',
  error: 'pat-error',
};

export interface PatternBarProps {
  pattern: string;
  onChange(pattern: string): void;
  /** Shown greyed after the pattern, with its dot (".heic"); '' for none. */
  extension: string;
  /** The main process's pattern error; also covers find & replace regex errors. */
  error: string | null;
  /** Token values for the first file, for "All tokens…". */
  loadTokenValues(): Promise<TokenValues | null>;
}

/** The pattern bar: the pattern input with highlighted tokens, and the token palette. */
export function PatternBar({ pattern, onChange, extension, error, loadTokenValues }: PatternBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<TokenSpan | null>(null);
  const [showAll, setShowAll] = useState(false);
  const parsed = useMemo(() => parsePattern(pattern), [pattern]);
  const pieces = useMemo(() => highlight(pattern), [pattern]);
  const message = parsed.ok ? error : parsed.error;

  const syncScroll = (): void => {
    if (mirrorRef.current && inputRef.current) mirrorRef.current.scrollLeft = inputRef.current.scrollLeft;
  };

  // After an edit made with a button, return focus to the input with the caret where the edit ended.
  // No dependency array: this runs after every render on purpose, keeping the mirror's scroll in
  // step with the input and placing a pending caret as soon as one is set.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (input && pendingCaret.current !== null) {
      input.focus();
      input.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
    syncScroll();
  });

  const apply = (next: { pattern: string; caret: number }): void => {
    pendingCaret.current = next.caret;
    onChange(next.pattern);
  };

  const insertToken = (name: TokenName): void => {
    const input = inputRef.current;
    const start = input?.selectionStart ?? pattern.length;
    const end = input?.selectionEnd ?? start;
    apply(replaceRange(pattern, start, end, `{${name}}`));
  };

  const openAtCaret = (): void => {
    const caret = inputRef.current?.selectionStart;
    setEditing(caret === null || caret === undefined ? null : tokenAt(pattern, caret));
  };

  /** Where the edited token starts inside the field, so the popover sits under it. */
  const editingLeft = (): number => {
    const mirror = mirrorRef.current;
    if (!editing || !mirror) return 0;
    const el = mirror.querySelector<HTMLElement>(`[data-start="${editing.start}"]`);
    return el ? el.offsetLeft - mirror.scrollLeft : 0;
  };

  return (
    <section className="pattern-bar" aria-label="Pattern">
      <div className="pattern-row">
        <span className="label" aria-hidden="true">
          Name
        </span>
        <div ref={fieldRef} className={parsed.ok ? 'pattern-field' : 'pattern-field invalid'}>
          <div ref={mirrorRef} className="pattern-mirror" aria-hidden="true" data-testid="pattern-mirror">
            {pieces.map((p) => (
              <span key={p.start} data-start={p.start} className={PIECE_CLASS[p.kind]}>
                {p.text}
              </span>
            ))}
            {extension !== '' && <span className="pat-ext">{extension}</span>}
          </div>
          <input
            ref={inputRef}
            className="pattern-input"
            aria-label="Name pattern"
            aria-invalid={!parsed.ok}
            aria-describedby={message ? 'pattern-message' : undefined}
            value={pattern}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              setEditing(null);
              onChange(e.target.value);
            }}
            onClick={openAtCaret}
            onKeyDown={(e) => {
              // The keyboard way to open a token's popover; outside a token, Enter does nothing.
              if (e.key === 'Enter') {
                e.preventDefault();
                openAtCaret();
              }
            }}
            onScroll={syncScroll}
            onSelect={syncScroll}
          />
          {editing && (
            <TokenPopover
              key={editing.start}
              span={editing}
              anchor={fieldRef}
              left={editingLeft()}
              onApply={(text) => {
                apply(replaceRange(pattern, editing.start, editing.end, text));
                setEditing(null);
              }}
              onRemove={() => {
                apply(replaceRange(pattern, editing.start, editing.end, ''));
                setEditing(null);
              }}
              onClose={() => setEditing(null)}
            />
          )}
        </div>
      </div>
      {message && (
        <p id="pattern-message" className="pattern-message" role="alert">
          {message}
        </p>
      )}
      <div className="palette" role="toolbar" aria-label="Insert a token">
        {PALETTE.map((group, i) => (
          <Fragment key={group.group}>
            {i > 0 && <span className="sep" />}
            <span className="palette-group">{group.group}</span>
            {group.tokens.map((t) => (
              <button key={t.token} type="button" className="chip" title={`Insert {${t.token}}`} onClick={() => insertToken(t.token)}>
                {chipLabel(t.token)}
              </button>
            ))}
          </Fragment>
        ))}
        <button type="button" className="chip chip-link" onClick={() => setShowAll(true)}>
          All tokens…
        </button>
      </div>
      <p className="hint palette-hint">
        Click a token in the name to change its format, for example to add the time. With the cursor in a token, Enter does the same.
      </p>
      {showAll && <AllTokensDialog load={loadTokenValues} onInsert={insertToken} onClose={() => setShowAll(false)} />}
    </section>
  );
}
