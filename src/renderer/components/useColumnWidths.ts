import { useEffect, useState } from 'react';
import { loadWidths, saveWidths, type Widths } from '../lib/columns.js';
import { storage } from '../lib/storage.js';

/** The preview table's column widths, remembered across launches. null is the default layout. */
export function useColumnWidths(): [Widths | null, (widths: Widths | null) => void] {
  const [widths, setWidths] = useState<Widths | null>(() => loadWidths(storage()));
  useEffect(() => saveWidths(storage(), widths), [widths]);
  return [widths, setWidths];
}
