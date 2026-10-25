# Store listing copy and submission notes

Copy for the Mac App Store, the Microsoft Store, Flathub and the Snap Store, with the answers each store's questionnaire asks for. Everything here describes Renami 0.4.0 as it is on `main`; where a store build will have to differ, the item says so under *Before submitting*.

The public pages the stores need are on the site, deployed from `site/` by `.github/workflows/pages.yml`:

| Page | URL |
|---|---|
| Marketing / homepage | https://aesonford.github.io/Renami/ |
| Privacy policy | https://aesonford.github.io/Renami/privacy.html |
| Support | https://aesonford.github.io/Renami/support.html |
| User guide | https://aesonford.github.io/Renami/help.html |
| Source code | https://github.com/AesonFord/Renami |
| Licence | GPL-3.0-or-later, https://github.com/AesonFord/Renami/blob/main/LICENSE |

## Names and one-liners

| Field | Text | Notes |
|---|---|---|
| Name | Renami | |
| Subtitle (Apple, 30 chars max) | Rename files in bulk | 20 chars |
| Summary (Flathub, 35 chars max, no full stop) | Rename files in bulk from a pattern | 35 chars |
| Summary (Snap, 79 chars max) | Rename files and folders in bulk from one name pattern, with a live preview | 75 chars |
| Short description (Microsoft Store) | Rename files in bulk from one name pattern, with a live preview and undo. Reads photo, video and audio metadata, so names can carry the date taken, camera, artist or album. | |
| Category | macOS: Productivity (`public.app-category.productivity`, as in `electron-builder.yml`). Microsoft Store: Productivity, or Utilities & tools. Flathub/Snap: Utility, FileTools. | |
| Keywords (Apple, 100 chars max, comma-separated) | rename,batch,bulk,files,photos,exif,date taken,sequence,regex,find replace,folder,organize | 94 chars |

## Promotional text (Apple, 170 chars max)

Drop in files, write one name pattern such as Hawaii_{date_taken:YYYY-MM-DD}_{seq:3}, check the live preview, and rename. Undo until you quit.

## Description

Use this for the Mac App Store and Microsoft Store description fields, and for the AppStream `<description>` (see `build/app.renami.metainfo.xml`, which carries the same text as paragraphs and a list).

> Renami renames files in bulk. Drop in files and folders, write one name pattern, check the live preview, and click Rename. Nothing changes on disk until you do, and a rename can be undone until you quit.
>
> A pattern is plain text plus tokens that Renami fills in from each file: Hawaii_{date_taken:YYYY-MM-DD}_{seq:3} turns IMG_4821.jpg into Hawaii_2024-07-04_001.jpg. Tokens cover the current name, folder, dates, sequence number, camera make and model, lens, ISO, aperture, shutter speed, focal length, image size, GPS position, duration, frame rate, bitrate, artist, album, title, track number, file size and checksums. Any token can have a fallback for files that don't have the value.
>
> Beyond the pattern, Renami can:
>
> • Number files in either direction, with a start, a step, and a restart in each folder or each day, month or year.
> • Keep a RAW file and its JPEG together under the same number.
> • Type a name straight into the preview, drag rows into order, or import a list of names from a spreadsheet.
> • Find and replace on the current or the new name, with regular expressions and $1 backreferences.
> • Change case, turn spaces into underscores, strip accents or force ASCII, and map extensions (.jpeg to .jpg).
> • Set a file's modified and created dates to the date it was taken, shift a camera clock that was wrong, or use a date found in the file name.
> • Sort files into folders by year and month with a / in the pattern, or gather them into one folder.
> • Rename the folders inside a folder.
> • Filter by file type, name, size or modified date, with or without subfolders.
> • Export the preview, or a finished rename, as CSV.
>
> The preview flags anything that needs a look: a name that got a suffix because it was taken, a token that came out empty, or an error that would stop the rename. Renami checks that no file changed between the preview and the rename, and a cancelled rename puts everything back.
>
> Renami works entirely on your computer. It has no account and no analytics, and it never sends your files anywhere. Photo, video and audio metadata is read by a bundled copy of ExifTool.
>
> Renami is free software under the GNU GPL, version 3 or later. The source code is at github.com/AesonFord/Renami.

## What's new in 0.4.0

> On macOS, Renami now looks and works like a Mac app: the files strip sits in the title bar, text uses the system font, the File menu has every command with its ⌘ shortcut, and About Renami shows the version. Windows and Linux gain the same File menu. Electron and dependencies updated.

## Age rating

Renami has no user-generated content, no social features, no purchases, no ads, no violence, no mature content, and no web browsing. Answer every content question with none or no.

- Apple: comes out as 4+.
- Microsoft Store (IARC questionnaire): comes out as the lowest rating in every region (3+ / E / PEGI 3 or equivalent).
- Flathub/Snap (OARS 1.1): `<content_rating type="oars-1.1" />` with no attributes, as in the metainfo file.

## Privacy answers

Backed by `site/privacy.html` and the code it describes (`src/main/updater.ts`, `src/main/updateCheck.ts`, `src/main/updatePrefs.ts`).

**What the app does on the network.** One request, to `https://api.github.com/repos/AesonFord/Renami/releases/latest`, at most once a day and when the user chooses Check for Updates…. Headers: `Accept: application/vnd.github+json`, `User-Agent: Renami/<version>`. Nothing else, no cookies, no identifiers. The user can turn the daily check off in the menu. Download opens the system browser at github.com; the app never downloads or installs anything itself.

