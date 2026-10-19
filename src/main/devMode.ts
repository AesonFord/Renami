/**
 * The dev server URL the window should load, or null to load the built page. A packaged app
 * must ignore ELECTRON_RENDERER_URL: with the preload attached, loading an attacker-chosen URL
 * would hand that page the whole IPC surface (Electron security checklist).
 */
export function devRendererUrl(isPackaged: boolean, env: Record<string, string | undefined>): string | null {
  if (isPackaged) return null;
  return env.ELECTRON_RENDERER_URL || null;
}

/**
 * A stand-in for GitHub's latest-release feed, for trying the update dialogs by hand. A packaged
 * app must ignore RENAMI_UPDATE_FEED: the feed chooses the version offered and its release page.
 */
export function devUpdateFeed(isPackaged: boolean, env: Record<string, string | undefined>): string | null {
  if (isPackaged) return null;
  return env.RENAMI_UPDATE_FEED || null;
}
