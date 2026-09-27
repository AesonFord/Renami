// Starts the release build for this machine's arch and fails if it quits, or writes to renami.log,
// within SMOKE_MS. That catches what the release fuses can break at startup: an asar integrity
// mismatch, or an app that loads from outside the asar. It can't see inside the window: release
// builds refuse --inspect, which is how the e2e tests drive the app.
// Usage: node scripts/smoke-launch.mjs <mac|win|linux>   (on Linux, run it under xvfb-run -a)
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { unpackedApps } from './release-config.mjs';

const SMOKE_MS = 15_000;
const QUIT_MS = 10_000;
const platform = process.argv[2];
const target = unpackedApps(platform).find((app) => app.arch === process.arch);
if (!target) {
  console.error(`::error::No ${platform} build for this machine's arch (${process.arch})`);
  process.exit(1);
}

// A throwaway profile, so the check never touches real presets and every log line is from this run.
const userData = mkdtempSync(path.join(tmpdir(), 'renami-smoke-'));
const child = spawn(target.exe, [], {
  env: { ...process.env, RENAMI_USER_DATA_DIR: userData },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (chunk) => (output += chunk));
child.stderr.on('data', (chunk) => (output += chunk));
const exited = new Promise((resolve) => {
  child.on('exit', (code, signal) => resolve(`quit within ${SMOKE_MS / 1000} s (code ${code}, signal ${signal})`));
  child.on('error', (error) => resolve(`could not start: ${error.message}`));
});

const quit = await Promise.race([exited, delay(SMOKE_MS).then(() => null)]);
let stuck;
if (!quit) {
  child.kill();
  // A hung or unresponsive app must not hang the check (and the CI step running it) forever.
  const stopped = await Promise.race([exited, delay(QUIT_MS).then(() => null)]);
  if (!stopped) {
    child.kill('SIGKILL');
    await exited;
    stuck = `did not quit within ${QUIT_MS / 1000} s of being asked to; killed it`;
  }
}

const logFile = path.join(userData, 'renami.log');
const log = existsSync(logFile) ? readFileSync(logFile, 'utf8').trim() : '';
// Windows holds the folder briefly after the process exits; if a Chromium helper still holds it
// past the retries, leave it for the ephemeral runner to discard rather than fail the check over it.
try {
  rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
} catch {
  // ignored, see above
}

const problems = [quit, stuck, log && `wrote to renami.log:\n${log}`].filter(Boolean);
if (problems.length > 0) {
  console.error(`::error::${target.exe}: ${problems.join('; ')}`);
  if (output.trim()) console.error(output.trim());
  process.exit(1);
}
console.log(`${target.exe} ran for ${SMOKE_MS / 1000} s with a clean log`);
