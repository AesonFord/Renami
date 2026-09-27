import type { FindReplaceRule, RuleScope } from '../../../core/types.js';
import { XIcon } from '../icons.js';
import type { TabProps } from './types.js';

export function FindReplaceTab({ settings, onChange }: TabProps) {
  const rules = settings.findReplace;
  const setRules = (next: FindReplaceRule[]): void => onChange((s) => ({ ...s, findReplace: next }));
  const patch = (i: number, p: Partial<FindReplaceRule>): void =>
    setRules(rules.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <div className="rules">
      {rules.length === 0 && (
        <p className="hint">
          Rules change each file's current name, in order, before the pattern uses it as {'{name}'}. A rule applied to the new name
          changes what the pattern produced instead.
        </p>
      )}
      {rules.map((r, i) => (
        <div key={i} className="rule" role="group" aria-label={`Rule ${i + 1}`}>
          <label className="inline">
            Find
            <input className="field mono" value={r.find} onChange={(e) => patch(i, { find: e.target.value })} />
          </label>
          <label className="inline">
            Replace with
            <input className="field mono" value={r.replace} onChange={(e) => patch(i, { replace: e.target.value })} />
          </label>
          <label className="inline">
            Apply to
            <select className="field" value={r.scope ?? 'original'} onChange={(e) => patch(i, { scope: e.target.value as RuleScope })}>
              <option value="original">Current name</option>
              <option value="result">New name</option>
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={r.regex} onChange={(e) => patch(i, { regex: e.target.checked })} />
            Regex
          </label>
          <label className="check">
            <input type="checkbox" checked={r.matchCase} onChange={(e) => patch(i, { matchCase: e.target.checked })} />
            Match case
          </label>
          <button
            type="button"
            className="icon-btn"
            aria-label={`Remove rule ${i + 1}`}
            onClick={() => setRules(rules.filter((_, j) => j !== i))}
          >
            <XIcon />
          </button>
        </div>
      ))}
      <div>
        <button
          type="button"
          className="btn btn-small"
          onClick={() => setRules([...rules, { find: '', replace: '', regex: false, matchCase: false }])}
        >
          + Add rule
        </button>
      </div>
      <p className="hint">
        Regex rules can use $1, $2 and so on for captured groups: find <span className="mono">^(\d+)-(\d+)$</span> and replace with
        $2-$1 swaps two numbers.
      </p>
    </div>
  );
}
