---
name: Coupling-Heal v4 Supervisor + Live-Dashboard
description: fn_run_coupling_heal_v4_supervised wrappt admin_heal_step_job_coupling_v4 mit try/catch, hängt Forensik (gap_sync, mismatch, schema_drift) an coupling_heal_v4_runs an, klassifiziert transient/structural via fn_classify_pg_error, alarmiert via ops_alert_events und retried 1× bei transient. Cron 151 ersetzt durch jobid 163. UI CouplingHealV4Card im HealCockpit Tab mit Realtime auf coupling_heal_v4_runs.
type: feature
---

**Stack:**
- Tabelle `coupling_heal_v4_runs` (RLS admin-read, REPLICA IDENTITY FULL, in supabase_realtime publication).
- `fn_coupling_heal_v4_forensics()` → jsonb {gap_sync_queued_no_job, mismatch_done_step_open_job, schema_drift}.
- `fn_classify_pg_error(sqlstate,msg)` → transient | structural (deadlock, lock_not_available, query_canceled, conn_*, "tuple already modified" etc.).
- `fn_run_coupling_heal_v4_supervised(_retry_of uuid)` → INSERT running → ruft RPC → klassifiziert Status (succeeded|skipped|failed_transient|failed_structural|crashed|retried_succeeded) → Forensik → UPDATE → Alert in ops_alert_events bei !ok → bei transient + kein retry: sleep 2 + Self-Call mit retry_of=v_run_id.
- Cron `coupling_heal_15min_v4` (jobid 163) ruft Supervisor statt direkt RPC.
- `admin_get_coupling_heal_v4_runs(limit)` SECURITY DEFINER + has_role-Gate für UI.
- UI: `src/components/admin/heal/cards/CouplingHealV4Card.tsx` im HealCockpitTabContent über HealClusterExplanationPanel.

**Status-Logik:**
- processed=0 → skipped
- errors>0 AND healed=0 → failed_structural (DAG-Block / Phantom-Repair-Guards greifen für alle Kandidaten — strukturelles Signal)
- sonst → succeeded oder retried_succeeded
- Exception → fn_classify_pg_error entscheidet failed_transient vs failed_structural

**Auto-Retry:** nur bei failed_transient + _retry_of IS NULL (max 1 Retry, vermeidet Endlos-Loop).

**Alerting-Dedupe:** md5('coupling_heal_v4|status|sqlstate|YYYY-MM-DD-HH24') — max 1 Alert pro Stunde+Status+SQLSTATE.

**Baseline 2026-05-03 15:20:** processed 44 · healed 9 · errors 42 (PREDECESSORS_NOT_DONE skips, OK weil healed>0) · gap_sync 44 · mismatch 0 · drift 0 · 407ms · status=succeeded.
