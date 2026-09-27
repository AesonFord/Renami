import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type RenameSettings } from '../../../src/core/types.js';
import { CleanupTab } from '../../../src/renderer/components/tabs/CleanupTab.js';

let latest: RenameSettings = DEFAULT_SETTINGS;

function Harness({ initial = DEFAULT_SETTINGS }: { initial?: RenameSettings }) {
  const [settings, setSettings] = useState(initial);
  latest = settings;
  return <CleanupTab settings={settings} onChange={setSettings} />;
}

describe('CleanupTab', () => {
  it('offers the new case modes', async () => {
    render(<Harness />);
    const options = within(screen.getByLabelText('Case')).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Keep as is', 'lowercase', 'UPPERCASE', 'Title Case', 'Sentence case', 'snake_case', 'kebab-case', 'camelCase']);
    await userEvent.selectOptions(screen.getByLabelText('Case'), 'snake');
    expect(latest.cleanup.caseMode).toBe('snake');
  });

  it('turns on accent stripping and ASCII only', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByLabelText('Strip accents'));
    await userEvent.click(screen.getByLabelText('ASCII only'));
    expect(latest.cleanup).toEqual({ ...DEFAULT_SETTINGS.cleanup, stripDiacritics: true, asciiOnly: true });
  });

  it('adds, edits and removes extension rules', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: '+ Add extension rule' }));
    const rule = screen.getByRole('group', { name: 'Extension rule 1' });
    await userEvent.type(within(rule).getByLabelText('Extension rule 1 from'), 'jpeg');
    await userEvent.type(within(rule).getByLabelText('Extension rule 1 to'), 'jpg');
    expect(latest.cleanup.extensionRules).toEqual([{ from: 'jpeg', to: 'jpg' }]);
    await userEvent.click(within(rule).getByRole('button', { name: 'Remove extension rule 1' }));
    expect(latest.cleanup.extensionRules).toEqual([]);
  });
});
