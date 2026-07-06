# AGENTS.md

## Purpose

This subtree contains React UI components and UI helper modules for search, detail, status, source, and download surfaces.

## Ownership

* Owns `src/renderer/ui/`.
* Parent `src/renderer/AGENTS.md` owns broader Renderer rules.
* Shared types remain owned by `src/shared/`.

## Local Contracts

* Components should remain presentation-focused whenever possible.
* Do not introduce direct Electron, Node, or filesystem access.
* License, warning, and attribution text must not imply permissions when license data is unknown.
* Loading, empty, and error states must remain visible for user-facing flows.
* The main scan/review/download flow is musician-facing. Do not show developer terms such as group, resolver, candidate, confidence, source mode, merge, or session in the main UI.
* Root/download folder paths are shown in the bottom status bar only. The bottom status bar also owns the primary download call-to-action (`Download (x)`).
* Review and Download are separate user states: Review is for choosing/renaming files (`UploadListDetail`); Download (`DownloadScreen`) shows progress and result only, with no editing and no archive inspection.
* Follow the design contract in `docs/DESIGN.md`: preserve the accepted dark color palette, panel chrome, sparse gradient spotlight treatment, and bottom status bar. Do not change font sizes without explicit user sign-off; weights and density may be tuned.
* ZIP content disclosure (`ArchiveDisclosure` in `UploadListDetail.tsx`) must render all entries when opened, borderless, with no truncation.

## Work Guidance

* Keep UI copy concise and license-safe.
* Use song, file, upload, download folder, and files selected in main-flow copy.
* Prefer typed props derived from shared domain models.
* Keep layout changes responsive across desktop and constrained window sizes.

## Verification

* Run targeted tests under `test/renderer/` for component behavior changes.
* Run `pnpm typecheck` after UI type or prop changes.

## Child DOX Index

* No child DOX files are currently defined.
