# Stem ZIPper Port Map

## 1. Executive Summary

The Stem ZIPper core is portable for an MVP. The relevant logic is already organized around a small set of Main-process services for folder scanning, audio probing, stereo WAV splitting, ZIP creation, metadata generation, and progress reporting, so it can be extracted without porting the older app shell.

The correct integration model is a “two tools in one app shell” approach: the existing ccMixter Downloader remains the Source / Prepare tool, while a new Package Remix tool handles local remix exports before upload. This is not a “downloaded files → repackage” feature.

A realistic MVP is about 1–2 engineer-weeks for the core service and a thin entry point, assuming we avoid 7z/volume splitting and keep the renderer intentionally minimal.

## 2. Source Inventory

### Core engine candidates

- [_import/stem-zipper-main/app/electron/services/pack/zipStrategy.ts](_import/stem-zipper-main/app/electron/services/pack/zipStrategy.ts)
  - Likely target: [src/main/services/stemPacking/zipStrategy.ts](src/main/services/stemPacking/zipStrategy.ts)
  - Reason: central ZIP packing flow, archive naming, metadata file injection, and archive output handling.
  - Coupling/risk: depends on the current pack abstractions and metadata entry format.

- [_import/stem-zipper-main/app/electron/services/pack/expandFiles.ts](_import/stem-zipper-main/app/electron/services/pack/expandFiles.ts)
  - Likely target: [src/main/services/stemPacking/expandFiles.ts](src/main/services/stemPacking/expandFiles.ts)
  - Reason: folder scanning, extension filtering, file ordering, split decision logic, and progress bookkeeping.
  - Coupling/risk: mixed file-system and progress concerns; should be trimmed to the local-folder workflow.

- [_import/stem-zipper-main/app/electron/services/pack/splitStereo.ts](_import/stem-zipper-main/app/electron/services/pack/splitStereo.ts)
  - Likely target: [src/main/services/stemPacking/splitStereo.ts](src/main/services/stemPacking/splitStereo.ts)
  - Reason: the key feature for oversized stereo WAV splitting into mono L/R stems.
  - Coupling/risk: temporary-file handling and cleanup must be made explicit and safe.

- [_import/stem-zipper-main/app/electron/services/audioProbe.ts](_import/stem-zipper-main/app/electron/services/audioProbe.ts)
  - Likely target: [src/main/services/stemPacking/audioProbe.ts](src/main/services/stemPacking/audioProbe.ts)
  - Reason: probes WAV/MP3/other headers for codec, channel count, bit depth, and data offsets.
  - Coupling/risk: should be isolated from any UI or IPC assumptions.

- [_import/stem-zipper-main/app/electron/services/pack/metadata.ts](_import/stem-zipper-main/app/electron/services/pack/metadata.ts)
  - Likely target: [src/main/services/stemPacking/packMetadata.ts](src/main/services/stemPacking/packMetadata.ts)
  - Reason: generates metadata, license, attribution, and stamp files for each package.
  - Coupling/risk: license mapping and attribution text shape need review before reusing.

- [_import/stem-zipper-main/app/electron/services/pack/progress.ts](_import/stem-zipper-main/app/electron/services/pack/progress.ts)
  - Likely target: [src/main/services/stemPacking/progress.ts](src/main/services/stemPacking/progress.ts)
  - Reason: progress reporting model for preparing and packing.
  - Coupling/risk: simple and portable; should be adapted to this app’s event shape.

- [_import/stem-zipper-main/app/electron/services/pack/types.ts](_import/stem-zipper-main/app/electron/services/pack/types.ts)
  - Likely target: [src/main/services/stemPacking/types.ts](src/main/services/stemPacking/types.ts)
  - Reason: shared internal types for files, options, strategy context, and results.
  - Coupling/risk: keep these internal to the new service until a shared contract is justified.

- [_import/stem-zipper-main/app/electron/services/pack/index.ts](_import/stem-zipper-main/app/electron/services/pack/index.ts)
  - Likely target: [src/main/services/stemPacking/index.ts](src/main/services/stemPacking/index.ts)
  - Reason: orchestrates analysis, packing, temp-file cleanup, and strategy selection.
  - Coupling/risk: useful as a reference, but should be simplified for the new app shell.

