---
name: Council-Resume curriculum_id SSOT-Fix v3
description: admin_resume_(single_)council_deferred übergeben jetzt curriculum_id im payload (vorher SSOT VIOLATION via assert_job_payload). Idempotent gegen unique_violation wenn Atomic-Trigger den Job bereits angelegt hat.
type: feature
---

# Council-Resume Hotfix v3 (2026-04-27)

## Bug
Bulk Resume und Single Resume im Heal Cockpit warfen:
`SSOT VIOLATION: job package_quality_council missing curriculum_id`

## Root Cause
`assert_job_payload(job)` (zentraler Guard) erzwingt `payload->>'curriculum_id'`.
Beide RPCs übergaben aber nur `{package_id, resumed_from_defer}` an `enqueue_job_if_absent`.

## Fix
1. RPCs lesen `curriculum_id` aus `course_packages` und fügen sie in den payload ein.
2. Bulk-Variante skippt Pakete ohne curriculum_id (statt zu crashen) → `skipped_no_curriculum`.
3. Idempotent: Vor enqueue wird geprüft ob bereits ein aktiver Job existiert (Atomic-Trigger könnte schneller gewesen sein durch Step→queued). `unique_violation` wird abgefangen → Aktion `resumed_trigger_was_faster`.

## Verifikation
- 2 Council-Deferred + 1 DEFERRED-Resolved Paket geheilt
- 0 offene Defers, 3 aktive Council-Jobs

## Anti-Pattern
- ❌ `enqueue_job_if_absent` ohne `curriculum_id` im payload für jeden package_*-Job
- ❌ RPCs die Step→queued setzen UND danach enqueue ohne unique_violation Schutz
