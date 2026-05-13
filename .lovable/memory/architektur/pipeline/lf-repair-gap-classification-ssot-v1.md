---
name: LF Repair Gap Classification SSOT v1
description: SSOT-Diagnose vor LF-Coverage-Repair. v_exam_pool_lf_repair_gap_classification (Per-LF) + v_exam_pool_lf_repair_gap_summary (Per-Package) + admin_get_exam_pool_lf_repair_gaps RPC. Klassen BLUEPRINT_GAP/VARIANT_GAP/QUESTION_GAP_ONLY/MIXED_GAP/OK. Repair-Worker MUSS Klasse prüfen bevor er Fragen generiert.
type: feature
---

## Warum

`package_repair_exam_pool_lf_coverage` enqueued blind `package_generate_exam_pool` für jede Defizit-LF. Wenn die LF aber 0 approved Blueprints oder 0 usable Variants hat, generiert der Worker nichts → STALE_LOCK-Loop, NO_BLUEPRINTS-Park, kein Repair-Effekt.

## Klassen (Soll: 15 approved Fragen pro LF)

- **BLUEPRINT_GAP**: 0 approved Blueprints (`approved_at IS NOT NULL AND deprecated_at IS NULL AND status<>'deprecated'`)
- **VARIANT_GAP**: ≥1 approved BP, aber 0 usable Variants (`validation_passed=true`)
- **QUESTION_GAP_ONLY**: BPs+Variants ok, aber `qc_status='approved'` Fragen < 15
- **OK**: ≥15 approved Fragen
- **MIXED_GAP** (Per-Package): mehrere Klassen gleichzeitig in unterschiedlichen LFs

## Baseline 2026-05-13

| Klasse | Pakete | LF-Defizit | Frage-Defizit |
|---|---|---|---|
| OK | 154 | 0 | 0 |
| BLUEPRINT_GAP | 134 | 802 LFs | 10.779 |
| VARIANT_GAP | 105 | 428 LFs | 4.233 |
| MIXED_GAP | 46 | 230 LFs | 2.652 |

→ **285 Pakete** brauchen Heilung **vor** Question-Generierung.

## Konsequenz für Repair-Worker (Phase c)

`package_repair_exam_pool_lf_coverage` muss vor Fan-Out pro LF entscheiden:
- BLUEPRINT_GAP → enqueue `package_auto_seed_exam_blueprints` (oder `targeted_blueprint_fill`)
- VARIANT_GAP → enqueue `package_generate_blueprint_variants` / `promote_blueprint_variants`
- QUESTION_GAP_ONLY → wie heute: `package_generate_exam_pool` mit `learning_field_filter`
- MIXED → mischen pro LF, NIEMALS Paket-pauschal

## Artefakte

- View `public.v_exam_pool_lf_repair_gap_classification` (Per-Package×LF)
- View `public.v_exam_pool_lf_repair_gap_summary` (Per-Package Aggregat)
- RPC `public.admin_get_exam_pool_lf_repair_gaps(_package_ids uuid[], _only_problematic bool)` mit has_role-Gate
- Migration: 2026-05-13, Audit `lf_repair_gap_classification_view_created`

## Memory-Discipline (mitnehmen)

- Vor Migration: `\d auto_heal_log` (canonical: action_type, target_type, result_status, metadata — KEIN details-col)
- Worker-CPU-Budget: Parent-Repair NIE `completed`, solange Children nicht durch (Bucket B offen)
- LF-Repair = Blueprint→Variant→Question-Kette, nicht ein Schritt
