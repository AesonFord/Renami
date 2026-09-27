import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function listTs(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return listTs(p);
    return p.endsWith('.ts') ? [p] : [];
  });
}

describe('core boundary', () => {
  it('has at least one source file', () => {
    expect(listTs('src/core').length).toBeGreaterThan(0);
  });

  it('never imports electron or react', () => {
    const offenders = listTs('src/core').filter((file) =>
      /from\s+['"](electron|react)(\/[^'"]*)?['"]|require\(\s*['"](electron|react)/.test(
        readFileSync(file, 'utf8'),
      ),
    );
    expect(offenders).toEqual([]);
  });
});
