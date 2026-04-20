---
name: Wave 14b — Row-tolerant Promote v3 + Junk-Variant Cleanup
description: Promote-Bridge fängt nun unique_violation, check_violation, raise_exception sowie GLOBAL_CANONICAL_COLLISION per-row tolerant ab. Klassifikations-Korrektur: BB+TV waren keine Klasse C (Trigger-Block), sondern Klasse A (Source-Gap mit unsubstituierten Templates).
type: feature
---

## Promote-Bridge v3

`fn_prebuild_promote_blueprint_variants` Exception-Handling erweitert:
- `WHEN unique_violation` → collisions_skipped++
- `WHEN check_violation` → trigger_blocked_skipped++
- `WHEN raise_exception` → trigger_blocked_skipped++
- `WHEN OTHERS` mit erweiterten ILIKE-Patterns:
  - `%GLOBAL_CANONICAL_COLLISION%`
  - `%canonical%collision%`
  - `%collision%`, `%duplicate%`
  - `%APPROVAL_REQUIRES_%`
  - `%trap_type%`

Meta-Tracking: `trigger_blocked_skipped` separat von `collisions_skipped`. Strategy-Tag: `top_n_per_lf_row_tolerant_v3`.

## Forensik-Ergebnis

Diagnose der 2 verbleibenden Pakete (Beruflicher Betreuer, Testamentsvollstreckung) ergab:
- 25 Varianten je Paket mit `question_text = '{concept_template}' / '{procedure_template}'` (unsubstituierte Platzhalter)
- 25 Blueprints je Paket mit `question_template` als rohe Platzhalter
- Generate-Bridge (Wave 14a) hatte diese als gültig akzeptiert wegen `length > 20` (durch Padding)
- Echter Block beim Promote: `GLOBAL_CANONICAL_COLLISION` mit Scrum Master PSM I (gleicher Junk-Hash)

## Korrekturmaßnahmen

1. **Junk-Varianten**: 50 Varianten mit Pattern `{*_template}` oder `{Situation}` auf `status='rejected'` gesetzt
2. **Junk-Blueprints**: 50 Blueprints mit Template-Platzhaltern auf `status='deprecated'` gesetzt
3. **Klassifikation aktualisiert**: BB + TV von Klasse C → Klasse A (echter Source-Gap)

## Endbild Wave 14b

- **426 Pakete** mit echten exam_questions (war 425)
- **2 Pakete** ohne Variants (BB, TV) — bereit für AI-Blueprint-Regeneration
- **10 Pakete** ohne Blueprints (echte Klasse A Source-Gaps)

## Lehre

Generate-Bridge MUSS Platzhalter-Patterns explizit ablehnen, nicht nur Längen-Threshold prüfen. Empfohlene Erweiterung: `WHERE question_text !~ '\{[A-Za-z_]+\}'` als Pflicht-Filter im Generate-/Promote-Pfad.
