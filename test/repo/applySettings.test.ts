import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../..', import.meta.url));
const script = join(root, 'scripts', 'apply-repo-settings.sh');

// Stands in for gh. It logs every call, answers the two reads the tests steer (visibility, and
// the id of an existing `main` ruleset), lets every write (-X) succeed, and fails every other read,
// which the script reports as a difference.
const stub = `#!/usr/bin/env bash
echo "$*" >> "$GH_LOG"
case "$*" in
  *"-X "*) exit 0 ;;
  "api repos/o/r --jq .visibility") echo "$STUB_VISIBILITY" ;;
  "api repos/o/r/rulesets --jq"*'"main"'*) echo "\${STUB_MAIN_ID:-}" ;;
  "api repos/o/r/rulesets --jq"*) echo "" ;;
  "api repos/o/r/rulesets/42") [ -n "\${STUB_MAIN_LIVE:-}" ] && cat "$STUB_MAIN_LIVE" || exit 1 ;;
  *) exit 1 ;;
esac
`;

// On Windows, `bash` may resolve to WSL, which can't see the stub. CI runs this on macOS and Linux.
describe.skipIf(process.platform === 'win32')('apply-repo-settings.sh', () => {
  let dir: string;
  let log: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'renami-gh-'));
    log = join(dir, 'calls.log');
    writeFileSync(log, '');
    writeFileSync(join(dir, 'gh'), stub);
    chmodSync(join(dir, 'gh'), 0o755);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function run(args: string[], env: Record<string, string>) {
    const result = spawnSync('bash', [script, '--repo', 'o/r', ...args], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, GH_LOG: log, ...env },
    });
    const calls = readFileSync(log, 'utf8').split('\n').filter(Boolean);
    return { ...result, calls, writes: calls.filter((c) => c.includes('-X ')) };
  }

  it('refuses a private repo before writing anything', () => {
    const r = run([], { STUB_VISIBILITY: 'private' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('o/r is private');
    expect(r.calls).toEqual(['api repos/o/r --jq .visibility']);
  });

  it('only reads in --check mode, and reports each difference', () => {
    const r = run(['--check'], { STUB_VISIBILITY: 'public', STUB_MAIN_ID: '42' });
    expect(r.status).toBe(1);
    expect(r.writes).toEqual([]);
    expect(r.stdout).toContain('differs: private vulnerability reporting is missing, want true');
    expect(r.stdout).toContain('differs: ruleset main is different');
    expect(r.stdout).toContain('differs: ruleset release-tags is missing, want present');
  });

  it('updates an existing ruleset in place and creates a missing one', () => {
    const r = run([], { STUB_VISIBILITY: 'public', STUB_MAIN_ID: '42' });
    const rulesetWrites = r.writes.filter((c) => c.includes('/rulesets'));
    expect(rulesetWrites).toEqual([
      `api -X PUT repos/o/r/rulesets/42 --input ${join(root, '.github', 'rulesets', 'main.json')}`,
      `api -X POST repos/o/r/rulesets --input ${join(root, '.github', 'rulesets', 'release-tags.json')}`,
    ]);
    expect(r.writes).toContain('api -X PUT repos/o/r/actions/permissions/workflow -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false');
    expect(r.writes).toContain('api -X PUT repos/o/r/actions/permissions/fork-pr-contributor-approval -f approval_policy=first_time_contributors');
  });

  // GitHub returns the ruleset with defaults filled in, so a live copy is the file plus extras.
  function liveMain(edit: (rules: { type: string; parameters?: Record<string, unknown> }[]) => void) {
    const live = JSON.parse(readFileSync(join(root, '.github', 'rulesets', 'main.json'), 'utf8'));
    live.id = 42;
    live.source = 'o/r';
    const pr = live.rules.find((r: { type: string }) => r.type === 'pull_request');
    pr.parameters.required_reviewers = [];
    edit(live.rules);
    const file = join(dir, 'live-main.json');
    writeFileSync(file, JSON.stringify(live));
    return file;
  }
  const params = (rules: { type: string; parameters?: Record<string, unknown> }[], type: string) =>
    rules.find((r) => r.type === type)!.parameters!;

  it('accepts a live ruleset that only adds GitHub defaults', () => {
    const r = run(['--check'], { STUB_VISIBILITY: 'public', STUB_MAIN_ID: '42', STUB_MAIN_LIVE: liveMain(() => {}) });
    expect(r.stdout).not.toContain('ruleset main');
  });

  it('reports a live ruleset that allows extra merge methods', () => {
    const live = liveMain((rules) => {
      params(rules, 'pull_request').allowed_merge_methods = ['merge', 'squash', 'rebase'];
    });
    const r = run(['--check'], { STUB_VISIBILITY: 'public', STUB_MAIN_ID: '42', STUB_MAIN_LIVE: live });
    expect(r.stdout).toContain('differs: ruleset main is different');
  });

  it('reports a live ruleset with a looser CodeQL threshold', () => {
    const live = liveMain((rules) => {
      const tools = params(rules, 'code_scanning').code_scanning_tools as { alerts_threshold: string }[];
      tools[0].alerts_threshold = 'errors_and_warnings';
    });
    const r = run(['--check'], { STUB_VISIBILITY: 'public', STUB_MAIN_ID: '42', STUB_MAIN_LIVE: live });
    expect(r.stdout).toContain('differs: ruleset main is different');
  });

  it('says it needs jq when jq is missing', () => {
    // Only the stub directory on PATH: no jq, and no gh either, so it must stop before calling one.
    const result = spawnSync('/bin/bash', [script, '--repo', 'o/r'], {
      encoding: 'utf8',
      env: { PATH: dir, GH_LOG: log, STUB_VISIBILITY: 'public' },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('needs jq');
    expect(readFileSync(log, 'utf8')).toBe('');
  });

  it('rejects an unknown option', () => {
    const r = run(['--force'], { STUB_VISIBILITY: 'public' });
    expect(r.status).toBe(2);
    expect(r.calls).toEqual([]);
  });
});
