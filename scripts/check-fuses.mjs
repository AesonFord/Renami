// Fails unless every unpacked app `npm run dist` built for a platform has the fuses that
// electron-builder.release.yml sets. Guards against shipping from the base config by mistake.
// Usage: node scripts/check-fuses.mjs <mac|win|linux>
import { FuseState, FuseV1Options, getCurrentFuseWire } from '@electron/fuses';
import { fuseMismatches, releaseFuses, unpackedApps } from './release-config.mjs';

const platform = process.argv[2];
const expected = releaseFuses();
let failed = false;

for (const { arch, app } of unpackedApps(platform)) {
  try {
    const problems = fuseMismatches(await getCurrentFuseWire(app), expected, { FuseV1Options, FuseState });
    for (const problem of problems) console.error(`::error::${app} (${arch}): ${problem}`);
    if (problems.length === 0) console.log(`${app} (${arch}): all ${Object.keys(expected).length} release fuses set`);
    failed ||= problems.length > 0;
  } catch (error) {
    console.error(`::error::${app} (${arch}): ${error.message}`);
    failed = true;
  }
}

if (failed) process.exit(1);
