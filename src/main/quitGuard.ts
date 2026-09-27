/** What to do about a quit request, given the session's state. */
export type QuitDecision = 'quit' | 'ask' | 'refuse';

/**
 * Undo history is lost on quit, so ask first. Never quit in the middle of a batch
 * (a rename or an undo).
 */
export function quitDecision(state: { busy: boolean; canUndo: boolean }): QuitDecision {
  if (state.busy) return 'refuse';
  if (state.canUndo) return 'ask';
  return 'quit';
}

export const BUSY_QUIT = {
  message: 'Files are still being renamed',
  detail: 'Wait for the rename or undo to finish, or click Cancel, before you quit.',
};

export const CONFIRM_QUIT = {
  message: 'Quit Renami?',
  detail: "You can't undo your renames after you quit.",
};

/** What a second launch is told while Renami waits for a batch before quitting. */
export const QUIT_WAITING = {
  message: 'Renami is finishing a rename or undo',
  detail: 'Try again in a moment.',
};

/** What a second launch is told while Renami quits with no batch running (a few seconds at most). */
export const QUITTING = {
  message: 'Renami is quitting',
  detail: 'Try again in a moment.',
};

/** How long a quit waits for a batch to settle before it writes that to the log. */
export const QUIT_WAIT_NOTE_MS = 10_000;

export interface LongWaitNote {
  noteAfterMs: number;
  /** Called once if the batch is still running noteAfterMs after the wait began. */
  onLongWait(): void;
}

type Idleable = { whenIdle(): Promise<void>; isBusy(): boolean };

/**
 * Resolves once no rename or undo runs, however long that takes. A loop: a batch that starts
 * while the last one settles is waited for too. With `note`, a wait that runs long is reported
 * once, so a quit held up by a hung rollback leaves a trace in the log.
 */
export async function waitForIdle(session: Idleable, note?: LongWaitNote): Promise<void> {
  if (!session.isBusy()) return;
  const timer = note ? setTimeout(() => note.onLongWait(), note.noteAfterMs) : undefined;
  try {
    while (session.isBusy()) await session.whenIdle();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Disposes the session on quit. The timeout exists for a stuck ExifTool end(), not for a batch:
 * dispose() cancels a running rename or undo, and cutting its rollback short could leave files
 * under temporary names. So the timeout only starts once no batch runs. Until then this waits as
 * long as the rollback takes, which is a trade-off: a rollback hung on a dead network volume or a
 * stuck child process keeps the windowless app (and its single-instance lock) alive until it
 * returns. `note` logs such a wait, and index.ts answers a second launch meanwhile. Rejects with
 * dispose()'s error if it fails in time.
 */
export async function disposeBounded(
  session: Idleable & { dispose(): Promise<void> },
  timeoutMs: number,
  note?: LongWaitNote,
): Promise<void> {
  const disposing = session.dispose();
  // Marks a failure while waiting for the batch as handled; the race below still sees it.
  void disposing.catch(() => {});
  await waitForIdle(session, note);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  try {
    await Promise.race([disposing, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
