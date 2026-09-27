import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type RenameSettings } from '../../../src/core/types.js';
import { SequenceTab } from '../../../src/renderer/components/tabs/SequenceTab.js';

let latest: RenameSettings = DEFAULT_SETTINGS;

function Harness({ initial = DEFAULT_SETTINGS }: { initial?: RenameSettings }) {
  const [settings, setSettings] = useState(initial);
  latest = settings;
  return <SequenceTab settings={settings} onChange={setSettings} changed={false} />;
}

describe('SequenceTab', () => {
  it('sets the direction, step and restart period', async () => {
    render(<Harness />);
    await userEvent.selectOptions(screen.getByLabelText('Order'), 'desc');
    const step = screen.getByLabelText('Step');
    await userEvent.clear(step);
    await userEvent.type(step, '5');
    await userEvent.selectOptions(screen.getByLabelText('Restart'), 'day');
    expect(latest.sequence).toEqual({ ...DEFAULT_SETTINGS.sequence, direction: 'desc', step: 5, restartEvery: 'day' });
  });

  it('rejects a step below 1', async () => {
    render(<Harness />);
    const step = screen.getByLabelText('Step');
    await userEvent.clear(step);
    await userEvent.type(step, '0');
    expect(latest.sequence.step).toBe(1);
    expect(step).toHaveAttribute('aria-invalid', 'true');
  });

  it('offers manual order and explains how to set it', async () => {
    render(<Harness />);
    expect(screen.queryByText(/Drag rows in the preview/)).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Sort by'), 'manual');
    expect(latest.sequence.sortBy).toBe('manual');
    expect(screen.getByText(/Drag rows in the preview/)).toBeInTheDocument();
  });

  it('lists the controls in the documented order', () => {
    render(<Harness />);
    const labels = ['Sort by', 'Order', 'Start at', 'Step', 'Digits', 'Restart'].map((l) => screen.getByLabelText(l));
    for (let i = 1; i < labels.length; i += 1) {
      expect(labels[i - 1]!.compareDocumentPosition(labels[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });
});
