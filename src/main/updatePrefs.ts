import { readFile, rename, writeFile } from 'node:fs/promises';
import { parseVersion } from './updateCheck.js';

/** What the update check remembers between launches, in <userData>/updates.json. */
export interface UpdatePrefs {
  autoCheck: boolean;
  skippedVersion: string | null;
  lastCheckedAt: number | null;
}

export const DEFAULT_UPDATE_PREFS: UpdatePrefs = { autoCheck: true, skippedVersion: null, lastCheckedAt: null };

/** Never fails: a missing or damaged file, or a bad field, falls back to the default for it. */
export async function loadUpdatePrefs(file: string): Promise<UpdatePrefs> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return { ...DEFAULT_UPDATE_PREFS };
  }
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    autoCheck: typeof r.autoCheck === 'boolean' ? r.autoCheck : DEFAULT_UPDATE_PREFS.autoCheck,
    skippedVersion: typeof r.skippedVersion === 'string' && parseVersion(r.skippedVersion) ? r.skippedVersion : null,
    lastCheckedAt: typeof r.lastCheckedAt === 'number' && Number.isFinite(r.lastCheckedAt) ? r.lastCheckedAt : null,
  };
}

/** Atomic (write a .tmp, then rename), like the presets file. A failed save is logged, not thrown. */
export async function saveUpdatePrefs(file: string, prefs: UpdatePrefs): Promise<void> {
  const tmp = `${file}.tmp`;
  try {
    await writeFile(tmp, `${JSON.stringify(prefs, null, 2)}\n`, 'utf8');
    await rename(tmp, file);
  } catch (error) {
    console.warn('could not save update preferences', error);
  }
}
