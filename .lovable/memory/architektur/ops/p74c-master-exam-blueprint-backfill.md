---
name: P74c Master Exam-Blueprint Backfill (Phase 1+2)
description: Deterministischer SSOT-Bridge-Repair für 34 Pakete ohne Master exam_blueprints. Kein AI, kein blueprint_variants, kein Bronze-Touch.
type: feature
---

## Strukturelle Erkenntnis
Plattform hat Inhalte (Curriculum + Question-Blueprints + blueprint_variant_inventory),
aber 34 Paketen fehlt die verbindende Master-SSOT-Schicht `exam_blueprints`.
Folge: kein Exam-Pool-Orchestrator → Bronze-/Queue-Stalls → elite_harden + generate_oral_exam failed.
`blueprint_variants` ist tot (0 rows) — echte Variant-SSOT ist `blueprint_variant_inventory`.

## SSOT-Pfad (klargestellt)
Curriculum → Question Blueprints → Variant Inventory → **Master Exam Blueprint** → Exam Pool → Oral Exam → Tutor / Readiness.

## Phase 1 — Diagnose-Freeze
- `v_missing_exam_blueprint_packages` (service_role only) + `admin_get_missing_exam_blueprint_summary(limit)` (has_role admin)
- Recoverability-Klassen: READY (≥30 approved QBP) / LOW_QBP / INSUFFICIENT (0) / NO_CURRICULUM
- Baseline 2026-05-26: 34 total · 32 READY · 0 LOW_QBP · 2 INSUFFICIENT (Erbschaftsplanung + Berufsvormund) · 11 bronze_locked (alle in READY)

## Phase 2 — Deterministic Backfill (RPC-Family)
- `fn_backfill_missing_exam_blueprint(p_package_id, p_dry_run)` — service_role only
- Regeln:
  - **idempotent** · **niemals overwrite** · **kein AI** · **kein blueprint_variants**
  - **Active-Jobs-Guard**: skipped_active_jobs wenn validate_exam_pool / generate_oral_exam / elite_harden / package_quality_council / package_run_integrity_check / package_auto_publish pending|processing
  - **Difficulty** aus realer approved exam_questions-Verteilung (sample ≥10), Fallback 0.3/0.5/0.2
  - **Berührt NICHT** Bronze-Lock, **NICHT** package_status, **NICHT** job_queue
  - Snapshot: `reconstruction_source='question_blueprints_inventory'`, `reconstructed_at`, `reconstructed_by='p74c_backfill'`
- Admin-RPCs (has_role admin gated):
  - `admin_backfill_missing_exam_blueprint_dry_run(limit)` — Wave-Planung über READY-Pakete
  - `admin_backfill_missing_exam_blueprint_execute(package_id)` — Single-Shot (Canary + kontrolliert)
  - **KEIN Bulk-Execute-RPC** (bewusst — Waves manuell)
- Audit-Contracts: `exam_blueprint_backfilled` (package_id, curriculum_id, approved_qbp_count, variant_inventory_count, source) + `exam_blueprint_backfill_skipped` (package_id, reason)

## Dry-Run-Felder (Forensik)
would_insert · reason · approved_qbp_count · inventory_count · approved_questions · estimated_pool_size · active_jobs_detected · active_job_types · bronze_locked · difficulty_distribution.derived_from_sample

## Deprecation
`blueprint_variants` table → COMMENT 'DEPRECATED P74c'. CI-Guard gegen neue Writes folgt separat.

## Trennung zu späteren Phasen
- **P74c Phase 2** = nur Backfill (structural recovery)
- **P74d** (separat) = Bronze-Reconciliation + controlled enqueue von validate_exam_pool + (optional) generate_oral_exam (rate-limited, lane-aware)
- **P74e** (separat) = Wave-Rollout (Canary → 3er → 10er → Rest) mit queue-depth-/bronze-delta-/failed-step-Checks

## Canaries (Phase 2 Single-Execute)
1. `drohnen-a1-a3-lba` (63 QBP, 1 inv, 3 approved Q, bronze_locked) — Recovery-Validierung klein
2. `wundexperte-icw` (64 QBP, 7 inv, 15 approved Q, bronze_locked)
3. `galabau-gaertner` (76 QBP, 21 inv, 0 approved Q, status=blocked, NOT bronze)

## Verboten
- blueprint_variants reaktivieren · neue Variant-Engine · AI-Regeneration · Bulk-Approve · Bronze pauschal entfernen · Status-Flip aus Backfill · Multi-Row-Insert in exam_blueprints
