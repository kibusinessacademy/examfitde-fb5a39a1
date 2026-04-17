---
name: Hollow-Publish Coverage Guard v2
description: BEFORE-UPDATE Trigger blockt published-Übergang bei Coverage-Lücken; fn_should_hollow_quarantine_package erkennt COVERAGE_GAP_BELOW_TRACK_THRESHOLD; track-spezifische Schwellen
type: feature
---

Der Hollow-Publish-Guard prüft jetzt nicht mehr nur strukturelle Leere (lessons>0), sondern auch **track-spezifische Coverage-Schwellen**:

**Track-Schwellen (`fn_track_min_coverage_thresholds`):**
| Track | min_lesson_coverage_pct | min_competency_question_coverage_pct |
|---|---|---|
| STUDIUM | 80 | 80 |
| AUSBILDUNG_VOLL | 75 | 80 |
| EXAM_FIRST_PLUS | 60 | 80 |
| EXAM_FIRST | 0 (kein Lesson-Mandate) | 80 |
| Default | 60 | 75 |

**Komponenten:**
- `fn_compute_package_coverage(package_id)` — joins via `learning_fields.curriculum_id` (SSOT) und liefert `comp_total`, `comp_with_lesson`, `comp_with_question`, `lesson_coverage_pct`, `competency_question_coverage_pct`.
- `fn_should_hollow_quarantine_package` — neue **Case 4 `COVERAGE_GAP_BELOW_TRACK_THRESHOLD`**, sodass `run_hollow_published_guard_ssot` Pakete mit Lücken in Quarantäne setzt.
- `trg_guard_publish_requires_competency_coverage` (BEFORE UPDATE OF status) — wirft `RAISE EXCEPTION` mit ERRCODE `P0001`, wenn ein Paket nach `published` übergeht und eine Track-Schwelle unterschreitet.

**Bypass (audit-relevant):** Setze `integrity_report->>'bypass_coverage_guard' = 'true'` vor dem Publish-Update. Soll nur in dokumentierten Migrationen oder admin-ops mit Audit-Eintrag verwendet werden.

**Fehlertext-Beispiel:**
`COVERAGE_GAP_BELOW_TRACK_THRESHOLD: lesson_coverage_pct=6.1 below track-min=80.0 (track=STUDIUM, comp_with_lesson=2/33)`