**What the app stores.** `presets.json` (saved patterns and options), `updates.json` (auto-check on/off, last check time, skipped version), `renami.log` (error messages, which may contain file paths), and window layout in Electron's local storage. All in the userData folder, none of it ever transmitted.

**Apple App Privacy label.** **Data Not Collected.** The Mac App Store build has no update check (`src/main/distribution.ts` turns it off when `process.mas` is set) and its entitlements grant no network access, so the app sends nothing at all.

**Microsoft Store.** A privacy policy URL is required whenever an app declares the `internetClient` capability. The AppX manifest electron-builder writes declares only `runFullTrust` (see `appx.capabilities` in `electron-builder.store.yml`; none are added), and the store install skips the update check (`process.windowsStore`), so the policy URL is a formality: point it at the privacy page above.

**Flathub.** Grant no `--share=network` in the manifest: inside a Flatpak (`FLATPAK_ID` set) Renami skips the update check, so it needs none, and Flathub shows "no network access" on the listing.

## Reviewer notes (Apple and Microsoft)

> Renami is a bulk file renamer. To test: open the app, drag a folder of photos (or any files) onto the window, type a pattern such as `{name}_{seq:3}` in the field at the top, watch the preview update, and click Rename. Undo Last Rename in the File menu puts the files back. There is no account, no sign-in, no purchase and no network use beyond an optional once-a-day check for a newer version, which can be turned off under Check for Updates Automatically. All metadata is read locally by ExifTool, which is bundled inside the app.

## Screenshots

The site screenshot (`site/screenshot.png`, 2400 × 1520) shows the main window with six photos and a date-based pattern. Each store wants its own sizes; make them from the real app at the window size the store asks for rather than scaling this one. Check the current guidelines before you export, but as of writing:

- Mac App Store: 1280 × 800, 1440 × 900, 2560 × 1600 or 2880 × 1800 pixels, 16:10, at least one and up to ten.
- Microsoft Store: at least one desktop screenshot, 1366 × 768 or larger, up to ten.
- Flathub: at least one screenshot linked by URL from the MetaInfo file; it is already set to the site screenshot. Flathub prefers screenshots with no window shadow or decoration around the window.
- Snap: up to five, 480 × 480 to 3840 × 2160.

Suggested set, in order: the live preview with a date pattern (the existing shot), the Sequence tab with a restart each day, Find & replace with a regex, the preview panel showing a photo and its details, and the done notice with Undo.

## Before submitting

These are not documentation problems, but no store will take the current build as it is, and some of them change what the documentation above says.

1. **Licence.** Renami is GPL-3.0-or-later. The Free Software Foundation's position is that the Mac App Store's terms are incompatible with the GPL, and apps have been removed from Apple's stores over it (VLC, from the iOS App Store in 2011, came back later under a different licence). The Microsoft Store's agreement has drawn the same objection. Flathub and Snap take GPL software as it is. Options for Apple and Microsoft: as the copyright holder of the Renami code, add an app-store exception to the licence; relicense the app to a permissive licence; or distribute through those stores under a separate commercial licence of the same code. Contributions from others are GPL-licensed without a CLA (`CONTRIBUTING.md`), so any relicensing needs each contributor's consent, or their code left out. ExifTool is dual-licensed under the Artistic License and the GPL, so it doesn't force the choice. Decide this first; everything else depends on it.
2. **Signing and sandboxing (Apple).** `npm run dist:store` builds the `mas` target with the App Sandbox entitlements (`build/entitlements.mas.plist`, no network). Still yours to supply: the distribution and installer certificates, and the provisioning profile (`build/embedded.provisionprofile`, then uncomment it in the config). Two things to try on the first signed build before submitting: that ExifTool, a Perl script run by `/usr/bin/perl`, works inside the sandbox; and that files dropped on the window and folders chosen in dialogs are writable (they should be, under `files.user-selected.read-write`). A destination folder saved in a preset is not reachable after a relaunch until chosen again; security-scoped bookmarks would fix that later.
3. **Packaging (Microsoft).** `npm run dist:store` on Windows builds an `.appx`. Replace the `identityName`, `publisher` and `publisherDisplayName` placeholders with the Partner Center values first. The Explorer context menu added by `build/installer.nsh` is NSIS-only; the store package does without it unless a `desktop4:FileExplorerContextMenus` extension is added to the manifest.
4. **Flathub.** Needs a manifest in the `flathub` repository, `build/app.renami.metainfo.xml` installed to `/app/share/metainfo/`, a `.desktop` file with the same id (`app.renami.desktop`), and an icon at that id. The app id `app.renami` is reverse-DNS of `renami.app`; Flathub asks that you control the domain or use a `io.github.aesonford.Renami` id instead. If the domain isn't yours, rename the id in the metainfo file and in `appId` in `electron-builder.yml`.
5. **Snap.** A `snapcraft.yaml` using the `electron-builder` snap target or the `dump` plugin, `strict` confinement with the `home`, `removable-media` and (if the update check stays) `network` plugs. ExifTool needs `perl` staged.
6. **Support contact.** The stores ask for a support URL (set) and may ask for an email address. The support page points to GitHub Issues only; add an email there if you want a private channel, and use the same one in the store forms.
7. **Screenshots and icon.** The macOS icon in `build/` needs the Apple-shaped 1024 × 1024 version for App Store Connect; the Microsoft Store needs its tile sizes.
