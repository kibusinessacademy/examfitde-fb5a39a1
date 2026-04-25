---
name: Stale-Healer Triple-Conflict für package_run_integrity_check
description: Drei konkurrierende Healer (fn_reset_stale_processing_jobs, fn_release_stale_job_locks, guard_ghost_step_finalization) hielten integrity-check Jobs in einer Endlos-Lockschleife — gelöst durch Job-Type-Ausschluss + gelockerte Recovery-Bedingung + Step-Backfill
type: feature
---

# Stale-Healer Triple-Conflict — Recovery für package_run_integrity_check

## Symptom
Bis zu 8 Jobs `package_run_integrity_check` blieben tagelang im Status `processing`, jeder mit `last_heartbeat_at = NULL` und `last_error: STALE_PROCESSING_GUARD: auto-reset after 5min stale lock` (oft mehrfach geschachtelt). Die Pakete hatten alle `integrity_report_version_num = 17` und valides `integrity_passed`.

## Root Cause: drei kollidierende Heal-Pfade

1. **`fn_reset_stale_processing_jobs`** (5-min Threshold) hat den Job stumpf nach `pending` zurückgesetzt — *bevor* die artefakt-bewusste Recovery zum Zug kam. → kein Fortschritt, nur Loop.

2. **`fn_release_stale_job_locks`** (artifact-aware) hatte die Bedingung `pkg_updated_at > started_at`. In jedem Loop wurde `started_at` neu auf `now()` gesetzt, während `pkg_updated_at` (vom alten Report) konstant blieb → die Bedingung war nach dem ersten Loop nie wieder wahr → Recovery feuerte nie.

3. **`guard_ghost_step_finalization`** blockte den Recovery-Übergang, weil `package_steps.started_at IS NULL` (der Step war nie regulär „running" markiert worden) → Transaktion rollte zurück → Job blieb processing.

## Fix (3 Schichten)

- `fn_reset_stale_processing_jobs` schließt `package_run_integrity_check` jetzt aus (Versionssuffix `v6.5_integrity_check_excluded`). Diese Jobs werden **ausschließlich** von `fn_release_stale_job_locks` bearbeitet.
- `fn_release_stale_job_locks` (`v3_loose_freshness`) nutzt nicht mehr `pkg_updated_at > started_at`, sondern: `has_integrity_report AND integrity_passed IS NOT NULL AND integrity_version_num >= 15`.
- `fn_trigger_sync_step_on_job_complete` setzt beim Step-Done jetzt zusätzlich `started_at = COALESCE(started_at, NEW.started_at, NEW.locked_at, now()-1s)` und `attempts = GREATEST(attempts,1)`, damit `guard_ghost_step_finalization` nicht crasht.

## Invariante
- Nur **eine** Healer-Funktion darf für einen gegebenen Job-Type den `processing → pending/completed/failed` Übergang besitzen.
- Wenn ein Recovery-Pfad einen Step finalisiert, MUSS er auch die Pre-Conditions des entsprechenden Guards (started_at, attempts) plausibel befüllen.

## Verifikation
Direkter Aufruf nach Migration: `released=0, artifact_completed=3, quality_failed=3` (alle 6 reifen Stuck-Jobs in einem Cron-Tick geheilt).
