import type { RenameSettings, RestartEvery, SortDirection, SortKey } from '../../../core/types.js';
import { appendSeq, seqProblem } from '../../lib/pattern.js';
import { NumberField } from '../NumberField.js';
import type { TabProps } from './types.js';

/** `changed`: some sequence setting differs from its default, so a missing {seq} is worth pointing out. */
export function SequenceTab({ settings, onChange, changed }: TabProps & { changed: boolean }) {
  const seq = settings.sequence;
  const problem = seqProblem(settings.pattern);
  const set = (patch: Partial<RenameSettings['sequence']>): void =>
    onChange((s) => ({ ...s, sequence: { ...s.sequence, ...patch } }));
  return (
    <>
      <label className="inline">
        Sort by
        <select className="field" value={seq.sortBy} onChange={(e) => set({ sortBy: e.target.value as SortKey })}>
          <option value="dateTaken">Date taken</option>
          <option value="created">Created</option>
          <option value="modified">Modified</option>
          <option value="name">Name</option>
          <option value="manual">Manual order</option>
        </select>
      </label>
      <label className="inline">
        Order
        <select className="field" value={seq.direction} onChange={(e) => set({ direction: e.target.value as SortDirection })}>
          <option value="asc">Ascending</option>
          <option value="desc">Descending</option>
        </select>
      </label>
      <NumberField label="Start at" value={seq.start} min={0} max={999_999_999} onChange={(start) => set({ start })} />
      <NumberField label="Step" value={seq.step} min={1} max={1_000_000} onChange={(step) => set({ step })} />
      <NumberField label="Digits" value={seq.digits} min={1} max={10} onChange={(digits) => set({ digits })} />
      <label className="inline">
        Restart
        <select className="field" value={seq.restartEvery} onChange={(e) => set({ restartEvery: e.target.value as RestartEvery })}>
          <option value="never">Never</option>
          <option value="day">Each day</option>
          <option value="month">Each month</option>
          <option value="year">Each year</option>
        </select>
      </label>
      <span className="sep" />
      <label className="check">
        <input type="checkbox" checked={seq.restartPerFolder} onChange={(e) => set({ restartPerFolder: e.target.checked })} />
        Restart numbering in each folder
      </label>
      <label className="check">
        <input type="checkbox" checked={seq.keepGroupsTogether} onChange={(e) => set({ keepGroupsTogether: e.target.checked })} />
        Keep same-name files together
      </label>
      {seq.sortBy === 'manual' && (
        <span className="hint">Drag rows in the preview, or press Alt with the arrow keys on a row, to set the order.</span>
      )}
      {problem?.kind === 'noSeq' && changed && (
        <>
          <span className="hint">The pattern has no {'{seq}'}, so these numbers aren't used.</span>
          <button type="button" className="btn btn-small" onClick={() => onChange((s) => ({ ...s, pattern: appendSeq(s.pattern) }))}>
            Add {'{seq}'}
          </button>
        </>
      )}
      {problem?.kind === 'fixedDigits' && (
        <span className="hint">The pattern's {problem.token} sets its own digits, so Digits isn't used.</span>
      )}
    </>
  );
}
