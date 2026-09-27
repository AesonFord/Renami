import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../..', import.meta.url));
const read = (...parts: string[]) =>
  readFileSync(join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');

interface Ruleset {
  name: string;
  enforcement: string;
  bypass_actors: unknown[];
  conditions: { ref_name: { include: string[] } };
  rules: {
    type: string;
    parameters?: { required_status_checks?: { context: string; integration_id?: number }[] };
  }[];
}
const ruleset = (name: string): Ruleset => JSON.parse(read('.github', 'rulesets', `${name}.json`));

/**
 * The check names GitHub reports for a workflow's jobs: the job id, or `id (value)` for each value
 * of a matrix with one key and an inline list, such as `os: [a, b]`. A job whose names it can't
 * work out (its own `name:`, `include:`, several keys, a block list) gives no names, so a required
 * check on it fails instead of passing under a name GitHub never reports.
 */
function checkNames(workflow: string): string[] {
  const jobs = workflow.split(/^jobs:\s*$/m)[1] ?? '';
  return jobs.split(/^(?= {2}[\w-]+:\s*$)/m).flatMap((block) => {
    const id = block.match(/^ {2}([\w-]+):\s*$/m)?.[1];
    if (!id) return [];
    if (/^ {4}name:/m.test(block)) return [];
    const lines = block.split('\n');
    const at = lines.findIndex((l) => /^\s+matrix:\s*$/.test(l));
    if (at === -1) return [id];
    // The matrix is the lines after `matrix:` that are indented deeper than it.
    const indent = lines[at].search(/\S/);
    const after = lines.slice(at + 1);
    const end = after.findIndex((l) => l.trim() !== '' && l.search(/\S/) <= indent);
    const keys = (end === -1 ? after : after.slice(0, end)).filter(
      (l) => l.search(/\S/) === indent + 2 && !l.trim().startsWith('#'),
    );
    const list = keys.length === 1 ? keys[0].match(/^\s+[\w-]+:\s*\[(.+)\]\s*$/) : null;
    if (!list) return [];
    return list[1].split(',').map((v) => `${id} (${v.trim().replace(/^['"]|['"]$/g, '')})`);
  });
}

const workflowDir = join(root, '.github', 'workflows');
const allChecks = readdirSync(workflowDir)
  .filter((f) => /\.ya?ml$/.test(f))
  .flatMap((f) => checkNames(read('.github', 'workflows', f)));

describe.each(['main', 'release-tags'])('the %s ruleset', (name) => {
  it('is named for its file, active, and has no bypass actors', () => {
    const r = ruleset(name);
    expect(r.name).toBe(name);
    expect(r.enforcement).toBe('active');
    expect(r.bypass_actors).toEqual([]);
  });
});

describe('the main ruleset', () => {
  const required = ruleset('main')
    .rules.filter((r) => r.type === 'required_status_checks')
    .flatMap((r) => r.parameters?.required_status_checks ?? [])
    .map((c) => c.context);

  it('requires the three CI jobs and dependency review', () => {
    expect(required).toEqual([
      'test (macos-latest)',
      'test (windows-latest)',
      'test (ubuntu-latest)',
      'dependency-review',
    ]);
  });

  // Without an app id, any app or commit status posting the same name would satisfy the check.
  it('only accepts these checks from GitHub Actions', () => {
    const checks = ruleset('main').rules.flatMap((r) => r.parameters?.required_status_checks ?? []);
    expect(checks.map((c) => c.integration_id)).toEqual([15368, 15368, 15368, 15368]);
  });

  // A required check that no job reports leaves every PR waiting forever.
  it('only requires checks that a workflow job reports', () => {
    for (const context of required) expect(allChecks).toContain(context);
  });
});

describe('the release-tags ruleset', () => {
  it('keeps v* tags from being deleted or moved', () => {
    const r = ruleset('release-tags');
    expect(r.conditions.ref_name.include).toEqual(['refs/tags/v*']);
    expect(r.rules.map((rule) => rule.type).sort()).toEqual(['deletion', 'update']);
  });
});

describe('checkNames', () => {
  it('expands a one-key matrix and keeps plain job ids', () => {
    const wf = [
      'jobs:',
      '  test:',
      '    strategy:',
      '      fail-fast: false',
      '      matrix:',
      "        os: [a, 'b']",
      '    steps: []',
      '  lint:',
      '    runs-on: x',
    ].join('\n');
    expect(checkNames(wf)).toEqual(['test (a)', 'test (b)', 'lint']);
  });

  // These jobs report names this parser can't work out. Returning nothing makes a required check
  // on them fail the test above, instead of passing under a name GitHub never reports.
  it('gives no names for a job with its own name', () => {
    const wf = ['jobs:', '  test:', '    name: Tests', '    runs-on: x', '    steps:', '      - name: step'].join('\n');
    expect(checkNames(wf)).toEqual([]);
  });

  it('gives no names for a matrix built with include', () => {
    const wf = ['jobs:', '  build:', '    strategy:', '      matrix:', '        include:', '          - os: a', '    runs-on: x'].join('\n');
    expect(checkNames(wf)).toEqual([]);
  });

  it('reads the matrix only, not a list further down the job', () => {
    const wf = [
      'jobs:',
      '  test:',
      '    strategy:',
      '      matrix:',
      '        os:',
      '          - a',
      '    steps:',
      '      - uses: x',
      '        with:',
      '          files: [one, two]',
    ].join('\n');
    expect(checkNames(wf)).toEqual([]);
  });
});
