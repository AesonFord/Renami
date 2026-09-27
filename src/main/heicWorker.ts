// The HEIC decoder's worker thread (see heicDecoder.ts). Bundled on its own by electron-vite.
import { parentPort } from 'node:worker_threads';
import decode from 'heic-decode';
import { rgbaToBgraInPlace, type WorkerReply } from './heicDecoder.js';

parentPort?.on('message', async ({ id, data }: { id: number; data: Uint8Array }) => {
  let reply: WorkerReply;
  try {
    const image = await decode({ buffer: data });
    rgbaToBgraInPlace(image.data);
    const pixels = new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength);
    reply = { id, width: image.width, height: image.height, data: pixels };
    parentPort?.postMessage(reply, [pixels.buffer as ArrayBuffer]);
  } catch (e) {
    reply = { id, error: e instanceof Error ? e.message : String(e) };
    parentPort?.postMessage(reply);
  }
});
