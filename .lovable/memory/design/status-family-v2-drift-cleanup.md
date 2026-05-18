---
name: status-Familie v2 Drift-Cleanup
description: Eigene status-{error,success,warning,info}-{DEFAULT,text,foreground,fg,subtle,bg-subtle,border} Token-API. Aliase danger/warn ENTFERNT, inverted bg-status-bg-subtle-X / text-status-fg-X bereinigt. Audit hard-failed auf alle Drift-Pattern.
type: design
---

# status-Familie v2 — finale Taxonomy

## API (Tailwind)
- `bg-status-<color>-bg-subtle` (Subtle-Fläche)
- `border-status-<color>-border` (Subtle-Border)
- `text-status-<color>` (DEFAULT, für Solid-Text/Icons)
- `text-status-<color>-text` (für Subtle-Hintergrund, Dark-Mode-Kontrast aufgehellt)
- `text-status-<color>-fg` (Alias zu -text)
- `bg-status-<color>` (Solid-Fläche, z.B. Fill-Bar)
- `text-status-<color>-foreground` (Text auf Solid-Fläche)
- `bg-status-<color>-subtle` (Alias zu -bg-subtle, kompatibel)

Colors v2: `error`, `success`, `warning`, `info`. KEINE `danger`/`warn` mehr.

## Wo
- `src/index.css`: HSL-Vars Light + Dark. v2 visuell = `destructive`/`success`/`warning`/`info` (kein neuer Hue).
- `tailwind.config.ts`: `colors.status.{error,success,warning,info}.{DEFAULT,text,foreground,fg,subtle,bg-subtle,border}`

## Verboten (hard-fail im Audit)
- `bg-status-bg-subtle` und `bg-status-bg-subtle-<color>` (inverted; neutrale Variante → `bg-surface-sunken`)
- `text-status-fg-<color>` (inverted)
- `(bg|border|text)-status-(danger|warn)` (legacy alias)
- `(bg|border|text)-status-(error|success|warning|info)/<n>` (opacity statt named subtoken)

Audit: `scripts/guards/contrast-token-audit.mjs` — HARD_PATTERNS Block. CI `contrast-token-audit.yml` blockt PRs.

## Migration 2026-05-18
- `bg-status-bg-subtle-{error,success,warning,info}` → `bg-status-<color>-bg-subtle` (25 Stellen)
- `text-status-fg-{error,success,warning,info}` → `text-status-<color>-fg`
- `bg-status-bg-subtle-{danger,warn,muted}` → error/warning/surface-sunken
- `status-danger` → `status-error`, `status-warn` → `status-warning` (direct rename, keine Alias-Phase)
- Bare `bg-status-bg-subtle` (no color) und `bg-status-bg-subtle/30` → `bg-surface-sunken`
- 26 Files migriert über sed-Pass.

Verbleibend: 1 soft warning in `AdminH5PSmokePage.tsx` (`bg-destructive/15`, P3/dev-only).
