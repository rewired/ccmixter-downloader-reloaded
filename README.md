# ccMixter Stem Downloader

Electron desktop foundation for planning ccMixter stem, remix pack, sample, and source-material downloads into a persistent local Stem Library Root Folder.

The current foundation proves the application structure, reviewed dry-run planning, and the first confirmed download execution path. It does not implement ZIP extraction, attribution writing, catalog/database persistence, signing, auto-update, or release automation.

## Project Structure

- `AGENTS.md` is the authoritative project instruction file.
- `docs/ccmixter-downloader-research-report.md` is the current research report location.
- `src/main/` owns Electron windows, IPC handlers, settings persistence, and privileged work.
- `src/preload/` exposes the narrow `window.ccmixterDownloader` bridge.
- `src/renderer/` contains the React UI and no direct Node/Electron imports.
- `src/shared/` contains domain models, pure planning functions, and IPC contracts.
- `test/` contains Vitest coverage for planning and safety checks.

## Install

```powershell
pnpm install
```

If install fails with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, fix the local certificate or registry trust configuration outside this repository. Do not commit insecure SSL workarounds.

## Run

```powershell
pnpm start
```

## Test and Verify

```powershell
pnpm typecheck
pnpm test
pnpm lint
pnpm package
pnpm test:e2e
```

The current Playwright Electron smoke uses one live ccMixter-hosted MP3 URL from `fixture:haze-smoke`, so network availability can affect `pnpm test:e2e`.

Manual artist catalog runtime smoke:

```powershell
pnpm start
```

In the Electron app, enter `https://ccmixter.org/people/7OOP3D`, click `Review artist uploads`, and verify that the resolver status is not unresolved, the upload count is greater than 1, visible catalog rows appear, and diagnostics do not show a bare `fetch failed` warning.

## Current Slice Behavior

The app lets a user choose a Stem Library Root Folder once, stores that setting through the Main process in Electron's user data area, resolves ccMixter metadata, creates a dry-run preview, lets the user review target names, and starts downloads only after explicit confirmation.

Dry-run paths are planned below the selected root folder:

```text
<Stem Library Root>/<Artist>/<Songname (96 bpm)>/<filename.ext>
```

The reviewed plan is converted into a Main-process download job before any file write. Downloads are limited to `http://` or `https://` ccMixter hosts, write to unique temporary files first, and do not overwrite existing files by default. Cancelling root-folder selection is not an error. A dry run cannot be created without a selected root folder.

ZIP extraction, attribution file writing, and persistent catalog/database storage are still not implemented.
