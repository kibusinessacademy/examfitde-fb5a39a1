---
name: Redundant-Seeding ↔ Ghost-Completion Decoupling v1
description: P0-Härtung für fn_guard_redundant_seeding — kein implizites done mehr im Trigger; SSOT-Reconciler übernimmt Closing über admin_force_steps_done
type: feature
---

## Problem
`fn_guard_redundant_seeding` setzte `package_steps.status='done'` ohne `meta.ok='true'`. Der `fn_guard_ghost_completion` blockierte das mit `RAISE EXCEPTION`, was den umgebenden `INSERT INTO job_queue` rückabwickelte. Effekt: 126 Coupling-Heal-Inserts verschwanden still.

## Fix-Architektur

### 1. Trigger-Härtung
- **Kein implizites `done`** mehr. Trigger markiert nur `meta.redundant_detected=true` + Reason + Artefakt-Snapshot.
- Pro Job-Typ getrennte **Artefakt-Truth**:
  - `package_auto_seed_exam_blueprints` → ≥10 Blueprints (`approved`/`review`)
  - `package_generate_blueprint_variants` → ≥10 Varianten **UND** ≥80% Blueprint-Coverage (echte Variant-Truth, nicht Blueprint-Proxy)
- Job-Insert wird nur verworfen, wenn Truth wirklich erfüllt → Heals laufen sonst durch.

### 2. SSOT-Reconciler
`admin_reconcile_redundant_seeding(_dry_run boolean)` schließt markierte Steps kontrolliert über `admin_force_steps_done` (Emergency-Bypass + Audit). Reason-Codes:
- `REDUNDANT_BLUEPRINTS_PRESENT`, `REDUNDANT_VARIANTS_PRESENT`
- `BLUEPRINTS_INSUFFICIENT`, `VARIANTS_INSUFFICIENT`
- `BLOCKED_UPSTREAM_ACTIVE_JOBS`

### 3. Beobachtung
View `v_ops_redundant_seeding_pending` zeigt markierte, noch nicht reconcilierte Steps.

## Verifikation (post-deploy)
- Coupling-Gaps `generate_blueprint_variants`: **5 → 0** nach manuellem Heal-Run.
- Re-Enqueue-Inserts bleiben jetzt persistent (`status='pending'`/`processing`).
- Keine `RAISE EXCEPTION` aus Ghost-Guard durch Redundant-Seeding-Pfad mehr.

## Regel
Guards dürfen **niemals** `package_steps.status` direkt mutieren — nur `meta`. Status-Transitions ausschließlich über `markStepDone()` / `admin_force_steps_done()`.
