# ccMixter Stem Downloader

Electron desktop foundation for planning ccMixter stem, remix pack, sample, and source-material downloads into a persistent local Stem Library Root Folder.

This first slice proves the application structure. It does not implement real ccMixter API scans, downloads, ZIP extraction, attribution writing, persistence beyond the root-folder setting, signing, auto-update, or release automation.

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
```

## First Slice Behavior

The app lets a user choose a Stem Library Root Folder once, stores that setting through the Main process in Electron's user data area, parses a ccMixter artist/upload input locally, and creates a dry-run preview.

Dry-run paths are planned below the selected root folder:

```text
<Stem Library Root>/<Artist>/<Songname (96 bpm)>/<filename.ext>
```

The dry-run plan uses fixture/sample data and visibly warns that no ccMixter scan, download, ZIP extraction, or attribution writing happened. Cancelling root-folder selection is not an error. A dry run cannot be created without a selected root folder.
