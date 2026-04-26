---
name: Queue-Härtung — Reaper, max_attempts-Eskalation, Phantom Pre-Enqueue
description: Drei strukturelle Queue-Fixes — fn_reap_stale_processing_jobs (Cron */5), BEFORE-UPDATE Trigger fn_guard_max_attempts_escalation, und fn_step_already_terminal Pre-Enqueue Guard in beiden enqueue_job_if_absent Overloads.
type: feature
---

# Queue-Härtung v1 — 2026-04-26

## Problem
Queue-Analyse zeigte drei systemische Symptome:
- **Stale-Processing**: Mehrere Jobs >10 min ohne Heartbeat im `processing` (Worker-Crash, Timeout).
- **max_attempts Drift**: Jobs liefen mit `attempts > max_attempts` weiter (z. B. 10/3 bei `package_quality_council`), weil kein Trigger eskalierte.
- **STEP_ALREADY_DONE_PHANTOM**: 72 Cancels in 24h — der Phantom-Sweep im Claim canceled erst beim Anfassen, nicht beim Einreihen → Queue-Lärm.

## Fix

### 1) `fn_reap_stale_processing_jobs(p_stale_minutes int default 10)`
- Findet `status='processing'` Jobs mit `COALESCE(last_heartbeat_at, locked_at, started_at) < now() - p_stale_minutes`.
- **Requeue** wenn `attempts < max_attempts`: status=pending, lock release, `last_error_code=STALE_PROCESSING_REAPED`, run_after=+60s.
- **Fail** wenn `attempts >= max_attempts`: status=failed, `last_error_code=STALE_PROCESSING_EXHAUSTED`.
- Cron `reap-stale-processing-jobs` alle 5 min (jobid 125).
- Audit in `auto_heal_log`.

### 2) `fn_guard_max_attempts_escalation` (BEFORE-UPDATE Trigger auf job_queue)
- Feuert nur wenn `attempts`/`max_attempts`/`status` sich ändert.
- Wenn `attempts > max_attempts` UND status nicht terminal → setzt status=failed, `last_error_code=MAX_ATTEMPTS_EXHAUSTED`, `liveness_status=cooldown_exhausted`.
- Backfill bei Install: alle Drift-Jobs sofort eskaliert.

### 3) `fn_step_already_terminal(job_type, package_id) → boolean`
- Helper, der prüft ob `package_steps.status IN ('done','skipped')` für den abgeleiteten step_key.
- Aufgerufen **als erste Prüfung** in **beiden** `enqueue_job_if_absent` Overloads (6-arg priority-first und 6-arg payload-first).
- Bei Treffer: kein INSERT, Rückgabe `phantom_blocked`, Audit-Log Eintrag.
- Test verifiziert: `SELECT * FROM enqueue_job_if_absent('package_generate_oral_exam'::text, 'dd000001-...')` → status=`phantom_blocked`.

## Komplementär zu
- `claim_pending_jobs_by_types` Phantom-Sweep bleibt als **Belt-and-Suspenders** drin (fängt Jobs, die durch Race-Conditions doch reinrutschen).
- `kill_stale_processing_jobs_v2` (alt) und `fn_reap_stale_processing_jobs` (neu) koexistieren — neuer Reaper hat sauberere Eskalationslogik und nutzt `last_heartbeat_at` als primäres Signal.

## Hotfix gleichzeitig appliziert
- Paket `dd000001-0005-4000-8000-000000000001` Step `generate_oral_exam` via `admin_force_steps_done(emergency_bypass=true)` auf done — 0/15 oral_exam blueprints waren systembedingt nicht erfüllbar.
- Geparkter Job `be6d67f2-...` cancelled.
