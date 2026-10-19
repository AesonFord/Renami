import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTO_CHECK_INTERVAL_MS, notesExcerpt } from '../../src/main/updateCheck.js';
import { loadUpdatePrefs, saveUpdatePrefs, type UpdatePrefs } from '../../src/main/updatePrefs.js';
import { UpdateChecker, type UpdateCheckerDeps, type UpdateChoice, type UpdateUi } from '../../src/main/updater.js';

const NOW = 1_760_000_000_000;
const MAC_ARM_URL = 'https://github.com/AesonFord/Renami/releases/download/v0.3.0/Renami-mac-arm64.dmg';
const BODY = '## New\n\n* **Fast** renames';

const release = (tag = 'v0.3.0') => ({
  tag_name: tag,
  html_url: `https://github.com/AesonFord/Renami/releases/tag/${tag}`,
  body: BODY,
  draft: false,
  prerelease: false,
  assets: [{ name: 'Renami-mac-arm64.dmg', browser_download_url: MAC_ARM_URL }],
});

const ok = (json: unknown) => Promise.resolve(new Response(JSON.stringify(json), { status: 200 }));

/** A UpdateUi that records every call and answers the update prompt with `choice`. */
function fakeUi(choice: UpdateChoice = 'later', hold?: Promise<void>) {
  const calls: { method: string; args: unknown[] }[] = [];
  const ui: UpdateUi = {
    showAvailable: async (info) => {
      calls.push({ method: 'showAvailable', args: [info] });
      await hold;
      return choice;
    },
    showUpToDate: async (current) => {
      calls.push({ method: 'showUpToDate', args: [current] });
    },
    showError: async (message) => {
      calls.push({ method: 'showError', args: [message] });
    },
    openDownload: (url) => {
      calls.push({ method: 'openDownload', args: [url] });
    },
  };
  return { ui, calls };
}

async function setup(
  opts: { fetch?: UpdateCheckerDeps['fetch']; choice?: UpdateChoice; hold?: Promise<void>; current?: string; prefs?: Partial<UpdatePrefs> } = {},
) {
  const prefsFile = path.join(mkdtempSync(path.join(tmpdir(), 'renami-updater-')), 'updates.json');
  if (opts.prefs) await saveUpdatePrefs(prefsFile, { autoCheck: true, skippedVersion: null, lastCheckedAt: null, ...opts.prefs });
  const { ui, calls } = fakeUi(opts.choice, opts.hold);
  const timers: { fn: () => void; ms: number }[] = [];
  const fetch = vi.fn(opts.fetch ?? (() => ok(release())));
  const checker = new UpdateChecker({
    currentVersion: opts.current ?? '0.2.2',
    platform: 'darwin',
    arch: 'arm64',
    isAppImage: false,
    feedUrl: 'https://api.github.com/repos/AesonFord/Renami/releases/latest',
    fetch,
    prefsFile,
    ui,
    now: () => NOW,
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
      return {};
    },
  });
  await checker.init();
  return { checker, calls, fetch, timers, prefs: () => loadUpdatePrefs(prefsFile) };
}

