---
name: integrity-check-heartbeat-and-shard-roadmap-v1
description: package-run-integrity-check Heartbeat-Stage-1 (live, 25s tick) + Live-Verifikation v_integrity_check_heartbeat_health + Sharding-Roadmap (Stage 2) + Job-Runner-Completion-Bug (offen).
type: feature
---

# Integrity-Check Heartbeat + Shard Roadmap

## Problem (forensisch verifiziert 2026-04-16)

`package-run-integrity-check` ist 1803 Zeilen monolithisch. Pakete mit
≥800 approved Fragen erreichen NIE `completed`-Status. Nach Live-Test
am 2026-04-16 19:17 wurde aber ein **zweiter, übergeordneter Bug**
identifiziert (siehe „Offener Befund" unten).

## Stage 1 — Heartbeat (LIVE seit 2026-04-16, deployed)

In `Deno.serve` Handler:
1. `startIntegrityHeartbeat(sb, jobId, packageId)` startet 25s-Loop
2. Ruft `heartbeat_job_processing(p_job_id, p_worker_id, p_meta)` auf
3. Fallback: direktes `meta.processing_tick_at` Update
4. `finally`-Block stoppt Heartbeat sicher (auch bei early-return)

**Effekt:** `fn_release_stale_job_locks` betrachtet Jobs mit
`processing_tick_at < 3min` als alive.

## Live-Verifikations-View (kanonisch seit 2026-04-16)

`v_integrity_check_heartbeat_health` klassifiziert Jobs in 6 Klassen:
- `alive` — tick <90s
- `progressing` — tick <3min
- `no_heartbeat_yet` — >60s ohne tick (frisch gepickt oder Kurzläufer)
- `stale_lock` — tick >3min (Heartbeat hängt)
- `sharding_required` — >800 approved + recoveries≥2
- `completed`/`failed`/`cancelled`/`pending` — terminal/wartend

**Trigger Stage 2:**
- Ein Paket mit >800 Fragen crasht trotz Heartbeat erneut
- Mediane Laufzeit nähert sich Edge-Limit
- Repeated Hard-Kills bei diesem Jobtyp

## Offener Befund (2026-04-16 19:17): Job-Runner-Completion-Lücke

**Symptom:** Edge-Function läuft erfolgreich durch (`COURSE_READY`,
`pool_loaded=N/N`, score=73-100), Cold-Start <50ms, returnt 200. Aber
`job_queue.status` bleibt `processing`, der Runner setzt nie `completed`.

**Beweis aus Live-Test:**
- 9 Jobs gleichzeitig gepickt von `job-runner-18760eff` um 19:17:01
- Alle 9 Edge-Function-Calls erfolgreich abgeschlossen 19:17:10–19:17:20
- Logs zeigen `COURSE_READY score=...` für alle Pakete inkl. Scrum 1977q
- Keine `markJobCompleted`-Spur, keine Failure-Spur
- Status nach 3min: alle 9 noch `processing`, age=177s

**Hypothesen (zu prüfen):**
1. Runner hat einen anderen Worker-Pool und ruft nicht selbst die
   Edge-Function — der Heartbeat-Code läuft daher in einem anderen
   Pfad als der Job-Runner-Aufruf
2. Runner ignoriert `200 OK` weil Response-Body das `success`-Flag
   nicht im erwarteten Format hat
3. Doppelte Pickup-Pfade: Cron + Runner picken denselben Job, einer
   führt aus, der andere blockiert das Status-Update

**Nächster forensischer Schritt:**
- Runner-Code in `_shared/job-runner.ts` o.ä. inspizieren
- Prüfen ob Edge-Response-Schema `{ ok, status, ... }` statt `{ success }` ist
- Workspace-Telemetrie für `job-runner-18760eff` prüfen

## Stage 2 — Sharding (GEPLANT, hängt an Runner-Bug)

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

**Vorbedingung:** Runner-Completion-Bug muss zuerst behoben sein,
sonst stranden auch Shard-Jobs auf `processing`.

## SSOT-Regeln

- **Heartbeat-Pflicht:** Jede Edge-Function mit erwarteter Laufzeit >30s
  MUSS `heartbeat_job_processing` alle ≤30s aufrufen
- **Finally-Cleanup:** Heartbeat-Handle MUSS in `finally` gestoppt werden
- **Job-Payload SSOT:** `package_run_integrity_check` Payload MUSS
  `package_id` + `curriculum_id` enthalten (guard_job_payload Trigger)
- **Stale-Detection-Hierarchie:** Heartbeat (<3min) > attempts > lock_age
- **Live-Verifikation:** `v_integrity_check_heartbeat_health` ist die
  kanonische Wahrheit für Health-Klassifikation, kein Ad-hoc-SQL
