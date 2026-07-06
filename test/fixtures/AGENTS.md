# AGENTS.md

## Purpose

This subtree contains reusable API, HTML, archive, license, and domain fixture data for tests.

## Ownership

* Owns `test/fixtures/`.
* Parent `test/AGENTS.md` owns broader test standards.
* Domain model contracts remain owned by `src/shared/domain/`.

## Local Contracts

* Fixtures must be deterministic and suitable for offline tests.
* Do not silently normalize missing API or license fields in fixture data.
* Keep fixture names descriptive enough to show the scenario they support.

## Work Guidance

* Prefer adding small focused fixtures over expanding one fixture to cover unrelated cases.
* Update tests with fixture changes so fixture intent remains clear.

## Verification

* Run targeted tests that consume changed fixtures.

## Child DOX Index

* `ccmixter/` contains ccMixter API and HTML fixtures and remains owned by this file.
