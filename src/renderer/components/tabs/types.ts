import type { RenameSettings } from '../../../core/types.js';

export type Update = (update: (s: RenameSettings) => RenameSettings) => void;

export interface TabProps {
  settings: RenameSettings;
  onChange: Update;
}
