import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { OpenPaths, pathsFromArgv } from '../../src/main/openPaths.js';

describe('OpenPaths', () => {
  it('queues paths until the page takes them, then sends later ones as events', () => {
    const send = vi.fn();
    const q = new OpenPaths(send);
    q.add(['/a']);
    q.add(['/b', '/c']);
    expect(send).not.toHaveBeenCalled();
    expect(q.take()).toEqual(['/a', '/b', '/c']);
    expect(q.take()).toEqual([]);
    q.add(['/d']);
    expect(send).toHaveBeenCalledWith(['/d']);
  });

  it('ignores empty batches', () => {
    const send = vi.fn();
    const q = new OpenPaths(send);
    q.take();
    q.add([]);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('pathsFromArgv', () => {
  it('skips the executable (and the script in dev) and every flag, resolving the rest against cwd', () => {
    const cwd = path.resolve('/work');
    expect(pathsFromArgv(['/Applications/Renami.app/Contents/MacOS/Renami', '--flag', 'Trip', '/abs/photo.jpg'], true, cwd))
      .toEqual([path.resolve(cwd, 'Trip'), path.resolve(cwd, '/abs/photo.jpg')]);
    expect(pathsFromArgv(['/usr/bin/electron', 'out/main/index.mjs', '-psn_0_1', 'Trip'], false, cwd))
      .toEqual([path.resolve(cwd, 'Trip')]);
    expect(pathsFromArgv(['/usr/bin/electron'], true, cwd)).toEqual([]);
  });
});
