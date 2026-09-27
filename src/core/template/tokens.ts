import { lastSegment } from '../names.js';
import type { DateKind, FileEntry, FileMetadata } from '../types.js';

export interface RenderContext {
  entry: FileEntry;
  meta: FileMetadata;
  /** Current name without extension, after find & replace. */
  name: string;
  seq: number;
  /** The Sequence tab's Digits setting; used by {seq} without a format. */
  defaultDigits: number;
}

export type TokenDef =
  | { kind: 'date'; date: DateKind; label: string }
  | {
      kind: 'number';
      /** Whether "{token:N}" (digits) is allowed. */
      digitsFormat: boolean;
      label: string;
      get: (ctx: RenderContext) => number | undefined;
      /** Padding when no format is given. */
      defaultDigits: (ctx: RenderContext) => number;
    }
  | { kind: 'text'; label: string; get: (ctx: RenderContext) => string | undefined };

const text = (label: string, get: (ctx: RenderContext) => string | undefined): TokenDef => ({
  kind: 'text', label, get,
});
const num = (
  label: string,
  digitsFormat: boolean,
  get: (ctx: RenderContext) => number | undefined,
  defaultDigits: (ctx: RenderContext) => number = () => 0,
): TokenDef => ({ kind: 'number', label, digitsFormat, get, defaultDigits });
const date = (kind: DateKind, label: string): TokenDef => ({ kind: 'date', date: kind, label });

export function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}m${s}s` : `${m}m${s}s`;
}

const UNITS = ['KB', 'MB', 'GB', 'TB'];

/** "512B", "340KB", "1.2MB": one decimal below 100, none above. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)}B`;
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < UNITS.length - 1) {
    value /= 1024;
    i += 1;
  }
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded}${UNITS[i]}`;
}

const trimNumber = (n: number, decimals = 2): string => String(Math.round(n * 10 ** decimals) / 10 ** decimals);

/** Shutter speed as it fits in a file name: "1-250" for fractions, "2s" or "1.5s" for whole seconds. */
export function formatExposure(seconds: number): string {
  return seconds >= 1 ? `${trimNumber(seconds)}s` : `1-${Math.round(1 / seconds)}`;
}

/** The folder above `dir`, or undefined when dir is a root. Accepts / and \. */
export function parentFolder(dir: string): string | undefined {
  const parts = dir.split(/[\\/]+/).filter((s) => s !== '');
  return parts.length >= 2 ? parts[parts.length - 2] : undefined;
}

/** Every token. */
export const TOKENS = {
  name: text('name', (c) => c.name),
  folder: text('folder name', (c) => lastSegment(c.entry.dir)),
  date_taken: date('date_taken', 'date taken'),
  created: date('created', 'created date'),
  modified: date('modified', 'modified date'),
  seq: num('sequence number', true, (c) => c.seq, (c) => c.defaultDigits),
  camera_make: text('camera make', (c) => c.meta.cameraMake),
  camera_model: text('camera model', (c) => c.meta.cameraModel),
  lens: text('lens', (c) => c.meta.lens),
  iso: num('ISO', false, (c) => c.meta.iso),
  focal_length: text('focal length', (c) =>
    c.meta.focalLength === undefined ? undefined : `${Math.round(c.meta.focalLength)}mm`),
  width: num('width', false, (c) => c.meta.width),
  height: num('height', false, (c) => c.meta.height),
  gps_lat: text('GPS latitude', (c) => c.meta.gpsLat?.toFixed(4)),
  gps_lon: text('GPS longitude', (c) => c.meta.gpsLon?.toFixed(4)),
  duration: text('duration', (c) =>
    c.meta.durationSeconds === undefined ? undefined : formatDuration(c.meta.durationSeconds)),
  artist: text('artist', (c) => c.meta.artist),
  album_artist: text('album artist', (c) => c.meta.albumArtist),
  album: text('album', (c) => c.meta.album),
  title: text('title', (c) => c.meta.title),
  genre: text('genre', (c) => c.meta.genre),
  track: num('track number', true, (c) => c.meta.track),
  disc: num('disc number', true, (c) => c.meta.disc),
  year: num('year', false, (c) => c.meta.year),
  ext: text('extension', (c) => c.entry.ext || undefined),
  parent: text('parent folder name', (c) => parentFolder(c.entry.dir)),
  size: text('size', (c) => formatSize(c.entry.size)),
  size_bytes: num('size in bytes', false, (c) => c.entry.size),
  crc32: text('CRC32', (c) => c.meta.crc32),
  md5: text('MD5', (c) => c.meta.md5),
  aperture: text('aperture', (c) => (c.meta.aperture === undefined ? undefined : `f${trimNumber(c.meta.aperture, 1)}`)),
  shutter: text('shutter speed', (c) =>
    c.meta.exposureSeconds === undefined || c.meta.exposureSeconds <= 0 ? undefined : formatExposure(c.meta.exposureSeconds)),
  fps: text('frame rate', (c) => (c.meta.frameRate === undefined ? undefined : trimNumber(c.meta.frameRate))),
  bitrate: num('bitrate in kbps', false, (c) => c.meta.bitrateKbps),
  composer: text('composer', (c) => c.meta.composer),
} satisfies Record<string, TokenDef>;

export type TokenName = keyof typeof TOKENS;

export function isTokenName(s: string): s is TokenName {
  return Object.hasOwn(TOKENS, s);
}
