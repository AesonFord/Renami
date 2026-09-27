import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EVENTS, INVOKE } from '../../src/shared/ipc.js';

const src = (rel: string) => readFileSync(path.join(import.meta.dirname, '../../src', rel), 'utf8');

describe('IPC channels', () => {
  it('gives every request and event its own channel name', () => {
    const names = [...Object.values(INVOKE), ...Object.values(EVENTS)];
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z]+:[a-z-]+$/);
  });

  it('is handled in the main process and exposed by the preload script, channel for channel', () => {
    const main = src('main/index.ts');
    const preload = src('preload/index.ts');
    for (const key of Object.keys(INVOKE)) {
      expect(main, `main handles INVOKE.${key}`).toContain(`INVOKE.${key}`);
      expect(preload, `preload invokes INVOKE.${key}`).toContain(`INVOKE.${key}`);
    }
    for (const key of Object.keys(EVENTS)) {
      expect(main, `main sends EVENTS.${key}`).toContain(`EVENTS.${key}`);
      expect(preload, `preload listens for EVENTS.${key}`).toContain(`EVENTS.${key}`);
    }
  });
});