### Possible support code

- [_import/stem-zipper-main/app/common/constants.ts](_import/stem-zipper-main/app/common/constants.ts)
  - Likely target: [src/shared/domain/stemPacking.ts](src/shared/domain/stemPacking.ts)
  - Reason: supported extensions and default size constants are reusable.
  - Coupling/risk: should be slimmed to the local packaging workflow.

- [_import/stem-zipper-main/app/common/packing/constants.ts](_import/stem-zipper-main/app/common/packing/constants.ts)
  - Likely target: [src/shared/domain/stemPacking.ts](src/shared/domain/stemPacking.ts)
  - Reason: size-estimation constants for ZIP overhead and split planning.
  - Coupling/risk: useful, but likely should be adapted rather than copied verbatim.

- [_import/stem-zipper-main/app/common/packing/estimator.ts](_import/stem-zipper-main/app/common/packing/estimator.ts)
  - Likely target: [src/main/services/stemPacking/packEstimator.ts](src/main/services/stemPacking/packEstimator.ts)
  - Reason: planning logic for archive count and size fit.
  - Coupling/risk: not required for the simplest MVP but useful for preview and warnings.

- [_import/stem-zipper-main/app/common/ipc/contracts.ts](_import/stem-zipper-main/app/common/ipc/contracts.ts)
  - Likely target: [src/shared/ipc/contracts.ts](src/shared/ipc/contracts.ts)
  - Reason: a useful template for future narrow IPC contracts.
  - Coupling/risk: avoid broadening the surface; keep it narrow and future-only.

- [_import/stem-zipper-main/app/common/types.ts](_import/stem-zipper-main/app/common/types.ts)
  - Likely target: [src/shared/domain/stemPacking.ts](src/shared/domain/stemPacking.ts)
  - Reason: audio codec and metadata shape hints.
  - Coupling/risk: keep the app’s license semantics explicit.

### Do not port

- [_import/stem-zipper-main/app/src/features](_import/stem-zipper-main/app/src/features))
  - Do not port the old UI, file table, metadata modal, route state, or pack controls.

- [_import/stem-zipper-main/app/src/styles](_import/stem-zipper-main/app/src/styles)) and Tailwind setup
  - Do not port styling or Tailwind configuration.

- [_import/stem-zipper-main/app/src/routes](_import/stem-zipper-main/app/src/routes))
  - Do not port old routing or shell composition.

- [_import/stem-zipper-main/app/electron/preload.ts](_import/stem-zipper-main/app/electron/preload.ts) and old preload/IPC wholesale
  - Do not port the old bridge or IPC model as-is.

- [_import/stem-zipper-main/app/locales](_import/stem-zipper-main/app/locales))
  - Do not port i18n for MVP unless a small, dedicated English-only copy layer is needed.

- [_import/stem-zipper-main/app/package.json](_import/stem-zipper-main/app/package.json), Vite/Electron build config, and packaging scripts
  - Do not port build tooling or packaging config into the current app in this slice.

- [_import/stem-zipper-main/app/electron/services/preferences.ts](_import/stem-zipper-main/app/electron/services/preferences.ts)
  - Do not port the old preferences system unless a later slice clearly needs it for defaults or presets.

## 3. Dependency Map

| Dependency | Why it is needed | MVP | Recommendation |
| --- | --- | --- | --- |
| `yazl` | Core ZIP creation path for writing archive files. | Yes | Add now. |
| `wavefile` | Useful for richer WAV parsing/writing, but not strictly required for the inspected implementation. | No | The inspected code uses a custom WAV parser that handles common cases but may be brittle with non-standard files. For improved robustness and to avoid future maintenance issues with complex WAV formats, replacing the custom parser with `wavefile` is strongly recommended, even for the MVP. |
| Node built-ins (`fs`, `path`, `crypto`) | Folder scanning, temp files, hashing, and stream plumbing. | Yes | Use now; no new dependency needed. |
| `buffer-crc32` | Not clearly required by the inspected pack core. | No | Avoid unless a checksum or integrity feature is explicitly planned. |
| `7zip-bin` and 7z volume tooling | Needed only for 7z/volume-splitting strategy. | No | Exclude from MVP; treat as later-phase work only if the core proves this path is trivial to isolate. |

