import type { FileChange, PreviewRow } from '../../shared/ipc.js';
import { badgesFor } from './flags.js';

/** Quotes a value when it holds a comma, a quote or a line break (RFC 4180). */
export function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** A CSV document with CRLF line ends and a trailing newline, as spreadsheets expect. */
export function csvText(header: readonly string[], rows: readonly (readonly string[])[]): string {
  return `${[header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/** The preview as a spreadsheet: what each file is called now, what it will be called, and why. */
export function previewCsv(rows: readonly PreviewRow[]): string {
  return csvText(
    ['Current name', 'New name', 'Status', 'Date used', 'From folder', 'Path'],
    rows.map((r) => [
      r.currentName,
      r.newName,
      badgesFor(r).map((b) => b.label).join('; '),
      r.dateUsed ?? '',
      r.folderPath,
      r.path,
    ]),
  );
}

/** A finished batch: every file's path before and after. */
export function changesCsv(changes: readonly FileChange[]): string {
  return csvText(['From', 'To'], changes.map((c) => [c.from, c.to]));
}
