// What a release build must produce, read from the electron-builder configs so the workflow, the
// release checks and the tests never keep their own copy. Regular expressions rather than a YAML
// parser keep this dependency-free; the configs are flat enough for that.
import { readFileSync } from 'node:fs';

export const PLATFORMS = /** @type {const} */ (['mac', 'win', 'linux']);

const readBase = () => readFileSync('electron-builder.yml', 'utf8');

/** The indented body of a top-level `name:` section. */
function section(yml, name, file) {
  // actions/checkout on windows-latest checks these configs out as CRLF (core.autocrlf=true, no
  // .gitattributes); normalize here, the one place every caller's text passes through, so a bare
  // \n match still finds the section whichever line ending the file came in with.
  const text = yml.replace(/\r\n/g, '\n');
  // A section's body is its indented lines, plus any blank line or column-0 comment inside it; it
  // still ends at the next top-level (unindented, non-comment) `key:` line.
  const match = text.match(new RegExp(`^${name}:\\n((?:[ \\t]+.*\\n?|[ \\t]*\\n|#.*\\n?)*)`, 'm'));
  if (!match?.[1]) throw new Error(`${file} has no ${name}: section`);
  return match[1];
}

/** A top-level `key: value`, or a key inside a section's body. */
function value(text, key) {
  return text.match(new RegExp(`^\\s*${key}:\\s*"?([^"\\n]+?)"?\\s*$`, 'm'))?.[1];
}

function artifactName(yml, name) {
  const pattern = value(section(yml, name, 'electron-builder.yml'), 'artifactName');
  if (!pattern) throw new Error(`electron-builder.yml's ${name}: section sets no artifactName`);
  return pattern;
}

function checkPlatform(platform) {
  if (!PLATFORMS.includes(platform)) throw new Error(`Unknown platform ${platform}; expected mac, win or linux`);
}

/**
 * Installer file names for a platform, in upload order. ${arch} is spelled the way electron-builder
 * spells it per format (builder-util getArtifactArchName): x86_64 for AppImage, amd64 for deb.
 */
export function installerNames(platform, builderYml = readBase()) {
  checkPlatform(platform);
  const productName = value(builderYml, 'productName');
  const expand = (pattern, arch, ext) =>
    pattern.replaceAll('${productName}', productName).replaceAll('${arch}', arch).replaceAll('${ext}', ext);
  if (platform === 'mac') {
    const pattern = artifactName(builderYml, 'mac');
    return [expand(pattern, 'arm64', 'dmg'), expand(pattern, 'x64', 'dmg')];
  }
  if (platform === 'win') return [expand(artifactName(builderYml, 'nsis'), 'x64', 'exe')];
  const pattern = artifactName(builderYml, 'linux');
  return [expand(pattern, 'x86_64', 'AppImage'), expand(pattern, 'amd64', 'deb')];
}

/**
 * The unpacked apps `npm run dist` leaves in dist/. `app` is what @electron/fuses reads, `exe` is
 * what to launch, and `arch` uses process.arch's spelling so a runner can pick its own.
 */
export function unpackedApps(platform, builderYml = readBase()) {
  checkPlatform(platform);
  const productName = value(builderYml, 'productName');
  if (platform === 'mac') {
    return [
      ['arm64', 'dist/mac-arm64'],
      ['x64', 'dist/mac'],
    ].map(([arch, dir]) => {
      const app = `${dir}/${productName}.app`;
      return { arch, app, exe: `${app}/Contents/MacOS/${productName}` };
    });
  }
  if (platform === 'win') {
    const exe = `dist/win-unpacked/${productName}.exe`;
    return [{ arch: 'x64', app: exe, exe }];
  }
  const executableName = value(section(builderYml, 'linux', 'electron-builder.yml'), 'executableName') ?? productName;
  const exe = `dist/linux-unpacked/${executableName}`;
  return [{ arch: 'x64', app: exe, exe }];
}

/**
 * The fuses electron-builder.release.yml sets, keyed by @electron/fuses' FuseV1Options names.
 * Throws rather than returning {} so a moved or emptied section can't make the check vacuous.
 */
export function releaseFuses(releaseYml = readFileSync('electron-builder.release.yml', 'utf8')) {
  const body = section(releaseYml, 'electronFuses', 'electron-builder.release.yml');
  const fuses = {};
  for (const [, key, setting] of body.matchAll(/^\s+(\w+):\s*(true|false)\s*$/gm)) {
    // Not a fuse: it tells electron-builder to re-seal the ad-hoc macOS signature afterwards.
    if (key === 'resetAdHocDarwinSignature') continue;
    fuses[key[0].toUpperCase() + key.slice(1)] = setting === 'true';
  }
  if (Object.keys(fuses).length === 0) throw new Error('electron-builder.release.yml sets no fuses under electronFuses:');
  return fuses;
}

/**
 * One message per fuse whose state in `wire` differs from `expected`. The caller passes
 * @electron/fuses' FuseV1Options and FuseState, so this module stays dependency-free.
 */
export function fuseMismatches(wire, expected, { FuseV1Options, FuseState }) {
  const states = {
    [FuseState.DISABLE]: 'disabled',
    [FuseState.ENABLE]: 'enabled',
    [FuseState.REMOVED]: 'removed',
    [FuseState.INHERIT]: 'inherited',
  };
  const problems = [];
  for (const [name, enabled] of Object.entries(expected)) {
    const want = enabled ? 'enabled' : 'disabled';
    const index = FuseV1Options[name];
    if (index === undefined) {
      problems.push(`${name} is not a fuse @electron/fuses knows`);
    } else if (wire[index] === undefined) {
      problems.push(`${name} is missing from this Electron binary, expected ${want}`);
    } else if (states[wire[index]] !== want) {
      problems.push(`${name} is ${states[wire[index]] ?? `byte ${wire[index]}`}, expected ${want}`);
    }
  }
  return problems;
}
