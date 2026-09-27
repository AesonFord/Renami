import { useState, type FormEvent, type RefObject } from 'react';
import { TOKENS } from '../../core/template/tokens.js';
import { DATE_FORMATS, RESERVED_IN_TOKEN, tokenLabel, tokenText, type TokenSpan } from '../lib/pattern.js';
import { Popover } from './Popover.js';

interface TokenPopoverProps {
  span: TokenSpan;
  /** The pattern field; clicks inside it (on another token) don't close the popover. */
  anchor: RefObject<HTMLElement | null>;
  /** Horizontal offset of the token inside the field, in px. */
  left: number;
  onApply(text: string): void;
  onRemove(): void;
  onClose(): void;
}

/** Clicking a token in the input opens a popover for its format and default. */
export function TokenPopover({ span, anchor, left, onApply, onRemove, onClose }: TokenPopoverProps) {
  const def = TOKENS[span.name];
  const isDate = def.kind === 'date';
  const hasDigits = def.kind === 'number' && def.digitsFormat;
  const [format, setFormat] = useState(span.format ?? '');
  const [fallback, setFallback] = useState(span.fallback ?? '');
  const [problem, setProblem] = useState<string | null>(null);

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const f = format.trim() === '' ? null : format.trim();
    const d = fallback === '' ? null : fallback;
    if ((f !== null && RESERVED_IN_TOKEN.test(f)) || (d !== null && RESERVED_IN_TOKEN.test(d))) {
      setProblem("Formats and defaults can't contain {, } or |");
      return;
    }
    if (hasDigits && f !== null && !/^([1-9]|10)$/.test(f)) {
      setProblem('Digits must be a whole number from 1 to 10');
      return;
    }
    // seq has no Default field (it always has a value), so never carry one forward even if the
    // pattern text already had one from before the token was last edited.
    onApply(tokenText(span.name, isDate || hasDigits ? f : null, isDate || span.name === 'seq' ? null : d));
  };

  return (
    <Popover label={`Edit {${span.name}}`} anchor={anchor} onClose={onClose} style={{ left, top: 'calc(100% + 6px)' }}>
      <form className="token-form" onSubmit={submit}>
        <div className="token-title">
          <span className="tok">{`{${span.name}}`}</span> {tokenLabel(span.name)}
        </div>
        {isDate && (
          <>
            <label>
              Format
              <input className="field mono" value={format} placeholder="YYYY-MM-DD" autoFocus onChange={(e) => setFormat(e.target.value)} />
            </label>
            <div className="formats">
              {DATE_FORMATS.map((f) => (
                <button key={f} type="button" className="chip mono" onClick={() => setFormat(f)}>
                  {f}
                </button>
              ))}
            </div>
            <p className="hint">YYYY year · MM month · MMM Jan · DD day · ddd Thu · HH hour · hh A 12-hour · mm minute · ss second · SSS ms</p>
          </>
        )}
        {hasDigits && (
          <label>
            Digits
            <input
              className="field"
              inputMode="numeric"
              value={format}
              placeholder={span.name === 'seq' ? 'Same as the Sequence tab' : 'No padding'}
              autoFocus
              onChange={(e) => setFormat(e.target.value)}
            />
          </label>
        )}
        {!isDate && span.name !== 'seq' && (
          <label>
            Default
            <input
              className="field"
              value={fallback}
              placeholder="Used when a file has no value"
              autoFocus={!hasDigits}
              onChange={(e) => setFallback(e.target.value)}
            />
          </label>
        )}
        {problem && (
          <p className="text-error" role="alert">
            {problem}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn-small" onClick={onRemove}>
            Remove token
          </button>
          <button type="submit" className="btn btn-primary btn-small">
            Apply
          </button>
        </div>
      </form>
    </Popover>
  );
}
