import { describe, expect, it } from 'vitest';
import { clampPanelWidth, PANEL_MIN } from '../../src/renderer/components/usePanelWidth.js';
import { formatBytes, formatDuration, showInFolderLabel } from '../../src/renderer/lib/fileInfo.js';
import { isSelectionKey, reselect, stepSelection } from '../../src/renderer/lib/selection.js';

const PATHS = ['/a', '/b', '/c'];

describe('stepSelection', () => {
  it('moves one row up or down, or to either end', () => {
    expect(stepSelection(PATHS, '/b', 'ArrowUp')).toBe('/a');
    expect(stepSelection(PATHS, '/b', 'ArrowDown')).toBe('/c');
    expect(stepSelection(PATHS, '/b', 'Home')).toBe('/a');
    expect(stepSelection(PATHS, '/b', 'End')).toBe('/c');
  });

  it('stays put at the ends and with no rows', () => {
    expect(stepSelection(PATHS, '/a', 'ArrowUp')).toBeNull();
    expect(stepSelection(PATHS, '/c', 'ArrowDown')).toBeNull();
    expect(stepSelection(PATHS, '/a', 'Home')).toBeNull();
    expect(stepSelection([], '/a', 'End')).toBeNull();
  });

  it('knows its keys', () => {
    expect(['ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter'].map(isSelectionKey)).toEqual([true, true, true, true, false]);
  });
});

describe('reselect', () => {
  it('keeps a selection that is still shown, and nothing selected stays nothing', () => {
    expect(reselect(PATHS, '/b', 0)).toBe('/b');
    expect(reselect(PATHS, null, 1)).toBeNull();
  });

  it('lands on the row now where the selection was, or the last row', () => {
    expect(reselect(['/a', '/c'], '/b', 1)).toBe('/c');
    expect(reselect(['/a'], '/b', 1)).toBe('/a');
    expect(reselect([], '/b', 1)).toBeNull();
  });
});

describe('file info', () => {
  it('formats sizes in decimal units', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(3514)).toBe('3.5 KB');
    expect(formatBytes(2_400_000)).toBe('2.4 MB');
    expect(formatBytes(45_000_000)).toBe('45 MB');
    expect(formatBytes(3_000_000_000_000_000)).toBe('3000 TB');
  });

  it('formats durations', () => {
    expect(formatDuration(0.6)).toBe('0:01');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3725)).toBe('1:02:05');
  });

  it('names the file manager', () => {
    expect(showInFolderLabel('darwin')).toBe('Show in Finder');
    expect(showInFolderLabel('win32')).toBe('Show in Explorer');
    expect(showInFolderLabel('linux')).toBe('Show in folder');
    expect(showInFolderLabel(null)).toBe('Show in folder');
  });
});

describe('clampPanelWidth', () => {
  it('keeps the panel between its minimum and 60% of the window', () => {
    expect(clampPanelWidth(100, 1280)).toBe(PANEL_MIN);
    expect(clampPanelWidth(500, 1280)).toBe(500);
    expect(clampPanelWidth(1000, 1280)).toBe(768);
    expect(clampPanelWidth(400, 300)).toBe(PANEL_MIN);
  });
});
