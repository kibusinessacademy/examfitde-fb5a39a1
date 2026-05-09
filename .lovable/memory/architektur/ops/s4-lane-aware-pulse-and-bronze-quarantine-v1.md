---
name: S4 Lane-Aware Pulse + Bronze Quarantine v1
description: Lane-aware Auto-Pulse-Failure-Gate (control/default) + Bronze-Quarantäne für STALE_REAP_LOOP_TERMINAL Pakete mit automatischer Trigger-Setzung, Admin-RPCs und Heal-Cockpit-Card.
type: feature
---

**S4 (2026-05-09):**

1. **Lane-aware Pulse-Gate** — `fn_lane_failure_rate_15m(lane,pool)` Helper. `fn_auto_recovery_pulse_decide` nutzt jetzt `fn_lane_failure_rate_15m('control','default')` statt globaler Failure-Rate. Block nur noch wenn `lane_failure_rate>0.30 AND gate.healthy=false` (UND-Verknüpfung). Neue Decision `pulse_allowed_lane_healthy_global_failure_ignored` wenn global hoch, lane gesund. Audit-Meta trennt `global_failure_rate_15m` vs `lane_failure_rate_15m`.

2. **Bronze-Quarantäne** — Neuer Flag `course_packages.feature_flags.bronze_quarantine = {active, reason, since, source_job_id, source_job_type, last_error_excerpt, occurrences, manual_bypass}`. Trigger `trg_quarantine_on_stale_reap_terminal` (AFTER UPDATE on job_queue WHEN status='failed') setzt den Flag automatisch sobald `last_error LIKE '%STALE_REAP_LOOP_TERMINAL%'`. `fn_is_bronze_locked` erweitert → Quarantine-Pakete werden vom existierenden `fn_guard_bronze_lock_on_job_enqueue` automatisch geblockt (kein Code-Touch an anderen Producern).

3. **Admin-RPCs** (admin-gated, SECURITY DEFINER):
   - `admin_get_bronze_quarantine(p_reason, p_limit)` — Filter nach reason, max 500.
   - `admin_requeue_bronze_quarantine(p_package_id, p_reason)` — clear quarantine + manual_bypass=true + enqueue `package_run_integrity_check` mit `bronze_lock_override=true` + Audit `bronze_quarantine_requeue`.

4. **UI** `BronzeQuarantineCard` (`/admin/v2/heal` Sektion 3 nach StuckPatternsCard) — Filter-Chips pro reason, Liste mit per-Paket Re-Queue-Button (window.confirm + custom reason). Cluster-Badges zeigen Verteilung.

5. **Backfill 2026-05-09:** 89 Pakete mit historischem `STALE_REAP_LOOP_TERMINAL` (30d) retroaktiv quarantänisiert (audit-tagged `s4_bronze_quarantine_backfill`).

**Rollback:** `DROP TRIGGER trg_quarantine_on_stale_reap_terminal` + alte `fn_auto_recovery_pulse_decide` restoren + `UPDATE course_packages SET feature_flags = feature_flags - 'bronze_quarantine'`.
