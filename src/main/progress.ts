/** Taskbar (Windows) / dock (macOS) progress for a running batch; -1 is Electron's "no bar". */
export function progressFraction(done: number, total: number): number {
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return -1;
  return Math.min(1, Math.max(0, done / total));
}
