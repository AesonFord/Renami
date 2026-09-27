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
    const steps = text.split(/^\s*- /m).filter((s) => /^uses:\s*actions\/checkout@/.test(s));
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
