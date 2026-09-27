import { vi } from 'vitest';
import type { RenameSettings } from '../../src/core/types.js';
import type { Api, FilesSummary, MetadataStatus, PlanView, ProgressView } from '../../src/shared/ipc.js';
import { row } from './fixtures.js';

export type FakeApi = Api & {
  emitMetadata(status: MetadataStatus): void;
  emitProgress(progress: ProgressView): void;
  emitOpenPaths(paths: string[]): void;
};

export function summaryFor(paths: string[]): FilesSummary {
  return {
    sources: paths.map((p) => ({ path: p, name: p.split('/').pop() ?? p, isFolder: true, count: 2 })),
    total: paths.length * 2,
    extensionsFound: ['jpg', 'txt'],
    unreadableFolders: [],
  };
}

export const PLAN: PlanView = {
  planId: 'plan-1',
  rows: [
    row({ path: '/photos/a.jpg', currentName: 'a.jpg', newName: 'Trip_001.jpg' }),
    row({ path: '/photos/b.jpg', currentName: 'b.jpg', newName: 'Trip_002.jpg' }),
  ],
  patternError: null,
  errorCount: 0,
  complete: true,
};

/** An Api whose methods are vi.fn()s with sensible answers. Pass overrides for what a test needs. */
export function createFakeApi(overrides: Partial<Api> = {}): FakeApi {
  const metadataListeners = new Set<(s: MetadataStatus) => void>();
  const progressListeners = new Set<(p: ProgressView) => void>();
  const openListeners = new Set<(p: string[]) => void>();
  const emitMetadata = (s: MetadataStatus) => metadataListeners.forEach((cb) => cb(s));
  const api: FakeApi = {
    platform: vi.fn(async () => 'darwin' as const),
    scan: vi.fn(async (paths: string[]) => summaryFor(paths)),
    buildPlan: vi.fn(async () => PLAN),
    tokenValues: vi.fn(async () => null),
    execute: vi.fn(async () => ({ status: 'done' as const, renamed: 2, datesChanged: 0, changes: [], sourcesAfter: ['/photos'] })),
    cancel: vi.fn(async () => {}),
    undo: vi.fn(async () => ({
      status: 'done' as const,
      restored: 2,
      skipped: [],
      error: null,
      rollback: null,
      sourcesAfter: ['/photos'],
    })),
    canUndo: vi.fn(async () => false),
    listPresets: vi.fn(async () => []),
    // Trims like the real store does.
    savePreset: vi.fn(async (name: string, settings: RenameSettings) => [{ name: name.trim(), settings }]),
    deletePreset: vi.fn(async () => []),
    pickPaths: vi.fn(async () => ['/picked']),
    pickFolder: vi.fn(async () => '/dest'),
    copyText: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
    saveText: vi.fn(async () => true),
    readText: vi.fn(async () => null),
    takeOpenPaths: vi.fn(async () => []),
    fileDetails: vi.fn(async () => ({ size: 2_400_000, width: 4032, height: 3024, durationSeconds: null })),
    showInFolder: vi.fn(async () => {}),
    openFile: vi.fn(async () => null),
    pathForFile: vi.fn((file: File) => `/dropped/${file.name}`),
    onMetadataProgress: vi.fn((cb: (s: MetadataStatus) => void) => {
      metadataListeners.add(cb);
      return () => {
        metadataListeners.delete(cb);
      };
    }),
    onExecuteProgress: vi.fn((cb: (p: ProgressView) => void) => {
      progressListeners.add(cb);
      return () => {
        progressListeners.delete(cb);
      };
    }),
    onOpenPaths: vi.fn((cb: (p: string[]) => void) => {
      openListeners.add(cb);
      return () => {
        openListeners.delete(cb);
      };
    }),
    emitMetadata,
    emitProgress: (p) => progressListeners.forEach((cb) => cb(p)),
    emitOpenPaths: (p) => openListeners.forEach((cb) => cb(p)),
    ...overrides,
  };
  return api;
}

/** A promise you resolve by hand, for ordering tests. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
