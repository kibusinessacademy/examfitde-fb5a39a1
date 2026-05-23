---
name: P2 Bronze-Drain Canary + P2.5 Active-Job-Reconciliation v1
description: 5er-Wellen-Reaktivierung Bronze-locked Pakete + Klassifikation/Reset/Cancel/Requeue offener Jobs mit Re-Enqueue-Contract.
type: feature
---

## P2 — Bronze-Drain Canary

- View `v_bronze_drain_candidates` — oldest-first Liste, eligible-Filter (status=building, requires_review=true, kein manual_bypass, kein admin_force_building_at, kein bronze_quarantine, kein active package_elite_harden bronze_repair, kein processing-Job).
- RPC `admin_bronze_drain_canary_dispatch(p_batch_size=5, p_wave_id=gen_random_uuid())` ruft pro Paket bestehendes `admin_bronze_targeted_repair_dispatch` (keine neue Repair-Logik). Schreibt pro Versuch + Summary Audit.
- View `v_bronze_drain_wave_status` aggregiert pro Wave: dispatched/skipped/completed/failed/tail_released/avg_runtime + globale `bronze_remaining`.
- RPC `admin_get_bronze_drain_waves(p_limit=10)` — Cockpit-Read.
- UI `BronzeDrainWaveCard` (HealCockpit Sektion nach BronzeQuarantineCard). Manueller "Canary starten (5)" Button + Polling 15s.
- Audit-Contracts: `bronze_drain_wave` (wave_id, package_id, repair_vector, enqueue_source, idempotency_key) + `bronze_drain_wave_summary` (wave_id, total_candidates, dispatched, skipped, skip_reasons).
- Verbote: kein WIP-Cap-Override, keine Building-Demotion, keine Parallel-Dispatch aller Bronze-Pakete.

**Baseline 2026-05-23:** 28 eligible / 30 total Bronze-Kandidaten. P2 ist canary-only, manueller Gate zwischen Wellen.

## P2.5 — Active-Job-Reconciliation

- View `v_active_job_reconciliation` klassifiziert pending/processing Jobs in 6 Klassen:
  - `HEALTHY_ACTIVE` — processing, heartbeat<5min
  - `STALE_PROCESSING` — processing, heartbeat NULL/>10min
  - `ORPHANED_ACTIVE` — package_step bereits `done`
  - `DAG_SUPERSEDED` — Downstream-Step (via `step_dag_edges.depends_on`) bereits `done`
  - `RETRYABLE_STUCK` — pending, run_after<now-30min, attempts<max, kein active sibling
  - `TERMINAL_DRIFT` — pending, attempts≥max (read-only, Drift-Cron terminalisiert)
- RPC `admin_active_job_reconcile_dispatch(p_dry_run=true, p_max_actions=50)` — Default Dry-Run.
  - STALE → reset auf `pending`, locked_at/by/heartbeat NULL, attempts unverändert. Audit `active_job_reconciled` reason=`zombie_processing`.
  - ORPHANED + DAG_SUPERSEDED → `cancelled` mit last_error=`reconcile:<class>`. Audit `active_job_cancelled_superseded`.
  - RETRYABLE_STUCK → neuer Job-Insert mit Re-Enqueue-Contract: `attempts=0`, `parent_job_id=alt.id`, `meta.requeue_reason=retryable_stuck_reconcile`, `meta.enqueue_source=active_job_reconcile`, idempotency_key=`requeue:active_job_reconcile:<old_id>`. Bronze-Lock-Check via `fn_is_bronze_locked` skipped als `bronze_locked`. Active-sibling skipped als `has_active_sibling`. Alter Job → `cancelled` last_error=`reconciled_requeue`.
- RPC `admin_get_active_job_reconciliation(p_limit_per_class=10)` — Counts + Beispiele für UI.
- UI `ActiveJobReconciliationCard` mit Klassen-Badges + Dry-Run + Apply-Buttons + Beispieltabellen pro actionable Klasse.
- Audit-Contracts: `active_job_reconciled` (job_id, reason, prev_status, new_status) + `active_job_cancelled_superseded` (job_id, reason).

**Re-Enqueue-Contract Pflicht:**
- `attempts = 0` (NIE vom Vorgänger kopieren)
- `parent_job_id` gesetzt
- `meta.requeue_reason` gesetzt
- `meta.enqueue_source` gesetzt (kein `edge_unknown`)
- Idempotency-Key deterministisch pro alter job_id

**Baseline 2026-05-23:** 129 HEALTHY / 79 RETRYABLE_STUCK / 2 DAG_SUPERSEDED / 0 STALE_PROCESSING.

## Verbote (hart respektiert)
- Keine WIP-Cap-Erhöhung
- Keine Building-Demotion
- Kein globaler Queue-Purge
- Keine Parallel-Dispatch aller Bronze-Pakete
- Keine neue Repair-Logik (existing `admin_bronze_targeted_repair_dispatch`)

## Nächster Schritt
P5 LWK-Wave erst nach manueller Freigabe wenn Canary stabil + ACTIVE_JOBS bereinigt.
