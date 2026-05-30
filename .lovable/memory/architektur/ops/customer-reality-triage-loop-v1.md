---
name: Customer-Reality Triage Loop v1 (P0-C)
description: Tägliche Aggregation der Learner+Pre-Customer Reality-Runs zu priorisierter Fix-Queue mit Owner-Mapping, Trend-Diff gegen letzte Baseline, Auto-GitHub-Issues für P0 und Baseline-Snapshot bei RELEASE.
type: feature
---

# Customer-Reality Triage Loop v1

**Cut:** 2026-05-30 (P0-C)
**Prinzip:** Reality → Finding → Fix-Queue → Regression. Kein neues Feature.

## Pipeline

1. `learner-reality-daily.yml` (06:17 UTC) → `reality-results/learner-reality-results.json` + `findings/`
2. `pre-customer-reality-daily.yml` (06:37 UTC) → `reality-results/pre-customer-reality-results.json` + `findings/`
3. **`customer-reality-triage.yml`** (workflow_run, beide trigger) → `triage.json`, `triage-report.md`, GitHub-Issues, Baseline-Snapshot

## SSOT-Files

- `scripts/_lib/reality-owner-map.mjs` — route→owner/surface + kind→fix-hint
- `scripts/customer-reality-triage.mjs` — Triage-Engine (Dedupe via Fingerprint, Trend-Diff, Issue-Stubs)
- `.github/workflows/customer-reality-triage.yml` — Orchestrator
- `reality-baselines/last.json` — letzter RELEASE-Snapshot (committed by bot)

## Fingerprint

Stabile Dedupe-ID = `severity|kind|journey|route|detail[0..120]` → hash.
Gleicher Fingerprint über mehrere Runs = derselbe Bug — verhindert Issue-Spam.

## Gate-Regel

| Overall | Aktion |
|---|---|
| **BLOCK** | P0-Issues auto-geöffnet, exit 2, kein Baseline-Update |
| **REVIEW** | Findings gesammelt, exit 1, kein Baseline-Update |
| **RELEASE** | Baseline `reality-baselines/last.json` committed, exit 0 |

Overall = max(severity) der beiden Runs (BLOCK > REVIEW > RELEASE).

## GitHub Issues

- 1 Issue pro P0-Fingerprint
- Labels: `reality`, `p0`, `owner:<key>`, `surface:<key>`
- Dedupe: Workflow listet offene `reality+p0`-Issues, parsed Fingerprint aus Body, überspringt Duplikate
- Schließen: manuell oder via nächstem Triage-Run wenn Fingerprint nicht mehr vorkommt (Auto-Close kommt in v2)

## Trend-Diff

Pro Run im Report:
- Baseline-Δ Finding-Count
- 🆕 new Findings + new P0
- ✅ resolved Findings (im Baseline, nicht im aktuellen Run)

## Bewusst NICHT gebaut

- Keine neue DB-Tabelle, kein neuer Edge-Worker
- Kein Auto-Close (nur Dedupe-Skip)
- Kein Owner-Routing nach echten GitHub-Teams (Owner ist logischer Surface-Key)
- Keine wöchentliche P1-Cluster-Automation (manuell aus triage.json)
