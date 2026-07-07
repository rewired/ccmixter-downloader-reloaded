# AGENTS.md

## Purpose

This subtree contains Main Process service modules for ccMixter access, download planning/execution, archive inspection, and grouping.

## Ownership

* Owns service implementation folders under `src/main/services/`.
* Parent `src/main/AGENTS.md` owns Main Process wiring and security expectations.
* Shared contracts remain owned by `src/shared/`.

## Local Contracts

* Service inputs and outputs that cross process or test boundaries must use shared domain or IPC types.
* Do not assume missing ccMixter API fields or license values; model unknowns explicitly.
* Download and license data persistence must remain in Main Process services.
* External network communication must have basic error handling.
* Artist catalog scans enrich upload pages in the Main Process with bounded concurrency, cache enrichment within a session, and keep per-upload failures recoverable.

## Work Guidance

* Keep service-domain boundaries clear: archive, ccmixter, download, and grouping concerns should not bleed into Renderer code.
* Prefer fixture-backed tests for API parsing and license-sensitive behavior.
* Preserve partial artist catalog scan results when a scan is cancelled.

## Verification

* Run targeted Vitest tests for the changed service domain.
* Run `pnpm typecheck` after service contract or type changes.

## Child DOX Index

* `archive/` contains archive inspection service code.
* `ccmixter/` contains ccMixter API, HTML, resolver, and artist catalog services.
* `download/` contains download planning and manager services.
* `grouping/` contains stem grouping services.
* `stemPacking/` contains the local-folder Stem Packing engine (scan, probe, split, ZIP, metadata, read-only preview) for the future Package Remix tool. It is exposed through a narrow choose/preview/pack IPC surface (`src/shared/ipc/contracts.ts`, `src/main/index.ts`, `src/preload/index.ts`) but is not wired to download results; see `docs/adr/0002-stem-packing-engine.md` and `docs/stem-zipper-port-map.md`.
* These service-domain folders do not currently have separate child `AGENTS.md` files.
