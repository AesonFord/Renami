# Contributing to Renami

Bug reports, fixes and small features are welcome. For anything large, open an issue first so we can agree on the approach before you write it.

## Security problems

Don't open an issue or pull request. Follow [SECURITY.md](SECURITY.md).

## Check your change

You need Node 22 or later.

```bash
npm ci
npm run typecheck
npm test
npm run e2e      # builds the app, then runs the Playwright tests
```

The [README](README.md) has more on running and packaging the app.

## Pull requests

- Keep a pull request to one change, with tests for new behavior.
- CI runs the type check, unit and end-to-end tests on macOS, Windows and Linux, plus CodeQL and dependency review. All of them must pass before a merge.
- On your first pull request, CI waits until the maintainer approves the run.
- Pull requests are squash-merged, so your branch's history doesn't need tidying.
- Review conversations must be resolved before the merge.

## License

Renami is licensed under GPL-3.0-or-later. By contributing, you agree that your contribution is licensed the same way. There's no CLA and no sign-off.
