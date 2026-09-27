import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type RenameSettings } from '../../../src/core/types.js';
import { DatesTab } from '../../../src/renderer/components/tabs/DatesTab.js';

let latest: RenameSettings = DEFAULT_SETTINGS;

function Harness({ initial = DEFAULT_SETTINGS }: { initial?: RenameSettings }) {
  const [settings, setSettings] = useState(initial);
  latest = settings;
  return <DatesTab settings={settings} onChange={setSettings} platform="darwin" />;
}

describe('DatesTab', () => {
  it('shifts the date taken by hours and minutes', async () => {
    render(<Harness />);
    const hours = screen.getByLabelText('Hours');
    await userEvent.clear(hours);
    await userEvent.type(hours, '-1');
    expect(latest.dates.shiftMinutes).toBe(-60);
    const minutes = screen.getByLabelText('Minutes');
    await userEvent.clear(minutes);
    await userEvent.type(minutes, '-30');
    expect(latest.dates.shiftMinutes).toBe(-90);
  });

  it('shows a saved shift split into hours and minutes', () => {
    render(<Harness initial={{ ...DEFAULT_SETTINGS, dates: { ...DEFAULT_SETTINGS.dates, shiftMinutes: 135 } }} />);
    expect(screen.getByLabelText('Hours')).toHaveValue('2');
    expect(screen.getByLabelText('Minutes')).toHaveValue('15');
  });

  it('turns the name date off and on', async () => {
    render(<Harness />);
    const box = screen.getByLabelText(/Use a date found in the file name/);
    expect(box).toBeChecked();
    await userEvent.click(box);
    expect(latest.dates.useNameDate).toBe(false);
  });
});
