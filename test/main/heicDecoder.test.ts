import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { HeicDecoder, rgbaToBgraInPlace, SupersededError, type DecoderWorker, type WorkerReply } from '../../src/main/heicDecoder.js';

/** A worker that answers only when the test says so. */
class FakeWorker extends EventEmitter implements DecoderWorker {
  readonly posted: { id: number; data: Uint8Array }[] = [];
  postMessage(message: { id: number; data: Uint8Array }): void {
    this.posted.push(message);
  }
  reply(reply: WorkerReply): void {
    this.emit('message', reply);
  }
}

const bytes = (...n: number[]) => new Uint8Array(n);

it('rgbaToBgraInPlace swaps red and blue', () => {
  const px = bytes(1, 2, 3, 4, 5, 6, 7, 8);
  rgbaToBgraInPlace(px);
  expect([...px]).toEqual([3, 2, 1, 4, 7, 6, 5, 8]);
});

describe('HeicDecoder', () => {
  it('decodes in the worker, starting it only when first needed', async () => {
    const workers: FakeWorker[] = [];
    const d = new HeicDecoder(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });
    expect(workers).toHaveLength(0);
    const input = bytes(9, 9);
    const result = d.decode(input);
    const [w] = workers;
    expect([...w!.posted[0]!.data]).toEqual([9, 9]);
    // The worker gets a copy: transferring it must not empty the caller's buffer.
    expect(w!.posted[0]!.data).not.toBe(input);
    w!.reply({ id: w!.posted[0]!.id, width: 1, height: 1, data: bytes(1, 2, 3, 4) });
    expect(await result).toEqual({ width: 1, height: 1, data: bytes(1, 2, 3, 4) });
  });

  it('runs one at a time and drops a waiting decode when a newer one arrives', async () => {
    const w = new FakeWorker();
    const d = new HeicDecoder(() => w);
    const first = d.decode(bytes(1));
    const second = d.decode(bytes(2));
    const third = d.decode(bytes(3));
    await expect(second).rejects.toBeInstanceOf(SupersededError);
    expect(w.posted).toHaveLength(1);
    w.reply({ id: w.posted[0]!.id, width: 1, height: 1, data: bytes(1) });
    await first;
    expect(w.posted).toHaveLength(2);
    expect([...w.posted[1]!.data]).toEqual([3]);
    w.reply({ id: w.posted[1]!.id, error: 'bad file' });
    await expect(third).rejects.toThrow('bad file');
  });

  it('fails the running decode when the worker dies, and starts a new worker for the next', async () => {
    const workers: FakeWorker[] = [];
    const d = new HeicDecoder(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });
    const doomed = d.decode(bytes(1));
    workers[0]!.emit('error', new Error('out of memory'));
    await expect(doomed).rejects.toThrow('out of memory');
    const next = d.decode(bytes(2));
    expect(workers).toHaveLength(2);
    workers[1]!.reply({ id: workers[1]!.posted[0]!.id, width: 1, height: 1, data: bytes(2) });
    await expect(next).resolves.toMatchObject({ width: 1 });
  });
});
