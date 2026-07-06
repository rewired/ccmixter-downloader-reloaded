# AGENTS.md

## Purpose

This subtree contains Vitest tests, Playwright Electron smoke tests, and fixtures for reproducible behavior checks.

## Ownership

* Owns `test/`.
* Root `AGENTS.md` owns Definition of Done and repo-wide quality expectations.
* Child docs own fixtures and E2E tests.

## Local Contracts

* Tests should validate public contracts and user-visible behavior rather than incidental internals.
* Fixture data must stay reproducible and license/API assumptions must be explicit.
* Renderer safety tests enforce Electron boundary rules.

## Work Guidance

* Add targeted regression tests with behavior changes.
* Keep fixtures small, named, and representative.
* Do not make tests depend on live ccMixter network availability unless explicitly required.

## Verification

* Run `pnpm test` for the full Vitest suite.
* Run targeted `pnpm vitest run <path>` style commands for narrow changes when appropriate.
* Run `pnpm test:e2e` for Playwright Electron smoke changes.

## Child DOX Index

* `fixtures/AGENTS.md` covers reusable fixture data.
* `e2e/AGENTS.md` covers Playwright Electron smoke tests.
* Domain-specific test folders such as `archive/`, `ccmixter/`, `download/`, `grouping/`, `renderer/`, and `review/` remain owned by this file.
