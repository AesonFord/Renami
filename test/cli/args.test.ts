import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/core/index.js';
import { parseCommand, UsageError } from '../../src/cli/args.js';
import { HELP, tokensText } from '../../src/cli/help.js';

const cwd = path.resolve('/work');
const noFiles = async (file: string): Promise<string> => {
  throw new Error(`ENOENT: no such file, open '${file}'`);
};
const files = (map: Record<string, string>) => async (file: string): Promise<string> => {
  const text = map[file];
  if (text === undefined) throw new Error(`ENOENT: no such file, open '${file}'`);
  return text;
};
const parse = (argv: string[], readText = noFiles) => parseCommand(argv, cwd, readText);
const rename = async (argv: string[], readText = noFiles) => {
  const cmd = await parse(['rename', ...argv], readText);
  if (cmd.kind !== 'rename') throw new Error(`expected rename, got ${cmd.kind}`);
  return cmd;
};

describe('parseCommand: commands', () => {
  it('shows help with no arguments, --help or -h', async () => {
    expect(await parse([])).toEqual({ kind: 'help' });
    expect(await parse(['--help'])).toEqual({ kind: 'help' });
    expect(await parse(['-h'])).toEqual({ kind: 'help' });
    expect(await parse(['rename', '--help'])).toEqual({ kind: 'help' });
  });

  it('prints the version with --version or -v', async () => {
    expect(await parse(['--version'])).toEqual({ kind: 'version' });
    expect(await parse(['-v'])).toEqual({ kind: 'version' });
  });

  it('lists tokens, and refuses extra arguments', async () => {
    expect(await parse(['tokens'])).toEqual({ kind: 'tokens' });
    await expect(parse(['tokens', 'x'])).rejects.toThrow(UsageError);
  });

  it('opens the desktop app for bare paths, resolved against cwd', async () => {
    expect(await parse(['Trip', '/abs/b.jpg'])).toEqual({
      kind: 'open',
      paths: [path.resolve(cwd, 'Trip'), path.resolve('/abs/b.jpg')],
    });
  });

  it('treats a subcommand name as the command; ./rename is a path', async () => {
    expect((await parse(['./rename'])).kind).toBe('open');
    await expect(parse(['rename'])).rejects.toThrow('rename needs at least one file or folder');
  });

  it('refuses any other flag without a command', async () => {
    await expect(parse(['-r', 'Trip'])).rejects.toThrow(/"-r" needs a command/);
    await expect(parse(['Trip', '--apply'])).rejects.toThrow(/"--apply" needs a command/);
  });

  it('parses undo with exactly one journal', async () => {
    expect(await parse(['undo', 'j.json'])).toEqual({ kind: 'undo', journal: path.resolve(cwd, 'j.json') });
    await expect(parse(['undo'])).rejects.toThrow('undo needs exactly one journal file');
    await expect(parse(['undo', 'a', 'b'])).rejects.toThrow('undo needs exactly one journal file');
  });
});

