# Multi-Class Drain Orchestrator v1

Ziel: Nach Batch 4 (BRONZE_REVIEW_CLEAN drained) die 4 echten Restklassen klassenspezifisch + autonom abarbeiten — ohne manuelle SQL-Abfragen.

## Architektur

```text
                    cron drain-orchestrator-10min
                              │
                              ▼
              admin_drain_class_orchestrator(p_dry)
                              │
        ┌──────────┬──────────┼──────────┬──────────┐
        ▼          ▼          ▼          ▼          ▼
   BRONZE_REVIEW  NEEDS_     POOL_GAP   TRAP_GAP   STOP-Gate
   _REQUIRED      INTEGRITY  _REPAIR    _REPAIR    (Health)
        │          │          │          │
   bronze_repair  integrity  pool_repair trap_repair
   _dispatch      _enqueue   _enqueue    _enqueue
```

Eine RPC pro Klasse mit eigenem Eligibility-Filter, eigenem Job-Type, eigenem Cooldown, eigenem WIP-Cap. Ein Orchestrator ruft sie nacheinander mit globalen Stop-Kriterien.

## Klassen-Plan

### 1. BRONZE_REVIEW_REQUIRED (46 Pakete)
- **Eligibility**: bronze_locked + (hard_fails ≠ [] ODER score < 75) + ≥48h ohne Repair-Attempt
- **Action**: `admin_bronze_targeted_repair_dispatch(package_id)` (existiert, max 1 Versuch)
- **WIP-Cap**: 5 parallel (teure Repairs)
- **Batch-Size**: 5 / Lauf
- **Stop**: Klasse leer · WIP-Cap erreicht · failure_class_growth in anderer Klasse

### 2. NEEDS_INTEGRITY_FIRST (99 Pakete)
- **Eligibility**: kein Report ODER score < 75, status ∈ (building, queued), approved ≥ track-min, kein aktiver `package_run_integrity_check`
- **Action**: enqueue `package_run_integrity_check` mit `enqueue_source='drain_needs_integrity_v1'`
- **WIP-Cap**: 10 parallel
- **Batch-Size**: 10 / Lauf
- **Stop**: Klasse leer · WIP-Cap erreicht · 3 consecutive empty_batch

### 3. POOL_GAP_REPAIR (5 Pakete)
- **Eligibility**: hard_fails enthält `TOO_FEW_APPROVED` ODER pool < 50, kein aktiver `package_repair_exam_pool_*`
- **Action**: enqueue `package_repair_exam_pool_quality` (defect-aware aus existierendem `_admin_recheck_enqueue`-Pattern)
- **WIP-Cap**: 3 parallel
- **Batch-Size**: 3 / Lauf
- **Stop**: Klasse leer · WIP-Cap erreicht

### 4. TRAP_GAP_REPAIR (2 Pakete)
- **Eligibility**: hard_fails enthält `TRAP_COVERAGE_BLOCK` / `HARDISH_TOO_LOW` / `ELITE_CONTEXT` / `CONFLICT_TYPE_LOW`, kein aktiver Repair-Job
- **Action**: enqueue `package_exam_rebalance` (existiert als Edge)
- **WIP-Cap**: 2 parallel
- **Batch-Size**: 2 / Lauf
- **Stop**: Klasse leer · WIP-Cap erreicht

## Globale Stop-Kriterien (Orchestrator)

1. `fn_worker_health_gate` rot → komplett aussetzen (audit `health_skip`)
2. `failure_rate_15m > 20%` → aussetzen
3. Pro Klasse: 3 aufeinanderfolgende `empty_batch` → Klasse für 30min cooldown
4. Globale Drain-Caps pro Lauf (prevent burst): max 20 enqueues total

## Stufen

1. **RPC `admin_drain_bronze_review_required(p_dry, p_limit)`**
   - View `v_bronze_review_required_eligible` (joined mit repair_attempts + cooldown)
   - Loop → `admin_bronze_targeted_repair_dispatch`
   - Audit `auto_heal_log` action_type=`drain_bronze_review_batch`

