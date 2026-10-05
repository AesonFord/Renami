// Builds the npm package for the renami command line into out/cli.
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { cliPackageJson, forbiddenInputs } from './cli-package.mjs';

const app = JSON.parse(await readFile('package.json', 'utf8'));
await rm('out/cli', { recursive: true, force: true });
await mkdir('out/cli', { recursive: true });

const { metafile } = await build({
  entryPoints: ['src/cli/main.ts'],
  outfile: 'out/cli/renami.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  banner: { js: '#!/usr/bin/env node' },
  // ExifTool is a real program shipped by this package; npm installs it, it can't be bundled.
  external: ['exiftool-vendored'],
  define: { 'process.env.RENAMI_CLI_VERSION': JSON.stringify(app.version) },
  metafile: true,
  logLevel: 'warning',
});

const leaked = forbiddenInputs(Object.keys(metafile.inputs));
if (leaked.length > 0) throw new Error(`The CLI bundle pulled in code it must not ship:\n${leaked.join('\n')}`);

await writeFile('out/cli/package.json', `${JSON.stringify(cliPackageJson(app), null, 2)}\n`);
await copyFile('LICENSE', 'out/cli/LICENSE');
await copyFile('src/cli/README.md', 'out/cli/README.md');
console.log(`Built renami ${app.version} in out/cli`);
