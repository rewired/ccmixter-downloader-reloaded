# AGENTS.md

## Purpose

This subtree contains the Electron application source code.

## Ownership

* Owns application code under `src/`.
* Root `AGENTS.md` owns repo-wide DOX, Electron security defaults, license-safety rules, and project priorities.
* Child docs own Main, Preload, Renderer, and Shared contracts.

## Local Contracts

* Keep privileged operations in Main Process services.
* Keep Renderer code free of Node/Electron-specific logic.
* Put shared types, domain models, and IPC contracts in `src/shared/`.
* Do not introduce broad or synchronous IPC.

## Work Guidance

* Prefer narrow edits that preserve existing module boundaries.
* Make new durable architecture decisions visible in `docs/adr/`.

## Verification

* Run `pnpm typecheck` after source changes when relevant.
* Run `pnpm test` for behavior changes covered by Vitest.
* Run `pnpm lint` for renderer-safety-sensitive changes.

## Child DOX Index

* `main/AGENTS.md` covers Electron Main Process entrypoints, services, settings, wiring, and privileged operations.
* `preload/AGENTS.md` covers secure bridge APIs.
* `renderer/AGENTS.md` covers React renderer code and UI behavior.
* `shared/AGENTS.md` covers shared domain models and typed IPC contracts.