describe('parseCommand: rename', () => {
  it('defaults to a dry run with default settings and absolute paths', async () => {
    const cmd = await rename(['photos']);
    expect(cmd.paths).toEqual([path.resolve(cwd, 'photos')]);
    expect(cmd.settings).toEqual(DEFAULT_SETTINGS);
    expect(cmd.options).toEqual({ apply: false, journal: null, json: false, quiet: false });
  });

  it('maps every flag onto the settings', async () => {
    const cmd = await rename([
      'p', '-p', 'Trip_{seq}', '--sort', 'name', '--desc', '--start', '0', '--step', '2', '--digits', '4',
      '--restart', 'day', '--restart-per-folder', '--replace', 'IMG_=', '--replace', 'a=b=c', '--regex', '--match-case',
      '--case', 'kebab', '--spaces-to-underscores', '--ascii', '--strip-accents', '--ext', '.JPEG=jpg',
      '--dest', 'out', '--shift=-90', '--use-name-date', '--set-modified', '--set-created',
      '-r', '--only-ext', 'JPG, heic', '--folders', '--name', 'IMG',
      '--apply', '--journal', 'undo.json', '--json', '-q',
    ]);
    const s = cmd.settings;
    expect(s.pattern).toBe('Trip_{seq}');
    expect(s.sequence).toMatchObject({ sortBy: 'name', direction: 'desc', start: 0, step: 2, digits: 4, restartEvery: 'day', restartPerFolder: true });
    expect(s.findReplace).toEqual([
      { find: 'IMG_', replace: '', regex: true, matchCase: true },
      { find: 'a', replace: 'b=c', regex: true, matchCase: true },
    ]);
    expect(s.cleanup).toMatchObject({ caseMode: 'kebab', spacesToUnderscores: true, asciiOnly: true, stripDiacritics: true, extensionRules: [{ from: 'jpeg', to: 'jpg' }] });
    expect(s.move.destinationRoot).toBe(path.resolve(cwd, 'out'));
    expect(s.dates).toEqual({ setModified: true, setCreated: true, shiftMinutes: -90, useNameDate: true });
    expect(s.filter).toMatchObject({ includeSubfolders: true, extensions: ['jpg', 'heic'], mode: 'folders', name: { text: 'IMG', regex: false } });
    expect(cmd.options).toEqual({ apply: true, journal: path.resolve(cwd, 'undo.json'), json: true, quiet: true });
  });

  it('reads a settings file, then lets flags override it', async () => {
    const file = path.resolve(cwd, 's.json');
    const text = JSON.stringify({
      pattern: '{name}_file',
      sequence: { digits: 5 },
      findReplace: [{ find: 'x', replace: 'y', regex: false, matchCase: false }],
      filter: { includeSubfolders: true },
    });
    const cmd = await rename(['p', '--settings', 's.json', '-p', '{name}_flag', '--replace', 'a=b'], files({ [file]: text }));
    expect(cmd.settings.pattern).toBe('{name}_flag');
    expect(cmd.settings.sequence.digits).toBe(5);
    expect(cmd.settings.filter.includeSubfolders).toBe(true);
    expect(cmd.settings.findReplace.map((r) => r.find)).toEqual(['x', 'a']);
  });

  it('refuses a settings file it cannot read, cannot parse, or that is not an object', async () => {
    const file = path.resolve(cwd, 's.json');
    await expect(rename(['p', '--settings', 's.json'])).rejects.toThrow(/can't read the settings file/);
    await expect(rename(['p', '--settings', 's.json'], files({ [file]: '{nope' }))).rejects.toThrow(/can't read the settings file/);
    await expect(rename(['p', '--settings', 's.json'], files({ [file]: '[]' }))).rejects.toThrow(/must hold a JSON object/);
  });

  it('refuses manual sorting, from a flag or a file', async () => {
    const file = path.resolve(cwd, 's.json');
    await expect(rename(['p', '--sort', 'manual'])).rejects.toThrow(/--sort must be one of dateTaken, created, modified, name/);
    await expect(rename(['p', '--settings', 's.json'], files({ [file]: '{"sequence":{"sortBy":"manual"}}' }))).rejects.toThrow(
      /only works in the desktop app/,
    );
  });

  it('refuses bad values with the flag named', async () => {
    await expect(rename(['p', '--digits', '11'])).rejects.toThrow('--digits needs a whole number from 1 to 10, got "11"');
    await expect(rename(['p', '--step', '1.5'])).rejects.toThrow(/--step needs a whole number/);
    await expect(rename(['p', '--case', 'shout'])).rejects.toThrow(/--case must be one of/);
    await expect(rename(['p', '--replace', 'nothing'])).rejects.toThrow('--replace needs FIND=REPL, got "nothing"');
    await expect(rename(['p', '--replace', '=x'])).rejects.toThrow('--replace needs FIND=REPL, got "=x"');
    await expect(rename(['p', '--only-ext', ','])).rejects.toThrow('--only-ext needs at least one extension');
    await expect(rename(['p', '--nope'])).rejects.toThrow(UsageError);
  });

  it('explains how to pass a negative --shift', async () => {
    await expect(rename(['p', '--shift', '-60'])).rejects.toThrow(/--shift=-/);
    expect((await rename(['p', '--shift=-60'])).settings.dates.shiftMinutes).toBe(-60);
  });

  it('only accepts --journal together with --apply', async () => {
    await expect(rename(['p', '--journal', 'j.json'])).rejects.toThrow('--journal only works with --apply');
  });
});

describe('help', () => {
  it('documents every exit code and the negative --shift form', () => {
    for (const code of ['0', '1', '2', '3', '4', '5', '6', '7']) expect(HELP).toMatch(new RegExp(`^\\s+${code}\\s`, 'm'));
    expect(HELP).toContain('--shift=-60');
  });

  it('lists every token with its label', () => {
    const text = tokensText();
    expect(text).toMatch(/\{date_taken\}\s+date taken/);
    expect(text).toMatch(/\{crc32\}\s+CRC32/);
  });
});
