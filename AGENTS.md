# AGENTS.md

## Project Goal

We are building an Electron desktop application for searching, reviewing, downloading, and license-safe documenting of ccMixter tracks.

Primary goals:

* secure Electron architecture
* reliable download engine
* transparent license and attribution display
* reproducible tests and builds
* maintainable, agent-readable repository structure

## Working Principles

* Work incrementally and keep diffs small.
* Change only what is necessary for the current task.
* Prefer clarity over cleverness.
* Do not make silent assumptions about license logic or API field names.
* If project information is missing, mark it explicitly as `not specified` or `TODO`.
* Prefer Main Process services for privileged operations.
* Keep the Renderer free of Node/Electron-specific logic.
* Document architecture decisions with short ADR notes in `docs/adr/` when a decision is expected to outlive a single sprint.

## Technical Guardrails

* Keep secure Electron defaults enabled:

  * `contextIsolation: true`
  * `sandbox: true`
  * no `nodeIntegration` in the Renderer
* Do not use synchronous IPC calls.
* Do not perform blocking I/O operations in the Main Process.
* Do not expose broad `contextBridge` objects; expose only small, named APIs.
* Do not perform implicit file-format or license conversions.
* Download and license data must be persisted by the Main Process.
* UI components should remain presentation-focused whenever possible.
* Shared types and IPC contracts belong in `src/shared/`.

## Repository Expectations

Expected folders:

* `src/main/` for Main Process logic
* `src/preload/` for secure bridge APIs
* `src/renderer/` for UI
* `src/shared/` for types, contracts, and domain models
* `test/fixtures/` for API and license fixtures
* `docs/` for architecture, ADRs, and release documentation
* `.github/workflows/` for CI/CD

If the actual structure differs:

* first explain the existing structure
* then propose minimally invasive adjustments
* do not perform large-scale reorganization without a clear instruction

## Agent Roles

### Developer Agent

Responsibilities:

* implement architecture
* build services, IPC, UI, and persistence
* preserve type safety
* make technical debt visible

Delivers:

* production code
* small, targeted refactorings
* technical notes for relevant decisions

### Tester Agent

Responsibilities:

* unit and integration tests
* E2E smoke tests
* fixture maintenance
* regression detection

Delivers:

* Vitest tests
* Playwright Electron tests
* reproducible test data

### Release Agent

Responsibilities:

* Forge and packaging configuration
* GitHub Actions workflows
* release checklists
* artifact and channel management

Delivers:

* build configuration
* CI/CD workflows
* release note templates

### Security Agent

Responsibilities:

* Electron security defaults
* IPC surface review
* secret handling
* permission and content review

Delivers:

* security review comments
* hardening recommendations
* secure-default checklists

### Legal Agent

Responsibilities:

* license display
* attribution logic
* warning and notice copy
* risk notes for unknown license states

Delivers:

* license matrix
* UI wording
* manifest and attribution text

### UX Agent

Responsibilities:

* search, detail, and download flows
* accessibility fundamentals
* clear states for errors and offline behavior
* UI information hierarchy

Delivers:

* component-level UX decisions
* empty, loading, and error states
* microcopy

## Interfaces Between Agents

* The Developer Agent publishes new domain models and IPC contracts in `src/shared/`.
* The Tester Agent writes tests against these public contracts, not against incidental internals.
* The Security Agent reviews all changes to:

  * `src/preload/`
  * IPC channels
  * window/session configuration
  * external network communication
* The Legal Agent reviews all changes to:

  * license model
  * attribution export
  * UI text about permitted use
* The Release Agent reviews all changes to:

  * Forge configuration
  * workflows
  * installer/signing logic
* The UX Agent reviews all changes to search, detail, and queue surfaces.

## Prioritized Task Queue

### First

* Establish project structure and secure Electron shell
* Type IPC contracts
* Set up ccMixter API client with fixtures
* Define license model and attribution manifest
* Implement download queue with progress, retry, and cancel

### Next

* Build search page, detail view, and queue UI
* Persist settings and download paths
* Add Vitest and Playwright foundations
* Set up GitHub Actions matrix for tests and builds

### Then

* Stabilize packaging for Windows, macOS, and Linux
* Add signing preparation
* Prepare beta/stable release channels
* Improve offline caching and local re-indexing

### Later

* Evaluate auto-update
* Add extended library features
* Add batch downloads and download templates
* Add advanced attribution export formats

## Definition of Done

A task is only done when:

* the code can be built
* linting and relevant tests pass
* new or changed IPC contracts are typed
* error paths are handled at least at a basic level
* user states for loading, empty, and error cases are visible
* security-relevant changes are briefly justified
* license-related changes do not introduce silent default assumptions

## Prohibited

* Do not enable `nodeIntegration` in the Renderer.
* Do not access the file system directly from the Renderer.
* Do not use silent defaults such as “unknown license = commercially allowed”.
* Do not add large dependencies without justification.
* Do not use uncommented magic strings for IPC channels.
* Do not introduce release automation that requires signing or secrets without fallback documentation.

## Placeholders and Unknowns

The following points are currently not specified and must be added when needed:

* `[APP_NAME]`
* `[BUNDLE_IDENTIFIER]`
* `[ICON_PATHS]`
* `[PREFERRED_PACKAGE_MANAGER]`
* `[TARGET_RELEASE_CHANNELS]`
* `[DEFAULT_DOWNLOAD_DIR_POLICY]`
* `[TELEMETRY_POLICY]`
* `[LEGAL_REVIEW_OWNER]`