2. **RPC `admin_drain_needs_integrity(p_dry, p_limit)`**
   - View `v_needs_integrity_eligible` (Track-min lookup, no-active-job, cooldown)
   - Direct enqueue `package_run_integrity_check` via `_admin_recheck_enqueue`-Helper
   - Audit `drain_needs_integrity_batch`

3. **RPC `admin_drain_pool_gap(p_dry, p_limit)`**
   - View `v_pool_gap_eligible` (hard_fail-Filter + pool-size)
   - Defect-aware enqueue (LF-Lücke vs Volumen vs Coverage)
   - Audit `drain_pool_gap_batch`

4. **RPC `admin_drain_trap_gap(p_dry, p_limit)`**
   - View `v_trap_gap_eligible` (trap-spezifische hard_fails)
   - Enqueue `package_exam_rebalance`
   - Audit `drain_trap_gap_batch`

5. **Orchestrator `admin_drain_class_orchestrator(p_dry)`**
   - Health-Gate vorab
   - Ruft alle 4 Klassen-RPCs in Reihenfolge BRONZE → NEEDS_INTEGRITY → POOL_GAP → TRAP_GAP
   - Aggregiert pro Klasse: enqueued, skipped_reason
   - Schreibt finalen Snapshot in `auto_heal_log` action_type=`drain_orchestrator_run`
   - Returns: `{class, enqueued, eligible_total, stopped_reason, gate_snapshot}`

6. **Cron `drain-orchestrator-10min`** (`*/10 * * * *`)
   - Triggert Orchestrator non-dry
   - Idempotenz via Cooldown pro Klasse + Job-Type-Lookup

7. **UI-Card `DrainOrchestratorCard`** (HealCockpit Sektion 3d)
   - Live-Counts pro Klasse + letzte 5 Orchestrator-Läufe
   - Manual-Trigger-Button (admin only) + Per-Class-Trigger
   - Skip-Reasons als Tooltip

8. **Smoke-Test**: `admin_smoke_drain_orchestrator()` läuft alle 4 Klassen-RPCs dry + Orchestrator dry, prüft 0 Errors + plausible Counts.

## Migrations (eine pro Concern)

| # | Migration | Inhalt |
|---|---|---|
| 1 | `_v_bronze_review_required_eligible` | View + Grants |
| 2 | `_v_needs_integrity_eligible` | View + Grants |
| 3 | `_v_pool_gap_eligible` | View + Grants |
| 4 | `_v_trap_gap_eligible` | View + Grants |
| 5 | `_admin_drain_4x_class_rpcs` | 4 Klassen-RPCs (SECURITY DEFINER, has_role-Gate) |
| 6 | `_admin_drain_class_orchestrator` | Orchestrator-RPC |
| 7 | `_drain_orchestrator_cron_10min` | pg_cron via `supabase--insert` (kein Migration, da Anon-Key) |
| 8 | `_drain_orchestrator_smoke` | Smoke-RPC |

## Stop-Wächter

- **Hard-Stop**: failure_rate_15m > 20% · worker_health rot · ANY hard_fail-Klasse wächst > baseline
- **Soft-Pause**: pro Klasse 3× empty_batch → 30min Cooldown auf Klassen-Ebene
- **Audit-Pflicht**: jeder Lauf (auch noop/skipped) in `auto_heal_log` mit `metadata.gate_snapshot`

## Smoke + Rollback

- Vor Cron-Aktivierung: `admin_smoke_drain_orchestrator()` 3× grün
- Rollback: Cron disable + Orchestrator-RPC liefert noop wenn `feature_flags.drain_orchestrator.enabled=false` (default true)

## Out-of-Scope
- Keine Änderung am bestehenden `admin_reconcile_queued_tail_without_job` (BRONZE_REVIEW_CLEAN-Pfad bleibt)
- Keine UI-Refactors außerhalb der neuen Card
- Keine Änderung an Council/Auto-Publish-Logik
