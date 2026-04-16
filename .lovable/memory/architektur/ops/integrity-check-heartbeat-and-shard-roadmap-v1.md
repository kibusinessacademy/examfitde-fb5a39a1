---
name: integrity-check-heartbeat-and-shard-roadmap-v1
description: package-run-integrity-check Heartbeat-Stage-1 + Live-Verifikation v_integrity_check_heartbeat_health + Sharding-Roadmap (Stage 2) + Fix #3 artifact-aware Stale-Lock-Recovery + Step-Sync executed-Marker.
type: feature
---

# Integrity-Check Heartbeat + Shard Roadmap

## Stage 1 — Heartbeat (LIVE seit 2026-04-16, deployed)

In `Deno.serve` Handler von `package-run-integrity-check`:
1. `startIntegrityHeartbeat(sb, jobId, packageId)` startet 25s-Loop
2. Ruft `heartbeat_job_processing(p_job_id, p_worker_id, p_meta)` auf
3. Fallback: direktes `meta.processing_tick_at` Update
4. `finally`-Block stoppt Heartbeat sicher

## Live-Verifikations-View

`v_integrity_check_heartbeat_health` klassifiziert Jobs in 6 Klassen:
- `alive` — tick <90s
- `progressing` — tick <3min
- `no_heartbeat_yet` — >60s ohne tick
- `stale_lock` — tick >3min
- `sharding_required` — >800 approved + recoveries≥2
- `completed`/`failed`/`cancelled`/`pending`

## Fix #3 — Artifact-Aware Stale-Lock-Recovery (LIVE seit 2026-04-16 19:36)

**Problem:** Job-Runner crasht bei Tick-Capacity-Overflow (8 schwere Jobs × 10-15s > 110s Edge-Limit), bevor er `status=completed` persistiert. Edge-Function hat aber bereits `integrity_report` geschrieben.

**Lösung in `fn_release_stale_job_locks`:**

```sql
IF v_rec.job_type = 'package_run_integrity_check'
   AND v_rec.has_integrity_report
   AND v_rec.integrity_version IS NOT NULL
   AND v_rec.pkg_updated_at > v_rec.started_at  -- KRITISCH: Bericht muss frischer als Job sein
THEN
  UPDATE job_queue SET status='completed', ...
  CONTINUE;  -- nicht erneut requeuen
END IF;
```

**Schutz vor Fehldiagnose:** `pkg_updated_at > started_at` verhindert, dass ein alter Report einen kaputten neuen Lauf fälschlich grün färbt.

## Step-Sync executed-Marker (LIVE seit 2026-04-16 19:37)

**Lücke:** `fn_trigger_sync_step_on_job_complete` setzte nur `meta.ok='true'`, aber `fn_guard_integrity_requires_execution` verlangt zusätzlich `meta.executed='true'` für `run_integrity_check`.

**Fix:** Step-Sync setzt jetzt beide Marker. Da `result.ok=true` bedeutet, dass die Edge-Function gelaufen ist, ist `executed=true` semantisch korrekt.

## Recovery-Sweep 2026-04-16

9 Jobs vom Pre-Fix-Hard-Kill geheilt:
- **2 Pakete (passed=true, Score 100):** auf `completed` gesetzt
- **7 Pakete (passed=false, Score 69-91):** bleiben `failed`, aber mit korrektem `QUALITY_THRESHOLD_NOT_MET` Error statt irreführendem `STALE_LOCK_LOOP_HARD_KILL`

## Fix #1 — Per-Type Tick-Capacity Cap (LIVE seit 2026-04-16 20:30)

**Problem:** Runner claimt im selben Tick bis zu 8 schwere `package_run_integrity_check` Jobs (lane="control", budget≈3-4, plus redistribution). Bei 10-15s pro Job überschreitet die serielle Verarbeitung das 110s Edge-Limit → Runner-Pod abortet bevor `status=completed` persistiert wird.

**Lösung in `_shared/runner-lanes.ts`:**

```typescript
export const PER_TYPE_TICK_CAPS: Record<string, number> = {
  package_run_integrity_check: 2,
  package_quality_council: 2,
  package_validate_exam_pool: 3,
  package_validate_handbook_depth: 3,
  package_elite_harden: 2,
  package_repair_exam_pool_quality: 2,
};
```

**Anwendung in `job-runner/index.ts`:** Direkt nach Lane-Claim, vor Pool-Autofix. Übersteigt ein Jobtyp den Cap, werden überzählige Jobs sauber zurück auf `pending` gesetzt mit `run_after = now()+5s` und `meta.per_type_cap_deferred_at`. Lane-Claim selbst bleibt unverändert (FIFO-Fairness pro Lane bleibt erhalten).

## Fix #3 v2 — Schemafest gegen v3 integrity_report (LIVE seit 2026-04-16 20:29)

**Problem v1:** Recovery prüfte `integrity_report_version_num IS NOT NULL`, aber v3-Reports speichern Score als **number** (nicht Objekt) und neue Pakete kennen primär `gate_version` ("COURSE_READY_v1.7"). Bei Score < 80 hat v1 den Job als `STALE_LOCK_LOOP_HARD_KILL` markiert statt als fachlichen Fail.

**Lösung v2:**
- Evidenz-OR: `integrity_version_num IS NOT NULL OR gate_version IS NOT NULL`
- Score-Lesen tolerant: `jsonb_typeof(...) = 'number'` ODER `'object'` mit `overall`
- Pfad A `integrity_passed=true` → `completed`
- Pfad B `integrity_passed=false` → `failed/QUALITY_THRESHOLD_NOT_MET` (statt Hard-Kill nach 5 Cycles)

## Stage 2 — Sharding (NUR bei echtem Bedarf)

**Trigger:**
- Ein Paket mit >800 Fragen crasht trotz Heartbeat + Per-Type-Cap erneut
- Mediane Laufzeit nähert sich Edge-Limit
- Repeated Hard-Kills nach Fix #3 v2

**Pattern:** Orchestrator → N × Shard-Jobs (250 Fragen) → Finalize-Aggregator

## Sweep 2026-04-16 20:25 (Tick-Overflow-Welle)

## Offen (geringere Priorität)

- **Fix #1 — Per-Type-Tick-Cap:** Runner sollte max. 2-3 `package_run_integrity_check` pro Tick claimen (nicht 8). Reduziert Crash-Wahrscheinlichkeit.
- **Fix #2 — Immediate-Persistence:** Runner schreibt `finalState` sofort nach jedem Job, nicht am Tick-Ende. Heilt die Wurzelursache.

## SSOT-Regeln

- **Heartbeat-Pflicht:** Edge-Functions >30s MÜSSEN `heartbeat_job_processing` ≤30s aufrufen
- **Finally-Cleanup:** Heartbeat-Handle MUSS in `finally` gestoppt werden
- **Artifact-Aware Recovery:** Stale-Lock-Recovery für integrity-check MUSS `pkg_updated_at > started_at` prüfen
- **Step-Sync executed:** Trigger MUSS `executed=true` setzen, sonst blockt Integrity-Guard
- **Live-Verifikation:** `v_integrity_check_heartbeat_health` ist die kanonische Wahrheit für Health-Klassifikation
