# Security policy

## Supported versions

Only the latest release gets security fixes. Older releases don't get backports, so update to the newest one.

## Reporting a vulnerability

Please don't open a public issue or pull request for a security problem.

Report it privately instead: on the repository's **Security** tab, click **Report a vulnerability**. Only the maintainer can see the report.

You'll get an acknowledgement within 7 days, and a fix or a decision within 90 days. The disclosure date is agreed in the advisory. You're credited in the advisory unless you'd rather not be.

## In scope

- Escaping the renderer sandbox
- IPC calls from the renderer that do more than the UI allows
- A rename or undo that writes outside the files you chose
- File names or metadata crafted to inject into ExifTool or the preview
- Tampered release assets

## Out of scope

- The Gatekeeper and SmartScreen warnings on first launch. The builds aren't code-signed; the README explains how to open them.
- Attacks that need the attacker to already run code on your machine.

## Verifying a download

Each release has a `SHA256SUMS` file and a build provenance attestation. With the [GitHub CLI](https://cli.github.com/), in the folder holding the installer and `SHA256SUMS`:

```bash
gh attestation verify Renami-mac-arm64.dmg --repo AesonFord/Renami
shasum -a 256 -c SHA256SUMS --ignore-missing
```

Use the name of the installer you downloaded. The first command proves the file was built by this repository's release workflow from a tag on `main`. The second proves it matches the checksum published with the release. On Windows, compare `Get-FileHash Renami-win-x64-setup.exe` with its line in `SHA256SUMS`.
