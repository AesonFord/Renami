import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/core/types.js';
import { PresetPicker } from '../../src/renderer/components/PresetPicker.js';

const presets = [
  { name: 'Music library', settings: DEFAULT_SETTINGS },
  { name: 'Vacation photos', settings: DEFAULT_SETTINGS },
];

function renderPicker(current: string | null = null) {
  const props = {
    presets,
    current,
    onLoad: vi.fn(),
    onSave: vi.fn(async () => {}),
    onDelete: vi.fn(async () => {}),
  };
  render(<PresetPicker {...props} />);
  return props;
}

describe('PresetPicker', () => {
  it('loads a preset, or none', async () => {
    const props = renderPicker();
    await userEvent.selectOptions(screen.getByLabelText('Preset'), 'Vacation photos');
    expect(props.onLoad).toHaveBeenLastCalledWith('Vacation photos');
  });

  it('shows the current preset as selected', () => {
    renderPicker('Music library');
    expect(screen.getByLabelText('Preset')).toHaveValue('Music library');
  });

  it('saves under a new name', async () => {
    const props = renderPicker();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const popover = screen.getByRole('dialog', { name: 'Save preset' });
    expect(within(popover).getByRole('button', { name: 'Save preset' })).toBeDisabled();
    await userEvent.type(within(popover).getByLabelText('Name'), 'Scans');
    await userEvent.click(within(popover).getByRole('button', { name: 'Save preset' }));
    expect(props.onSave).toHaveBeenCalledWith('Scans');
    // The popover closes once the save resolves.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('warns when the name replaces a saved preset, ignoring case', async () => {
    renderPicker('Vacation photos');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const name = screen.getByLabelText('Name');
    expect(name).toHaveValue('Vacation photos');
    expect(screen.getByText('This replaces the saved preset "Vacation photos".')).toBeInTheDocument();
    await userEvent.clear(name);
    await userEvent.type(name, 'music LIBRARY');
    expect(screen.getByText('This replaces the saved preset "Music library".')).toBeInTheDocument();
  });

  it('deletes the current preset after confirming', async () => {
    const props = renderPicker('Music library');
    await userEvent.click(screen.getByRole('button', { name: 'Delete preset Music library' }));
    const confirm = screen.getByRole('dialog', { name: 'Delete preset' });
    expect(confirm).toHaveTextContent('Delete the preset "Music library"?');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    expect(props.onDelete).toHaveBeenCalledWith('Music library');
  });

  it('has no delete button without a current preset', () => {
    renderPicker();
    expect(screen.queryByRole('button', { name: /Delete preset/ })).not.toBeInTheDocument();
  });
});
