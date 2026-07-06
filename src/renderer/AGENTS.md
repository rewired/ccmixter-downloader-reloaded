# AGENTS.md

## Purpose

This subtree contains React Renderer code, browser UI state, styles, and presentation-focused workflows.

## Ownership

* Owns `src/renderer/`.
* Parent `src/AGENTS.md` owns source-wide Electron boundaries.
* `ui/AGENTS.md` owns reusable and screen-level UI components.

## Local Contracts

* Do not access the filesystem directly from Renderer code.
* Do not import Electron or Node-specific APIs into Renderer code.
* Use preload-exposed APIs and shared types for privileged operations.
* Visible user states for loading, empty, and error cases must stay clear.
* Renderer/UI design decisions follow `docs/DESIGN.md`: the current dark color palette, panel chrome, sparse gradient spotlight treatment, and bottom status bar are accepted and must be preserved. Do not change font sizes without explicit user sign-off; weights and density may be tuned.

## Work Guidance

* Keep components presentation-focused when possible.
* Preserve accessibility fundamentals and clear information hierarchy in search, detail, and queue surfaces.
* Avoid silent license assumptions in UI copy.

## Verification

* Run `pnpm typecheck` after Renderer changes.
* Run `pnpm lint` after Renderer safety-sensitive changes.
* Run targeted renderer tests under `test/renderer/` when UI behavior changes.

## Child DOX Index

* `ui/AGENTS.md` covers Renderer UI components and local UI helper modules.
* `i18n/AGENTS.md` covers renderer-side English strings and the typed translation helper.
* `index.html`, `index.tsx`, `styles.css`, and `global.d.ts` remain owned by this file.
