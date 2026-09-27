import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crc32Hex, crc32Update, hashFile } from '../../src/core/hash.js';

let dir = '';
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'renami-hash-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('crc32', () => {
  it('matches the standard check values', () => {
    expect(crc32Hex(Buffer.from('123456789'))).toBe('cbf43926');
    expect(crc32Hex(Buffer.from('abc'))).toBe('352441c2');
    expect(crc32Hex(Buffer.alloc(0))).toBe('00000000');
  });
  it('is the same whether fed at once or in pieces', () => {
    const data = Buffer.from('The quick brown fox jumps over the lazy dog');
    const pieces = crc32Update(crc32Update(0, data.subarray(0, 10)), data.subarray(10));
    expect(pieces.toString(16).padStart(8, '0')).toBe(crc32Hex(data));
  });
});

describe('hashFile', () => {
  it('returns the CRC32 and MD5 of a small file', async () => {
    const p = path.join(dir, 'abc.txt');
    writeFileSync(p, 'abc');
    expect(await hashFile(p)).toEqual({ crc32: '352441c2', md5: '900150983cd24fb0d6963f7d28e17f72' });
  });
  it('hashes an empty file', async () => {
    const p = path.join(dir, 'empty.bin');
    writeFileSync(p, '');
    expect(await hashFile(p)).toEqual({ crc32: '00000000', md5: 'd41d8cd98f00b204e9800998ecf8427e' });
  });
  it('streams a file bigger than one chunk and agrees with a one-shot hash', async () => {
    const data = Buffer.alloc(3 * 1024 * 1024);
    for (let i = 0; i < data.length; i += 1) data[i] = (i * 31 + 7) & 0xff;
    const p = path.join(dir, 'big.bin');
    writeFileSync(p, data);
    expect(await hashFile(p)).toEqual({ crc32: crc32Hex(data), md5: createHash('md5').update(data).digest('hex') });
  });
  it('rejects when cancelled', async () => {
    const p = path.join(dir, 'cancel.bin');
    writeFileSync(p, Buffer.alloc(256 * 1024));
    const controller = new AbortController();
    controller.abort();
    await expect(hashFile(p, controller.signal)).rejects.toThrow('Cancelled');
  });
  it('rejects for a missing file', async () => {
    await expect(hashFile(path.join(dir, 'missing.bin'))).rejects.toThrow();
  });
});
