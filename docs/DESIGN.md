# DESIGN.md

## Status

The current ccMixter Stem Downloader visual direction is accepted and follows this dark-canvas system.

The implemented UI uses a near-black canvas, charcoal panels, white primary buttons, blue focus/selection signals, compact low-radius app chrome, and no decorative source-panel gradient. The bottom status bar remains part of the product design and must not be replaced casually.

Font sizes must remain unchanged unless the user explicitly asks for typography sizing changes. Weights and density may still be tuned for readability.

## Scope

This document governs Renderer/UI design decisions under `src/renderer/`.

## Design Contract

- Preserve the dark color palette (`--color-bg` near black, `--color-panel` charcoal, white text, `--color-accent` blue, warning/error/success/info tones) unless the user explicitly requests a redesign.
- Preserve the current utility-first desktop app direction: dark canvas, charcoal panels, compact low-radius chrome, soft borders, and sparse blue signal color.
- Keep the bottom status bar as the persistent place for the download folder path and the primary download call-to-action.
- Keep technical/developer details collapsed or secondary (see `TechnicalDetails`).
- Main-flow UI must use musician-facing language: song, file, upload, download folder, files selected. Avoid developer terms (group, resolver, candidate, confidence, source mode, merge, session) outside Technical details.
- Do not introduce chips, noisy metadata pills, decorative source-panel gradients, decorative full-page gradients, or dashboard clutter.
- Do not repeat artist/song/title information unnecessarily.
- Do not change existing font-size values without explicit user approval. Weights and spacing may be adjusted for readability and density.
- App chrome corner radii must not exceed 5px unless the user explicitly asks for a redesign.
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
- Semantic: warning / error / success / info background-border-text triples
- Shape: `--radius-sm` (max 3px), `--radius-md` (max 4px), `--radius-lg` (max 5px), `--radius-pill` (max 5px), `--shadow-panel`
- Layout: `--status-bar-height` (52px), `--space-*` scale

## Changing This Contract

Only change colors, compact panel chrome, font sizes, or the bottom-status-bar concept when the user explicitly asks for it. Font weights and density changes do not require sign-off.
