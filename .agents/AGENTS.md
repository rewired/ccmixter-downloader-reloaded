# AGENTS.md

## Purpose

This subtree contains local agent skills and support material used by repository automation.

## Ownership

* Owns local skill packages under `.agents/skills/`.
* Does not own application source, tests, docs, or release configuration.
* Root `AGENTS.md` owns repo-wide DOX, security, and license-safety rules.

## Local Contracts

* Treat skill instructions and reference material as durable agent tooling.
* Do not edit imported or third-party skill material unless the task is explicitly skill maintenance.
* Keep skill-local `AGENTS.md` files authoritative for their own package subtree.

## Work Guidance

* When adding or removing a skill package, update this Child DOX Index.
* Keep skill documentation concise and separate from application documentation.

## Verification

* No local verification command is specified for skill metadata.

## Child DOX Index

* `skills/` contains local skill packages. Existing nested `AGENTS.md` files inside skill packages control their own local instructions.
