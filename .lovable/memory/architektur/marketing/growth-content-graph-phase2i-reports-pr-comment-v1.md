---
name: Growth OS Phase 2I — Graph Guards Reports + PR Comments
description: content-graph-health-guard und keyword-graph-sync-guard schreiben JSON+MD Reports, Workflows uploaden Artifacts und posten/aktualisieren idempotente PR-Kommentare via marker. Warn-only, keine DB-Writes.
type: feature
---

# Phase 2I — Graph Guards Reports & PR Comments

## Scripts (warn-only, no DB writes)
- `scripts/guards/content-graph-health-guard.mjs` schreibt zusätzlich:
  - `content-graph-health-report.json`
  - `content-graph-health-report.md`
- `scripts/guards/keyword-graph-sync-guard.mjs` schreibt zusätzlich:
  - `keyword-graph-sync-report.json`
  - `keyword-graph-sync-report.md`

Beide Reports enthalten `status`, `metrics`, `breaches`, `thresholds`, `computed_at` (Sync zusätzlich `samples`).

## Workflows
- `.github/workflows/content-graph-health-guard.yml`
- `.github/workflows/keyword-graph-sync-guard.yml`

Beide:
- `permissions: pull-requests: write`
- `actions/upload-artifact@v4` für JSON + MD (`if: always()`)
- `actions/github-script@v7` postet PR-Kommentar bei `pull_request`, idempotent via Marker-Comment (`<!-- content-graph-health-guard -->` bzw. `<!-- keyword-graph-sync-guard -->`) → Update statt Duplikat.

## Defaults
- Warn-only (exit 0). `STRICT=1` opt-in.
- Daily Cron + PR-Trigger bleiben unverändert.

## Nicht-Ziele
- Keine DB-Writes, kein Auto-Fix.
- UI Card `GrowthGraphHealthStatusCard` folgt im nächsten Schritt.

## Rollback
```bash
git checkout HEAD~1 -- scripts/guards/content-graph-health-guard.mjs scripts/guards/keyword-graph-sync-guard.mjs .github/workflows/content-graph-health-guard.yml .github/workflows/keyword-graph-sync-guard.yml
```
