---
name: integrity-check-heartbeat-and-shard-roadmap-v1
description: package-run-integrity-check Heartbeat-Stage-1 (live, 25s tick) und Sharding-Roadmap (Stage 2, geplant). Verhindert STALE_LOCK_RECOVERY-Loops bei Pools >800 approved Fragen.
type: feature
---

# Integrity-Check Heartbeat + Shard Roadmap

## Problem (forensisch verifiziert 2026-04-16)

`package-run-integrity-check` ist 1754 Zeilen monolithisch. Pakete mit
≥800 approved Fragen erreichen NIE `completed`-Status:

- 11 Jobs gleichzeitig in `processing` ohne `attempts`-Increment
- Edge stirbt vor Lock-Update → STALE_LOCK_RECOVERY → Re-Pickup → Loop
- Erfolgreiche Runs (1424 Fragen) zeigen 0.05–13s Dauer — nur weil
  pagination-truncation den Pool künstlich begrenzte. Vollscan crasht.

## Stage 1 — Heartbeat (LIVE seit 2026-04-16)

In `Deno.serve` Handler:
1. `startIntegrityHeartbeat(sb, jobId, packageId)` startet 25s-Loop
2. Ruft `heartbeat_job_processing(p_job_id, p_worker_id, p_meta)` auf
3. Fallback: direktes `meta.processing_tick_at` Update
4. `finally`-Block stoppt Heartbeat sicher (auch bei early-return)

**Effekt:** `fn_release_stale_job_locks` betrachtet Jobs mit
`processing_tick_at < 3min` als alive. Damit endet der Recovery-Loop für
Jobs, die legitim 60–120s laufen.

## Stage 2 — Sharding (GEPLANT)

Wenn Heartbeat allein nicht reicht (Edge-Wallclock-Limit ~150s), wird
das Async-Pattern eingeführt:

```
package-run-integrity-check (orchestrator)
  → erstellt integrity_check_runs Row (status=running)
  → enqueued N × integrity_check_shard Jobs (250 Fragen pro Shard)
  → returnt 202 sofort
integrity_check_shard (worker)
  → verarbeitet Slice, schreibt partial_result
integrity_check_finalize (aggregator)
  → triggered wenn alle shards done
  → aggregiert + schreibt finalen Report
```

Trigger für Stage 2: Wenn nach 1 Woche Heartbeat-Live noch >2 Pakete
in STALE_LOCK_RECOVERY-Loop fallen.

## Pre-Migration Cleanup (2026-04-16)

Cancellt 11 stuck Jobs mit `pre_heartbeat_migration_cancel` Marker,
enqueued frische Jobs für 9 building-Pakete mit Curriculum-Referenz im
Payload (SSOT-Guard-konform). Audit in `admin_actions`.

## SSOT-Regeln

- **Heartbeat-Pflicht:** Jede Edge-Function mit erwarteter Laufzeit >30s
  MUSS `heartbeat_job_processing` alle ≤30s aufrufen
- **Finally-Cleanup:** Heartbeat-Handle MUSS in `finally` gestoppt werden
- **Job-Payload SSOT:** `package_run_integrity_check` Payload MUSS
  `package_id` + `curriculum_id` enthalten (guard_job_payload Trigger)
- **Stale-Detection-Hierarchie:** Heartbeat (<3min) > attempts > lock_age
