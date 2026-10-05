# renami

Rename files in bulk from a pattern, from the command line. This is the command-line companion to the [Renami](https://github.com/AesonFord/Renami) desktop app, with the same rename engine.

```bash
npm install -g renami     # needs Node 22 or later

renami rename ~/Photos/Hawaii -p 'Hawaii_{date_taken:YYYY-MM-DD}_{seq:3}'                            # preview
renami rename ~/Photos/Hawaii -p 'Hawaii_{date_taken:YYYY-MM-DD}_{seq:3}' --apply --journal undo.json  # rename
renami undo undo.json                                                                                # put it back
```

Nothing on disk changes without `--apply`. `renami tokens` lists the pattern tokens, and `renami --help` lists every option and exit code. `renami <paths…>` opens the desktop app with those files, if it is installed.

See the [README](https://github.com/AesonFord/Renami#command-line) for settings files, JSON output and exit codes.
