import { describe, expect, it } from 'vitest';
import { changesCsv, csvCell, csvText, previewCsv } from '../../src/renderer/lib/csv.js';
import { flag, row } from './fixtures.js';

describe('csvCell', () => {
  it('quotes only what needs it', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
  });
});

describe('csvText', () => {
  it('joins with CRLF and ends with a newline', () => {
    expect(csvText(['A', 'B'], [['1', '2']])).toBe('A,B\r\n1,2\r\n');
  });
});

describe('previewCsv', () => {
  it('writes one row per file with its status badges', () => {
    const text = previewCsv([
      row({ path: '/p/a.jpg', currentName: 'a.jpg', newName: 'Trip_001.jpg', folderPath: '/p' }),
      row({ path: '/p/b.jpg', currentName: 'b.jpg', newName: 'Trip_002.jpg', folderPath: '/p', flags: [flag('suffix-added', 'warning'), flag('paired', 'info')] }),
      row({ path: '/p/c.jpg', currentName: 'c.jpg', newName: '', kind: 'error', dateUsed: null, folderPath: '/p', flags: [flag('empty-segment', 'error')] }),
    ]);
    expect(text.split('\r\n')).toEqual([
      'Current name,New name,Status,Date used,From folder,Path',
      'a.jpg,Trip_001.jpg,Ready,2024-07-04 14:30,/p,/p/a.jpg',
      'b.jpg,Trip_002.jpg,Suffix added; Paired,2024-07-04 14:30,/p,/p/b.jpg',
      'c.jpg,,Empty name,,/p,/p/c.jpg',
      '',
    ]);
  });
});

describe('changesCsv', () => {
  it('writes From and To', () => {
    expect(changesCsv([{ from: '/p/a.jpg', to: '/p/Trip_001.jpg' }])).toBe('From,To\r\n/p/a.jpg,/p/Trip_001.jpg\r\n');
  });
});
