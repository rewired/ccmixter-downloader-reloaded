# AGENTS.md

## Purpose

This subtree contains typed IPC channels, request shapes, response shapes, and shared IPC exports.

## Ownership

* Owns `src/shared/ipc/`.
* Parent `src/shared/AGENTS.md` owns shared-contract standards.
* Main and Preload code consume these contracts but do not own them.

## Local Contracts

* IPC channels must be named constants or typed contract entries, not uncommented magic strings.
* Do not define synchronous IPC contracts.
* Keep request and response types explicit and narrow.
* IPC changes are security-relevant and require review against preload exposure.

## Work Guidance

* Update Main handlers, preload APIs, Renderer callers, and tests together when changing IPC contracts.
* Prefer adding small specific contracts over broad generic command surfaces.

## Verification

* Run `pnpm typecheck` after IPC contract changes.
* Run `pnpm lint` after IPC/preload exposure changes.
* Run targeted Main/Renderer tests for changed IPC behavior.

## Child DOX Index

* No child DOX files are currently defined.
