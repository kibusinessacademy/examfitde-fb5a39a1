---
name: S1 Adaptive Burst v2 + Quality Gate Decisions
description: fn_adaptive_burst_size_v2 multi-input (failure_rate/reaper_churn/lane/pool), v_quality_gate_decision_per_pkg SSOT, admin RPC + Cockpit-Card, auto_recovery_pulse_decide auf v2 mit failure_rate-Gate.
type: feature
---

## S1 deployed 2026-05-09

### fn_adaptive_burst_size_v2(pending, failure_rate_15m, reaper_churn_5m, lane, pool)
- Base tier: 25/35/50/75 (wie v1)
- failure_rate>0.20 → ×0.5; >0.10 → ×0.75
- reaper_churn>10 → ×0.5; >5 → ×0.7
- lane='control' → cap 35; lane='recovery' → floor 35
- pool!='default' → cap 25
- clamp 5..100. IMMUTABLE, anon/authenticated executable (pure math).

### fn_auto_recovery_pulse_decide (updated)
- Liest live failure_rate_15m aus job_queue completed/updated und reaper_churn_5m aus auto_heal_log.
- Neuer Decision-Path: `noop_failure_rate_too_high` wenn rate>0.30.
- Logged `burst_version: 'v2'` im audit.

### v_quality_gate_decision_per_pkg
- SSOT pro Paket: package_quality_scores ⊕ package_quality_reports (latest) ⊕ feature_flags.bronze.locked.
- Decisions: PUBLISHED / BRONZE_REVIEW_LOCKED / NOT_SCORED / READY_TO_PUBLISH (≥90) / REVIEW_REQUIRED (75-89) / REPAIR_RECOMMENDED (60-74) / REPAIR_REQUIRED (<60).
- View hard-locked (anon/authenticated revoked); Zugriff nur via RPC.

### admin_get_quality_gate_decisions(p_decision, p_limit)
- SECURITY DEFINER + has_role('admin') Gate.
- Sortiert nach Repair-Priorität (REPAIR_REQUIRED zuerst).

### UI: QualityGateDecisionsCard
- Heal-Cockpit Diagnostics-Tab.
- Filter-Dropdown, Summary-Badges, CSV-Export.

### Tests (src/test/ops/dag-heal-and-alerts.test.ts)
26 Tests grün. Inklusive Burst-v2 Truth-Table (7 cases) + Gate-RPC Anon-Refusal.

### Rollback
DROP FUNCTION fn_adaptive_burst_size_v2(int,numeric,int,text,text);
DROP VIEW v_quality_gate_decision_per_pkg CASCADE;
DROP FUNCTION admin_get_quality_gate_decisions(text,int);
(fn_auto_recovery_pulse_decide vorherige Version aus chat_history wiederherstellen)
