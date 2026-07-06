# AGENTS.md

## Purpose

This subtree contains Electron preload code and secure bridge APIs exposed to the Renderer.

## Ownership

* Owns `src/preload/`.
* Parent `src/AGENTS.md` owns source-wide boundaries.
* `src/shared/` owns IPC and domain contracts used by preload APIs.

## Local Contracts

* Expose only small, named `contextBridge` APIs.
* Do not expose broad Node, Electron, filesystem, or shell access to the Renderer.
* Do not use synchronous IPC.
* Keep preload API shapes aligned with typed shared IPC contracts.

## Work Guidance

* Treat every preload API change as security-relevant.
* Prefer explicit methods over generic invoke wrappers.

## Verification

* Run `pnpm lint` after preload or bridge-surface changes.
* Run `pnpm typecheck` after preload contract changes.

## Child DOX Index

* No child DOX files are currently defined.