describe('UpdateChecker', () => {
  // Failed checks warn on the console by design; keep the test output clean.
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('offers a newer release and opens the platform download', async () => {
    const { checker, calls, prefs } = await setup({ choice: 'download' });
    await checker.checkNow(false);
    expect(calls).toEqual([
      { method: 'showAvailable', args: [{ current: '0.2.2', latest: '0.3.0', notes: notesExcerpt(BODY) }] },
      { method: 'openDownload', args: [MAC_ARM_URL] },
    ]);
    expect((await prefs()).lastCheckedAt).toBe(NOW);
  });

  it('sends the GitHub headers and a timeout signal', async () => {
    const { checker, fetch } = await setup();
    await checker.checkNow(true);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.github.com/repos/AesonFord/Renami/releases/latest');
    expect(init.headers).toEqual({ Accept: 'application/vnd.github+json', 'User-Agent': 'Renami/0.2.2' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('skip remembers the version and the auto check stays quiet about it', async () => {
    let tag = 'v0.3.0';
    const { checker, calls, prefs } = await setup({ choice: 'skip', fetch: () => ok(release(tag)) });
    await checker.checkNow(false);
    expect((await prefs()).skippedVersion).toBe('0.3.0');
    calls.length = 0;
    await checker.checkNow(false);
    expect(calls).toEqual([]);
    await checker.checkNow(true);
    expect(calls.map((c) => c.method)).toEqual(['showAvailable']);
    calls.length = 0;
    tag = 'v0.3.1';
    await checker.checkNow(false);
    expect(calls.map((c) => c.method)).toEqual(['showAvailable']);
  });

  it('later changes nothing but the check time', async () => {
    const { checker, calls, prefs } = await setup({ choice: 'later' });
    await checker.checkNow(false);
    expect(calls.map((c) => c.method)).toEqual(['showAvailable']);
    expect(await prefs()).toEqual({ autoCheck: true, skippedVersion: null, lastCheckedAt: NOW });
  });

  it('manual check that is up to date says so; the auto check says nothing', async () => {
    const { checker, calls } = await setup({ fetch: () => ok(release('v0.2.2')) });
    await checker.checkNow(true);
    expect(calls).toEqual([{ method: 'showUpToDate', args: ['0.2.2'] }]);
    calls.length = 0;
    await checker.checkNow(false);
    expect(calls).toEqual([]);
  });

  it('newer local version is up to date', async () => {
    const { checker, calls } = await setup({ current: '0.4.0' });
    await checker.checkNow(true);
    expect(calls).toEqual([{ method: 'showUpToDate', args: ['0.4.0'] }]);
  });

  it('no releases yet is up to date', async () => {
    const { checker, calls } = await setup({ fetch: () => Promise.resolve(new Response('{}', { status: 404 })) });
    await checker.checkNow(true);
    expect(calls).toEqual([{ method: 'showUpToDate', args: ['0.2.2'] }]);
  });

  const failures: [string, UpdateCheckerDeps['fetch'], string][] = [
    ['offline', () => Promise.reject(new TypeError('fetch failed')), "Can't reach GitHub. Check your connection and try again."],
    [
      'a timeout',
      () => Promise.reject(new DOMException('The operation timed out.', 'TimeoutError')),
      'GitHub took too long to answer. Try again later.',
    ],
    ['403', () => Promise.resolve(new Response('', { status: 403 })), 'GitHub is limiting requests right now. Try again in an hour.'],
    ['429', () => Promise.resolve(new Response('', { status: 429 })), 'GitHub is limiting requests right now. Try again in an hour.'],
    ['500', () => Promise.resolve(new Response('', { status: 500 })), 'GitHub answered with an error (500). Try again later.'],
    ['a non-release body', () => ok({ tag_name: 'latest' }), "GitHub's answer didn't look like a Renami release."],
    ['a non-JSON body', () => Promise.resolve(new Response('<html>', { status: 200 })), "GitHub's answer didn't look like a Renami release."],
  ];

  it.each(failures)('manual check that fails reports it (%s)', async (_name, fetch, message) => {
    const { checker, calls } = await setup({ fetch });
    await checker.checkNow(true);
    expect(calls).toEqual([{ method: 'showError', args: [message] }]);
  });

  it.each(failures)('auto check that fails stays silent (%s)', async (_name, fetch) => {
    const { checker, calls, prefs } = await setup({ fetch });
    await expect(checker.checkNow(false)).resolves.toBeUndefined();
    expect(calls).toEqual([]);
    expect((await prefs()).lastCheckedAt).toBeNull();
  });

  it('concurrent checks share one request', async () => {
    let answer!: (r: Response) => void;
    const { checker, calls, fetch } = await setup({ fetch: () => new Promise((resolve) => (answer = resolve)) });
    const both = Promise.all([checker.checkNow(false), checker.checkNow(true)]);
    answer(new Response(JSON.stringify(release()), { status: 200 }));
    await both;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(calls.map((c) => c.method)).toEqual(['showAvailable']);
  });

  it.each([
    ['up to date', () => ok(release('v0.2.2')), 'showUpToDate'],
    ['failing', () => Promise.resolve(new Response('', { status: 500 })), 'showError'],
  ] as const)('a manual check during an auto check still answers when %s', async (_name, answerWith, method) => {
    let answer!: () => void;
    const gate = new Promise<void>((resolve) => (answer = resolve));
    const { checker, calls, fetch } = await setup({ fetch: () => gate.then(answerWith) });
    const both = Promise.all([checker.checkNow(false), checker.checkNow(true)]);
    answer();
    await both;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(calls.map((c) => c.method)).toEqual([method]);
  });

  it('a manual check while an update dialog is open sends no request', async () => {
    let close!: () => void;
    const hold = new Promise<void>((resolve) => (close = resolve));
    const { checker, calls, fetch } = await setup({ hold });
    const auto = checker.checkNow(false);
    await vi.waitFor(() => expect(calls.map((c) => c.method)).toEqual(['showAvailable']));
    await checker.checkNow(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    close();
    await auto;
    expect(calls.map((c) => c.method)).toEqual(['showAvailable']);
  });

  it('two manual checks make one request and one dialog', async () => {
    const { checker, calls, fetch } = await setup({ fetch: () => ok(release('v0.2.2')) });
    await Promise.all([checker.checkNow(true), checker.checkNow(true)]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(calls.map((c) => c.method)).toEqual(['showUpToDate']);
  });

  it('startAuto does nothing when the automatic check is off', async () => {
    const { checker, timers } = await setup({ prefs: { autoCheck: false } });
    expect(checker.autoCheck).toBe(false);
    checker.startAuto(10_000);
    expect(timers).toEqual([]);
  });

  it('startAuto waits out the 24 h throttle', async () => {
    const hourAgo = NOW - 3_600_000;
    const { checker, timers, fetch } = await setup({ prefs: { lastCheckedAt: hourAgo } });
    checker.startAuto(10_000);
    expect(timers.map((t) => t.ms)).toEqual([10_000]);
    await timers[0]!.fn();
    expect(fetch).not.toHaveBeenCalled();
    expect(timers[1]?.ms).toBe(AUTO_CHECK_INTERVAL_MS - 3_600_000);
  });

  it('startAuto checks when due, then again a day later', async () => {
    const { checker, timers, fetch } = await setup();
    checker.startAuto(10_000);
    await timers[0]!.fn();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(timers[1]?.ms).toBe(AUTO_CHECK_INTERVAL_MS);
  });

  it('turning the automatic check off saves it and cancels a pending check', async () => {
    const { checker, timers, fetch, prefs } = await setup();
    checker.startAuto(10_000);
    await checker.setAutoCheck(false);
    expect((await prefs()).autoCheck).toBe(false);
    await timers[0]!.fn();
    expect(fetch).not.toHaveBeenCalled();
    expect(timers).toHaveLength(1);
  });

  it('turning it back on schedules a check once auto checking has started', async () => {
    const { checker, timers, fetch } = await setup({ prefs: { autoCheck: false } });
    checker.startAuto(10_000);
    await checker.setAutoCheck(true);
    expect(checker.autoCheck).toBe(true);
    expect(timers).toHaveLength(1);
    await timers[0]!.fn();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
