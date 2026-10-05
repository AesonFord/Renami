// Runs the built CLI the way an npm install would: plain Node, outside Vitest.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const cli = 'out/cli/renami.mjs';
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
const fail = (text, result) => {
  console.error(`smoke-cli: ${text}\n--- stdout\n${result.stdout}\n--- stderr\n${result.stderr}`);
  process.exit(1);
};

const v = run('--version');
if (v.status !== 0 || v.stdout.trim() !== version) fail(`--version printed "${v.stdout.trim()}", expected ${version}`, v);

const r = run('rename', 'test/fixtures/media', '--json');
if (r.status !== 0) fail(`rename exited ${r.status}`, r);
const out = JSON.parse(r.stdout);
if (!Array.isArray(out.plan) || out.plan.length === 0) fail('rename --json listed no files', r);
console.log(`smoke-cli: renami ${version} planned ${out.plan.length} files`);
