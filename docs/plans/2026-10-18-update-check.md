# Update Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Renami tells the user when a newer release is out on GitHub and links them to the installer for their platform. It checks on its own once a day (they can turn that off) and whenever they choose "Check for Updates…".

**Architecture:** Everything runs in the main process, with no renderer or IPC changes. Pure functions in `src/main/updateCheck.ts` parse the GitHub "latest release" response, compare versions and pick the download link. `src/main/updatePrefs.ts` saves the user's choices in userData. `src/main/updater.ts` is an `UpdateChecker` class with every side effect injected (fetch, clock, prefs, dialogs), which makes it unit-testable. `index.ts` wires it to `net.fetch`, `dialog` and `shell`, and `menu.ts` gains the two menu items.

**Tech Stack:** Electron 44 main process (`net.fetch`, `dialog`, `shell.openExternal`), TypeScript, vitest (the `node` project). No new dependencies.

**Spec:** None was written. This plan is based on "Option A" from the 2026-10-18 conversation (check and notify, no auto-install, because the mac build is ad-hoc signed and Squirrel.Mac would reject updates). The decisions below are the spec.

## Global Constraints

- No new runtime or dev dependencies. Version comparison is hand-written (no `semver` package).
- Feed: `https://api.github.com/repos/AesonFord/Renami/releases/latest`, with headers `Accept: application/vnd.github+json` and `User-Agent: Renami/<app.getVersion()>`.
- Request timeout: 10 000 ms (`AbortSignal.timeout`).
- Automatic check: on by default, only when `app.isPackaged`, first run 10 000 ms after the window is created, at most once every 24 h (`AUTO_CHECK_INTERVAL_MS = 86_400_000`). It re-arms on a timer while the app is open.
- `RENAMI_NO_UPDATE_CHECK=1` disables the automatic check in every build. The manual menu item still works. CI (smoke launch, e2e) sets it.
- `RENAMI_UPDATE_FEED` overrides the feed URL **only when `!app.isPackaged`**, following the `devRendererUrl` pattern in `src/main/devMode.ts`.
- `shell.openExternal` only ever receives URLs that start with `https://github.com/AesonFord/Renami/`. Anything else falls back to `https://github.com/AesonFord/Renami/releases/latest`.
- Automatic-check failures never show a dialog and never write to `renami.log`, because `scripts/smoke-launch.mjs` fails the release on any log line. They go to `console.warn` only.
- Prefs file: `<userData>/updates.json`, written atomically (`.tmp` then `rename`), the same way `src/core/presets.ts:186-189` does it.
- Installer names must match `installerNames()` in `scripts/release-config.mjs`. A test pins them so the two copies can't drift.
- Prereleases are never offered. `releases/latest` excludes them, and the parser rejects `prerelease: true` or `draft: true` anyway. A user on `0.3.0-beta.1` is offered `0.3.0` stable but not `0.2.2`.
- Copy (exact):
  - Available: message `Renami {latest} is available`, detail `You have {current}.` followed, when there are notes, by a blank line and the notes excerpt. Buttons `['Download', 'Skip This Version', 'Later']`, defaultId 0, cancelId 2.
  - Up to date (manual only): message `Renami is up to date`, detail `{current} is the newest version.`
  - Error (manual only): message `Couldn't check for updates`, detail is the `UpdateError.message`.
  - Menu labels: `Check for Updates…` and `Check for Updates Automatically` (checkbox).
- Commits use Conventional Commits (`feat:`, `test:`, `docs:`), with no AI attribution.

## Review Focus

1. **Offline, DNS failure or timeout on the automatic check.** The user sees nothing and `renami.log` stays empty. The manual check shows the error dialog with `Can't reach GitHub. Check your connection and try again.` (Task 3: `auto check that fails stays silent`, `manual check that fails reports it`.)
2. **Hostile or odd feed JSON**: missing fields, a non-semver `tag_name` such as `latest`, or `html_url`/asset URLs pointing off GitHub. No update is offered for malformed data, and an off-site URL is never opened. (Task 1: `parseRelease rejects …`, `downloadUrl never returns an off-site URL`.)
3. **The user is on a prerelease, or on a version newer than the feed** (a local build after a version bump). No downgrade is offered. (Task 1: `compareVersions orders prereleases below their release`, and Task 3: `newer local version is up to date`.)
4. **`updates.json` is corrupt, missing, has the wrong types or can't be written.** The app uses the defaults and still launches and checks. A failed save is swallowed. (Task 2: `loads defaults from garbage`, `save failure does not throw`.)
5. **"Check for Updates…" clicked twice, or while the automatic check is in flight.** One request goes out and one dialog appears per manual click, never a stacked duplicate. (Task 3: `concurrent checks share one request`.)

