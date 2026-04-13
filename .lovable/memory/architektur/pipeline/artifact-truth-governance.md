# Artifact-Truth Governance (v2 — Full Adoption)

Updated: 2026-04-13

## Core Principle
Die Pipeline folgt der strategischen Priorität **"Artifact-Truth over Execution-Meta"**. Jeder prebuildable Step prüft zuerst, ob die Artefakte bereits in der Datenbank existieren, und markiert sich als `done` mit `adopted: true`, wenn die Postconditions erfüllt sind — ohne einen Job auszuführen.

## Prebuild Short-Circuit RPCs (8 Steps)

| Step Key | RPC | Artifact-Truth Gate |
|---|---|---|
| `finalize_learning_content` | `fn_prebuild_finalize_learning_content` | Lessons + content materialized |
| `auto_seed_exam_blueprints` | `fn_prebuild_auto_seed_exam_blueprints` | ≥10 approved `question_blueprints` |
| `validate_blueprints` | `fn_prebuild_validate_blueprints` | All blueprints in terminal state |
| `generate_blueprint_variants` | `fn_prebuild_generate_blueprint_variants` | ≥80% blueprints have variants |
| `validate_blueprint_variants` | `fn_prebuild_validate_blueprint_variants` | ≥10 variants, ≥50% in review+ |
| `promote_blueprint_variants` | `fn_prebuild_promote_blueprint_variants` | Promoted variants exist in exam_questions |
| `validate_handbook` | `fn_prebuild_validate_handbook` | Handbook sections present |
| `validate_handbook_depth` | `fn_prebuild_validate_handbook_depth` | Depth metrics pass thresholds |

## Back-Sync (ensure-variant-inventory)
`ensure-variant-inventory` synchronisiert `blueprint_variant_inventory` aus echten `exam_question_variants`-Zählungen statt mit `materialized_count: 0` zu seeden. Inventory ist damit derived state, nicht primary truth.

## SSOT Rule
> Jeder Step MUSS zuerst Artefakte prüfen und DARF nur Jobs ausführen, wenn etwas fehlt.

Meta-Tags für adoptierte Steps: `{ prebuild: true, adopted: true, adopted_from_ssot: true }`
