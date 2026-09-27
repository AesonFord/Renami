// Copies a platform's installers from dist/ into installers/ for upload, and fails naming any that
// electron-builder didn't produce. Blockmaps, latest*.yml and unpacked folders stay behind.
// Usage: node scripts/collect-installers.mjs <mac|win|linux>
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { installerNames } from './release-config.mjs';

const names = installerNames(process.argv[2]);
const missing = names.filter((name) => !existsSync(`dist/${name}`));
if (missing.length > 0) {
  console.error(`::error::electron-builder did not produce ${missing.join(', ')}. dist/ holds: ${readdirSync('dist').join(', ')}`);
  process.exit(1);
}

mkdirSync('installers', { recursive: true });
for (const name of names) {
  copyFileSync(`dist/${name}`, `installers/${name}`);
  console.log(`installers/${name}`);
}
