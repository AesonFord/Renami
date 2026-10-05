import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cliPackageJson, forbiddenInputs } from '../../scripts/cli-package.mjs';

const app = JSON.parse(readFileSync('package.json', 'utf8'));

describe('cliPackageJson', () => {
  it("publishes @aesonford/renami with the app's version, licence, Node range and ExifTool range", () => {
    const pkg = cliPackageJson(app);
    expect(pkg).toMatchObject({
      name: '@aesonford/renami',
      version: app.version,
      license: app.license,
      type: 'module',
      bin: { renami: 'renami.mjs' },
      files: ['renami.mjs', 'README.md', 'LICENSE'],
      engines: app.engines,
      dependencies: { 'exiftool-vendored': app.dependencies['exiftool-vendored'] },
    });
    expect(Object.keys(pkg.dependencies)).toEqual(['exiftool-vendored']);
  });

  it('refuses an app package.json without exiftool-vendored', () => {
    expect(() => cliPackageJson({ ...app, dependencies: {} })).toThrow('package.json has no exiftool-vendored dependency');
  });
});

describe('forbiddenInputs', () => {
  it('flags app code and bundled node_modules, and allows core and cli', () => {
    expect(
      forbiddenInputs(['src/cli/main.ts', 'src/core/planner.ts', 'src/main/session.ts', 'src/renderer/App.tsx', 'node_modules/heic-decode/index.js']),
    ).toEqual(['src/main/session.ts', 'src/renderer/App.tsx', 'node_modules/heic-decode/index.js']);
  });
});

it('keeps the CLI bundle out of the desktop app', () => {
  expect(readFileSync('electron-builder.yml', 'utf8')).toMatch(/^\s+- "!out\/cli\/\*\*"$/m);
});
