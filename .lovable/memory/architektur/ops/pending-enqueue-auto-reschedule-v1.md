---
name: Pending-Enqueue Auto-Reschedule
description: Verhindert dauerhaft stuck pending_enqueue Steps durch pg_cron + fn_reschedule_pending_enqueue_steps; Heal nur für building-Pakete ohne aktiven Job
type: feature
---

## Problem
Steps können beim atomic-coupling-Trigger (siehe atomic-step-job-coupling-v2) wegen Cap/Cooldown auf `pending_enqueue` zurückgewiesen werden. Bisher gab es keinen Re-Enqueuer — Steps verblieben dauerhaft (bis 22h beobachtet) im Status, blockierten den DAG und damit nachfolgende Jobs (35 Jobs ohne `started_at`/`prereq_reason` waren Symptom dieses Bugs).

## Lösung
- `fn_reschedule_pending_enqueue_steps(p_min_age_seconds, p_max_per_run, p_triggered_by)` — Snapshot-then-Update Pattern, healt `pending_enqueue → queued` wenn:
  1. Step ist älter als min_age (Default 300s)
  2. `course_packages.status = 'building'`
  3. Kein aktiver Job (`pending|queued|processing|running|batch_pending`) für `package_id` + `package_<step_key>` existiert
- pg_cron `pending_enqueue_reschedule_minutely`: jede Minute, 5min min-age, max 25 pro Lauf
- Audit-Log `pending_enqueue_reschedule_log` (admin-RLS) inkl. Fehler-Capture per `EXCEPTION WHEN OTHERS`
- Diagnose-View `v_pending_enqueue_stuck` (admin sichtbar)

## Bekannte Edge-Cases
- Pakete in `status='queued'` oder `'blocked'` werden NICHT gehealt (korrekt — separater Bypass-Pfad nötig)
- Cascade-Reset-Trigger (`cascade_reset_downstream_steps` AFTER UPDATE) kann bei manchen Steps "tuple already modified" werfen — wird im Audit-Log als `reschedule_failed: ...` erfasst, kein Crash
- 2 Steps mit hartem Trigger-Konflikt brauchen manuellen Heal-Pfad (TODO)

## Migration
`20260424041307_pending_enqueue_auto_reschedule.sql`

## Cron
```sql
SELECT cron.schedule(
  'pending_enqueue_reschedule_minutely',
  '* * * * *',
  $$ SELECT public.fn_reschedule_pending_enqueue_steps(300, 25, 'cron'); $$
);
```
