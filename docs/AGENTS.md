# AGENTS.md

## Purpose

This subtree contains durable project documentation, research notes, architecture records, release notes, and related project knowledge.

## Ownership

* Owns documentation under `docs/`.
* Root `AGENTS.md` owns repo-wide workflow, project goals, and Definition of Done.
* `docs/adr/AGENTS.md` owns architecture decision records.

## Local Contracts

* Document stable decisions, constraints, and evidence.
* Mark unknown project facts as `not specified` or `TODO`.
* Keep documentation synchronized with durable behavior and public contracts.

## Work Guidance

* Prefer short operational notes over long narrative history.
* Do not use docs to compensate for unclear code contracts; update the relevant source contract when behavior changes.

## Verification

* Use `git diff --check -- docs` for documentation-only whitespace checks.

## Child DOX Index

* `adr/AGENTS.md` covers architecture decision records.
* `DESIGN.md` is the binding Renderer/UI design contract (accepted colors/chrome, tunable typography/density). `src/renderer/AGENTS.md` and `src/renderer/ui/AGENTS.md` reference it.
* `ccmixter-downloader-research-report.md` remains owned by this file.
