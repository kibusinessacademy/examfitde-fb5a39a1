---
name: Cancel-Storm Hard-Guard v1
description: trg_guard_block_building_to_queued_revert + fn_rebalance_wip_priority hardening — verhindert dass geschützte Pakete (≥50 approved Q oder ≥70% progress oder pending tail-jobs) demoted werden. Beendete 991 Cancels/6h.
type: feature
---

# Cancel-Storm Root-Fix 2026-05-02

## Symptom
991 cancels in 6h auf 5 Hauptursachen:
- DAG_SEQUENCE_GUARD predecessor reset (152) → Folge des Reverts
- PRICING_HARD_GATE_PRECONDITION/BLOCKED (161) → Tail-Cancels
- PATTERN_X14_REPLACED_BY_HEAL (82)
- STALE_LOCK_LOOP_HARD_KILL (53)
- 4 Hot-Loop-Pakete = 556 cancels (56%)

## Root Cause
1. **fn_rebalance_wip_priority** (cron `*/10`) demoted `building→queued` mit nur einer Schutzschwelle (`build_progress<70`). Schutz griff nicht für Pakete mit hohem `approved_questions` aber niedrigem `build_progress`.
2. **Unidentifizierter Reverter** (`transition_source='unknown_trigger'`) demoted `570ccb3e` (build_progress=100, 2010 approved Q) 155x in 6h.
3. Jede Demotion cancelt 11 pending Tail-Jobs gleichzeitig → Multiplikator-Effekt.

## Fix
**Hard-Guard Trigger** `trg_guard_block_building_to_queued_revert` BEFORE UPDATE OF status:
- Block wenn `fn_package_demote_protected(pkg)` true (≥50 approved Q ODER ≥70% progress ODER pending tail jobs vorhanden)
- Bypass nur via `app.transition_source IN ('admin_manual','admin_soft_reset','admin_force_rebuild')` oder `session_replication_role='replica'`
- Setzt `NEW.status := OLD.status` (behält building) statt RAISE — alle anderen Felder dürfen geändert werden
- Audit jeder Block in `auto_heal_log` mit action_type='guard_block_building_revert'

**fn_rebalance_wip_priority v3**:
- Setzt `app.transition_source='wip_rebalancer'` (Identitäts-Attribution)
- 3 zusätzliche WHERE-Bedingungen: approved_q ≥ 50, no pending council/integrity/auto_publish jobs
- Defensive race-safe Doppelcheck via Helper vor jedem UPDATE
- cancel_reason='WIP_REBALANCE_DEMOTION' im meta gesetzt (vorher: leer)
- Audit `wip_rebalance_skipped_protected` für übersprungene Demotion-Versuche

## Verification
- Test-Revert auf 570ccb3e mit `app.transition_source='simulated_attacker'`: Status blieb building, 1 Block-Audit erzeugt ✓
- Innerhalb 5min nach Migration: 5 weitere Blocks gegen `unknown_trigger`-Reverter automatisch abgewehrt
- Storm-Cleanup: 6 Pakete healed, alle cancelled tail-jobs der 6h-Window mit `superseded_by_post_storm_heal` markiert

## Open
`unknown_trigger`-Reverter noch nicht identifiziert — Kandidaten: `production-watchdog` (3min), `admin-production-supervisor-cron` (5min), oder rohes UPDATE in einer anderen Edge-Function. Hard-Guard hält trotzdem.

## Files
- Migration: `20260502200251_*.sql`
- Helper: `fn_package_demote_protected(uuid)` (service_role only)
- Trigger: `trg_guard_block_building_to_queued_revert`
- RPC: `fn_rebalance_wip_priority` v3
