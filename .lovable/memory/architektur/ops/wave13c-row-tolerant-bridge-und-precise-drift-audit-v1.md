---
name: Wave 13c — Row-Tolerant Promote-Bridge + präzises Drift-Audit
description: Per-row Kollisionstoleranz in fn_prebuild_promote_blueprint_variants und 4-Regel-Drift-Audit (statt Regex-Sweep)
type: feature
---

## Row-Tolerant Promote-Bridge (Endform)

`fn_prebuild_promote_blueprint_variants` ist final SSOT-konform:

- **Per-row INSERT mit per-row EXCEPTION** für `unique_violation`, `check_violation` und globale Canonical-Collisions (`SQLERRM ILIKE '%GLOBAL_CANONICAL_COLLISION%' / '%canonical%collision%' / '%duplicate%'`)
- **Eine Kollision blockiert nicht mehr das Paket** — nur die einzelne Row wird übersprungen, Counter `v_collisions` zählt sauber
- **Step-Adoption auch bei Kollisionen**: Sobald `exam_questions_total > 0` für Curriculum, wird Step `done` mit reason `ARTIFACT_TRUTH_ADOPTED_WITH_COLLISIONS`
- **Skipped-Existing**: bereits promotete Varianten (via `meta->>source_variant_id`) werden ohne Insert-Versuch übersprungen
- Step-Meta dokumentiert: `inserted_questions`, `collisions_skipped`, `skipped_existing`, `exam_questions_total`, `strategy: top_n_per_lf_row_tolerant`

## Präzises Drift-Audit (4 Regeln statt Regex-Sweep)

| Funktion | Soll-Regel |
|---|---|
| `fn_audit_drift_step_finalization_v2` | Pre-Build-RPCs mit `status='done'` MÜSSEN `ok:true`, `executed:true`, `finished_at` setzen |
| `fn_audit_drift_bridge_presence_v2` | `fn_prebuild_promote_blueprint_variants`/`generate_blueprint_variants`/`auto_seed_exam_blueprints` MÜSSEN `INSERT INTO <ziel-tabelle>` enthalten |
| `fn_audit_drift_schema_domain_v2` | Keine `completed_at`, kein `curriculums`, kein `status='rejected'`/`'promoted'` in Variant-Filtern |
| `fn_audit_drift_bare_meta_v2` | Nur kritisch wenn (a) `RETURNS TABLE(... meta jsonb)`, (b) `UPDATE package_steps`, (c) `SET meta = COALESCE(meta,...)` ohne Alias-Präfix |

`fn_audit_all_drift_v2()` aggregiert die 4 in einer JSONB-Antwort mit `critical_count`/`high_count`.

## Wave 13c Endergebnis

- 425 Pakete mit `exam_questions` (Vorher: 413 nach Wave 12, 122 vor Wave 12)
- 13 leere Pakete übrig — alles legitime Klasse-A (NO_BLUEPRINTS) oder Klasse-B (NO_VARIANTS) Restarbeit
- **Klasse D = 0 offen** (1 Restfall hat 3 Varianten < min 6 → korrekt deferred, kein Bug)
- Drift-Audit findet 1 critical: `fn_prebuild_generate_blueprint_variants` ohne `INSERT INTO exam_question_variants` — geplante Welle 14 (Generate-Bridge)
- A/B-Worker läuft sauber: 5 completed exam_pool-Jobs, neue generate_blueprint_variants pending

## Architektur-Endform

Promote-Bridge ist jetzt **dauerhafte Materialisierungsstrategie**, nicht Notfall-Fix:
- SSOT-konform per-row mit Dedup über `(blueprint_id, normalized_hash)`
- Kollisions-tolerant (Top-N pro LF wird gesammelt, Kollisionen einzeln gezählt)
- Step-Adoption an Artifact-Truth gebunden (`exam_questions_total > 0`), nicht an Insert-Erfolg pro Row