---

## File Structure

| File | Responsibility |
|---|---|
| Create `src/main/updateCheck.ts` | Pure logic: version parsing and comparison, release parsing, choosing the download URL, the notes excerpt, the auto-check schedule. |
| Create `src/main/updatePrefs.ts` | Load and save `updates.json`, falling back to defaults. |
| Create `src/main/updater.ts` | `UpdateChecker`: fetch, decide, prompt, persist, de-duplicate concurrent checks, schedule. |
| Modify `src/main/menu.ts` | Optional `updates` argument, which adds the two items (mac: app menu; others: a Help menu). |
| Modify `src/main/devMode.ts` | `devUpdateFeed(isPackaged, env)`. |
| Modify `src/main/index.ts` | Wiring: the real fetch, dialogs, `openExternal`, the menu rebuild when the checkbox toggles, starting the automatic check. |
| Modify `scripts/smoke-launch.mjs`, `e2e/helpers.ts` | Set `RENAMI_NO_UPDATE_CHECK=1`. |
| Modify `README.md` | A new `## Updates` section. |
| Tests | `test/main/updateCheck.test.ts`, `test/main/updatePrefs.test.ts`, `test/main/updater.test.ts`, `test/main/menu.test.ts`, `test/main/devMode.test.ts`, `test/release/release-config.test.ts` |

---

### Task 1: Pure update logic

**Files:**
- Create: `src/main/updateCheck.ts`
- Test: `test/main/updateCheck.test.ts`
- Modify: `test/release/release-config.test.ts`, for the installer-name drift test

**Interfaces:**
- Produces:
  ```ts
  export const RELEASES_PAGE = 'https://github.com/AesonFord/Renami/releases/latest';
  export const FEED_URL = 'https://api.github.com/repos/AesonFord/Renami/releases/latest';
  export const AUTO_CHECK_INTERVAL_MS = 86_400_000;
  export interface Version { major: number; minor: number; patch: number; pre: string[] }
  export interface Release { version: string; pageUrl: string; notes: string; assets: { name: string; url: string }[] }
  export function parseVersion(v: string): Version | null;          // accepts an optional leading "v"
  export function compareVersions(a: string, b: string): number;   // <0, 0, >0; throws on unparseable input
  export function parseRelease(json: unknown): Release | null;
  export function installerName(platform: NodeJS.Platform, arch: string, isAppImage: boolean): string | null;
  export function downloadUrl(release: Release, platform: NodeJS.Platform, arch: string, isAppImage: boolean): string;
  export function notesExcerpt(markdown: string, maxChars?: number): string; // default maxChars = 600
  export function isDueForAutoCheck(lastCheckedAt: number | null, now: number): boolean;
  ```

