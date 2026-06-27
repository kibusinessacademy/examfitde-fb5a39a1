---
name: Pipeline Health Cockpit
description: Read-only operator cockpit projecting job_queue SSOT views into action queue, DLQ summary, stuck jobs, job-type health
type: feature
---
# PIPELINE.HEALTH.OS.1 — Pipeline Operator Cockpit

**Status:** Active · **Version:** pipeline-health-os-1.0.0 · **Cut:** Welle 1 (Read-only Projection, kein Eingriff)

## Mission
Operator sieht in einem Screen, was *jetzt* an der Content-Pipeline brennt — ohne Glossar-Wissen über 60+ Job-Types.
Antwortet: „Was hängt? Wo verbrennen wir Slots? Was muss als Erstes ins Reaper-Triage?"

## Architektur (Freeze-konform)
- **+1 Edge Function:** `evaluate-pipeline-health` (admin-only via `requireAdmin`).
- **+1 UI-Route:** `/admin/governance/pipeline-health`.
- **0 neue Tabellen, 0 neue Cron-Jobs, 0 Trigger.**
- **Pure SSOT:** `supabase/functions/_shared/pipelineHealth/index.ts` — kein DB, kein Fetch, kein Clock-Drift im Math.

## Inputs (existierende Views, read-only)
- `job_health_kpis` — per job_type total/pending/processing/completed/failed/cancelled/blocked + avg_fail_attempts.
- `job_processing_age` — Jobs in `processing` mit `running_for` interval.
- `dead_letter_jobs` (resolved_at IS NULL) — unresolved DLQ Items.
- `job_artifact_blockers_top` — pending Aging je job_type.

## Action-Queue Heuristiken
| Code | Trigger | Severity |
|---|---|---|
| STUCK_RUNNING | `running_for > 10min` | high; > 30min: critical |
| CANCEL_LOOP | `cancel_ratio > 0.5 ∧ total >= 20` | high; > 0.8: critical |
| HIGH_FAIL_RATE | `fail_ratio > 0.2 ∧ total >= 20` | high; > 0.5: critical |
| STALE_PENDING | `pending >= 5 ∧ oldest_updated > 1h` | medium; > 6h: high |
| BLOCKED_BACKLOG | `blocked > 20` | medium; > 100: high |
| DLQ_BACKLOG | `>=3 unresolved DLQ je job_type` | medium; >=5: high; >=10: critical |

Score = `priority(code) × weight(severity)`, Top 20 sortiert. Schwellen explizit für Reproducibility.

## Health-Klassifikation
- **red** wenn `cancel_ratio > 0.5 ∨ fail_ratio > 0.3`
- **yellow** wenn `success_rate < 0.7` oder `total = 0`
- **green** sonst

## Tests
16 Unit-Tests in `src/__tests__/pipeline-health/projector.test.ts` (KPI-Build, alle Action-Codes, Determinismus, Caps).

## Constraints
- **NIE** schreibt in `job_queue`, DLQ, Locks.
- Auto-Refresh 60 s im UI; Edge Function ist idempotent & seiteneffektfrei.
- Bestehende Cron-Jobs (reaper, watchdog, auto-heal) bleiben SSOT für *Eingriffe* — dieses Cockpit ist Diagnostik.

## Nächste Cuts (optional)
- Snapshot-Tabelle für Trend (heute vs. 7d) — bewusst nicht in Welle 1.
- Deep-Link je Action-Item → bestehende Job-Detail-Views.
- Slack/Email-Alert bei `critical` Items > Schwelle.
