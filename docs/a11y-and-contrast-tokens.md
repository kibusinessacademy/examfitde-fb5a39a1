# ExamFit · A11y & Contrast-Token Standard

Single source of truth für Barrierefreiheit und semantische Farbverwendung in
allen `src/components/**`, `src/pages/**`, `src/features/**`.

## Status-Familie v2 (FROZEN — 2026-05-18)

Kanonische, eingefrorene API für Status-Farben. Audit hard-failed bei Drift.

**Erlaubte Tokens** (`color ∈ {error, success, warning, info}`):

| Zweck | Tailwind |
| --- | --- |
| Subtle-Fläche | `bg-status-<color>-bg-subtle` |
| Subtle-Border | `border-status-<color>-border` |
| Text auf Subtle | `text-status-<color>-text` (oder `-fg` Alias) |
| Solid-Fläche | `bg-status-<color>` |
| Text auf Solid | `text-status-<color>-foreground` |
| Solid-Text/Icon | `text-status-<color>` |

**Verboten (hart, blockt CI):**

- `bg-status-bg-subtle` oder `bg-status-bg-subtle-<color>` (inverted; neutral → `bg-surface-sunken`)
- `text-status-fg-<color>` (inverted)
- `(bg|border|text)-status-(danger|warn)` (Legacy-Alias entfernt)
- `(bg|border|text)-status-(error|success|warning|info)/<N>` (Opacity statt Subtoken)

**Erweiterung:** Neue Status-Farben (z.B. `neutral`, `pending`) erfordern
expliziten Token-Taxonomy-Cut — keine ad-hoc-Klassen. Visuelle Aliase
(neuer Status zeigt auf bestehenden Hue) sind erlaubt.

**Quellen:**
- Definition: `src/index.css` (Light + Dark HSL-Vars) + `tailwind.config.ts`
- Audit: `scripts/guards/contrast-token-audit.mjs` (HARD_PATTERNS Block)
- Detail-Memo: `.lovable/memory/design/status-family-v2-drift-cleanup.md`


## Grundregeln (POUR-aligned)

1. **Keine harten Farbklassen** in Komponenten:
   `text-white`, `text-black`, `bg-white`, `bg-black` sind verboten.
   Verwende stattdessen semantische Tokens (siehe `src/index.css`).
2. **Keine Status-Opacity-Surfaces** wie `bg-success/10`, `bg-warning/15`,
   `bg-destructive/20`. Nutze die `*-bg-subtle` / `*-border` Tokens.
3. **Text auf Gradient/Petrol** läuft über `text-text-on-gradient` /
   `text-text-on-petrol`, nicht über `text-white`.
4. **Modal/Sheet-Scrim** verwendet `bg-scrim/80` (Token), nicht `bg-black/80`.
5. **Inline Tracks** auf getönten Backgrounds: `bg-track-subtle/10`.

## Token-Referenz (Auszug)

| Zweck | Token | Tailwind |
| --- | --- | --- |
| Status-Fläche | `--success-bg-subtle` | `bg-success-bg-subtle` |
| Status-Border | `--success-border` | `border-success-border` |
| Status-Text | `--success` | `text-success` |
| Sekundär-Text | `--text-tertiary` | `text-text-tertiary` |
| Auf Gradient | `--text-on-gradient` | `text-text-on-gradient` |
| Modal-Scrim | `--scrim` | `bg-scrim/80` |

Volle Liste: `src/index.css` (Light + Dark) und `tailwind.config.ts`.

## CI-Gates

Alle Gates blocken den PR-Merge bei Verstoß.

| Workflow | Was | Trigger |
| --- | --- | --- |
| `contrast-token-audit` | Statische Token-Hygiene (hard violations FAIL) | PR auf `src/**` |
| `a11y-learner-regression` | jest-axe auf Lesson/Continue/Module | PR auf `src/components/lesson|course/**` |
| `a11y-smoke-routes` | Playwright + axe auf alle public Routen aus `tests/e2e/a11y-routes.ts` | PR + nightly |
| `badge-visual-regression` | Playwright Pixel-Snapshot der Status-Badges | PR auf `src/**` & Tokens |

### Strict-Mode

Die Baseline `scripts/guards/.contrast-token-audit-baseline.txt` ist seit
2026-05-05 leer. Jeder neue Hard-Hit FAIL-t. Eine Datei nur dann
grandfathern, wenn ein refactor-bereit beschlossen ist — Einträge sind
non-comment-Zeilen mit dem Pfad relativ zum Repo-Root.

## Lokale Befehle

```bash
# Token-Audit (statisch, schnell)
node scripts/guards/contrast-token-audit.mjs

# Learner-Komponenten a11y (jest-axe)
bunx vitest run src/test/a11y/learner-components.a11y.test.tsx

# A11y-Smoke (Playwright + axe) gegen Staging
BASE_URL=https://examfitde.lovable.app \
  bunx playwright test tests/e2e/a11y-smoke.spec.ts

# Badge-Visual-Regression
bunx playwright test tests/e2e/badge-visual.spec.ts
# Baseline aktualisieren nach absichtlichem Token-Wechsel:
bunx playwright test tests/e2e/badge-visual.spec.ts --update-snapshots
```

## Neue Routen ergänzen

`tests/e2e/a11y-routes.ts` ist SSOT — Eintrag dort genügt, der CI-Workflow
zieht automatisch nach.

## Neue Komponente / neuer Cluster

1. Tokens ausschließlich aus `src/index.css` benutzen.
2. Bei Status-Surfaces: `bg-{success|warning|destructive|info}-bg-subtle`
   + `border-*-border` + `text-*` (nicht `*-foreground` für Subtle-Surface).
3. Falls eine A11y-Regel zum dritten Mal manuell gefixt werden muss → als
   jest-axe Test in `src/test/a11y/` festschreiben.

## Änderungs-Historie

- **2026-05-05** Baseline geleert (13 Files migriert), Strict-Mode aktiv,
  `--scrim`, `--text-on-gradient`, `--track-subtle` Tokens eingeführt,
  `tests/e2e/a11y-routes.ts` als SSOT für Smoke-Routen, Badge-Visual-Suite.
