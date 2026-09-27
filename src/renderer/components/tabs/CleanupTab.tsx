import type { CaseMode, ExtensionRule, RenameSettings } from '../../../core/types.js';
import { XIcon } from '../icons.js';
import type { TabProps } from './types.js';

export function CleanupTab({ settings, onChange }: TabProps) {
  const c = settings.cleanup;
  const set = (patch: Partial<RenameSettings['cleanup']>): void =>
    onChange((s) => ({ ...s, cleanup: { ...s.cleanup, ...patch } }));
  const rules = c.extensionRules;
  const patchRule = (i: number, p: Partial<ExtensionRule>): void =>
    set({ extensionRules: rules.map((r, j) => (j === i ? { ...r, ...p } : r)) });
  return (
    <>
      <label className="inline">
        Case
        <select className="field" value={c.caseMode} onChange={(e) => set({ caseMode: e.target.value as CaseMode })}>
          <option value="none">Keep as is</option>
          <option value="lower">lowercase</option>
          <option value="upper">UPPERCASE</option>
          <option value="title">Title Case</option>
          <option value="sentence">Sentence case</option>
          <option value="snake">snake_case</option>
          <option value="kebab">kebab-case</option>
          <option value="camel">camelCase</option>
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={c.spacesToUnderscores} onChange={(e) => set({ spacesToUnderscores: e.target.checked })} />
        Spaces to underscores
      </label>
      <label className="check">
        <input type="checkbox" checked={c.lowercaseExtension} onChange={(e) => set({ lowercaseExtension: e.target.checked })} />
        Lowercase extension
      </label>
      <label className="check">
        <input type="checkbox" checked={c.stripDiacritics} onChange={(e) => set({ stripDiacritics: e.target.checked })} />
        Strip accents
      </label>
      <label className="check">
        <input type="checkbox" checked={c.asciiOnly} onChange={(e) => set({ asciiOnly: e.target.checked })} />
        ASCII only
      </label>
      <span className="hint">Always on: repeated separators are collapsed, and names are made safe for Windows.</span>
      <div className="rules">
        {rules.map((r, i) => (
          <div key={i} className="rule" role="group" aria-label={`Extension rule ${i + 1}`}>
            <label className="inline">
              Change .
              <input
                className="field mono"
                style={{ width: 72 }}
                aria-label={`Extension rule ${i + 1} from`}
                value={r.from}
                onChange={(e) => patchRule(i, { from: e.target.value })}
              />
            </label>
            <label className="inline">
              to .
              <input
                className="field mono"
                style={{ width: 72 }}
                aria-label={`Extension rule ${i + 1} to`}
                value={r.to}
                onChange={(e) => patchRule(i, { to: e.target.value })}
              />
            </label>
            <button
              type="button"
              className="icon-btn"
              aria-label={`Remove extension rule ${i + 1}`}
              onClick={() => set({ extensionRules: rules.filter((_, j) => j !== i) })}
            >
              <XIcon />
            </button>
          </div>
        ))}
        <div>
          <button type="button" className="btn btn-small" onClick={() => set({ extensionRules: [...rules, { from: '', to: '' }] })}>
            + Add extension rule
          </button>
          <span className="hint"> Leave "to" empty to drop the extension. Extensions no rule names keep theirs.</span>
        </div>
      </div>
    </>
  );
}
