---
name: Auto-Quarantine + Enqueue-Source Hard Gate v1
description: Job-Type-Level Auto-Quarantine bei ≥30 Cancels/15min. enqueue_source als Pflicht-Tag in payload (Phase 1 warn-only bis 2026-05-09, dann hard-block). Cron-Drift-Guard fn_cron_enqueue_drift_guard als Single-Entry für alle */15-Heiler. Tabelle job_type_quarantine, View v_job_type_quarantine_active, RPC admin_get/clear. Cron auto-quarantine-hot-cancel-loops-5min.
type: feature
---

## Problem
Blind enqueueing Crons (z. B. `coupling_heal_15min`, `enqueue_integrity_rechecks`, worker direct INSERTs) erzeugten Cancel-Loops mit 158/h auf `package_generate_exam_pool`, 65/h auf `package_quality_council`. 100% UNTAGGED.

## Lösung (3 Schichten)

### 1. Auto-Quarantine (Job-Type-Level)
- `public.job_type_quarantine` Tabelle (RLS, admin-read-only)
- `fn_auto_quarantine_hot_cancel_loops(window=15, threshold=30, block=30)` cron alle 5min
- Auditiert in `auto_heal_log` als `job_type_auto_quarantine`

### 2. enqueue_source Hard Gate
- `enqueue_job_if_absent` (6-param overload) prüft `payload->>'enqueue_source'`
- Phase 1 (bis 2026-05-09): warn-only, log nach `auto_heal_log` als `enqueue_source_missing_warn`
- Phase 2 (ab 2026-05-09): hard-block mit return status `enqueue_source_missing`
- Zusätzlich: blockiert wenn `job_type` aktuell quarantäniert (`enqueue_blocked_job_type_quarantined`)

### 3. Cron Drift-Guard
- `fn_cron_enqueue_drift_guard(pkg, jobtype, caller)` Single-Entry für */15 Heiler
- Prüft: quarantine, pkg.status='building', step exists & not terminal, DAG predecessors done, no active job, ≥3 cancels/1h cooldown
- Returns `{allow: bool, reason: text, ...}`

## Verifikation
- Erster Lauf 2026-05-02 06:00: 1 Quarantäne (`package_generate_exam_pool`, 48 cancels/15min, 23 pkgs) für 30min.

## Files
- Migration: `20260502055938_*` (Tabelle, fn_auto_quarantine, enqueue_job_if_absent patch, fn_cron_enqueue_drift_guard, admin_clear, view, RPC)
- Cron: `auto-quarantine-hot-cancel-loops-5min` (id 152)
- Runbook: `docs/runbooks/cron-cancel-loop-repair.md`

## Migrationsleitfaden für bestehende Cron-Producer
Jeder Producer muss vor INSERT:
```sql
IF (SELECT (fn_cron_enqueue_drift_guard(pkg, jobtype, '<cron_name>')->>'allow')::boolean) THEN
  PERFORM enqueue_job_if_absent(jobtype, pkg, 0, 25, NULL,
    payload || jsonb_build_object('enqueue_source','<cron_name>'));
END IF;
```
