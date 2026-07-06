# DESIGN.md

## Status

The current ccMixter Stem Downloader visual direction is accepted.

The calm light UI, panel surfaces, teal accent, border radius scale, and bottom status bar concept defined in `src/renderer/styles.css` are part of the product design and must not be replaced casually.

Typography (font sizes, weights, density) may still be tuned for readability.

## Scope

This document governs Renderer/UI design decisions under `src/renderer/`.

## Design Contract

- Preserve the existing color palette (`--color-bg`, `--color-panel`, `--color-accent` teal, warning/error/success/info tones) unless the user explicitly requests a redesign.
- Preserve the current calm, utility-first desktop app direction: white/near-white panels, soft borders, restrained teal accent, no gradients.
- Keep the bottom status bar as the persistent place for the download folder path and the primary download call-to-action.
- Keep technical/developer details collapsed or secondary (see `TechnicalDetails`).
- Main-flow UI must use musician-facing language: song, file, upload, download folder, files selected. Avoid developer terms (group, resolver, candidate, confidence, source mode, merge, session) outside Technical details.
- Do not introduce chips, badges, noisy metadata pills, decorative gradients, or dashboard clutter.
- Do not repeat artist/song/title information unnecessarily.
- Font sizes, weights, and spacing may be adjusted for readability and density.
- Review and download are separate user states:
  - Review: choose and rename files.
  - Download: show progress and result only. No editing, no archive inspection.
- ZIP content disclosure should be compact, borderless, and complete when opened (no truncation).

## Reference Tokens

Current values live in `src/renderer/styles.css` (`:root`); this section is a pointer, not a duplicate source of truth:

- Surfaces: `--color-bg`, `--color-panel`, `--color-panel-alt`
- Borders: `--color-border`, `--color-border-strong`
- Text: `--color-text`, `--color-muted`
- Accent: `--color-accent` (teal), `--color-accent-soft`, `--color-accent-soft-border`
- Semantic: warning / error / success / info background-border-text triples
- Shape: `--radius-sm` (6px), `--radius-md` (8px), `--shadow-panel`
- Layout: `--status-bar-height` (52px), `--space-*` scale

## Changing This Contract

Only change colors, panel chrome, or the bottom-status-bar concept when the user explicitly asks for a redesign. Typography and density changes do not require sign-off.
