// Generates small media files with known metadata into test/fixtures/media.
// Needs ffmpeg (with libmp3lame) and macOS `sips`. Run once with `npm run fixtures` and commit the output.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { exiftool } from 'exiftool-vendored';

const out = path.resolve('test/fixtures/media');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const at = (name) => path.join(out, name);
const ff = (...args) =>
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
const write = (file, tags) => exiftool.write(at(file), tags, { writeArgs: ['-overwrite_original'] });

const picture = ['-f', 'lavfi', '-i', 'color=c=teal:s=64x48', '-frames:v', '1'];
const clip = ['-f', 'lavfi', '-i', 'testsrc=size=64x48:rate=10', '-t', '1', '-pix_fmt', 'yuv420p'];
const tone = ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1'];
const audioTags = [
  'artist=Test Artist', 'album_artist=Test Band', 'album=Test Album', 'title=Test Title',
  'genre=Hawaiian', 'track=3/12', 'disc=1/2', 'date=1993',
].flatMap((t) => ['-metadata', t]);

// Photos
ff(...picture, at('photo.jpg'));
await write('photo.jpg', {
  DateTimeOriginal: '2024:07:04 14:30:00',
  Make: 'Canon',
  Model: 'EOS R5',
  LensModel: 'RF24-70mm F2.8 L IS USM',
  ISO: 400,
  FocalLength: 35,
  GPSLatitude: 21.2766,
  GPSLatitudeRef: 'N',
  // ExifTool re-derives GPSLongitudeRef from the sign of GPSLongitude when both are written
  // in the same command, so the coordinate itself must be negative for a Western longitude.
  GPSLongitude: -157.8259,
  GPSLongitudeRef: 'W',
});
ff(...picture, at('nodate.jpg'));
execFileSync('sips', ['-s', 'format', 'heic', at('nodate.jpg'), '--out', at('photo.heic')], { stdio: 'ignore' });
await write('photo.heic', { DateTimeOriginal: '2024:07:05 08:10:00', Make: 'Apple', Model: 'iPhone 15' });

// Video: UTC-only CreateDate (mp4, m4v) and an Apple CreationDate with offset (mov)
ff(...clip, '-metadata', 'creation_time=2024-07-05T23:15:02Z', '-f', 'mp4', at('clip.mp4'));
ff(...clip, '-metadata', 'creation_time=2024-07-05T23:15:02Z', '-f', 'mp4', at('clip.m4v'));
ff(
  ...clip,
  '-metadata', 'creation_time=2024-07-05T04:42:00Z',
  '-metadata', 'com.apple.quicktime.creationdate=2024-07-04T18:42:00-1000',
  '-movflags', 'use_metadata_tags',
  '-f', 'mov', at('live.mov'),
);

// Audio
ff(...tone, ...audioTags, '-c:a', 'libmp3lame', '-id3v2_version', '3', at('song.mp3'));
ff(...tone, ...audioTags, '-c:a', 'flac', at('song.flac'));
ff(...tone, ...audioTags, '-c:a', 'aac', '-f', 'mp4', at('song.m4a'));
ff(...tone, ...audioTags, '-c:a', 'aac', '-f', 'mp4', at('book.m4b'));

writeFileSync(at('notes.txt'), 'no metadata here\n');
await exiftool.end();
console.log(`Fixtures written to ${out}`);
