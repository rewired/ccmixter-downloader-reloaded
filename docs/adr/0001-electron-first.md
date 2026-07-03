# ADR 0001: Electron-first foundation

## Status

Accepted

## Context

The repository goal is a desktop application for collecting ccMixter stems, remix packs, samples, and source material into a musician's local stem library. The research report is stored at `docs/ccmixter-downloader-research-report.md`.

ccMixter metadata and file publication patterns are heterogeneous. Later slices will need filesystem access, network requests, download management, ZIP extraction, attribution writing, and user-reviewed path planning.

## Decision

Electron is the primary platform. The Renderer is UI-only, the Main process owns privileged work, and the Preload script exposes a narrow typed bridge.

The first slice introduces a persistent Stem Library Root Folder. Planned artist/song/file paths are previewed below that root folder before any real download behavior exists.

Electron security defaults stay enabled:

- `sandbox: true`
- `contextIsolation: true`
- `nodeIntegration: false`

The app does not load remote ccMixter pages or expose broad Electron/Node APIs to the Renderer.

## Consequences

Dry-run planning comes before downloads so users can review grouping, naming, and target paths before files are written. The foundation can add real ccMixter API metadata, downloads, ZIP extraction, and attribution writing later without changing the Renderer into a privileged process.

The Stem Library Root Folder is persisted by the Main process in Electron's app user data area. Browser storage is not the source of truth for this setting.
