# AGENTS.md

## Purpose

This subtree contains shared domain models for ccMixter uploads, licenses, archive data, downloads, grouping, review, planning, and classification.

## Ownership

* Owns `src/shared/domain/`.
* Parent `src/shared/AGENTS.md` owns shared-contract standards.
* Root `AGENTS.md` owns license-safety requirements.

## Local Contracts

* License-related fields must not silently imply commercial allowance or reuse permission.
* Unknown or missing API data must be represented explicitly.
* Domain models used by IPC or tests are public contracts.
* Review sessions start with zero files selected for all input kinds; musicians opt in per file. Every discovered file still appears in the session so it stays reviewable/selectable.
* Artist catalog progress separates downloadable uploads, no-files-found uploads, and could-not-check uploads.

## Work Guidance

* Keep domain types implementation-neutral.
* Update fixtures and tests when domain parsing expectations change.
* Missing BPM remains optional metadata and must not block target path planning.

## Verification

* Run `pnpm typecheck` after domain model changes.
* Run targeted Vitest tests for planning, review, classification, archive, grouping, or download behavior affected by model changes.

## Child DOX Index

* No child DOX files are currently defined.
