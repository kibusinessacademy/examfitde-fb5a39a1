# P2 Bronze-Drain Canary → P2.5 Active-Job-Reconciliation

Strikte Reihenfolge laut Auftrag. P5 ist explizit **nicht** Teil dieses Cuts — startet erst nach Tail-Stabilisierung.

## Cut 1 — P2 Bronze-Drain Canary (Build)

### 1a Audit-Contracts registrieren
In `ops_audit_contract`:
- `bronze_drain_wave` — required_keys: wave_id, package_id, repair_vector, enqueue_source, idempotency_key, result_status
- `bronze_drain_wave_summary` — wave_id, total_candidates, dispatched, skipped, skip_reasons
- `active_job_reconciled` — job_id, package_id, reason, prev_status, new_status
- `active_job_cancelled_superseded` — job_id, package_id, reason, downstream_step

### 1b SSOT-View `v_bronze_drain_candidates`
Oldest-first Liste mit Eligibility-Flags. Filter im Body:
- `cp.status = 'building'`
- `feature_flags->'bronze'->>'requires_review' = 'true'`
- `manual_bypass != 'true'` UND kein `admin_force_building_at`
- kein `processing` Job auf Paket
- kein aktiver `package_elite_harden` mit `meta.bronze_repair=true`
- kein aktiver Bronze-Guard-Block-Loop in letzten 30min (audit-basiert)

Spalten: `package_id, title, priority, bronze_score, repair_attempts, last_repair_at, oldest_signal_at, eligible (bool), skip_reason`.

### 1c RPC `admin_bronze_drain_canary_dispatch(p_batch_size int default 5, p_wave_id uuid default gen_random_uuid())`
- admin-gated via `has_role(auth.uid(),'admin')`, `SECURITY DEFINER`
- selektiert TOP `p_batch_size` aus `v_bronze_drain_candidates WHERE eligible=true` ORDER BY oldest_signal_at
- ruft pro Paket bestehende `admin_bronze_targeted_repair_dispatch(pkg)` auf (keine neue Repair-Logik)
- schreibt pro Dispatch `auto_heal_log` action_type=`bronze_drain_wave` mit wave_id, repair_vector (aus RPC-Result), idempotency_key
- schreibt Skips analog mit `result_status='skipped'`
- schreibt Summary-Audit `bronze_drain_wave_summary` am Ende
- Returns: `{wave_id, dispatched, skipped[], details[]}`

### 1d View `v_bronze_drain_wave_status`
Aggregiert auto_heal_log + job_queue pro wave_id: dispatched, completed, failed, tail_released (post-bronze step done), avg_runtime_s, bronze_remaining (gesamt eligible).

### 1e RPC `admin_get_bronze_drain_waves(p_limit int default 10)`
Letzte N Waves mit Status für UI.

### 1f UI `BronzeDrainWaveCard` (`/admin/v2/heal`, Sektion 4)
- "Canary starten (5)" Button → `admin_bronze_drain_canary_dispatch`
- Tabelle: aktuelle + letzte Waves mit dispatched/completed/failed/tail_released/avg_runtime
- Counter: bronze_remaining
- window.confirm vor Dispatch
- Polling 15s

## Cut 2 — Beobachtungs-Hinweise (Doku)
Card zeigt Stop-Conditions als Hinweis-Banner (failed-spike, duplicate repair jobs, queue pressure delta). Keine Auto-Stops in diesem Cut — bewusst manueller Gate.

## Cut 3 — P2.5 Active-Job-Reconciliation

### 3a SSOT-View `v_active_job_reconciliation`
Pro pending/processing Job in `job_queue`:
- `class`: HEALTHY_ACTIVE / STALE_PROCESSING / ORPHANED_ACTIVE / DAG_SUPERSEDED / RETRYABLE_STUCK / TERMINAL_DRIFT
- Logik:
  - HEALTHY: status='processing' AND `last_heartbeat_at > now()-5min`
  - STALE: 'processing' AND heartbeat NULL/älter 10min
  - ORPHANED: package_step `status='done'` für payload.step_key
  - DAG_SUPERSEDED: downstream-Step bereits `done` (via `step_dag_edges`)
  - RETRYABLE_STUCK: 'pending' AND `run_after < now()-30min` AND attempts<max_attempts AND no active sibling
  - TERMINAL_DRIFT: attempts≥max_attempts AND status='pending' (wird vom Drift-Cron terminalisiert — nur Read-only Klassifikation)

### 3b RPC `admin_active_job_reconcile_dispatch(p_dry_run bool default true, p_max_actions int default 50)`
Pro Klasse:
- **STALE_PROCESSING** → reset auf `pending`, `locked_at=null, locked_by=null, attempts=attempts` (nicht erhöht), Audit `active_job_reconciled` reason='zombie_processing'
- **ORPHANED_ACTIVE** + **DAG_SUPERSEDED** → `status='cancelled', error='superseded'`. Audit `active_job_cancelled_superseded`
- **RETRYABLE_STUCK** → neuer Job-Insert mit Re-Enqueue-Contract:
  - `attempts=0`
  - `parent_job_id=alt.id`
  - `meta = jsonb_build_object('requeue_reason','retryable_stuck_reconcile','enqueue_source','active_job_reconcile','parent_job_id',alt.id)`
  - Idempotency-Key: `requeue:active_job_reconcile:<old_id>`
  - Alter Job → `status='cancelled', error='reconciled_requeue'`
  - Bronze-Lock-Check via `fn_is_bronze_locked`
- TERMINAL_DRIFT/HEALTHY → no-op

`p_dry_run=true` (Default): nur Klassifikation + would-do, kein Write. UI nutzt zuerst dry_run.

### 3c UI `ActiveJobReconciliationCard`
Im Heal-Cockpit unter BronzeDrainWaveCard. Zeigt Klassen-Counts + "Dry Run"-Button + "Apply (max 50)"-Button. Klassen-Tabelle mit Top-10 Beispielen.

## Cut 4 — P5 LWK-Wave (NICHT in diesem PR)
P5 erst nach manueller Freigabe wenn Canary stabil + ACTIVE_JOBS bereinigt. Wird als eigener Cut geplant.

## Files (geplant)
- `supabase/migrations/<ts>_p2_bronze_drain_canary.sql` (1a-1e)
- `supabase/migrations/<ts2>_p25_active_job_reconciliation.sql` (3a-3b)
- `src/hooks/useBronzeDrainWaves.ts`
- `src/components/admin/heal/BronzeDrainWaveCard.tsx`
- `src/hooks/useActiveJobReconciliation.ts`
- `src/components/admin/heal/ActiveJobReconciliationCard.tsx`
- Edit `src/pages/admin/v2/HealCockpitPage.tsx` (oder entsprechende Heal-Page) zur Einbindung
- `mem://architektur/ops/p2-bronze-drain-canary-and-p25-reconcile-v1.md`

## Verbote (im Cut hart respektiert)
- Keine WIP-Cap-Erhöhung
- Keine Building-Demotion
- Kein globaler Queue-Purge
- Keine Parallel-Dispatch aller Bronze
- Keine neue Repair-Logik (existing `admin_bronze_targeted_repair_dispatch`)
- Re-Enqueue-Contract: attempts=0 + parent_job_id + requeue_reason + enqueue_source — Pflicht bei jedem Insert in Cut 3