- [ ] **Step 1: Write the failing tests** in `test/main/updateCheck.test.ts`:
  - `parseVersion accepts v-prefixed and prerelease`: `parseVersion('v0.2.2')` → `{major:0,minor:2,patch:2,pre:[]}`, and `parseVersion('1.0.0-beta.2').pre` → `['beta','2']`. `parseVersion('latest')`, `parseVersion('1.2')` and `parseVersion('')` → `null`.
  - `compareVersions orders by number, not text`: `compareVersions('0.10.0','0.9.0') > 0`, and `compareVersions('0.2.2','v0.2.2') === 0`.
  - `compareVersions orders prereleases below their release`: `'0.3.0-beta.1' < '0.3.0'`, `'0.3.0-beta.2' < '0.3.0-beta.10'` (numeric identifiers), `'0.3.0-alpha' < '0.3.0-beta'`, and `'0.3.0-beta.1' > '0.2.2'`.
  - `parseRelease reads a GitHub release`: given `{tag_name:'v0.3.0', html_url:'https://github.com/AesonFord/Renami/releases/tag/v0.3.0', body:'## What\'s new', draft:false, prerelease:false, assets:[{name:'Renami-mac-arm64.dmg', browser_download_url:'https://github.com/AesonFord/Renami/releases/download/v0.3.0/Renami-mac-arm64.dmg'}]}` → `{version:'0.3.0', pageUrl:…, notes:"## What's new", assets:[{name, url}]}`.
  - `parseRelease rejects drafts, prereleases and malformed input`: `null` for `draft:true`, `prerelease:true`, `tag_name:'latest'`, a missing `tag_name`, `null`, `'text'`, and `[]`. A `body: null` becomes `notes: ''`. A non-array `assets` becomes `[]`. Assets missing a string `name` or URL are dropped.
  - `installerName matches each platform`: `('darwin','arm64',false)` → `'Renami-mac-arm64.dmg'`, `('darwin','x64',false)` → `'Renami-mac-x64.dmg'`, `('win32','x64',false)` → `'Renami-win-x64-setup.exe'`, `('linux','x64',true)` → `'Renami-linux-x86_64.AppImage'`, `('linux','x64',false)` → `'Renami-linux-amd64.deb'`, and `('win32','arm64',false)` → `null`.
  - `downloadUrl picks the platform's asset`: with the mac asset above, `('darwin','arm64',false)` → its URL. With no matching asset → `release.pageUrl`.
  - `downloadUrl never returns an off-site URL`: an asset URL of `https://evil.example/Renami-mac-arm64.dmg` with `pageUrl: 'https://evil.example/'` → `RELEASES_PAGE`. An asset URL under `https://github.com/someoneelse/` → `RELEASES_PAGE`.
  - `notesExcerpt strips markdown and truncates`: `'## New\n\n* **Fast** rename by [@x](https://…)\n'` → `'New\n\n• Fast rename by @x'`. A 2 000-char body is at most 601 chars and ends with `'…'`. A truncated excerpt never cuts mid-word.
  - `isDueForAutoCheck`: `(null, 0)` → true, `(now - 86_400_000, now)` → true, `(now - 86_399_999, now)` → false, and a future `lastCheckedAt` (clock went backwards) → true.
- Add to `test/release/release-config.test.ts`: `update check links the installers the release builds`. For each platform, every name in `installerNames(platform)` equals the corresponding `installerName(...)` (mac arm64/x64, win x64, linux AppImage/deb).

- [ ] **Step 2: Run** `npx vitest run test/main/updateCheck.test.ts test/release/release-config.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/main/updateCheck.ts`.**
  - Prerelease comparison follows SemVer §11: compare identifiers left to right, numeric identifiers numerically, numeric below alphanumeric, and a shorter list below a longer one when all else is equal. Ignore build metadata (`+…`).
  - The URL guard is `url.startsWith('https://github.com/AesonFord/Renami/')`, applied to both the asset URL and `pageUrl`. Fall through asset → page → `RELEASES_PAGE`.
  - `notesExcerpt`: strip leading `#`s, `**`/`__`, and links `[text](url)` → `text`. Turn line-start `* `/`- ` into `• `. Collapse 3+ newlines into 2, trim, then truncate at the last space at or before `maxChars` and append `…`.

- [ ] **Step 4: Run the same command.** Expected: PASS.

- [ ] **Step 5: Commit** with `git add src/main/updateCheck.ts test/main/updateCheck.test.ts test/release/release-config.test.ts && git commit -m "feat: parse GitHub releases and compare versions for the update check"`

---

### Task 2: Update preferences

**Files:**
- Create: `src/main/updatePrefs.ts`
- Test: `test/main/updatePrefs.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface UpdatePrefs { autoCheck: boolean; skippedVersion: string | null; lastCheckedAt: number | null }
  export const DEFAULT_UPDATE_PREFS: UpdatePrefs; // { autoCheck: true, skippedVersion: null, lastCheckedAt: null }
  export function loadUpdatePrefs(file: string): Promise<UpdatePrefs>;
  export function saveUpdatePrefs(file: string, prefs: UpdatePrefs): Promise<void>; // never rejects
  ```

