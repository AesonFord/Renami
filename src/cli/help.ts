import { TOKENS } from '../core/index.js';

export const HELP = `Rename files in bulk from a pattern.

Usage:
  renami rename <paths…> [options]   Show what would be renamed (a dry run)
  renami rename <paths…> --apply     Rename the files
  renami undo <journal.json>         Undo a rename recorded with --journal
  renami tokens                      List the tokens a pattern can use
  renami <paths…>                    Open the Renami desktop app with these files
  renami --help | --version

Options for rename:
  -p, --pattern <pattern>       The new name, e.g. "Trip_{date_taken:YYYY-MM-DD}_{seq:3}"
      --settings <file.json>    Settings saved as JSON; the flags below override them

  Numbering
      --sort dateTaken|created|modified|name   --desc
      --start N   --step N   --digits N
      --restart never|day|month|year           --restart-per-folder

  Find & replace (in the current name)
      --replace FIND=REPL       Repeatable; plain text unless --regex
      --regex   --match-case

  Clean up
      --case none|lower|upper|title|sentence|snake|kebab|camel
      --spaces-to-underscores   --ascii   --strip-accents
      --ext FROM=TO             Map an extension, e.g. --ext jpeg=jpg (repeatable)

  Move and dates
      --dest <folder>           Move the renamed files into this folder
      --shift=<±minutes>        Correct a wrong camera clock, e.g. --shift=-60
      --use-name-date           Use a date in the file name when there is no date taken
      --set-modified   --set-created   Set the file's dates to the date used

  Which files
  -r, --recursive               Include subfolders
      --only-ext jpg,heic       Only these extensions
      --folders                 Rename the folders inside the given folders
      --name <text>             Only names containing this text

  Output and safety
      --apply                   Rename (without it, nothing on disk changes)
      --journal <file.json>     With --apply: record the batch so "renami undo" can reverse it
      --json                    Print the plan and the result as JSON
  -q, --quiet                   Print only errors

Exit codes:
  0   Done, or a dry run found no problems
  1   Usage error
  2   Invalid pattern
  3   Some files can't be renamed; nothing was renamed
  4   Files changed between the plan and the rename; nothing was renamed
  5   The rename or undo failed or was cancelled, or the journal couldn't be written
  6   The undo skipped some files
  7   The desktop app was not found
`;

export function tokensText(): string {
  const lines = Object.entries(TOKENS).map(([name, def]) => `  ${`{${name}}`.padEnd(18)}${def.label}`);
  return `${lines.join('\n')}\n\nDates take a format: {date_taken:YYYY-MM-DD}. Numbers take digits: {seq:3}.\n`;
}
