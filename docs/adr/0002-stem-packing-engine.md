# ADR 0002: Stem Packing engine (local-folder ZIP packaging)

## Status

Accepted

## Context

`docs/stem-zipper-port-map.md` inventories the Stem ZIPper reference project (`_import/stem-zipper-main`, reference-only, never imported) and proposes porting its core packing engine as an internal Main-process service for a future "Package Remix" tool. That tool packages a musician's own local remix exports before upload; it is not a "downloaded files → repackage" feature and is not wired to the ccMixter Downloader in this slice.

Slice 2 ports the engine only: `src/main/services/stemPacking/`, callable from tests, with no renderer UI, no IPC/preload, and no post-download repacking behavior.

## Decision

- New service: `src/main/services/stemPacking/` (`packStemFolder`, `expandFiles`, `audioProbe`, `splitStereo`, `packMetadata`, `zipStrategy`, `types`, `index`). Shared request/response/domain types live in `src/shared/domain/stemPacking.ts`.
- `packStemFolder(request)` scans one local folder (non-recursive), skips unsupported files and existing archive files (`.zip`, `.7z`, `.rar`, `.tar`, `.gz`) by default, optionally splits oversized stereo WAV files into temporary mono L/R files, bin-packs files (first-fit-decreasing, deterministic tie-break by path) into `stems-01.zip`, `stems-02.zip`, ..., and always cleans up temp split files (success or failure).
- `yazl` writes ZIP archives; `wavefile` parses/writes WAV for stereo-split probing, replacing the reference project's hand-rolled WAV chunk parser.
- ZIP entries are written uncompressed (store method). Supported audio formats are already compressed (or small WAV fixtures for MVP), so deflate adds CPU cost without a meaningful size benefit, and it keeps archive layout simple to reason about and test.
- License/attribution/BPM are explicit user-provided strings (`StemPackMetadataInput`), not a closed enum of Creative Commons license IDs like the reference project used. Title, artist, and license are required; missing/blank values are a blocking `StemPackError` (`STEM_PACK_VALIDATION_FAILED`) rather than a silent default, per the root license-safety contract.
- Duplicate ZIP entry basenames (e.g., a split output colliding with a pre-existing same-named file) are resolved deterministically via `name (1).ext`, `name (2).ext`, etc. Existing archives are never overwritten unless `options.overwrite` is true; otherwise the next free `stems-NN-{n}.zip` name is chosen.
- No progress reporting, no 7z/volume splitting, no per-extension zip grouping, and no i18n/locale plumbing were ported — these were either out of MVP scope per the port map or added unnecessary coupling for an engine-only slice.

## Consequences

- `yazl`, `wavefile`, and `@types/yazl` were added as dependencies (`yazl`/`wavefile` runtime, `@types/yazl` dev). No 7z tooling and no UI libraries were added.
- Tests in `test/stem-packing/` generate WAV fixtures in-memory via `wavefile` and read ZIP output via a small central-directory-based reader (`test/stem-packing/zipTestUtils.ts`) rather than adding a zip-reading dependency, since this service's writer always emits file-based entries with a streaming data descriptor (zeroed local-header sizes).
- Future slices (3–5 in the port map) can add a narrow IPC/preload contract, a Package Remix UI, and richer features (presets, 7z, progress) on top of this engine without revisiting its core contracts.