- [ ] **Step 1: Write the failing tests.** Each uses a temp dir from `mkdtempSync(path.join(tmpdir(), 'renami-updates-'))`, as `test/main/crash.test.ts` does.
  - `loads defaults when the file is missing` → `toEqual(DEFAULT_UPDATE_PREFS)`.
  - `loads defaults from garbage`: the file contains `'{not json'` → defaults. A file with `{"autoCheck":"yes","skippedVersion":5,"lastCheckedAt":"x"}` → defaults field by field. A file with `{"autoCheck":false}` → `{autoCheck:false, skippedVersion:null, lastCheckedAt:null}`.
  - `round-trips what it saves`: save `{autoCheck:false, skippedVersion:'0.3.0', lastCheckedAt:1760000000000}`, then load and get the same value. No `updates.json.tmp` is left behind.
  - `save failure does not throw`: `saveUpdatePrefs(path.join(dir, 'missing-dir', 'updates.json'), DEFAULT_UPDATE_PREFS)` resolves to `undefined`.

- [ ] **Step 2: Run** `npx vitest run test/main/updatePrefs.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.** Validate each field on its own (`typeof` checks; `skippedVersion` must also pass `parseVersion` from Task 1). Save with `JSON.stringify(prefs, null, 2) + '\n'` to `${file}.tmp`, then `rename`, wrapped in try/catch, with `console.warn` on failure.

- [ ] **Step 4: Run the same command.** Expected: PASS.

- [ ] **Step 5: Commit** with `git commit -m "feat: remember update-check preferences in updates.json"`

---

### Task 3: UpdateChecker

**Files:**
- Create: `src/main/updater.ts`
- Test: `test/main/updater.test.ts`

**Interfaces:**
- Consumes: everything from Task 1 and Task 2.
- Produces:
  ```ts
  export class UpdateError extends Error {}
  export type UpdateChoice = 'download' | 'skip' | 'later';
  export interface UpdateUi {
    showAvailable(info: { current: string; latest: string; notes: string }): Promise<UpdateChoice>;
    showUpToDate(current: string): Promise<void>;
    showError(message: string): Promise<void>;
    openDownload(url: string): void;
  }
  export interface UpdateCheckerDeps {
    currentVersion: string;
    platform: NodeJS.Platform; arch: string; isAppImage: boolean;
    feedUrl: string;
    fetch: (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<Response>;
    prefsFile: string;
    ui: UpdateUi;
    now?: () => number;
    setTimer?: (fn: () => void, ms: number) => { unref?: () => void } | unknown;
  }
  export class UpdateChecker {
    constructor(deps: UpdateCheckerDeps);
    init(): Promise<void>;                 // loads prefs; call before anything else
    get autoCheck(): boolean;
    setAutoCheck(on: boolean): Promise<void>; // persists; turning on schedules, turning off cancels the timer
    checkNow(manual: boolean): Promise<void>; // never rejects
    startAuto(delayMs: number): void;      // no-op when autoCheck is off
  }
  ```

- [ ] **Step 1: Write the failing tests.** Use a fake `fetch` (returns `new Response(JSON.stringify(release), {status})` or rejects), a recording fake `UpdateUi`, a fixed `now`, and a fake `setTimer` that captures callbacks. The prefs file goes in a temp dir.
  - `offers a newer release and opens the platform download`: current `0.2.2`, feed `v0.3.0` with a mac-arm64 asset, and the ui answers `'download'`. Expect `showAvailable` called with `{current:'0.2.2', latest:'0.3.0', notes: notesExcerpt(body)}` and `openDownload` with the asset URL. The saved `lastCheckedAt === now()`.
  - `sends the GitHub headers and a timeout signal`: the fetch init has `Accept: 'application/vnd.github+json'`, `User-Agent: 'Renami/0.2.2'` and an `AbortSignal`.
  - `skip remembers the version and the auto check stays quiet about it`: the ui answers `'skip'`, so the saved `skippedVersion === '0.3.0'`. A second `checkNow(false)` calls no ui method. `checkNow(true)` calls `showAvailable` again (a manual check ignores the skip). A later feed of `v0.3.1` triggers `checkNow(false)` → `showAvailable`.
  - `manual check that is up to date says so`: feed `v0.2.2` → `showUpToDate('0.2.2')`. The same feed with `checkNow(false)` → no ui calls.
  - `newer local version is up to date`: current `0.4.0`, feed `v0.3.0`, manual → `showUpToDate`.
  - `no releases yet is up to date`: status 404 with manual → `showUpToDate`.
  - `manual check that fails reports it`. Messages are exact:
    - fetch rejects with `TypeError('fetch failed')` → `showError("Can't reach GitHub. Check your connection and try again.")`
    - fetch rejects with a `DOMException` named `TimeoutError` → `showError('GitHub took too long to answer. Try again later.')`
    - status 403 or 429 → `showError('GitHub is limiting requests right now. Try again in an hour.')`
    - status 500 → `showError('GitHub answered with an error (500). Try again later.')`
    - status 200 with a body `parseRelease` rejects → `showError("GitHub's answer didn't look like a Renami release.")`
  - `auto check that fails stays silent`: each failure above with `checkNow(false)` → no ui calls, the promise resolves, and `lastCheckedAt` is unchanged.
  - `concurrent checks share one request`: the fetch returns a promise held open. `checkNow(false)` and `checkNow(true)` together lead to a single `fetch` call, and after it resolves, `showAvailable` is called exactly once. Two `checkNow(true)` calls also make one fetch and one dialog.
  - `startAuto respects the 24 h throttle and the switch`: with `autoCheck` off, `startAuto(10_000)` captures no timer. With it on and `lastCheckedAt` from 1 h ago, the captured callback runs and doesn't fetch, then reschedules for the remaining time. With it on and `lastCheckedAt` null, the callback fetches and then reschedules after `AUTO_CHECK_INTERVAL_MS`. `setAutoCheck(false)` persists `autoCheck:false`, and a pending callback that fires later does nothing.

- [ ] **Step 2: Run** `npx vitest run test/main/updater.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - The in-flight fetch is a single `Promise<Release | null | UpdateError>` field, cleared in `finally`. Each caller awaits it and then does its own ui step. A second manual caller during an open dialog gets no dialog of its own: track `dialogOpen` and return early.
  - Save prefs only after a successful fetch or a user choice.
  - Errors go to `console.warn('update check failed', error)`, never to the log file.
  - Timers are `unref`'d when `unref` exists, so they never keep the app alive.

- [ ] **Step 4: Run the same command.** Expected: PASS.

- [ ] **Step 5: Commit** with `git commit -m "feat: check GitHub for a newer Renami and prompt to download it"`

---

### Task 4: Menu items

**Files:**
- Modify: `src/main/menu.ts`
- Test: `test/main/menu.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface UpdateMenu { autoCheck: boolean; checkNow: () => void; setAutoCheck: (on: boolean) => void }
  export function menuTemplate(platform: NodeJS.Platform, isDev: boolean, updates?: UpdateMenu): MenuItemConstructorOptions[];
  ```
  The third argument is optional, so the existing tests and calls keep working. When it's omitted, there are no update items and the menu is unchanged.

- [ ] **Step 1: Add the failing tests.** Find items by `label` with a small helper that walks the submenus.
  - `puts the update items in the mac app menu`: on `darwin` with updates, the item with `role: 'appMenu'` still exists (the existing test still passes), and its submenu, in order, has the roles and labels `about`, separator, `Check for Updates…`, `Check for Updates Automatically` (`type: 'checkbox'`, `checked` mirrors `autoCheck`), separator, `services`, separator, `hide`, `hideOthers`, `unhide`, separator, `quit`.
  - `puts the update items in a Help menu elsewhere`: on `win32`/`linux`, the last top-level item is `{ role: 'help' }`, whose submenu holds the two items.
  - `menu items call through`: `click()` on "Check for Updates…" calls `checkNow` once. `click({checked:true})` on the checkbox calls `setAutoCheck(true)`.
  - `no update items without the argument`: `menuTemplate('darwin', false)` has neither label.

- [ ] **Step 2: Run** `npx vitest run test/main/menu.test.ts`. Expected: the new tests FAIL and the old ones PASS.

- [ ] **Step 3: Implement.** On mac, keep `role: 'appMenu'` and give it an explicit `submenu`, because Electron uses a given submenu in place of the role's default. Extend the doc comment so it says why.

- [ ] **Step 4: Run the same command.** Expected: PASS.

- [ ] **Step 5: Commit** with `git commit -m "feat: add Check for Updates to the menu"`

---

### Task 5: Wire it into the app, keep CI offline, document it

**Files:**
- Modify: `src/main/devMode.ts`, `test/main/devMode.test.ts`
- Modify: `src/main/index.ts`, `scripts/smoke-launch.mjs`, `e2e/helpers.ts`, `README.md`

**Interfaces:**
- Consumes: `UpdateChecker`/`UpdateUi` (Task 3), `UpdateMenu`/`menuTemplate` (Task 4), `FEED_URL` (Task 1).
- Produces: `export function devUpdateFeed(isPackaged: boolean, env: Record<string, string | undefined>): string | null` in `devMode.ts`.

- [ ] **Step 1: Write the failing tests** in `test/main/devMode.test.ts`. `devUpdateFeed(true, {RENAMI_UPDATE_FEED:'http://localhost:9/x'})` → `null`, `devUpdateFeed(false, {RENAMI_UPDATE_FEED:'http://localhost:9/x'})` → that URL, and `devUpdateFeed(false, {})` → `null`.

- [ ] **Step 2: Run** `npx vitest run test/main/devMode.test.ts`. Expected: FAIL. Then implement it next to `devRendererUrl`, with a comment explaining why a packaged app ignores it (an attacker-chosen feed could choose the download link). Run again: PASS.

- [ ] **Step 3: Wire up `src/main/index.ts`** inside `whenReady`:
  - Build the `UpdateChecker` with:
    - `fetch: (url, init) => net.fetch(url, init)` (add `net` to the electron import)
    - `feedUrl: devUpdateFeed(app.isPackaged, process.env) ?? FEED_URL`
    - `prefsFile: path.join(app.getPath('userData'), 'updates.json')`
    - `isAppImage: Boolean(process.env.APPIMAGE)`
    - `currentVersion: app.getVersion()`
  - Its `UpdateUi` uses `dialog.showMessageBox(liveWindow() ?? …)` with the exact copy in Global Constraints, and `openDownload: (url) => void shell.openExternal(url)`.
  - `await updater.init()` before building the menu, then build the menu with `{ autoCheck: updater.autoCheck, checkNow: () => void updater.checkNow(true), setAutoCheck: (on) => void updater.setAutoCheck(on).then(rebuildMenu) }`. `rebuildMenu` re-runs `Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate(...)))`.
  - After `mainWindow = createWindow(devUrl)`, call `if (app.isPackaged && process.env.RENAMI_NO_UPDATE_CHECK !== '1') updater.startAuto(10_000)`.
  - Reword the spellchecker comment (`// … the app is offline.`) to `// … the app makes no other network requests; the update check (updater.ts) is the one exception.`

- [ ] **Step 4: Keep CI offline.** Add `RENAMI_NO_UPDATE_CHECK: '1'` to the spawn env in `scripts/smoke-launch.mjs`, and `env.RENAMI_NO_UPDATE_CHECK = '1'` next to `env.RENAMI_USER_DATA_DIR` in `e2e/helpers.ts`.

- [ ] **Step 5: Document it.** Add `## Updates` to `README.md` after "Package it". It covers:
  - Renami asks `api.github.com` for the latest release at most once a day and sends only its version in the User-Agent.
  - The check can be turned off with "Check for Updates Automatically" (in the app menu on macOS, Help elsewhere).
  - Installing stays manual until the builds are signed.
  - The environment variables are `RENAMI_NO_UPDATE_CHECK` and `RENAMI_UPDATE_FEED` (dev only).

- [ ] **Step 6: Verify.**
  - Run `npm run typecheck && npm test`. Expected: both exit 0.
  - Run `npm run e2e`. Expected: all pass.
  - Manual check against a fake feed:
    1. Save a release JSON with `tag_name: "v9.9.9"` to the scratchpad and serve it with `npx http-server -p 8765`.
    2. Run `RENAMI_UPDATE_FEED=http://localhost:8765/release.json npm run dev`.
    3. Choose Check for Updates…. Expected: "Renami 9.9.9 is available".
    4. Click Skip This Version, then run the check again. Expected: it still shows, because a manual check ignores the skip.
    5. Stop the server and check again. Expected: "Couldn't check for updates".

- [ ] **Step 7: Commit** with `git add -A src/main scripts/smoke-launch.mjs e2e/helpers.ts README.md test/main && git commit -m "feat: check for updates on launch and from the menu"`

---

## Out of scope

- Downloading or installing updates (Option B, which needs a Developer ID for mac).
- The npm command line: `npm` already handles its updates.
- Offering prereleases to beta users.
