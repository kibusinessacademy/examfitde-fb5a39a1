---
name: exam_questions status/qc_status Sync-Härtung
description: Trigger + CHECK-Constraint + Selbsttest verhindern dauerhaft Drift zwischen status und qc_status auf exam_questions (Root-Cause des §34f-Stalls).
type: feature
---

## Komponenten
- `fn_sync_status_qc_status()` BEFORE INSERT/UPDATE Trigger auf `exam_questions(status, qc_status)`:
  - status='approved' → qc_status='approved' (aus tier1_passed/pending/review/NULL)
  - qc_status='approved' & status in (draft/review/NULL) → status='approved' + reviewed_at
  - qc_status='approved' & status='rejected' → qc_status='rejected' (Ablehnung gewinnt)
  - status='rejected' & qc_status='approved' → qc_status='rejected'
- CHECK-Constraint `chk_exam_questions_status_qc_consistency` (VALIDATED): blockiert jede künftige Drift hart.
- RPC `fn_selftest_status_qc_sync()` SECURITY DEFINER → JSONB Report (`ok`, drift counts, trigger/constraint state) + admin_notifications log. GRANT auf authenticated + service_role.

## Drift-Park-Strategie
Backfill mit Sub-Block je Row: bei globaler Hash-Kollision (`trg_guard_global_collision_on_approve`) → `status='rejected'` + `qc_status='dup_collision'`. Keine Datenverluste.

## Aufrufpfade
- UI Button (Admin Cockpit / Heal-Cockpit): `supabase.rpc('fn_selftest_status_qc_sync')`
- Cron (täglich): selber RPC; bei `ok=false` Alert via admin_notifications high-severity.

## Backfill-Statistik (initial run 2026-04-25)
- 7851 status_only-Drifts → synced (alle ohne Kollision)
- 548 qc_only-Drifts → 159 synced, 389 wegen status='rejected' auf qc_status='rejected' korrigiert
