/**
 * Whether this copy of Renami was installed by an app store, which then owns updates. A store
 * install never asks GitHub for releases: the Mac App Store rejects apps that send users to
 * downloads outside the store, the store build's sandbox grants no network access
 * (build/entitlements.mas.plist), and Flathub and Snap update the app themselves.
 *
 * Signals: process.mas (the Mac App Store build of Electron), process.windowsStore (an AppX/MSIX
 * package), FLATPAK_ID (set inside a Flatpak sandbox), and SNAP (the snap's root folder). A snap
 * exports SNAP to every child, so a terminal inside a snapped editor has it too; only an app that
 * runs from the snap's own folder is the snap.
 */
export function isStoreInstall({ mas, windowsStore, env, execPath }: Pick<NodeJS.Process, 'mas' | 'windowsStore' | 'env' | 'execPath'>): boolean {
  if (mas || windowsStore || env.FLATPAK_ID) return true;
  return Boolean(env.SNAP) && execPath.startsWith(`${env.SNAP}/`);
}
