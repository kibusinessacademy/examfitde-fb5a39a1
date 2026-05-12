---
name: Multi-Class Drain Orchestrator v1
description: Autonomer 10-Min-Cron drainiert die 4 echten Restklassen (BRONZE_REVIEW_REQUIRED, NEEDS_INTEGRITY_FIRST, POOL_GAP_REPAIR, TRAP_GAP_REPAIR) klassenspezifisch ohne manuelles SQL. Health-Gate + WIP-Caps + globaler 20er-Cap.
type: feature
---

# Multi-Class Drain Orchestrator v1

Folge-System des `admin_reconcile_queued_tail_without_job` (BRONZE_REVIEW_CLEAN). Räumt die 4 verbleibenden Gate-Klassen autonom ab.

## RPCs

| RPC | Klasse | Job-Type | WIP-Cap | Batch |
|---|---|---|---|---|
| `admin_drain_bronze_review_required` | BRONZE_REVIEW_REQUIRED | package_elite_harden via `admin_bronze_targeted_repair_dispatch` | 5 | 5 |
| `admin_drain_needs_integrity` | NEEDS_INTEGRITY_FIRST | package_run_integrity_check | 10 | 10 |
| `admin_drain_pool_gap` | POOL_GAP_REPAIR | package_repair_exam_pool_quality | 3 | 3 |
| `admin_drain_trap_gap` | TRAP_GAP_REPAIR | package_exam_rebalance | 2 | 2 |
| `admin_drain_class_orchestrator` | ALL | ruft 4 RPCs in DAG-Order | global cap 20 | — |
| `admin_smoke_drain_orchestrator` | ALL (dry) | smoke-test, 0 enqueues | — | — |

## Eligibility-Filter

- Direkt auf `v_publish_readiness_gate` (kein redundanter View-Layer)
- Per Klasse zusätzlich: `NOT EXISTS active job of same type` (Anti-Dup)
- BRONZE: `bronze_locked AND score 75–84 AND repair_attempts<1 AND NOT repair_active`
- NEEDS_INTEGRITY: `has_active_integrity_job=false AND package_status IN (building,queued)`

## Stop-Kriterien (Orchestrator)

1. `fn_worker_health_gate.healthy=false` → Hard-Stop, audit `health_gate_red`
2. Globaler Cap 20 enqueues / Lauf
3. Pro Klasse: WIP-Cap erreicht → noop + audit
4. Klasse leer → `class_empty`

## Cron

- Job-Name: `drain-orchestrator-10min` (jobid 237)
- Schedule: `*/10 * * * *`
- Action: `SELECT public.admin_drain_class_orchestrator(false);`
- DB-side direkt (kein HTTP-Call, kein Anon-Key)

## Audit

- `auto_heal_log.action_type='drain_<class>_batch'` pro Klassen-RPC
- `auto_heal_log.action_type='drain_orchestrator_run'` pro Orchestrator-Lauf mit `metadata.gate_snapshot`
- Bootstrap: `drain_orchestrator_bootstrap` (smoke + first live run)

## Permissions

- SECURITY DEFINER, gates: `service_role` OR `current_user IN (postgres,supabase_admin,service_role)` OR `has_role(uid,'admin')`
- GRANT EXECUTE auf authenticated, anon, service_role (interner Gate hält Sicherheit)

## Live-Run 2026-05-12 12:01 UTC

| Klasse | eligible | enqueued |
|---|---|---|
| BRONZE_REVIEW_REQUIRED | 46 | 0 (alle in REPAIR_ALREADY_ACTIVE/NOT_BRONZE) |
| NEEDS_INTEGRITY_FIRST | 113 | 0 (alle mit aktivem Job) |
| POOL_GAP_REPAIR | 14 | 0 (alle mit aktivem Repair) |
| TRAP_GAP_REPAIR | 2 | 2 ✅ |

## Rollback

- `SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='drain-orchestrator-10min';`
- RPCs bleiben bestehen, können manuell aufgerufen werden

## Migrations
- `20260512_admin_drain_4x_class_rpcs_orchestrator_smoke` — alle 6 RPCs in einer Migration (atomar)
