---
name: DAG-Blocked Auto-Heal v1
description: View v_dag_blocked_jobs + RPCs admin_get_dag_blocked_overview/admin_heal_dag_blocked_jobs/admin_retry_dag_blocked_for_package + fn_alert_dag_blocked_jobs (P0/P1) + Cron 10min. Heilt fehlende Parents per Re-Enqueue mit bronze_lock_override=true.
type: feature
---

## Komponenten

- **`v_dag_blocked_jobs`**: blocked/queued/pending Jobs × step_dag_edges → Parent-Step-Status, parent_active_jobs, block_reason (parent_failed | parent_queued_no_job | parent_step_missing | parent_done_drift | parent_active | no_parent_required), minutes_blocked.
- **`admin_get_dag_blocked_overview()`** SECURITY DEFINER (admin-gated): summary (total, by_reason, severity P0≥50/P1≥20/P2≥5, oldest_minutes), by_package (Top 100), jobs (Top 200).
- **`admin_heal_dag_blocked_jobs(p_package_id, p_dry_run, p_max_packages)`**: für jedes Paket+Parent-Step: failed → queued reset; falls keine aktiven Parent-Jobs → INSERT job_queue mit `payload.bronze_lock_override=true` und `enqueue_source='dag_blocked_auto_heal'`. Audit in auto_heal_log.
- **`admin_retry_dag_blocked_for_package(uuid)`**: Wrapper pro Kurs.
- **`fn_alert_dag_blocked_jobs(p1=20, p0=50, stale=60min, dedupe=30min)`**: schreibt `dag_blocked_alert` (result_status=P0/P1) mit top_packages + Link `/admin/queue?tab=heal#dag-blocked` ins auto_heal_log. Dedupe via gleicher result_status in 30 Min.
- **Cron `dag-blocked-alert-and-heal-10min`** (`*/10 * * * *`): Alert + Heal (max 30 Pakete/run).

## UI
- `DagBlockedDashboardCard` in HealCockpitTabContent direkt unter MorningBriefing. Severity-Badge (P0/P1/P2/OK), by_reason Badges, Top-25-Pakete-Tabelle mit Per-Kurs-Heal-Button, Job-Details Toggle, Link zu auto_heal_log.

## Bronze-Override
Re-Enqueue setzt `payload.bronze_lock_override=true` → bestehender `trg_guard_bronze_lock_on_job_enqueue` lässt diese DAG-Heals durch (single choke-point honored).
