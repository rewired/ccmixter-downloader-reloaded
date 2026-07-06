# AGENTS.md

## Purpose

This subtree contains the renderer-side string dictionary and translation helper.

## Ownership

* Owns `src/renderer/i18n/`.
* Parent `src/renderer/AGENTS.md` owns broader Renderer rules and Electron boundaries.
* UI components own where strings are used.

## Local Contracts

* Provide English strings first.
* Keep the translation helper simple and typed.
* Do not add runtime language switching until explicitly required.
* Newly touched main-flow user-facing strings should use the dictionary.

## Work Guidance

* Use musician-facing terms in main-flow strings: song, file, upload, download folder, and files selected.
* Keep developer/debug terms in Technical details only.

## Verification

* Run `pnpm typecheck` after key or type changes.
* Run renderer tests when visible copy or main-flow terminology changes.

## Child DOX Index

* No child DOX files are currently defined.
