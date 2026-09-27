/** What the preview panel does with a file. */
export type PreviewKind = 'image' | 'raw' | 'heic' | 'video' | 'audio' | 'pdf';

/** The scheme the main process serves batch files on. */
export const PREVIEW_SCHEME = 'renami-file';
const PREVIEW_ORIGIN = `${PREVIEW_SCHEME}://preview/`;

/** Content types for the files streamed unchanged. RAW and HEIC are converted to JPEG. */
const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  m4b: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  pdf: 'application/pdf',
};

const RAW = new Set(
  'cr2 cr3 nef nrw arw srf sr2 dng raf orf rw2 pef srw x3f 3fr iiq erf mef mos kdc rwl'.split(' '),
);
const HEIC = new Set(['heic', 'heif', 'hif']);

/** Lowercase extension without the dot; '' when there is none. */
export function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** The preview kind for a file name; null for folders and files with no preview. */
export function previewKind(name: string, isDir = false): PreviewKind | null {
  if (isDir) return null;
  const ext = extensionOf(name);
  if (RAW.has(ext)) return 'raw';
  if (HEIC.has(ext)) return 'heic';
  const mime = MIME[ext];
  if (!mime) return null;
  if (mime === 'application/pdf') return 'pdf';
  return mime.slice(0, mime.indexOf('/')) as 'image' | 'video' | 'audio';
}

/** The content type a file is streamed with, or null when it is converted or has no preview. */
export function mimeType(name: string): string | null {
  return MIME[extensionOf(name)] ?? null;
}

/** The URL the page loads a batch file from. */
export function previewUrl(path: string): string {
  return `${PREVIEW_ORIGIN}?path=${encodeURIComponent(path)}`;
}

/** The file path a preview URL names, or null when it isn't one. */
export function pathFromPreviewUrl(url: string): string | null {
  if (!url.startsWith(PREVIEW_ORIGIN)) return null;
  try {
    return new URL(url).searchParams.get('path') || null;
  } catch {
    return null;
  }
}
