/**
 * The pure half of the update check: reading GitHub's latest-release answer, comparing versions,
 * and choosing what to link. Renami only tells the user about a new release; it never installs one
 * (the macOS build is ad-hoc signed, so Squirrel.Mac would refuse an update).
 */

export const RELEASES_PAGE = 'https://github.com/AesonFord/Renami/releases/latest';
export const FEED_URL = 'https://api.github.com/repos/AesonFord/Renami/releases/latest';
export const AUTO_CHECK_INTERVAL_MS = 86_400_000;

/**
 * The feed is untrusted: only links into the repository are ever opened. Checked on the parsed
 * URL, so dot-segments (`Renami/../../evil`) can't walk out of it.
 */
function trusted(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.host === 'github.com' && u.pathname.startsWith('/AesonFord/Renami/') ? u.href : null;
  } catch {
    return null;
  }
}

export interface Version {
  major: number;
  minor: number;
  patch: number;
  pre: string[];
}

export interface Release {
  version: string;
  pageUrl: string;
  notes: string;
  assets: { name: string; url: string }[];
}

const VERSION = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

/** A SemVer version, with an optional leading "v". Build metadata is ignored. */
export function parseVersion(v: string): Version | null {
  const m = VERSION.exec(v);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ? m[4].split('.') : [] };
}

/** SemVer §11 precedence for prerelease identifiers. */
function comparePre(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return b.length - a.length;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i]!;
    const y = b[i]!;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      if (Number(x) !== Number(y)) return Number(x) - Number(y);
    } else if (xn !== yn) {
      return xn ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return a.length - b.length;
}

/** Negative when a is older than b, 0 when equal, positive when newer. Throws on a non-version. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) throw new Error(`Not a version: ${x ? b : a}`);
  return x.major - y.major || x.minor - y.minor || x.patch - y.patch || comparePre(x.pre, y.pre);
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** GitHub's release JSON, or null for a draft, a prerelease, or anything that isn't a release. */
export function parseRelease(json: unknown): Release | null {
  if (!isRecord(json) || json.draft === true || json.prerelease === true) return null;
  const { tag_name: tag, html_url: pageUrl, body, assets } = json;
  if (typeof tag !== 'string' || typeof pageUrl !== 'string') return null;
  const version = parseVersion(tag);
  if (!version || version.pre.length > 0) return null;
  return {
    version: tag.replace(/^v/, ''),
    pageUrl,
    notes: typeof body === 'string' ? body : '',
    assets: (Array.isArray(assets) ? assets : []).flatMap((a: unknown) =>
      isRecord(a) && typeof a.name === 'string' && typeof a.browser_download_url === 'string'
        ? [{ name: a.name, url: a.browser_download_url }]
        : [],
    ),
  };
}

/**
 * The installer this machine would download. Must match installerNames() in
 * scripts/release-config.mjs (test/release/release-config.test.ts checks it).
 */
export function installerName(platform: NodeJS.Platform, arch: string, isAppImage: boolean): string | null {
  if (platform === 'darwin' && (arch === 'arm64' || arch === 'x64')) return `Renami-mac-${arch}.dmg`;
  if (platform === 'win32' && arch === 'x64') return 'Renami-win-x64-setup.exe';
  if (platform === 'linux' && arch === 'x64') return isAppImage ? 'Renami-linux-x86_64.AppImage' : 'Renami-linux-amd64.deb';
  return null;
}

/** This platform's installer, else the release page, else the latest-release page: always on GitHub. */
export function downloadUrl(release: Release, platform: NodeJS.Platform, arch: string, isAppImage: boolean): string {
  const name = installerName(platform, arch, isAppImage);
  const asset = release.assets.find((a) => a.name === name)?.url;
  return trusted(asset) ?? trusted(release.pageUrl) ?? RELEASES_PAGE;
}

/** Release notes as plain text for a dialog, cut at a word boundary. */
export function notesExcerpt(markdown: string, maxChars = 600): string {
  const text = markdown
    .replace(/\r\n/g, '\n')
    .replace(/^#+\s*/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[*-]\s+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text.length <= maxChars) return text;
  const cut = text.lastIndexOf(' ', maxChars);
  return `${text.slice(0, cut > 0 ? cut : maxChars).trimEnd()}…`;
}

/** Due once a day; a clock that went backwards counts as due rather than never. */
export function isDueForAutoCheck(lastCheckedAt: number | null, now: number): boolean {
  return lastCheckedAt === null || lastCheckedAt > now || now - lastCheckedAt >= AUTO_CHECK_INTERVAL_MS;
}