The safest MVP is a ZIP-only path with optional mono splitting for oversized stereo WAVs, no 7z, and no external archive binary dependency.

## 4. Proposed Target Architecture

Suggested structure:

- [src/main/services/stemPacking/](src/main/services/stemPacking/)
  - [src/main/services/stemPacking/packStemFolder.ts](src/main/services/stemPacking/packStemFolder.ts)
  - [src/main/services/stemPacking/audioProbe.ts](src/main/services/stemPacking/audioProbe.ts)
  - [src/main/services/stemPacking/splitStereo.ts](src/main/services/stemPacking/splitStereo.ts)
  - [src/main/services/stemPacking/zipStrategy.ts](src/main/services/stemPacking/zipStrategy.ts)
  - [src/main/services/stemPacking/expandFiles.ts](src/main/services/stemPacking/expandFiles.ts)
  - [src/main/services/stemPacking/packMetadata.ts](src/main/services/stemPacking/packMetadata.ts)
  - [src/main/services/stemPacking/types.ts](src/main/services/stemPacking/types.ts)

- [src/shared/domain/stemPacking.ts](src/shared/domain/stemPacking.ts)
  - Shared internal request/response and metadata types for the future service.

Future, not yet implemented:

- [src/shared/ipc/contracts.ts](src/shared/ipc/contracts.ts)
- [src/preload/index.ts](src/preload/index.ts)
- [src/renderer/ui/stemPackager/](src/renderer/ui/stemPackager/)

Responsibilities:

- Main: filesystem scanning, audio probing, splitting, ZIP creation, metadata file generation, temp-file lifecycle, progress, and warnings.
- Shared: typed request/response contracts and domain models only.
- Preload: a narrow bridge only when the renderer needs to trigger a pack operation.
- Renderer: presentation-only UI, with no Node/Electron imports and no direct filesystem access.

## 5. Proposed MVP Scope

### Input

- The user chooses a local export folder.
- The user provides or confirms title, artist, BPM, license, and attribution/source text.
- The user chooses options such as max ZIP size and whether to split oversized stereo WAV files.

### Processing

- Scan the local folder for supported audio files.
- Ignore unsupported files.
- Ignore existing ZIPs by default.
- Optionally split oversized stereo WAV files into mono L/R files.
- Create one or more `stems-XX.zip` packages.
- Include metadata, license, attribution, and stamp files.

### Output

- Created ZIP package paths.
- Warnings and skipped files.
- Cleanup result for temporary split files.

### Explicitly excluded from MVP

- Old Stem ZIPper UI
- Tailwind
- Old app preferences
- 7z and volume splitting
- Upload automation
- ccMixter API calls
- Post-download repacking
- Project-wide redesign

## 6. Data Model Sketch

```ts
interface StemPackFolderRequest {
  folderPath: string;
  outputDir?: string;
  title: string;
  artist: string;
  bpm?: string;
  license: string;
  attribution?: string;
  maxArchiveSizeMb: number;
  splitOversizedStereoWav: boolean;
}

interface StemPackOptions {
  maxArchiveSizeMb: number;
  splitOversizedStereoWav: boolean;
  includeStamp: boolean;
  overwrite: boolean;
}

interface StemPackMetadata {
  title: string;
  artist: string;
  bpm?: string;
  license: string;
  attribution?: string;
  sourceText?: string;
}

interface StemPackInputFile {
  path: string;
  sizeBytes: number;
  extension: string;
  kind: 'wav' | 'flac' | 'mp3' | 'aiff' | 'ogg' | 'aac' | 'm4a' | 'opus' | 'wma' | 'unknown';
  stereo?: boolean;
  codec?: string;
  numChannels?: number;
}

interface StemPackWarning {
  code: string;
  message: string;
  filePath?: string;
}

interface StemPackProgress {
  phase: 'scanning' | 'splitting' | 'packing' | 'done' | 'error';
  percent: number;
  currentFile?: string;
  currentArchive?: string;
}

interface StemPackResult {
  archives: string[];
  warnings: StemPackWarning[];
  skippedFiles: string[];
  tempArtifactsRemoved: boolean;
}
```

