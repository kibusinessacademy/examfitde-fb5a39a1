---
name: Targeted Blocker Recheck v1
description: SECURITY DEFINER Funktion admin_targeted_blocker_recheck(p_execute) reiht für die 4 echten Blocker-Klassen (NEVER_CHECKED/DEFERRED/COUNCIL_PENDING/EXAM_POOL_TOO_SMALL) cause-aware Reparatur-Jobs ein. Dry-Run + Execute über admin_ai_analysis_log auditierbar.
type: feature
---

## Zweck
Gezielte Wiederaufnahme der 13 echten Blocker aus v_admin_publish_readiness ohne View-Änderungen, ohne Lesson-Archivierung, ohne Track-Drift-Cleanup.

## Aufruf
```sql
-- Dry-run (Plan ansehen)
SELECT * FROM public.admin_targeted_blocker_recheck(false);

-- Execute (Jobs einreihen)
SELECT * FROM public.admin_targeted_blocker_recheck(true);
```

## Logik
| Blocker | Aktion | Bedingung |
|---------|--------|-----------|
| INTEGRITY_NEVER_CHECKED | enqueue package_run_integrity_check | unbedingt |
| INTEGRITY_DEFERRED | enqueue package_run_integrity_check | nur wenn defer_reason=WAITING_FOR_MATERIALIZATION UND approved_questions ≥ track-min |
| QUALITY_COUNCIL_PENDING (deferred=true im Report) | enqueue package_run_integrity_check (refresh) + package_quality_council | nur wenn integrity_passed=true |
| QUALITY_COUNCIL_PENDING | enqueue package_quality_council | nur wenn integrity_passed=true |
| EXAM_POOL_TOO_SMALL | enqueue package_repair_exam_pool_lf_coverage / _competency_coverage / _quality | defect-aware (LF-Lücke / <5 Fragen / Volumen) |

## Hilfsfunktion
`_admin_recheck_enqueue(job_type, package_id, priority, payload)` ergänzt automatisch `curriculum_id` (SSOT-Pflicht) und fängt `unique_violation` (Job bereits aktiv) und `check_violation` (Guard rejected) still ab.

## Audit
Plan und Ausführung werden in `admin_ai_analysis_log` mit route_key `targeted_blocker_recheck_dryrun` bzw. `_execute` persistiert.

## Track-Mindestschwellen (für DEFERRED-Recheck)
- AUSBILDUNG_VOLL: 300
- EXAM_FIRST: 150
- EXAM_FIRST_PLUS: 300
- STUDIUM: 200
