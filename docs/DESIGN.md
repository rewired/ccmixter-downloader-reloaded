# DESIGN.md

## Status

The current ccMixter Stem Downloader visual direction is accepted and now follows the root `DESIGN.md` dark-canvas system.

The implemented UI uses a near-black canvas, charcoal panels, white primary pill buttons, blue focus/selection signals, and a sparse gradient spotlight treatment on the source input panel. The bottom status bar remains part of the product design and must not be replaced casually.

Font sizes must remain unchanged unless the user explicitly asks for typography sizing changes. Weights and density may still be tuned for readability.

## Scope

This document governs Renderer/UI design decisions under `src/renderer/`.

## Design Contract

- Preserve the dark color palette (`--color-bg` near black, `--color-panel` charcoal, white text, `--color-accent` blue, warning/error/success/info tones) unless the user explicitly requests a redesign.
- Preserve the current utility-first desktop app direction: dark canvas, charcoal panels, soft borders, sparse blue signal color, and only one gradient spotlight card treatment in normal review flow.
- Keep the bottom status bar as the persistent place for the download folder path and the primary download call-to-action.
- Keep technical/developer details collapsed or secondary (see `TechnicalDetails`).
- Main-flow UI must use musician-facing language: song, file, upload, download folder, files selected. Avoid developer terms (group, resolver, candidate, confidence, source mode, merge, session) outside Technical details.
- Do not introduce chips, noisy metadata pills, decorative full-page gradients, or dashboard clutter.
- Do not repeat artist/song/title information unnecessarily.
- Do not change existing font-size values without explicit user approval. Weights and spacing may be adjusted for readability and density.
- Review and download are separate user states:
  - Review: choose and rename files.
  - Download: show progress and result only. No editing, no archive inspection.
- ZIP content disclosure should be compact, borderless, and complete when opened (no truncation).

## Reference Tokens

Current values live in `src/renderer/styles.css` (`:root`); this section is a pointer, not a duplicate source of truth:

- Surfaces: `--color-bg`, `--color-panel`, `--color-panel-alt`
- Borders: `--color-border`, `--color-border-strong`
- Text: `--color-text`, `--color-muted`
- Accent: `--color-accent` (blue), `--color-accent-soft`, `--color-accent-soft-border`
- Gradient spotlight anchors: `--color-gradient-magenta`, `--color-gradient-violet`, `--color-gradient-orange`, `--color-gradient-coral`
- Semantic: warning / error / success / info background-border-text triples
- Shape: `--radius-sm` (10px), `--radius-md` (20px), `--radius-lg` (30px), `--radius-pill` (100px), `--shadow-panel`
- Layout: `--status-bar-height` (52px), `--space-*` scale

## Changing This Contract

Only change colors, panel chrome, font sizes, or the bottom-status-bar concept when the user explicitly asks for it. Font weights and density changes do not require sign-off.
