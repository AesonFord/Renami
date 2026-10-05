/** Exit codes, documented in `renami --help` and the README. */
export const EXIT = {
  ok: 0,
  usage: 1,
  patternError: 2,
  planErrors: 3,
  stale: 4,
  failed: 5,
  undoSkipped: 6,
  appNotFound: 7,
} as const;
