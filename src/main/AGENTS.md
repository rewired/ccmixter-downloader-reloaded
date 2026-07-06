# AGENTS.md

## Purpose

This subtree contains Electron Main Process logic, privileged application services, settings, wiring, and sample data.

## Ownership

* Owns `src/main/` code.
* Parent `src/AGENTS.md` owns source-wide contracts.
* `services/AGENTS.md` owns service implementations and service-domain folders.

## Local Contracts

* Keep filesystem, network, persistence, download, and archive work in Main Process services.
* Do not perform blocking I/O in the Main Process.
* Keep IPC handlers typed through `src/shared/`.
* Preserve secure window defaults: `contextIsolation: true`, `sandbox: true`, and no Renderer `nodeIntegration`.

## Work Guidance

* Prefer async service APIs with explicit error handling.
* Avoid magic IPC channel strings outside shared IPC contracts.
* Security-relevant changes to windows, sessions, IPC, or networking require brief justification in the task closeout.

## Verification

* Run `pnpm typecheck` after Main Process changes.
* Run targeted Vitest tests under `test/` for changed services or wiring.
* Run `pnpm lint` when IPC or renderer-safety expectations may be affected.

## Child DOX Index

* `services/AGENTS.md` covers service modules under `src/main/services/`.
* `index.ts`, `settings.ts`, `sample-data.ts`, and `forge-env.d.ts` remain owned by this file.
