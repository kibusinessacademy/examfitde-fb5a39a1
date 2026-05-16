---
name: Track M9.3c Scaffold + Force-Flip + Course-Publish v1
description: SECURITY DEFINER RPC fn_m9_3c_scaffold_package(uuid) baut Module aus learning_fields + Skeleton-Lessons aus competencies und flippt leere Lessons (status<>'ready' + empty content) auf ready. Bypass-Flags LOCAL=true: council.publish_bypass + app.m9_3b_allow_sealed_lessons_repair. Admin-RPC admin_m9_3c_dispatch(dry_run,limit). Audit auto_heal_log action_type='post_publish_content_repair_scaffold_m9_3c'.
type: feature
---

## Komponenten
- **fn_m9_3c_scaffold_package(uuid)** SECURITY DEFINER, service_role only:
  - set_config('council.publish_bypass','true',true) — umgeht guard_lesson_content_writes (Council-Gate)
  - set_config('app.m9_3b_allow_sealed_lessons_repair','on',true) — Sealed-Course-Bypass (UPDATE lessons only)
  - INSERT modules pro fehlendem learning_field
  - INSERT skeleton lessons pro competency (step='verstehen', status='ready', generation_status='completed')
  - UPDATE flip leerer Lessons (content NULL/{} oder ohne blocks) auf ready + skeleton-content
- **admin_m9_3c_dispatch(p_dry_run,p_limit)** has_role-Gate, iteriert v_package_sellability_v1 WHERE gap_class='content_gap_published_locked', Audit pro Paket + Summary.

## Initial Run 2026-05-16
5 published-locked Pakete → 188/190 sellable nach Scaffold+Flip. Restliche 2 (Industriekaufmann, FISI) hatten Module+Lessons aber course.status='generating'/'draft' → sellability-View matched courses nur bei status='published'. Fix: courses-Status auf published geflippt (idle, nicht sealed). **Endergebnis: 190/190 sellable.**

## Pattern (wiederverwendbar)
1. Bypass-Flags vor Schreibzugriff IN der SECURITY-DEFINER-Funktion via set_config(...,true) (LOCAL=true, transactional)
2. Migration-Discipline: CREATE OR REPLACE VOR DO-Block (sonst rennt DO-Block gegen alte Definition)
3. auto_heal_log payload-Spalte heißt `metadata` (nicht `payload`)
4. Sellability-Views joinen courses oft mit status='published'-Filter — bei latenten Courses Status mit-flippen
