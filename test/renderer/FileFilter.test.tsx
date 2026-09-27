import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { bytesToMb, FileFilter, filterSummary, mbToBytes } from '../../src/renderer/components/FileFilter.js';
import { DEFAULT_SETTINGS, type RenameSettings } from '../../src/core/types.js';

type Filter = RenameSettings['filter'];
let latest: Filter = DEFAULT_SETTINGS.filter;

function Harness({ initial = DEFAULT_SETTINGS.filter }: { initial?: Filter }) {
  const [filter, setFilter] = useState(initial);
  latest = filter;
  return <FileFilter filter={filter} onChange={(patch) => setFilter((f) => ({ ...f, ...patch }))} />;
}

const open = () => userEvent.click(screen.getByRole('button', { name: /^(Files|Folders)/ }));

describe('filterSummary', () => {
  it('names the mode and counts active filters', () => {
    expect(filterSummary(DEFAULT_SETTINGS.filter)).toBe('Files');
    expect(filterSummary({ ...DEFAULT_SETTINGS.filter, mode: 'folders' })).toBe('Folders');
    expect(filterSummary({ ...DEFAULT_SETTINGS.filter, name: { text: 'IMG', regex: false }, minBytes: 1 })).toBe('Files · 2 filters');
    expect(filterSummary({ ...DEFAULT_SETTINGS.filter, modifiedTo: '2024-12-31' })).toBe('Files · 1 filter');
  });
});

describe('size conversion', () => {
  it('converts megabytes to bytes and back, with null for blank or bad input', () => {
    expect(mbToBytes('2')).toBe(2 * 1024 * 1024);
    expect(mbToBytes('0.5')).toBe(524288);
    expect(mbToBytes('')).toBeNull();
    expect(mbToBytes('abc')).toBeNull();
    expect(mbToBytes('-1')).toBeNull();
    expect(bytesToMb(524288)).toBe('0.5');
    expect(bytesToMb(null)).toBe('');
  });
});

describe('FileFilter', () => {
  it('switches between files and folders', async () => {
    render(<Harness />);
    await open();
    await userEvent.click(screen.getByLabelText('Folders'));
    expect(latest.mode).toBe('folders');
    expect(screen.getByRole('button', { name: /^Folders/ })).toBeInTheDocument();
    expect(screen.getByText(/renames the folders directly inside/)).toBeInTheDocument();
  });

  it('sets the name filter and its regex flag', async () => {
    render(<Harness />);
    await open();
    await userEvent.type(screen.getByLabelText('Name contains'), 'IMG');
    await userEvent.click(screen.getByLabelText('Regex'));
    expect(latest.name).toEqual({ text: 'IMG', regex: true });
  });

  it('sets the size limits in megabytes', async () => {
    render(<Harness />);
    await open();
    await userEvent.type(screen.getByLabelText('Size from (MB)'), '1');
    await userEvent.type(screen.getByLabelText('Size to (MB)'), '0.5');
    expect(latest.minBytes).toBe(1048576);
    expect(latest.maxBytes).toBe(524288);
    await userEvent.clear(screen.getByLabelText('Size to (MB)'));
    expect(latest.maxBytes).toBeNull();
  });

  it('sets the modified date range', async () => {
    render(<Harness />);
    await open();
    await userEvent.type(screen.getByLabelText('Modified from'), '2024-01-01');
    await userEvent.type(screen.getByLabelText('Modified to'), '2024-12-31');
    expect(latest.modifiedFrom).toBe('2024-01-01');
    expect(latest.modifiedTo).toBe('2024-12-31');
  });

  it('clears every filter but keeps the mode', async () => {
    render(<Harness initial={{ ...DEFAULT_SETTINGS.filter, mode: 'folders', name: { text: 'x', regex: true }, minBytes: 5, modifiedTo: '2024-12-31' }} />);
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(latest).toEqual({ ...DEFAULT_SETTINGS.filter, mode: 'folders' });
  });

  it('closes on Escape', async () => {
    render(<Harness />);
    await open();
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Filters' })).not.toBeInTheDocument();
  });
});
