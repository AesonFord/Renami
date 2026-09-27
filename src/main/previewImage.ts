import { nativeImage } from 'electron';
import type { ConvertInput } from './previewServer.js';

/** The long side of a converted preview, in pixels. */
export const MAX_EDGE = 2048;
const JPEG_QUALITY = 85;

/** Scales to at most MAX_EDGE on the long side and encodes as JPEG. Throws when it can't decode. */
export function toJpeg(input: ConvertInput): Buffer {
  let image =
    input.kind === 'jpeg'
      ? nativeImage.createFromBuffer(input.data)
      : nativeImage.createFromBitmap(Buffer.from(input.bitmap.data.buffer, input.bitmap.data.byteOffset, input.bitmap.data.byteLength), {
          width: input.bitmap.width,
          height: input.bitmap.height,
        });
  if (image.isEmpty()) throw new Error("Couldn't decode the image");
  const { width, height } = image.getSize();
  const long = Math.max(width, height);
  if (long > MAX_EDGE) {
    const scale = MAX_EDGE / long;
    image = image.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'good' });
  }
  return image.toJPEG(JPEG_QUALITY);
}

