// Pure helpers for scripts/build-cli.mjs, kept separate so tests can import them.

/** The npm package.json for the command line, derived from the app's so they never drift. */
export function cliPackageJson(app) {
  const exiftool = app.dependencies?.['exiftool-vendored'];
  if (!exiftool) throw new Error('package.json has no exiftool-vendored dependency');
  return {
    name: 'renami',
    version: app.version,
    description: 'Rename files in bulk from a pattern, from the command line',
    license: app.license,
    type: 'module',
    bin: { renami: 'renami.mjs' },
    files: ['renami.mjs', 'README.md', 'LICENSE'],
    engines: app.engines,
    repository: { type: 'git', url: 'git+https://github.com/AesonFord/Renami.git' },
    homepage: 'https://github.com/AesonFord/Renami#command-line',
    dependencies: { 'exiftool-vendored': exiftool },
  };
}

/** Bundle inputs the CLI must never ship: the desktop app's own code, or any bundled package. */
export function forbiddenInputs(inputs) {
  return inputs.filter((i) => /^src\/(main|preload|renderer|shared)\//.test(i) || i.includes('node_modules/'));
}
