
# VerwaltungsOS Phase A — Plattformkern fertigstellen

Ziel: Die vier noch offenen Kern-Cuts der Plattform-Roadmap **kontrolliert nacheinander** abschließen, ohne neue horizontale Buzzwords. Phase B (Voice/Realtime), C (Enterprise), D (weitere BranchenOS) explizit **nicht** in diesem Plan.

## Bereits FROZEN (Baseline)

- Fachbereichs-DNA v1 (40 Depts, 11 Layer)
- Oral Bridge v1 + Persona Pressure + Debrief
- Bund-Lagebild (NINA + Pegel)
- Arbeitsmarkt-Lagebild (BA API)
- Reality-Bridge v1 (DNA × Oral × Markt)
- Executive Cockpit v1 (Single-Payload RPC + Premium-UI)
- DailyBrief v1 (Executive / Risks / Department)
- DNA Backfill v1 (Rollen/Prozesse/KPIs/Risiken ≥3/4/3/3 für 40/40)
- **VerwaltungsAgentOS v1** (128 Workflows, Strict-RAG, Operations Console)

## Cut A1 — DailyBrief v2: AgentOS-Signal-Bridge

DailyBrief liest aktuell nur Oral-Signale. Mit AgentOS existieren jetzt 128 reale Workflows mit `kpi_targets`/`escalation_triggers`/`automation_hints` — diese werden zu **Workflow-Drift-Signalen** verknüpft.

- Neue View `v_verwaltung_workflow_signals` (read-only):
  pro Department → Anzahl Workflows, Kategorien-Mix, Anteil mit `escalation_triggers`, Anteil mit `automation_hints`, KPI-Coverage.
- RPC `verwaltung_daily_brief_workflow_pressure(_window_days)` (admin-gated):
  korreliert Oral-Eskalation (avg_escalation, high_conflict_pct) × Workflow-Dichte → deterministische Klassifikation `WORKFLOW_PRESSURE`/`AUTOMATION_OPPORTUNITY`/`GOVERNANCE_GAP`/`OK`.
- Department-Brief erweitert um Feld `workflow_signals` (Top-3 Workflows mit höchstem Pressure-Score, jeweils mit `workflow_key` als Source).
- UI-Card `WorkflowPressureSection` auf `/admin/verwaltung/daily-brief` zwischen Reality-Bridge und Departments.
- Smoke: `scripts/verwaltung-daily-brief-v2-smoke.mjs` (anon blocked, service-role shape, ≥1 classification per top-pressure dept).

## Cut A2 — Mission Control v2

Cockpit zeigt heute Reality + NINA + Cluster-Heat. v2 ergänzt **operative Ebenen**:

- **KPI-Drift-Strip**: aggregiert über `kpi_targets` der Workflows × Oral-Score-Trends — pro Dept Tile mit Pfeil/Delta.
- **Workflow-Blockaden-Tabelle**: Workflows mit hoher Escalation-Trigger-Quote und niedriger Automation — sortierbar.
- **Executive Personas Switcher**: Bürgermeister / Amtsleiter / Governance — filtert Cards (kein Schreibpfad, nur Visibility-Profile, persistiert in localStorage).
- Konsolidiert in bestehendes RPC `verwaltung_executive_cockpit` → Erweiterung um `workflow_pressure` Block (kein neues RPC), Shape-Smoke wird auf die neuen Keys gehärtet.

## Cut A3 — Governance Intelligence Layer

Eigenständige Surface `/admin/verwaltung/governance` mit:

- **AI-Audit-Trail**: liest `auto_heal_log` gefiltert auf `verwaltung_agent_run` + `verwaltung_oral_*` → Tabelle mit Run-Count / Sources-Histogram / Refusal-Quote / User-Hash.
- **Refusal-Quality-Card**: Anteil Refusal-Phrasen pro Department × Tag → identifiziert DNA-Lücken (zu viele Refusals = Knowledge-Gap).
- **Source-Coverage-Card**: zeigt welche `workflow_keys` nie zitiert wurden → Dead-Workflow-Detection.
- RPCs (admin-gated): `verwaltung_governance_audit_summary(_window_days)`, `verwaltung_governance_refusal_quality(_window_days)`, `verwaltung_governance_source_coverage(_window_days)`.
- Audit-Contract: `verwaltung_governance_view` (für Zugriffe selbst).

## Cut A4 — Modernisierungs-Intelligence (Phase-A-Closer)

Lightweight Prozess-Mining auf Basis vorhandener Signale (KEIN neuer Event-Bus):

- View `v_verwaltung_modernization_opportunities`:
  ranks Workflows nach (a) hohem `escalation_triggers`-Count, (b) leerem `automation_hints`, (c) hoher Oral-Eskalation im selben Dept.
- RPC `verwaltung_modernization_opportunities(_window_days, _limit)` (admin-gated) liefert Top-Opportunities mit deterministischer Recommendation: `AUTOMATE_STEP` / `REDUCE_MEDIA_BREAK` / `STRENGTHEN_DEESCALATION` / `CLARIFY_DOCUMENT`.
- UI: Sektion `ModernizationOpportunitiesSection` auf `/admin/verwaltung/cockpit` (unter Hotspots).
- Smoke `scripts/verwaltung-modernization-smoke.mjs`.

## Technische Details

- Alle Reads sind **read-only RPCs** mit `SECURITY DEFINER` + `has_role(uid,'admin')`.
- Kein neuer Schreibpfad, keine neuen Tabellen außer Views.
- LLM-Aufrufe ausschließlich in bestehender Edge `verwaltung-agent` — **kein neuer LLM-Code** in Phase A (Phase B = Voice).
- Audit-Contracts neu in `ops_audit_contract`: `verwaltung_governance_view`, sonst nur Reuse.
- UI strikt Token-only (`status-bg-*`, `shadow-elev-*`, `surface-*`). Operations-Center-Sprache, kein Chat-Look.
- Jeder Cut hat eigenen Smoke + Memory-Freeze. Index nach jedem Cut auto-updated (Memory-Rule).

## Sequenz & Approval

1. Cut A1 (DailyBrief v2 + Signal-Bridge)
2. Cut A2 (Mission Control v2)
3. Cut A3 (Governance Intelligence)
4. Cut A4 (Modernisierungs-Intelligence)

Pro Cut: Migration → Reader-Lib/UI → Smoke → Memory. Erst nach grünem Smoke der nächste Cut.

## Explizit NICHT in Phase A

- Voice/Realtime/Multi-Persona/Krisenstab (Phase B)
- Benchmarking-Plattform, AI-Act-Cockpit, DMS/Outlook/RIS-Integrationen (Phase C)
- Weitere BranchenOS (PraxisAgentOS etc., Phase D)
- Neue Fachverfahren-Tiefe pro Bundesland (separater DNA-Cut nach Phase A)

## Bestätigungsfrage

Bestätige die Sequenz A1 → A4. Soll ich nach grünem A1-Smoke automatisch in A2 weiterlaufen, oder pro Cut explizit auf dein Go warten?
