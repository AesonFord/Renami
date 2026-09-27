import type { Bitmap } from './previewServer.js';

/** Swaps red and blue in place: RGBA from libheif to the BGRA that nativeImage takes. */
export function rgbaToBgraInPlace(pixels: Uint8Array | Uint8ClampedArray): void {
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i]!;
    pixels[i] = pixels[i + 2]!;
    pixels[i + 2] = r;
  }
}

/** What the decoder worker sends back for one job. */
export type WorkerReply = { id: number; width: number; height: number; data: Uint8Array } | { id: number; error: string };

/** The part of a worker_threads Worker the decoder uses; tests pass a fake. */
export interface DecoderWorker {
  postMessage(message: { id: number; data: Uint8Array }, transfer: ArrayBuffer[]): void;
  on(event: 'message', listener: (reply: WorkerReply) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

/** Why a decode that a newer one replaced before it started was dropped. */
export class SupersededError extends Error {
  constructor() {
    super('A newer preview replaced this one');
  }
}

type Job = { id: number; data: Uint8Array; resolve(b: Bitmap): void; reject(e: Error): void };

/**
 * Decodes HEIC in a worker thread, so a 12 MP photo (most of a second) never stalls the main
 * process. One decode runs at a time; a decode waiting its turn is dropped as soon as a newer
 * one arrives, so stepping quickly through photos only decodes the one you stop on.
 */
export class HeicDecoder {
  private worker: DecoderWorker | null = null;
  private running: Job | null = null;
  private waiting: Job | null = null;
  private nextId = 1;

  constructor(private readonly start: () => DecoderWorker) {}

  decode(data: Uint8Array): Promise<Bitmap> {
    return new Promise<Bitmap>((resolve, reject) => {
      this.waiting?.reject(new SupersededError());
      this.waiting = { id: this.nextId++, data, resolve, reject };
      this.pump();
    });
  }

  private pump(): void {
    if (this.running || !this.waiting) return;
    const job = this.waiting;
    this.waiting = null;
    this.running = job;
    const copy = job.data.slice();
    this.ensureWorker().postMessage({ id: job.id, data: copy }, [copy.buffer as ArrayBuffer]);
  }

  private ensureWorker(): DecoderWorker {
    if (this.worker) return this.worker;
    const worker = this.start();
    worker.on('message', (reply) => {
      const job = this.running;
      if (!job || job.id !== reply.id) return;
      this.running = null;
      if ('error' in reply) job.reject(new Error(reply.error));
      else job.resolve({ width: reply.width, height: reply.height, data: reply.data });
      this.pump();
    });
    worker.on('error', (error) => {
      // The worker died (out of memory on a huge file, say). Fail its job; the next starts a new one.
      this.worker = null;
      const job = this.running;
      this.running = null;
      job?.reject(error);
      this.pump();
    });
    this.worker = worker;
    return worker;
  }
}
