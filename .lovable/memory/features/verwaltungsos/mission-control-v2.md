---
name: VerwaltungsOS Mission Control v2 — Executive Personas + Workflow-Druck
description: Cockpit-Erweiterung Cut A2 — Single-Payload-RPC liefert jetzt workflow_pressure, Cockpit zeigt Executive-Personas-Switcher (Bürgermeister/Amtsleiter/Governance, localStorage) und neue Workflow-Druck-Karte mit Klassifikation × Top-3 Workflows pro Dept.
type: feature
---

# Mission Control v2 — FROZEN 2026-05-28 (Cut A2)

Verlängert das Executive Cockpit um die A1-Workflow-Pressure-Signale und gibt
Entscheidern eine Persona-Linse — ohne neue Tabellen, ohne neuen Endpoint pro Karte.

## RPC

`verwaltung_executive_cockpit(_window_days)` (SECURITY DEFINER, admin ODER service_role)
liefert jetzt zusätzlich `workflow_pressure` (= `verwaltung_daily_brief_workflow_pressure`).
**Single Payload SSOT** — UI macht weiterhin nur einen RPC-Call + parallel NINA + BA.

## UI

`/admin/verwaltung/cockpit` (`VerwaltungCockpitPage`):
- **Executive-Personas-Switcher** in Hero: `Bürgermeister | Amtsleiter | Governance`.
  Persistenz via `localStorage` Key `verwaltungsos.cockpit.persona`. Fokus-Hint sichtbar.
- **Workflow-Druck-Karte** (Workflow-Icon, Gauge):
  - KPI-Strip: Ø Pressure, Department-Count
  - Klassifikations-Mix als Badges (`WORKFLOW_PRESSURE | AUTOMATION_OPPORTUNITY | GOVERNANCE_GAP | OK`)
  - Top-6 Drilldown mit Score, Klassifikations-Badge, Top-3 Workflows (esc/auto/kpi counts)
  - Token-only Color-Coding via `pressureTone()` (`status-bg-*-subtle`/`-border`/`-fg`)
- Reihenfolge: KPI-Strip → Reality+Lagebild → **Workflow-Druck** → Cluster-Heat+Risks → Hotspots.

## Anti-Drift

- Persona-Switcher ist UI-only (keine RPC-Mutation, keine Server-Filter).
- Workflow-Druck-Karte konsumiert ausschließlich `cockpit.workflow_pressure` aus dem aggregierten Payload — kein zweiter Fetch.
- Keine neuen Tabellen, keine LLM-Pfade.
- Tokens-only — keine rohen Tailwind-Farben.
- Mit A1: deterministisch in SQL, keine Mirror-Tabelle.
