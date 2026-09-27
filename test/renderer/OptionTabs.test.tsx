import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Platform, type RenameSettings } from '../../src/core/types.js';
import { OptionTabs } from '../../src/renderer/components/OptionTabs.js';

let latest: RenameSettings = DEFAULT_SETTINGS;

function Harness({ initial = DEFAULT_SETTINGS, platform = 'darwin', onChoose = vi.fn() }: { initial?: RenameSettings; platform?: Platform; onChoose?: () => void }) {
  const [settings, setSettings] = useState(initial);
  latest = settings;
  return <OptionTabs settings={settings} onChange={setSettings} platform={platform} onChooseDestination={onChoose} />;
}

const tab = (name: RegExp) => screen.getByRole('tab', { name });
const panel = () => screen.getByRole('tabpanel');

describe('OptionTabs', () => {
  it('shows the five tabs in order with Sequence open', () => {
    render(<Harness />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Sequence', 'Find & replace', 'Case & cleanup', 'Move into folders', 'File dates',
    ]);
    expect(tab(/Sequence/)).toHaveAttribute('aria-selected', 'true');
  });

  it('edits the sequence settings and counts the active ones', async () => {
    render(<Harness />);
    await userEvent.selectOptions(within(panel()).getByLabelText('Sort by'), 'name');
    const digits = within(panel()).getByLabelText('Digits');
    await userEvent.clear(digits);
    expect(latest.sequence.digits).toBe(3);
    await userEvent.type(digits, '4');
    await userEvent.click(within(panel()).getByLabelText('Restart numbering in each folder'));
    expect(latest.sequence).toEqual({ ...DEFAULT_SETTINGS.sequence, sortBy: 'name', digits: 4, restartPerFolder: true });
    expect(tab(/Sequence/)).toHaveTextContent('Sequence3');
  });

  it('ignores digits outside 1 to 10 and restores the box on blur', async () => {
    render(<Harness />);
    const digits = within(panel()).getByLabelText('Digits');
    await userEvent.clear(digits);
    await userEvent.type(digits, '11');
    expect(latest.sequence.digits).toBe(1);
    expect(digits).toHaveAttribute('aria-invalid', 'true');
    await userEvent.tab();
    expect(digits).toHaveValue('1');
  });

  it('says the sequence settings need {seq} once one is changed without it, and adds it', async () => {
    render(<Harness />);
    expect(within(panel()).queryByText(/The pattern has no \{seq\}/)).not.toBeInTheDocument();
    const start = within(panel()).getByLabelText('Start at');
    await userEvent.clear(start);
    await userEvent.type(start, '3');
    expect(within(panel()).getByText(/The pattern has no \{seq\}/)).toBeInTheDocument();
    await userEvent.click(within(panel()).getByRole('button', { name: 'Add {seq}' }));
    expect(latest.pattern).toBe('{name}_{seq}');
    expect(within(panel()).queryByText(/The pattern has no \{seq\}/)).not.toBeInTheDocument();
    expect(within(panel()).queryByRole('button', { name: 'Add {seq}' })).not.toBeInTheDocument();
  });

  it('says Digits is ignored when every {seq} sets its own digits', () => {
    const { unmount } = render(<Harness initial={{ ...DEFAULT_SETTINGS, pattern: 'Trip_{seq:3}' }} />);
    expect(within(panel()).getByText(/\{seq:3\} sets its own digits/)).toBeInTheDocument();
    unmount();

    render(<Harness initial={{ ...DEFAULT_SETTINGS, pattern: '{seq:3}_{seq}' }} />);
    expect(within(panel()).queryByText(/sets its own digits/)).not.toBeInTheDocument();
    expect(within(panel()).queryByText(/The pattern has no \{seq\}/)).not.toBeInTheDocument();
  });

  it('adds, edits and removes find & replace rules', async () => {
    render(<Harness />);
    await userEvent.click(tab(/Find & replace/));
    await userEvent.click(screen.getByRole('button', { name: '+ Add rule' }));
    const rule = screen.getByRole('group', { name: 'Rule 1' });
    await userEvent.type(within(rule).getByLabelText('Find'), 'IMG_');
    await userEvent.type(within(rule).getByLabelText('Replace with'), 'Trip ');
    await userEvent.click(within(rule).getByLabelText('Match case'));
    expect(latest.findReplace).toEqual([{ find: 'IMG_', replace: 'Trip ', regex: false, matchCase: true }]);
    expect(tab(/Find & replace/)).toHaveTextContent('1');
    await userEvent.click(within(rule).getByRole('button', { name: 'Remove rule 1' }));
    expect(latest.findReplace).toEqual([]);
  });

  it('sets case and cleanup options', async () => {
    render(<Harness />);
    await userEvent.click(tab(/Case & cleanup/));
    await userEvent.selectOptions(screen.getByLabelText('Case'), 'title');
    await userEvent.click(screen.getByLabelText('Spaces to underscores'));
    await userEvent.click(screen.getByLabelText('Lowercase extension'));
    expect(latest.cleanup).toEqual({ ...DEFAULT_SETTINGS.cleanup, caseMode: 'title', spacesToUnderscores: true, lowercaseExtension: true });
  });

  it("chooses a destination folder, and goes back to each file's folder", async () => {
    const onChoose = vi.fn();
    render(<Harness onChoose={onChoose} />);
    await userEvent.click(tab(/Move into folders/));
    await userEvent.click(screen.getByLabelText('One folder'));
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Type \/ in the pattern/)).toBeInTheDocument();
  });

  it("shows the chosen destination and can clear it", async () => {
    render(<Harness initial={{ ...DEFAULT_SETTINGS, move: { destinationRoot: '/sorted' } }} />);
    await userEvent.click(tab(/Move into folders/));
    expect(screen.getByLabelText('One folder')).toBeChecked();
    expect(screen.getByTitle('/sorted')).toHaveTextContent('/sorted');
    await userEvent.click(screen.getByLabelText("Each file's current folder"));
    expect(latest.move.destinationRoot).toBeNull();
  });

  it('sets file dates, with created dates disabled on Linux', async () => {
    const { unmount } = render(<Harness />);
    await userEvent.click(tab(/File dates/));
    await userEvent.click(screen.getByLabelText('Set modified date to date taken'));
    await userEvent.click(screen.getByLabelText('Set created date to date taken'));
    expect(latest.dates).toEqual({ ...DEFAULT_SETTINGS.dates, setModified: true, setCreated: true });
    unmount();

    render(<Harness platform="linux" initial={{ ...DEFAULT_SETTINGS, dates: { ...DEFAULT_SETTINGS.dates, setCreated: true } }} />);
    await userEvent.click(tab(/File dates/));
    const created = screen.getByLabelText('Set created date to date taken');
    expect(created).toBeDisabled();
    expect(created).not.toBeChecked();
    expect(screen.getByText(/Linux doesn't let apps change/)).toBeInTheDocument();
  });

  it("doesn't count setCreated in the File dates tab on Linux", () => {
    const { unmount } = render(
      <Harness platform="darwin" initial={{ ...DEFAULT_SETTINGS, dates: { ...DEFAULT_SETTINGS.dates, setCreated: true } }} />,
    );
    expect(tab(/File dates/).textContent).toBe('File dates1');
    unmount();

    render(<Harness platform="linux" initial={{ ...DEFAULT_SETTINGS, dates: { ...DEFAULT_SETTINGS.dates, setCreated: true } }} />);
    expect(tab(/File dates/).textContent).toBe('File dates');
  });
});
