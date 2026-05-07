---
name: LXI Heal Audit + Rollback v1
description: lxi_heal_attempts Snapshot-Tabelle + admin_lxi_rollback_heal_attempt + Smoke + Analyzer-Hardening
type: feature
---
Reinit-RPC schreibt before/after-Snapshot in lxi_heal_attempts und gibt attempt_id zurück.
Rollback nur innerhalb 1h, mit Drift-Guard (Step-Status muss noch queued/processing/running sein),
storniert seit attempt erzeugte Jobs und stellt previous_status wieder her. RPCs:
admin_lxi_rollback_heal_attempt, admin_lxi_list_heal_attempts, admin_lxi_get_heal_attempt_diff
(alle SECURITY DEFINER + has_role-Gate, RLS: nur admin SELECT, nie INSERT/UPDATE durch user).
Analyzer (admin-lxi-package-analyzer): Retry 3x mit Backoff+25s-Timeout, in-memory-Cache 5min/200,
Validate-Shape-Helper, Safe-Fallback (heuristic) wenn AI down/invalid.
Smoke scripts/lxi-heal-smoke.mjs (3 Phasen: dry-run-truth, push-wrapper-shape, optional LIVE rollback).
CI .github/workflows/lxi-heal-smoke.yml daily 05:21 UTC + on-PR (lxi/heal touched files), LXI_SMOKE_LIVE=0.
UI-Row-Actions in LxiQueuedNoLessonsReinitCard: Reset-Retry (single per-pkg, real-run), Audit-Drawer
mit Liste der attempts + Before/After-Diff + Rollback-Button (nur wenn can_rollback=true).
