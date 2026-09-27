import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type RenameSettings } from '../../../src/core/types.js';
import { FindReplaceTab } from '../../../src/renderer/components/tabs/FindReplaceTab.js';

let latest: RenameSettings = DEFAULT_SETTINGS;

function Harness({ initial = DEFAULT_SETTINGS }: { initial?: RenameSettings }) {
  const [settings, setSettings] = useState(initial);
  latest = settings;
  return <FindReplaceTab settings={settings} onChange={setSettings} />;
}

describe('FindReplaceTab', () => {
  it('lets a rule apply to the new name instead of the current one', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: '+ Add rule' }));
    const rule = screen.getByRole('group', { name: 'Rule 1' });
    expect(within(rule).getByLabelText('Apply to')).toHaveValue('original');
    expect(latest.findReplace[0]).not.toHaveProperty('scope');
    await userEvent.selectOptions(within(rule).getByLabelText('Apply to'), 'result');
    expect(latest.findReplace[0]?.scope).toBe('result');
  });

  it('shows a saved result-scope rule as New name', () => {
    render(
      <Harness
        initial={{ ...DEFAULT_SETTINGS, findReplace: [{ find: 'a', replace: 'b', regex: true, matchCase: false, scope: 'result' }] }}
      />,
    );
    expect(screen.getByLabelText('Apply to')).toHaveValue('result');
  });

  it('explains regex backreferences', () => {
    render(<Harness />);
    expect(screen.getByText(/\$1/)).toBeInTheDocument();
  });
});
