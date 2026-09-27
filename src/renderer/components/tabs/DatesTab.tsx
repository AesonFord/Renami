import type { Platform, RenameSettings } from '../../../core/types.js';
import { NumberField } from '../NumberField.js';
import type { TabProps } from './types.js';

export function DatesTab({ settings, onChange, platform }: TabProps & { platform: Platform | null }) {
  const d = settings.dates;
  const linux = platform === 'linux';
  const set = (patch: Partial<RenameSettings['dates']>): void => onChange((s) => ({ ...s, dates: { ...s.dates, ...patch } }));
  // Math.trunc keeps the sign on both parts: -90 minutes is -1 hour and -30 minutes.
  const hours = Math.trunc(d.shiftMinutes / 60);
  const minutes = d.shiftMinutes - hours * 60;
  return (
    <>
      <label className="check">
        <input type="checkbox" checked={d.setModified} onChange={(e) => set({ setModified: e.target.checked })} />
        Set modified date to date taken
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={d.setCreated && !linux}
          disabled={linux}
          onChange={(e) => set({ setCreated: e.target.checked })}
        />
        Set created date to date taken
      </label>
      {linux && <span className="hint">Linux doesn't let apps change a file's created date.</span>}
      <span className="hint">Only files with a real date taken are changed. The others keep their dates.</span>
      <span className="sep" />
      <span className="inline">
        Shift date taken by
        <NumberField label="Hours" value={hours} min={-9999} max={9999} onChange={(h) => set({ shiftMinutes: h * 60 + minutes })} />
        <NumberField label="Minutes" value={minutes} min={-59} max={59} onChange={(m) => set({ shiftMinutes: hours * 60 + m })} />
      </span>
      <span className="hint">For a camera clock that was off. The shift applies wherever the date taken is used.</span>
      <label className="check">
        <input type="checkbox" checked={d.useNameDate} onChange={(e) => set({ useNameDate: e.target.checked })} />
        Use a date found in the file name when there is no date taken
      </label>
    </>
  );
}
