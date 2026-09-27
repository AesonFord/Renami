import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { crc32 } from 'node:zlib';

export interface FileHashes {
  /** 8 lowercase hex digits. */
  crc32: string;
  /** 32 lowercase hex digits. */
  md5: string;
}

/** Feeds `chunk` into a running CRC-32 (zlib's). Start with 0; the result is the CRC so far. */
export function crc32Update(crc: number, chunk: Uint8Array): number {
  return crc32(chunk, crc);
}

const hex8 = (n: number): string => n.toString(16).padStart(8, '0');

export function crc32Hex(data: Uint8Array): string {
  return hex8(crc32Update(0, data));
}

/** Reads the file once and returns both hashes. Rejects with "Cancelled" once `signal` aborts. */
export async function hashFile(filePath: string, signal?: AbortSignal): Promise<FileHashes> {
  const md5 = createHash('md5');
  let crc = 0;
  const stream = createReadStream(filePath, { highWaterMark: 1024 * 1024 });
  try {
    if (signal?.aborted) throw new Error('Cancelled');
    for await (const chunk of stream) {
      if (signal?.aborted) throw new Error('Cancelled');
      const bytes = chunk as Buffer;
      md5.update(bytes);
      crc = crc32Update(crc, bytes);
    }
  } finally {
    stream.destroy();
  }
  return { crc32: hex8(crc), md5: md5.digest('hex') };
}
