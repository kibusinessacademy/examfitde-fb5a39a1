---
name: Pruefungsreife Diagnostic SSOT v1
description: Berufsspezifische Pruefungsreife-Diagnostik aus echten approved exam_questions, 1 pro Kompetenz, mit blueprint/generic Tracking-Segment. Lean Phase 1 (kein MC-Layer).
type: feature
---

## Pruefungsreife Diagnostic SSOT v1 (Phase 1, 2026-05-09)

### Quelle
SECURITY DEFINER RPC `fn_get_pruefungsreife_diagnostic_set(p_package_id uuid, p_limit int default 8)`:
- Nur `course_packages.status='published'` mit `curriculum_id`
- Nur `exam_questions.qc_status IN ('approved','tier1_passed')` + `options jsonb_array_length>=2`
- 1 Frage pro Kompetenz (ROW_NUMBER über competency_id, bevorzugt `item_difficulty 0.4–0.7` und niedrige `item_usage_count`)
- Sortiert nach `competencies.exam_relevance_tier` (tier_1→tier_3) → `sort_order` → title
- Limit clamped auf 4..10
- GRANT EXECUTE auf PUBLIC (read-only, nur veröffentlichte Daten)

### Frontend
- `useDiagnosticSet(packageId)` mappt RPC-Rows auf bestehendes `Question[]`-Schema (8 Generic-Categories als CYCLE) → kein UI-Rewrite nötig.
- Fallback-Pfade: `packageId === null` ODER RPC-Fehler ODER `<4 Rows` → generische `QUESTIONS`.
- `truncateStem(180)` schützt vor Mobile-Overflow auf 390px.

### Tracking (additiv, kein neues Event)
`baseMeta` in `PruefungsreifeCheckPage` erweitert:
- `question_source: 'blueprint' | 'generic'`
- `question_count: number`
- `competency_ids: string[] | null` (nur blueprint)
- `blueprint_ids: Array<string|null> | null` (nur blueprint)

Strict-Path bleibt: mit auflösbarer `package_id` → `quiz_started`/`quiz_completed`. Ohne → `lead_magnet_view + metadata.stage`. Vertrag aus Memory `Strict Event package_id SSOT` unverändert.

### UI-Switch
`QuizStartScreen` zeigt:
- Mit Beruf-Context + Blueprint-Set: `Prüfungsreife-Check für {Beruf}` + "Beantworte N Fragen aus dem echten Prüfungs-Pool deines Berufs"
- Sonst: `Allgemeiner Prüfungsreife-Check` (Hero-Headline mit HeroAccent unverändert)

### Out of Scope (Phase 2)
- MC-Korrektheit als zweite Score-Achse (aktuell nur 0–3 Selbsteinschätzung pro Question-Stem)
- Admin-Funnel-Card-Segment `question_source` (blueprint vs generic Conversion-Rate)
- Adaptiv-Selektion (IRT-basiert) — aktuell deterministisch nach Difficulty + Usage-Count

### Smoke (2026-05-09)
- 5 published Pakete liefern jeweils 8 Diagnose-Fragen
- 4/4 Vitest-Tests grün (`useDiagnosticSet.test.tsx`): null-packageId, RPC <4 rows, RPC ≥4 rows, RPC error → alle Pfade decken Fallback ab
