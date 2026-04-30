---
name: Exam-Pool Too-Small Combined Heal RPC
description: admin_heal_exam_pool_too_small(p_package_id, p_force_chain_reset, p_dry_run) — Kombi-Heal für EXAM_POOL_TOO_SMALL. Wählt Repair via fn_select_exam_pool_repair_action; bei recently failed/no-op resettet step-chain (generate_exam_pool, validate_exam_pool, repair_exam_pool_quality) + admin_nudge_atomic_trigger. Audit in auto_heal_log action_type='exam_pool_too_small_combined_heal'.
type: feature
---

## RPC: admin_heal_exam_pool_too_small
- Args: p_package_id uuid, p_force_chain_reset boolean=false, p_dry_run boolean=false
- Auth: admin oder service_role
- Returns: jsonb mit repair_action, recommended_step, repair_recently_failed, chain_reset_done, nudged

## Logik
1. fn_select_exam_pool_repair_action → empfohlene Repair-Action
2. Heuristik: hat Repair-Job in letzten 6h completed/failed?
3. Wenn ja oder p_force_chain_reset=true:
   - admin_step_reset_detailed für [generate_exam_pool, validate_exam_pool, repair_exam_pool_quality]
   - admin_nudge_atomic_trigger
4. Sonst: admin_targeted_blocker_recheck(true)

## UI
Drift-Log + Combined-Heal sichtbar in Heal-Cockpit Sektion 3 "Pakete heilen" als ExamPoolDriftLogCard.

## Tests
src/components/admin/heal/cards/ExamPoolDriftLog.test.ts — 9 Tests grün, View + 2 RPCs reachability + 6 Datenkontrakt-Szenarien.
