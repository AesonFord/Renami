import { MetadataReader, type Platform } from '../core/index.js';
import { parseCommand, UsageError } from './args.js';
import { EXIT } from './exit.js';
import { systemLaunchDeps } from './launch.js';
import { runCommand } from './run.js';

/** scripts/build-cli.mjs replaces this with the version from package.json. */
const VERSION = process.env.RENAMI_CLI_VERSION ?? '0.0.0-dev';

async function main(): Promise<number> {
  const controller = new AbortController();
  process.on('SIGINT', () => {
    if (controller.signal.aborted) process.exit(130);
    process.stderr.write('\nrenami: stopping; press Ctrl-C again to quit at once\n');
    controller.abort();
  });

  let command;
  try {
    command = await parseCommand(process.argv.slice(2), process.cwd());
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    process.stderr.write(`renami: ${e.message}\nRun "renami --help" for usage.\n`);
    return EXIT.usage;
  }

  const tty = process.stderr.isTTY;
  return runCommand(command, {
    stdout: process.stdout,
    stderr: process.stderr,
    signal: controller.signal,
    cwd: process.cwd(),
    platform: process.platform as Platform,
    version: VERSION,
    createReader: () => new MetadataReader(),
    launch: systemLaunchDeps(),
    progress: tty ? (text) => process.stderr.write(text === null ? '\r\x1b[K' : `\r${text}\x1b[K`) : undefined,
  });
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    process.stderr.write(`renami: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = EXIT.failed;
  },
);
