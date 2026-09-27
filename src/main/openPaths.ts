import path from 'node:path';

/**
 * Paths the OS hands the app (a folder dropped on the dock icon, "Open with", a second launch
 * with arguments). Until the page asks for them with take(), they wait here; after that they
 * go straight to the page as events.
 */
export class OpenPaths {
  private queue: string[] = [];
  private ready = false;

  constructor(private readonly send: (paths: string[]) => void) {}

  add(paths: readonly string[]): void {
    if (paths.length === 0) return;
    if (this.ready) this.send([...paths]);
    else this.queue.push(...paths);
  }

  /** Hands over everything queued so far and switches to sending events. */
  take(): string[] {
    this.ready = true;
    const queued = this.queue;
    this.queue = [];
    return queued;
  }
}

/**
 * The file and folder arguments in a command line: everything after the executable (and, when
 * not packaged, the script), except flags. Relative paths are resolved against cwd.
 */
export function pathsFromArgv(argv: readonly string[], packaged: boolean, cwd: string): string[] {
  return argv
    .slice(packaged ? 1 : 2)
    .filter((arg) => !arg.startsWith('-'))
    .map((arg) => path.resolve(cwd, arg));
}
