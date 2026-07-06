# AGENTS.md

## Purpose

This subtree contains architecture decision records for choices expected to outlive a single sprint.

## Ownership

* Owns ADR files under `docs/adr/`.
* Parent `docs/AGENTS.md` owns general documentation standards.
* Root `AGENTS.md` owns repo-wide architecture, security, and license-safety requirements.

## Local Contracts

* ADRs must record durable decisions, context, and consequences.
* ADRs must not hide unresolved project facts; use `not specified` or `TODO`.
* ADRs must not contradict current source contracts or AGENTS.md rules.

## Work Guidance

* Add or update an ADR when introducing a lasting architectural decision.
* Keep ADRs short and implementation-relevant.

## Verification

* Use `git diff --check -- docs/adr` for documentation-only whitespace checks.

## Child DOX Index

* No child DOX files are currently defined.
