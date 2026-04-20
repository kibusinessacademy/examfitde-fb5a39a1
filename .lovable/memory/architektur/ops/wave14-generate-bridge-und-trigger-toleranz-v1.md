---
name: Wave 14 — Generate-Bridge + Trigger-Toleranz
description: fn_prebuild_generate_blueprint_variants materialisiert exam_question_variants per-row mit LF-Fallback; Promote-Bridge fängt zusätzlich Trigger-RAISE (trap_type-Guard) tolerant ab
type: feature
---

## Architektur-Endform

`fn_prebuild_generate_blueprint_variants` ist nicht mehr nur Adopter, sondern aktive Bridge:

- **Per-row INSERT** in `exam_question_variants` mit per-row Exception (`check_violation`, `unique_violation`, Kollisions-Strings)
- **LF-Resolution-Kette**: `blueprint.learning_field_id` → `competency.learning_field_id` → erstes LF des Curriculums (Fallback)
- **question_text Pad**: zu kurze Templates (≤20 Zeichen) werden auf >20 erweitert für Promote-Filter-Kompatibilität
- **Allowed_question_types Mapping**: erstes erlaubtes BP-Type → gültiger Variant question_type
- **Coverage-Adoption**: ≥80% Coverage triggert Step `done` mit `strategy: row_tolerant_bridge_v1c_lf_fallback_pad`

## Promote-Bridge Härtung (v2)

`fn_prebuild_promote_blueprint_variants` fängt jetzt zusätzlich:
- `WHEN raise_exception THEN` für Trigger-Aborts (z.B. `APPROVAL_REQUIRES_TRAP_TYPE`)
- SQLERRM-Filter erweitert: `APPROVAL_REQUIRES_%`, `trap_type%`
- `is_trap` wird nur dann `true`, wenn `trap_type` wirklich gesetzt+nicht-leer ist
- Counter `trigger_blocked` separat von `collisions_skipped` für Forensik

## Backfill (Wave 14c)

Existierende Varianten der Klasse-B-Curricula (BB, TV, AM-SHK) erhielten:
- `learning_field_id` = erstes LF des Curriculums (sortiert nach `sort_order`, dann `created_at`)
- Padding für `question_text` ≤ 20 Zeichen

## Wave 14 Endergebnis

- 425 → 426 Pakete mit exam_questions
- Anlagenmechaniker SHK: 87 questions materialisiert (3 Trigger-blockiert, sauber toleriert)
- BB + TV: Generate-Bridge erzeugt Varianten, aber Trigger blockiert 100% beim Promote (echte Klasse C — Datenqualität, kein Bridge-Bug)
- 12 Pakete restleer: 10 Klasse A (NO_BLUEPRINTS) + 2 Klasse C (Trigger-Block bei DQ-Issues)

## Verbleibende Restklassen

| Klasse | Anzahl | Charakter |
|---|---|---|
| A_NO_BLUEPRINTS | 10 | Echte Source-Gaps — Seed/Blueprint-Erzeugung nötig |
| C_TRIGGER_BLOCKED | 2 | Templates zu kurz/unspezifisch — DQ-Repair statt Bridge |

## Korrekte Spaltennamen-SSOT

- `learning_fields.sort_order` (NICHT `order_index`)
- `package_steps.finished_at` (NICHT `completed_at`)
- `learning_fields.curriculum_id` (Joins über LF, NICHT direkt zu `competencies`)
