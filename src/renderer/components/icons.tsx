const stroke = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const FolderIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M1.5 4.5v8a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-6.5a1 1 0 0 0-1-1H8L6.5 3h-4a1 1 0 0 0-1 1z" {...stroke} strokeWidth="1.2" />
  </svg>
);

export const FileIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M4 1.5h5l3.5 3.5v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-11.5a1 1 0 0 1 1-1zM9 1.5V5h3.5" {...stroke} strokeWidth="1.2" />
  </svg>
);

export const XIcon = () => (
  <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
    <path d="M3 3l6 6M9 3l-6 6" {...stroke} strokeWidth="1.4" />
  </svg>
);

export const ChevronIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <path d="M3 4.5l3 3 3-3" {...stroke} strokeWidth="1.4" />
  </svg>
);

export const UndoIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <path d="M4.5 3.5L2 6l2.5 2.5M2.3 6h6.2a3.5 3.5 0 0 1 0 7H6" {...stroke} strokeWidth="1.3" />
  </svg>
);

export const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.7 9h6.6l.7-9" {...stroke} strokeWidth="1.2" />
  </svg>
);
