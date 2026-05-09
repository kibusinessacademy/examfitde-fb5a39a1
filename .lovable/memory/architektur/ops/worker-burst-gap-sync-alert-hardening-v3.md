---
name: Worker-Burst, Gap-Sync, Alert-Hardening v3
description: Phase-3 Sprint 2026-05-09 — claim_pending_jobs_v5 default 25, recovery_pulse, v_dag_gap_sync_per_lane, fn_should_suppress_cta_visible, admin_smoke_dag_heal_counters
type: feature
---

## Problembild
- 224 control-lane jobs pending, 2 processing → Throughput-Stau.
- v_dag_blocked_jobs zeigte 100 jobs als parent_done_drift (View-Lag), parents waren faktisch done.
- cta_visible_stall feuerte nachts trotz fehlendem Traffic (False-Positive).
- Suppression-Logik war inline in Cron, nicht testbar.

## Root Cause
1. Worker-Batch zu klein (10) → bei 226 pending bräuchte es 23 Claim-Cycles bei single Worker.
2. Suppression-Logik nicht extrahiert → keine Unit-Test-Coverage.
3. Gap-Sync gegen DAG-View hatte keinen lane-aggregierten Drill-Down.

## Kausalkette
backlog (worker_pool='default') → claim_v5 limit=10 + per-pkg-cap=3 → effektiv 3 jobs/cycle/pkg → starve bronze-locked tail.

## Fix-Design
- `claim_pending_jobs_v5` default p_limit 10→25 (additiv, Aufrufer können weiter overriden).
- `claim_recovery_pulse(worker_id, limit=50, pool='default')` — service_role only, kein per-pkg-cap, drainage-mode.
- `v_dag_gap_sync_per_lane` + `admin_get_dag_gap_sync()` (has_role-gated) → Drill-Down lane × block_reason × jobs/packages/avg_minutes/bronze_locked.
- `fn_should_suppress_cta_visible(baseline, c1h, c24h)` IMMUTABLE pure SQL → testbar; Cron nutzt Helper.
- `admin_smoke_dag_heal_counters()` → JSON-Snapshot total_blocked/by_reason/pending/processing für E2E-Tests.

## Verifikation
- DO-Block in Migration: 4 Suppression-Pfade getestet (low-baseline-suppress, high-baseline-fire, c1h>0-noop, c24h=0-noop) — alle grün.
- Vitest src/test/ops/dag-heal-and-alerts.test.ts: admin-RPCs refuse anon + Helper truth-table 4/4.
- Auto-heal-log Audit-Tag `worker_burst_and_audit_v3`.

## Restrisiken
- Bronze-locked tail jobs (35 Pakete) bleiben; bronze_lock_override muss per-package gesetzt werden (siehe forensic_manual_heal_2026_05_09).
- Edge-Function-CPU bleibt physisches Limit; recovery_pulse muss von Worker-Edge-Function expliziter gerufen werden, sonst weiter idle.

## Dauermaßnahmen
- Suppression-Helper als SSOT für jeden zukünftigen Traffic-Alert verwenden.
- Gap-Sync-View in Heal-Cockpit als Card aufnehmen (folgt im UI-Sprint).
- claim_recovery_pulse-Aufruf in worker-auto-scaler-cron einbauen wenn pending>100 für >10min.
