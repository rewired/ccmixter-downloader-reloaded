# AGENTS.md

## Purpose

This subtree contains shared domain models, public contracts, and typed IPC definitions used across Main, Preload, Renderer, and tests.

## Ownership

* Owns `src/shared/`.
* Parent `src/AGENTS.md` owns source-wide boundaries.
* Child docs own domain model and IPC contract details.

## Local Contracts

* Shared types are public contracts for this project.
* Do not encode silent license defaults.
* Keep contracts explicit about unknown, missing, or unresolved values.
* Changes here may require updates in Main, Preload, Renderer, tests, and docs.

## Work Guidance

* Prefer stable, narrow types over incidental implementation shapes.
* Use shared contracts for tests instead of duplicating private internals.

## Verification

* Run `pnpm typecheck` after shared contract changes.
* Run `pnpm test` or targeted Vitest tests after behavior-affecting contract changes.

## Child DOX Index

* `domain/AGENTS.md` covers domain models and domain classification/planning/review types.
* `ipc/AGENTS.md` covers IPC channels and IPC request/response contracts.
