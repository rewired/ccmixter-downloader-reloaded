# AGENTS.md

## Purpose

This subtree contains Playwright Electron end-to-end smoke tests.

## Ownership

* Owns `test/e2e/`.
* Parent `test/AGENTS.md` owns broader test standards.
* Release/package configuration remains owned by root `AGENTS.md`.

## Local Contracts

* E2E tests should cover high-value application smoke behavior.
* Tests must remain reproducible and avoid live external network requirements unless explicitly documented.
* E2E assertions should reflect user-visible behavior.

## Work Guidance

* Keep smoke tests focused; push detailed domain behavior into Vitest where practical.
* Update Playwright config only through the root-owned configuration path.

## Verification

* Run `pnpm test:e2e` for E2E behavior or packaging-smoke changes.
* Run `pnpm test:e2e:headed` only when interactive debugging is useful.

## Child DOX Index

* No child DOX files are currently defined.
