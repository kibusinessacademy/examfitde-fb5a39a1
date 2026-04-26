---
name: DAG-Block durch Step-Status-Drift + Auto-Recovery
description: Zwei strukturelle Pipeline-Stalls — Job/Step-Drift bei skipped completions UND failed Predecessor-Steps ohne Auto-Requeue — werden via Reconcile-Trigger (sofort) und Cron (5/7 Min) geheilt
type: feature
---

## Problem (2026-04-26)
0 processing trotz 9 fälliger pending Jobs. Worker zog nichts, weil `claim_pending_jobs_v4` strikt filtert: alle `package_*` Jobs verlangen, dass alle `depends_on`-Steps in (`done`,`skipped`) sind.

### Zwei Drift-Quellen
1. **Skip-Drift**: `package_generate_lesson_minichecks` (Track STUDIUM) returnt seit 11:50 alle 5 Min `completed` mit `meta.skipped=true / skip_reason=MINICHECKS_DISABLED`. Job-Status reicht aber NICHT bis `package_steps` durch — Step blieb auf `failed`.
2. **Postcondition-Fail-Drift**: `package_quality_council` Job war `completed`, aber unmittelbar danach setzte ein Postcondition-Guard den `package_steps.quality_council` auf `failed`. Es existiert kein Auto-Requeue für solche failed Steps → nachfolgende `auto_publish` Jobs hingen permanent.

## Fixes
### 1. `fn_reconcile_step_status_from_jobs` + Trigger
- Bei jedem Job→completed Transition wird der zugehörige `package_steps`-Eintrag auf `done` (oder `skipped` falls `meta.skipped=true`) gesetzt.
- AFTER UPDATE Trigger `trg_job_complete_reconcile_step` macht das atomar.
- Cron `reconcile-step-status-from-jobs` alle 5 Min als Safety Net (heilt historische Drift).

### 2. `fn_recover_failed_predecessor_steps`
- Findet `package_steps.status='failed'` Steps, die als `depends_on` von wartenden pending Jobs referenziert werden.
- Setzt sie auf `queued` zurück, max **3 Recovery-Versuche** pro Step über 24h, mind. 20 Min Cooldown.
- Logging via `meta.auto_recovery_count` + `meta.last_auto_recovery_at` + `meta.recovery_reason`.
- Cron `recover-failed-predecessor-steps` alle 7 Min.

## Invariante
Wenn `package_steps.X = failed` UND es existiert ein pending Job `package_Y` mit `Y` depends_on `X`, dann **muss X innerhalb 7 Min auf `queued` gehen** (sofern recovery_count < 3). Andernfalls hängt die ganze Kette.

## Sofortige Wirkung
- 5 zuvor blockierte Pakete (BWL-Steuern, WEG-Demo, Restaurants, Kurier, Maler) wurden durch Sofort-Run geheilt
- 2 quality_council Jobs unmittelbar in processing
- Verifiziert: 2 processing, 1 zusätzlicher completed innerhalb 60 sec
