import { fsMetadata } from '../dates.js';
import type { FileEntry, FileMetadata, WallClock } from '../types.js';
import { parseExifDateTime, utcWallToZone } from '../wallclock.js';

/** ExifTool readRaw output, read with -n. */
export type RawTags = Readonly<Record<string, unknown>>;

export const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set(['mov', 'mp4', 'm4v']);
export const AUDIO_EXTENSIONS: ReadonlySet<string> = new Set(['mp3', 'flac', 'm4a', 'm4b']);

function str(v: unknown): string | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t === '' ? undefined : t;
}

function num(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number.parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/** "3/12", "3 of 12", "3 12" or 3 → 3. */
function leadingInt(v: unknown): number | undefined {
  const n = typeof v === 'number' ? Math.trunc(v) : typeof v === 'string' ? Number.parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function yearOf(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined;
  const m = /\d{4}/.exec(String(v));
  return m ? Number(m[0]) : undefined;
}

function signed(value: unknown, ref: unknown, negativeRef: 'S' | 'W'): number | undefined {
  const n = num(value);
  if (n === undefined) return undefined;
  return n > 0 && String(ref ?? '').toUpperCase().startsWith(negativeRef) ? -n : n;
}

/** Bits per second (ExifTool -n) as whole kilobits per second. */
function kbps(v: unknown): number | undefined {
  const n = num(v);
  return n === undefined ? undefined : Math.round(n / 1000);
}

/** Adds the SubSecTimeOriginal digits ("45" → 450 ms) to a date that has no fraction yet. */
function withSubSec(wall: WallClock | undefined, subSec: unknown): WallClock | undefined {
  if (!wall || wall.millisecond !== undefined) return wall;
  const digits = typeof subSec === 'number' ? String(subSec) : typeof subSec === 'string' ? subSec.trim() : '';
  if (!/^\d+$/.test(digits)) return wall;
  return { ...wall, millisecond: Number(digits.padEnd(3, '0').slice(0, 3)) };
}

const asRecorded = (v: unknown): WallClock | undefined => parseExifDateTime(v)?.wall;

function fromUtc(v: unknown, timeZone: string): WallClock | undefined {
  const parsed = parseExifDateTime(v);
  if (!parsed) return undefined;
  return parsed.offsetMinutes === null ? utcWallToZone(parsed.wall, timeZone) : parsed.wall;
}

export function normalizeTags(raw: RawTags, entry: FileEntry, timeZone: string): FileMetadata {
  const meta = fsMetadata(entry, timeZone);
  const ext = entry.ext.toLowerCase();
  const isVideo = VIDEO_EXTENSIONS.has(ext);
  const isAudio = AUDIO_EXTENSIONS.has(ext);

  const fields: Omit<FileMetadata, 'modified' | 'created'> = {
    dateTaken: isAudio
      ? undefined
      : isVideo
        ? (asRecorded(raw.CreationDate) ?? fromUtc(raw.CreateDate, timeZone))
        : (asRecorded(raw.SubSecDateTimeOriginal) ??
          withSubSec(asRecorded(raw.DateTimeOriginal), raw.SubSecTimeOriginal) ??
          asRecorded(raw.CreateDate)),
    cameraMake: str(raw.Make),
    cameraModel: str(raw.Model),
    lens: str(raw.LensModel) ?? str(raw.LensID) ?? str(raw.Lens),
    iso: num(raw.ISO),
    focalLength: num(raw.FocalLength),
    width: num(raw.ImageWidth),
    height: num(raw.ImageHeight),
    gpsLat: signed(raw.GPSLatitude, raw.GPSLatitudeRef, 'S'),
    gpsLon: signed(raw.GPSLongitude, raw.GPSLongitudeRef, 'W'),
    durationSeconds: num(raw.Duration),
    artist: str(raw.Artist),
    albumArtist: str(raw.AlbumArtist) ?? str(raw.Albumartist) ?? str(raw.Band),
    album: str(raw.Album),
    title: str(raw.Title),
    genre: str(raw.Genre),
    track: leadingInt(raw.Track) ?? leadingInt(raw.TrackNumber),
    disc: leadingInt(raw.DiscNumber) ?? leadingInt(raw.DiskNumber) ?? leadingInt(raw.PartOfSet),
    year: isAudio
      ? (yearOf(raw.Year) ?? yearOf(raw.RecordingTime) ?? yearOf(raw.ContentCreateDate) ?? yearOf(raw.Date))
      : undefined,
    aperture: num(raw.FNumber) ?? num(raw.ApertureValue),
    exposureSeconds: num(raw.ExposureTime),
    frameRate: num(raw.VideoFrameRate),
    bitrateKbps: kbps(raw.AvgBitrate) ?? kbps(raw.AudioBitrate),
    composer: str(raw.Composer),
    readError: str(raw.Error),
  };

  const out: Record<string, unknown> = { ...meta };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) out[key] = value;
  }
  return out as unknown as FileMetadata;
}
