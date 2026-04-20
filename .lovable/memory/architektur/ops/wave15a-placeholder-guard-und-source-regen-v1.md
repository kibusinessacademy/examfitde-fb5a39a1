---
name: Wave 15a — Placeholder-Guard + Klasse-A Source-Regeneration
description: HARD-Guard auf exam_question_variants gegen unsubstituierte Platzhalter ({...}), SOFT-Auto-Deprecate auf question_blueprints, BB-Hollow-Done korrigiert, Re-Seed-Sweep für 12 Klasse-A-Pakete via package-auto-seed-exam-blueprints.
type: feature
---

## Placeholder-Guard

`fn_guard_variant_placeholder_pollution()` — BEFORE INSERT/UPDATE Trigger auf `exam_question_variants`:
- Pattern `\{[A-Za-z_][A-Za-z0-9_]*\}` in `question_text` ODER `answer_text` → `RAISE EXCEPTION` mit `check_violation`
- Bridge-toleriert: Promote-Bridge fängt `check_violation` per Row und überspringt → kein Paket-Block

`fn_guard_blueprint_placeholder_soft()` — BEFORE INSERT/UPDATE Trigger auf `question_blueprints`:
- Pattern in `question_template` → automatisches Setzen von `status='deprecated'` + `deprecated_at` + `change_reason` (kein Block)
- Erlaubt nachträgliches Enrichment ohne Insert-Fehler

`fn_audit_placeholder_pollution()` — Reporting-Funktion über beide Tabellen.

## Pollution-Cleanup (systemweit)

Bei der Aktivierung gefunden:
- **180 polluted variants** in 14 Curricula (alle als `rejected` markiert)
- **active_polluted = 36 variants** in 11 produktiven Paketen (BWL Bachelor, Fachinformatiker, Tech BW, AEVO etc.) — wären sonst Junk im Prüfungspool
- **75 polluted blueprints** in mehreren Curricula → `deprecated`

## BB-Hollow-Done Korrektur

`Beruflicher Betreuer`: `auto_seed_exam_blueprints` war `done` mit nur 1 aktivem Junk-Blueprint (24/25 deprecated, 1 noch active). Hollow-Guard wurde durch den 1 aktiven Junk umgangen.
- Letzten Junk-Blueprint deprecated.
- Steps `auto_seed_exam_blueprints`, `validate_blueprints`, `generate_blueprint_variants` zurückgesetzt mit `meta.allow_regression_by='ops_force_reset'`.

## Klasse-A Sweep

12 Pakete via `package-auto-seed-exam-blueprints` parallel angestoßen:
- 10 echte No-Blueprint-Pakete (Betreuung/Familienrecht-Domäne)
- 2 hollow-rejected Pakete (BB, TV)

Sweep läuft async (>50s pro Paket wegen AI-Generation). NON_BYPASSABLE_HOLLOW_DONE-Guard wurde bei einem Paket bestätigt — kein neues hollow seed mehr möglich.

## Erkenntnis

Der Junk war kein lokales BB/TV-Problem, sondern systemisch in 14 Curricula. Der Guard hätte schon vor Wave 13 existieren müssen. Lehre: Schema-/Domain-Constraints für Content-Qualität müssen früh als Trigger deklariert werden, nicht nur als Audit nachgelagert.
