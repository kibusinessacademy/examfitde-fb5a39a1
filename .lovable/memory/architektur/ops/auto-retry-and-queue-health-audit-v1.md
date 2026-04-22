---
name: Auto-Retry, Root-Cause Dashboard, Queue Health Alerts & Status Audit
description: SSOT-Komponenten für deterministische Failed→Pending Recovery, Klassifizierung, Stagnations-Alerts und vollständige Status-Transition Auditierung der job_queue.
type: feature
---

## Komponenten

1. **`fn_auto_retry_failed_jobs(_limit int)`** — klassifiziert per `fn_classify_job_error(last_error/error)`, wendet pro Klasse Cooldown + max_retry an, überspringt terminale Klassen (HARD_FAIL_*, REQUEUE_LOOP_KILLED ≥2x), cancelled Duplikate (gleicher package_id+job_type bereits aktiv). Cron: alle 2 Min.
2. **`v_failed_jobs_root_causes`** — gruppiert Failed-Jobs nach error_class × job_type, liefert affected_packages, last_run_at, avg_attempts, sample_error.
3. **`fn_check_queue_health_alerts()`** — schreibt `admin_notifications` (category='queue_health') bei REQUEUE_LOOP_KILLED-Cluster (≥3) oder Failed-Stagnation (≥30 Min, ≥10 Jobs, nicht abnehmend). Snapshots in `queue_health_snapshots`. Cron: alle 5 Min.
4. **`job_status_transitions`** + Trigger `trg_log_job_status_transition` (AFTER INSERT/UPDATE OF status) — loggt jede Statusänderung mit `trigger_source` (auto_retry_policy / service_role / admin_ui), error_class, attempts, meta.
5. **UI: `QueueHealthDashboard`** (in `QueuePage.tsx`, mobile-first) — Alerts, Auto-Retry/Health-Check Buttons, Root-Cause Liste mit terminal-Markierung, Live-Audit-Log.

## Policy-Tabelle (Cooldown / Max-Retry pro Klasse)

| Klasse | Cooldown | Max-Retry |
|---|---|---|
| STALE_LOCK_LOOP_HARD_KILL | 300s | 8 |
| REPAIR_COMPETENCY_COVERAGE | 180s | 6 |
| NON_BUILDING_PACKAGE | 30s | 5 |
| WATCHDOG_RECOVERY | 60s | 5 |
| TIMEOUT | 90s | 6 |
| RATE_LIMIT | 240s | 10 |
| QUALITY_THRESHOLD_NOT_MET | 600s | 4 |
| REQUEUE_LOOP_KILLED | 600s | 3 (skip nach attempts≥2) |
| HARD_FAIL_* / HARD_FAIL_BREAKER | — | terminal, kein Retry |
| OTHER | 120s | 5 |

## Warum

Ersetzt das manuelle Clone-and-Cancel Pattern (siehe Migration 20260422075412). Status-Audit ermöglicht forensische Analyse jeder Transition (failed→pending, building→queued, cancelled) mit Quelle.
