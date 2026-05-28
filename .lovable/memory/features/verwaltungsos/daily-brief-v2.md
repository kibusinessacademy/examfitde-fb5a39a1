---
name: VerwaltungsOS DailyBrief v2 — AgentOS Signal Bridge
description: Workflow-Pressure-Layer aus 128 realen Fachverfahren auf DailyBrief — per Fachbereich klassifiziert (WORKFLOW_PRESSURE/AUTOMATION_OPPORTUNITY/GOVERNANCE_GAP/OK), deterministischer Score, Top-3 Workflow-Drilldown. Smoke GREEN.
type: feature
---

# DailyBrief v2 — FROZEN 2026-05-28 (Cut A1)

Brücke zwischen DailyBrief v1 (Oral-Signale) und VerwaltungsAgentOS v1 (128 Workflows).
Macht aus statischen Workflow-Definitionen ein operatives Pressure-Signal.

## SSOT

- **View** `v_verwaltung_workflow_signals` (service_role only) — pro Fachbereich:
  `workflow_count`, `pct_with_escalations`, `pct_with_automation`, `pct_with_kpis`,
  `total_escalation_triggers`, `total_automation_hints`.
- **RPC** `verwaltung_daily_brief_workflow_pressure(_window_days)` (SECURITY DEFINER,
  service_role ODER `has_role(uid,'admin')`):
  - joint Workflow-Signals × Oral-Signals (`verwaltung_oral_sessions`)
  - deterministischer `pressure_score` 0–100 (avg_escalation×15 + high_conflict×0.3
    + escalations×0.3 − automation×0.2 − kpis×0.1)
  - Klassifikation: `WORKFLOW_PRESSURE | AUTOMATION_OPPORTUNITY | GOVERNANCE_GAP | OK`
  - Top-12 Pressure mit Top-3 Workflow-Cards (key/name/category/escalation/automation/kpi counts)
- **Audit-Contract** `daily_brief_workflow_pressure_read` in `ops_audit_contract`.

## UI

`/admin/verwaltung/daily-brief` → `WorkflowPressureSection`:
KPI-Strip (Pressure-Avg, Mix), Top-Departments-Liste mit Klassifikations-Badge,
Workflow-Drilldown pro Department (Top-3).

## Smoke (GREEN 2026-05-28)

`scripts/verwaltung-daily-brief-v2-smoke.mjs`:
- anon RPC blocked (permission denied)
- service_role payload: 7 Pflicht-Keys, `classification_mix` summe == department_count (40)
- view anon-read blocked

## Anti-Drift

- Pressure-Score & Klassifikation sind deterministisch im SQL — kein LLM.
- Erweiterungen (neue Klassen / neue Signale) erfordern Migration + Smoke-Update.
- Keine Mutationen, keine Mirror-Tabelle.
- `department_name` (nicht `display_name`) ist die einzige Anzeigequelle in `verwaltung_department_dna`.
