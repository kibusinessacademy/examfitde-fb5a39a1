---
name: Track Coverage Threshold Bug Fix v1
description: fn_track_min_coverage_thresholds hatte für EXAM_FIRST_PLUS fälschlich min_lesson_coverage_pct=60, obwohl der Track per track_step_applicability alle Lesson-Steps skippt. Fix setzt Wert auf 0 (Parität mit EXAM_FIRST).
type: feature
---

## Problem
Der Publish-Trigger `guard_publish_requires_competency_coverage` rief `fn_track_min_coverage_thresholds(track)` auf. Für `EXAM_FIRST_PLUS` lieferte die Funktion `min_lesson_coverage_pct = 60.0`. Da EXAM_FIRST_PLUS-Pakete per `track_step_applicability` aber **keine** Lesson-Steps ausführen (`scaffold_learning_course`, `generate_learning_content`, `fanout_learning_content` etc. alle `should_run=false`), kann die Lesson-Coverage strukturell nie 60% erreichen. Resultat: Jeder Publish-Versuch → `COVERAGE_GAP_BELOW_TRACK_THRESHOLD` → endloser Heal-Loop.

Symptomatisch betroffen waren u.a. `Immobiliardarlehensvermittler §34i` und drohend alle weiteren EXAM_FIRST_PLUS-Pakete (z. B. §34f).

## Fix (2026-04-24)
`fn_track_min_coverage_thresholds`:
- `EXAM_FIRST_PLUS.min_lesson_coverage_pct` von `60.0` → `0.0` (Parität mit `EXAM_FIRST`)
- `min_competency_question_coverage_pct` bleibt 80%

## Track-Threshold-SSOT (final)
| Track | min_lesson_cov | min_comp_q_cov |
|---|---|---|
| STUDIUM | 80 | 80 |
| AUSBILDUNG_VOLL | 75 | 80 |
| EXAM_FIRST_PLUS | **0** | 80 |
| EXAM_FIRST | 0 | 80 |

## Invariante
`min_lesson_coverage_pct` darf nur >0 sein, wenn der Track per `track_step_applicability` mindestens einen der lesson-erzeugenden Steps (`scaffold_learning_course`, `generate_learning_content`) auf `should_run=true` hat. Bei künftigen Track-Erweiterungen synchron halten.
