# AGENTS.md

## Project Goal

We are building an Electron desktop application for searching, reviewing, downloading, and license-safe documenting of ccMixter tracks.

Primary goals:

* secure Electron architecture
* reliable download engine
* transparent license and attribution display
* reproducible tests and builds
* maintainable, agent-readable repository structure

## DOX Framework

DOX is the binding AGENTS.md hierarchy for this repository. Agents must follow DOX instructions across all edits.

### Core Contract

* `AGENTS.md` files are binding work contracts for their subtrees.
* Work products, source materials, instructions, records, assets, and durable docs must stay understandable from the nearest applicable `AGENTS.md` plus every parent `AGENTS.md` above it.
* The closer `AGENTS.md` controls local work details when docs conflict.
* No child `AGENTS.md` may weaken DOX, Electron security defaults, or license-safety requirements from this root contract.

### Read Before Editing

1. Read this root `AGENTS.md`.
2. Identify every file or folder you expect to touch.
3. Walk from the repository root to each target path.
4. Read every `AGENTS.md` found along each route.
5. If a parent `AGENTS.md` lists a child `AGENTS.md` whose scope contains the path, read that child and continue from there.
6. Use the nearest `AGENTS.md` as the local contract and parent docs for repo-wide rules.
7. If docs conflict, the closer doc controls local work details, but no child doc may weaken DOX.

Do not rely on memory. Re-read the applicable DOX chain in the current session before editing.

### Update After Editing

Every meaningful change requires a DOX pass before the task is done.

Update the closest owning `AGENTS.md` when a change affects:

* purpose, scope, ownership, or responsibilities
* durable structure, contracts, workflows, or operating rules
* required inputs, outputs, permissions, constraints, side effects, or artifacts
* user preferences about behavior, communication, process, organization, or quality
* `AGENTS.md` creation, deletion, move, rename, or index contents

Update parent docs when parent-level structure, ownership, workflow, or child index changes. Update child docs when parent changes alter local rules. Remove stale or contradictory text immediately. Small edits that do not change behavior or contracts may leave docs unchanged, but the DOX pass still must happen.

### Hierarchy

* Root `AGENTS.md` is the DOX rail: project-wide instructions, global preferences, durable workflow rules, and the top-level Child DOX Index.
* Child `AGENTS.md` files own domain-specific instructions and their own Child DOX Index.
* Each parent explains what its direct children cover and what stays owned by the parent.
* The closer a doc is to the work, the more specific and practical it must be.

### Child Doc Shape

Create a child `AGENTS.md` when a folder becomes a durable boundary with its own purpose, rules, responsibilities, workflow, materials, or quality standards.

Default section order:

* Purpose
* Ownership
* Local Contracts
* Work Guidance
* Verification
* Child DOX Index

Work Guidance must reflect current project standards or user instructions. Leave it empty when there are no local standards yet. Verification must reflect existing checks. Leave it empty when no local verification exists yet.

### Style

* Keep docs concise, current, and operational.
* Document stable contracts, not diary entries.
* Put broad rules in parent docs and concrete details in child docs.
* Prefer direct bullets with explicit names.
* Do not duplicate rules across many files unless each scope needs a local version.
* Delete stale notes instead of explaining history.
* Trim obvious statements, repeated rules, misplaced detail, and warnings for risks that no longer exist.

### Closeout

1. Re-check changed paths against the DOX chain.
2. Update nearest owning docs and any affected parents or children.
3. Refresh every affected Child DOX Index.
4. Remove stale or contradictory text.
5. Run existing verification when relevant.
6. Report any docs intentionally left unchanged and why.

### User Preferences

* Durable behavior changes requested by the user must be recorded in this root file or the relevant child `AGENTS.md`.
* The user requested DOX as a durable project workflow: re-read applicable `AGENTS.md` chains before editing, update owning docs after meaningful changes, and keep child indexes current.

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
* `.github/workflows/` for CI/CD when workflows exist

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
* the DOX closeout pass has been completed

## Prohibited

* Do not enable `nodeIntegration` in the Renderer.
* Do not access the file system directly from the Renderer.
* Do not use silent defaults such as "unknown license = commercially allowed".
* Do not add large dependencies without justification.
* Do not use uncommented magic strings for IPC channels.
* Do not introduce release automation that requires signing or secrets without fallback documentation.

## Placeholders and Unknowns

The following points are currently not specified and must be added when needed:

* `[APP_NAME]`
* `[BUNDLE_IDENTIFIER]`
* `[ICON_PATHS]`
* `[TARGET_RELEASE_CHANNELS]`
* `[DEFAULT_DOWNLOAD_DIR_POLICY]`
* `[TELEMETRY_POLICY]`
* `[LEGAL_REVIEW_OWNER]`

The preferred package manager is specified by `package.json`: pnpm.

## Child DOX Index

* `.agents/AGENTS.md` covers local agent skills and skill support materials. Root owns only the fact that this folder exists as agent tooling.
* `src/AGENTS.md` covers application source code. Root owns only repo-wide architecture and security requirements.
* `test/AGENTS.md` covers unit, integration, fixture, and E2E tests. Root owns only project-wide Definition of Done and expected verification standards.
* `docs/AGENTS.md` covers durable project documentation and ADRs. Root owns only the requirement to document durable architecture decisions.
* Top-level configuration and metadata files remain owned by this root file: `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.json`, Forge/Webpack/Vitest/Playwright configs, `README.md`, `.gitignore`, and `skills-lock.json`.
* `.github/` is not present yet. Create `.github/AGENTS.md` and index `.github/workflows/` before adding CI/CD workflows.
* `.webpack/`, `out/`, and `node_modules/` are generated or vendor-managed output and are not DOX-indexed for edits.
* `stems-test/` is currently empty local test output space and is not DOX-indexed for durable work.
