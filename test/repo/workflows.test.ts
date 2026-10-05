import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Security rules for every workflow. GitHub enforces
// SHA pinning itself only once the repo is public and scripts/apply-repo-settings.sh has run;
// this catches a slip before then, and in every workflow added later.
const root = fileURLToPath(new URL('../..', import.meta.url));
const dir = join(root, '.github', 'workflows');
// Windows runners check out with CRLF line endings.
const read = (file: string) => readFileSync(join(dir, file), 'utf8').replace(/\r\n/g, '\n');
const workflows = readdirSync(dir)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((file) => ({ file, text: read(file) }));

it('finds the workflows', () => {
  expect(workflows.map((w) => w.file)).toContain('ci.yml');
});

describe.each(workflows)('$file', ({ text }) => {
  it('pins every action to a full commit SHA with its version in a comment', () => {
    const uses = [...text.matchAll(/^\s*(?:-\s+)?uses:\s*(.+)$/gm)].map((m) => m[1].trim());
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d\S*$/);
  });

  it('sets permissions at the top level', () => {
    expect(text).toMatch(/^permissions:/m);
  });

  it('never runs fork code with write access through pull_request_target', () => {
    expect(text).not.toContain('pull_request_target');
  });

  it('keeps checkout from saving the token in .git/config', () => {
    const steps = text.split(/^\s*- /m).filter((s) => /^\s*uses:\s*actions\/checkout@/m.test(s));
    if (text.includes('actions/checkout')) expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) expect(step).toMatch(/persist-credentials:\s*false/);
  });
});

// Code scanning and the dependency graph aren't available on a private repo on the free plan.
// Until Renami is public these jobs must skip, not fail every PR.
describe.each(['codeql.yml', 'dependency-review.yml'])('%s while the repo is private', (file) => {
  it('skips instead of failing', () => {
    expect(read(file)).toMatch(/^\s+if: github\.event\.repository\.visibility == 'public'/m);
  });
});

// Right after going public, main has no CodeQL analysis until something runs it. The first PR's
// code_scanning rule needs one to compare against, so CodeQL must be runnable by hand then.
it('lets CodeQL be run by hand on main', () => {
  const text = read('codeql.yml');
  expect(text).toMatch(/^ {2}workflow_dispatch:/m);
  expect(text).toMatch(/^\s+if: .*github\.event_name == 'workflow_dispatch'/m);
});

/** One job's text: from "  <name>:" up to the next job, or the end of the file. */
function job(text: string, name: string): string {
  const start = text.search(new RegExp(`^  ${name}:\\s*$`, 'm'));
  expect(start, `job ${name}`).toBeGreaterThanOrEqual(0);
  const rest = text.slice(start + 1);
  const next = rest.search(/^ {2}[\w-]+:\s*$/m);
  return next === -1 ? text.slice(start) : text.slice(start, start + 1 + next);
}

describe('publishing the command line to npm', () => {
  const release = read('release.yml');
  const publishStep = job(release, 'release')
    .split(/^\s+- /m)
    .find((s) => s.includes('npm publish')) ?? '';

  it('happens only in the release job of release.yml', () => {
    for (const { file, text } of workflows) {
      expect((text.match(/npm publish/g) ?? []).length, file).toBe(file === 'release.yml' ? 1 : 0);
    }
    expect(publishStep).not.toBe('');
  });

  it('publishes with provenance and never runs package scripts', () => {
    expect(publishStep).toContain('--provenance');
    expect(publishStep).toContain('--ignore-scripts');
  });

  it('only publishes when the NPM_PUBLISH variable is set', () => {
    expect(publishStep).toMatch(/if: vars\.NPM_PUBLISH == 'true'/);
  });

  it('publishes before the GitHub release goes public', () => {
    const steps = job(release, 'release');
    expect(steps.indexOf('npm publish')).toBeGreaterThan(-1);
    expect(steps.indexOf('npm publish')).toBeLessThan(steps.indexOf('--draft=false'));
  });

  it('gives the job that runs npm ci for the CLI no OIDC token', () => {
    expect(job(release, 'cli')).not.toContain('id-token');
    expect(job(release, 'release')).toMatch(/needs: \[build, cli\]/);
  });
});
