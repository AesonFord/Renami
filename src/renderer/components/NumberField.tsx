import { useEffect, useState } from 'react';

interface NumberFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange(value: number): void;
}

/** A whole-number box that lets the user clear it while typing and only reports valid values. */
export function NumberField({ label, value, min, max, onChange }: NumberFieldProps) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const valid = /^-?\d+$/.test(draft) && Number(draft) >= min && Number(draft) <= max;
  return (
    <label className="inline">
      {label}
      <input
        className="field"
        style={{ width: 64 }}
        inputMode="numeric"
        value={draft}
        aria-invalid={!valid}
        onChange={(e) => {
          const text = e.target.value;
          setDraft(text);
          if (/^-?\d+$/.test(text) && Number(text) >= min && Number(text) <= max) onChange(Number(text));
        }}
        onBlur={() => setDraft(String(value))}
      />
    </label>
  );
}
