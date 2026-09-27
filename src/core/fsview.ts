import { accessSync, constants, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { FsView } from './types.js';

function cached<T>(fn: (key: string) => T): (key: string) => T {
  const cache = new Map<string, T>();
  return (key) => {
    if (!cache.has(key)) cache.set(key, fn(key));
    return cache.get(key) as T;
  };
}

/**
 * Real FsView. Every answer is cached because the planner asks the same
 * questions for each file in a folder, so create a fresh one for each plan.
 */
export function createFsView(): FsView {
  return {
    listDir: cached((dir) => {
      try {
        return readdirSync(dir);
      } catch {
        return null;
      }
    }),
    nearestExisting: cached((p) => {
      let current = path.resolve(p);
      for (;;) {
        try {
          statSync(current);
          return current;
        } catch {
          const parent = path.dirname(current);
          if (parent === current) return current;
          current = parent;
        }
      }
    }),
    deviceOf: cached((existingPath) => statSync(existingPath).dev),
    isWritableDir: cached((dir) => {
      try {
        accessSync(dir, constants.W_OK);
        return true;
      } catch {
        return false;
      }
    }),
  };
}