## 7. Risks and Open Questions

- License mapping and allowed values need a narrow, explicit model rather than implicit defaults.
- Attribution text shape should be standardized so the generated files stay consistent.
- Large file handling needs clear rules for split thresholds, temp-file cleanup, and partial failure behavior.
- Temporary split-file cleanup must be guaranteed even when packing fails midway.
- Filename sanitization must prevent duplicates and path traversal issues.
- ZIP-in-ZIP avoidance needs a simple filter so existing ZIPs are skipped by default.
- Non-WAV stereo files may need conservative handling or an explicit warning.
- Audio probing can be synchronous or async; the service boundary should keep it predictable for the Main process.
- The old Stem ZIPper logic appears to assume a specific UI and preferences model; that should not be imported wholesale.
- Packaging behavior may differ between the old Electron/Vite app and the current Electron Forge/Webpack app, so the port should be kept thin and self-contained.

## 8. Test Plan for Later Implementation

- Pack a simple folder into `stems-01.zip`.
- Include metadata, license, and attribution files.
- Skip unsupported files.
- Skip existing ZIPs by default.
- Split oversized stereo WAVs into mono L/R files.
- Clean up temporary split files after success or failure.
- Preserve original source files.
- Handle duplicate names safely.
- Report warnings clearly.
- Add a renderer safety test ensuring no Node/Electron imports appear in the UI layer.

## 9. Recommended Implementation Slices

### Slice 1

Add an app-shell placeholder with two tools:

- “Get Source Material”
- “Package Remix”

Package Remix is a placeholder only.

### Slice 2

Port the Stem Packing core into [src/main/services/stemPacking/](src/main/services/stemPacking/) with no renderer UI and no IPC beyond tests if needed.

**Status: implemented.** See [docs/adr/0002-stem-packing-engine.md](adr/0002-stem-packing-engine.md) for the concrete engine contract, dependency choices, and scope deviations from this port map (no progress reporting, no per-extension zip grouping, license/attribution as explicit user-provided strings rather than a closed CC enum).

### Slice 3

Add a narrow IPC/preload contract for folder preview and pack start.

**Status: implemented.** `stem-pack:choose-folder`, `stem-pack:preview-folder`, and `stem-pack:pack-folder` are wired in `src/main/index.ts` and exposed through `src/preload/index.ts` as `chooseStemPackFolder`, `previewStemPackFolder`, and `packStemFolder`. Preview reuses the existing `scanStemFolder` read-only scan (new `previewStemFolder` wrapper in `src/main/services/stemPacking/`) and adds a cheap, size-only heuristic for oversized-stereo-WAV candidates (no per-file audio probing). No progress/cancel channels, no UI, and no coupling to the downloader's download pipeline were added.

### Slice 4

Build a minimal Package Remix UI in the current app design.

**Status: implemented.** `src/renderer/ui/PackageRemixView.tsx` replaces the Slice 1 placeholder with a self-contained folder-choose/preview/metadata-form/create-package flow built entirely on the Slice 3 preload API (`chooseStemPackFolder`, `previewStemPackFolder`, `packStemFolder`). It keeps its own local component state (no App-level wiring beyond swapping in the component for the `package` tool) so it stays isolated from the downloader's review/download state. No progress/cancel, no preferences/presets, no 7z/volume options, and no shell/open-path integration were added, per this port map's excluded-from-MVP list.

### Slice 5

Add enhancements such as preferences, presets, richer metadata, and later 7z/volume splitting if still desired.

### Acceptance criteria

- Exactly one documentation file is added: [docs/stem-zipper-port-map.md](docs/stem-zipper-port-map.md)
- No source code is changed
- No dependencies are added
- No config is changed
- The document clearly separates the portable core from the old app shell and UI
- The document explicitly rejects post-download repacking as the integration model
- The document gives a practical two-tool app-shell path for implementation
