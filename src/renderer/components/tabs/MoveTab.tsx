import type { TabProps } from './types.js';

export function MoveTab({ settings, onChange, onChooseDestination }: TabProps & { onChooseDestination(): void }) {
  const root = settings.move.destinationRoot;
  return (
    <>
      <label className="check">
        <input
          type="radio"
          name="destination"
          checked={root === null}
          onChange={() => onChange((s) => ({ ...s, move: { destinationRoot: null } }))}
        />
        Each file's current folder
      </label>
      <label className="check">
        <input type="radio" name="destination" checked={root !== null} onChange={() => onChooseDestination()} />
        One folder
      </label>
      {root !== null && (
        <span className="mono ellip dest" title={root}>
          {root}
        </span>
      )}
      <button type="button" className="btn btn-small" onClick={onChooseDestination}>
        Choose destination…
      </button>
      <span className="hint">
        Type / in the pattern to make subfolders, e.g. {'{date_taken:YYYY}/{date_taken:MM}/{name}'}
      </span>
    </>
  );
}
