---
name: Publish-Readiness-Gate v2 (BRONZE_REVIEW_CLEAN)
description: SSOT-Klassifikation für Publish-Readiness via integrity_report.v3.summary.hard_fail_reasons. Coverage ist KEIN Readiness-Signal. View v_publish_readiness_gate v2 mit BRONZE_REVIEW_CLEAN-Klasse trennt Audit-Bronze-Flag von echtem Review-Bedarf. Reconciler-RPC v3 mit Step×Gate-Class-Matrix.
type: feature
---

# Publish-Readiness-Gate v2

**Lehre aus Batch 1 (2026-05-12):** Coverage misst Verteilung, NICHT Pool-Größe. `admin_reconcile_coverage_met_integrity_false` enqueuete 8 Pakete basierend auf coverage≥80 → 4/8 Hard-Fail (TOO_FEW_APPROVED, HARDISH_TOO_LOW).

**Lehre aus v1→v2:** Bronze-Flag (`feature_flags.bronze.requires_review=true`) wurde historisch von `reconciler_bronze_branch` gesetzt. Manche Pakete sind aber heute clean (score=100, hard_fails=[]). Pure bronze-Klassifikation blockierte sie unnötig im Reconciler.

## SSOT-Regel

**Coverage ist kein Publish-Readiness-Signal. `integrity_report.v3.summary.hard_fail_reasons` ist die SSOT.**

## Gate-Klassen (v2)

View `v_publish_readiness_gate` (service_role only). Precedence top-down:

| Klasse | Bedingung | Heal-Pfad |
|---|---|---|
| COUNCIL_PENDING | active package_quality_council job | warten |
| AUTO_PUBLISH_PENDING | active package_auto_publish job | warten |
| **BRONZE_REVIEW_CLEAN** | bronze_locked AND hard_fails=[] AND score≥85 | Reconciler enqueue mit `bronze_lock_override=true` |
| BRONZE_REVIEW_REQUIRED | bronze_locked + nicht clean | admin_bronze_tail_auto_unlock / Manual-Review |
| POOL_GAP_REPAIR | hard_fail enthält TOO_FEW_APPROVED | repair_exam_pool_quality |
| BLOOM_GAP_REPAIR | hard_fail BLOOM_GATE/MISSING_UNDERSTAND/EVALUATE | repair_exam_pool_quality |
| TRAP_GAP_REPAIR | hard_fail TRAP_COVERAGE_BLOCK/HARDISH_TOO_LOW/ELITE_CONTEXT/CONFLICT_TYPE_LOW | repair_exam_pool_quality |
| READY | hard_fails=[] AND score≥85 AND integrity_passed=true AND NOT bronze_locked | → Council/Auto-Publish |
| BRONZE_REVIEW_REQUIRED | hard_fails=[] AND score 75–84 (NICHT bronze_locked) | Bronze-Branch |
| STALE_INTEGRITY | hard_fails=[] AND score≥85 AND integrity_passed=false AND no active integrity job | admin_reconcile_stale_integrity_only |
| NEEDS_INTEGRITY_FIRST | kein Report oder score<75 | run_integrity_check (regulär) |

## RPC `admin_reconcile_queued_tail_without_job` v3

Step×Gate-Class-Allowlist (strict):

| Step | erlaubte Gate-Classes |
|---|---|
| run_integrity_check | STALE_INTEGRITY |
| quality_council | READY, COUNCIL_PENDING, **BRONZE_REVIEW_CLEAN** |
| auto_publish | READY, AUTO_PUBLISH_PENDING, **BRONZE_REVIEW_CLEAN** |

Bronze-Lock-Trigger wird automatisch via `bronze_lock_override=true` umgangen wenn Gate-Class=`BRONZE_REVIEW_CLEAN` ODER `bronze_locked=true`. Audit `enqueue_source='queued_tail_reconciler_v3_gate_aware'`.

## Baseline 2026-05-12 (231 building/queued, post-v2)

| Klasse | n |
|---|---|
| NEEDS_INTEGRITY_FIRST | 103 |
| BRONZE_REVIEW_REQUIRED | 46 |
| BRONZE_REVIEW_CLEAN | 28 |
| READY | 25 |
| COUNCIL_PENDING | 16 |
| POOL_GAP_REPAIR | 11 |
| TRAP_GAP_REPAIR | 2 |

Live-Validation 2026-05-12: 2 BRONZE_REVIEW_CLEAN Pakete (Fleischer/Textilnäher, score=100) erfolgreich enqueued.

## Deprecated
- `admin_reconcile_coverage_met_integrity_false` → redirect auf `admin_reconcile_stale_integrity_only`. Audit `coverage_only_reconcile_deprecated_call`.

## Migrations
- `20260512_v_publish_readiness_gate` — v1 View+RPC
- `20260512_admin_reconcile_stale_integrity_only` — RPC v2 + deprecate v1
- `20260512_v_queued_tail_without_job_v2` — Status `queued` in next_tail_step
- `20260512_admin_reconcile_queued_tail_v2_gate_aware` — Gate-Filter in RPC
- `20260512_v_publish_readiness_gate_v2_bronze_review_clean` — BRONZE_REVIEW_CLEAN + RPC v3
