---
name: SELF.HEAL.OS.1 — Self-Healing Operator Cockpit
description: Deterministic projector over auto_heal_log / ops_health_summary / auto_heal_policies. Read-only Action Queue (HEAL_DISABLED, INCIDENT_MODE, HEAL_FAIL_SPIKE, HEAL_SILENCE, HEAL_THRASHING, ACTION_REGRESSION, ACTION_HIGH_FAILURE, ACTION_NO_EFFECT, ACTION_NO_FOLLOWUP). Live at /admin/governance/self-heal-health.
type: feature
---

# SELF.HEAL.OS.1 — Self-Healing Operator Cockpit

## Quellen (SSOT, read-only)
- `auto_heal_log` (7d, inkl. followup_verdict + score_before/after + duration_ms)
- `ops_health_summary` (auto_heal_allowed Flag, heals_24h/success/failed, stuck_jobs, failed_packages)
- `auto_heal_policies` (active row: incident_mode, cooldowns, requires_approval)

## Architektur
- Pure Projector: `supabase/functions/_shared/selfHealHealth/index.ts` (frontend mirror via `src/lib/selfHealHealth/index.ts`)
- Edge Function: `evaluate-self-heal-health` (admin-only, no writes)
- UI: `src/pages/admin/governance/SelfHealHealthPage.tsx` → Route `/admin/governance/self-heal-health`
- Tests: `src/__tests__/self-heal-health/projector.test.ts` (12 tests)

## Action Queue Heuristik (deterministisch, sortiert nach score desc)
| Code | Severity | Trigger |
|---|---|---|
| HEAL_DISABLED | critical | `ops_health_summary.auto_heal_allowed = false` |
| INCIDENT_MODE | critical | aktive Policy mit `incident_mode = true` |
| HEAL_FAIL_SPIKE | high | `heals_failed_24h >= 5` |
| HEAL_SILENCE | high | `heals_24h = 0` aber `failed_1h>0 ∨ stuck_jobs>0` |
| ACTION_REGRESSION | high | `regressed > improved` ∧ `followup_checked ≥ 3` |
| ACTION_HIGH_FAILURE | high | `success_rate < 0.5` ∧ `success+failed ≥ 5` |
| HEAL_THRASHING | medium | `heals_24h > 100` |
| ACTION_NO_EFFECT | medium | `improved=0` ∧ `no_change ≥ 5` |
| ACTION_NO_FOLLOWUP | medium | `total_7d ≥ 10` ∧ `followup_coverage < 0.2` |

## KPI je action_type (7d)
success_rate, effective_rate (improved/followup_checked), followup_coverage, avg_score_delta, avg_duration_ms, health (green/yellow/red).

## Invarianten
- Pure: keine DB-/Fetch-/Date.now()-Calls im Projector — `now_iso` ist Input.
- Read-only: keine Triggers, keine Heal-Runs aus dem Cockpit.
- Stable Sort: gleiche Inputs → identische Outputs (test 1 deckt das ab).
- SSOT-konform: keine eigene Heal-Logik, nur Aggregation bestehender Tabellen/Views.
