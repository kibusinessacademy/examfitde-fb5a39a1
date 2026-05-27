---
name: BerufAgentOS Cut 1 — Vertical Slice Wire-up
description: Route-Wire-up (admin + /app/beruf-agent-os), Bundle-Detail-Page mit 4 Tabs + HITL-Decision, Run→Bundle→Artifact-Library Pipeline (Edge materialisiert Artifacts post-insert), Empty/Error/Loading-States, Smoke-Test scripts/berufagentos-cut1-smoke.mjs. Verkapselt Cut 1 ohne Scope-Erweiterung.
type: feature
---

# Cut 1 — Vertical Slice Wire-up

## Routes (AppRoutes.tsx)
- `/admin/berufs-ki/outcome-control` → OutcomeControlCenterPage (Mission Control)
- `/admin/berufs-ki/outcome-bundles/:id` → OutcomeBundleDetailPage (Bundle-Detail mit 4 Tabs)
- `/app/beruf-agent-os` → OutcomeControlCenterPage (Public/Customer-Alias, kein AppLayout-Wrap)
- `/app/beruf-agent-os/bundle/:id` → OutcomeBundleDetailPage

## Bundle-Detail-Page (4 Tabs)
1. **Sektionen (11)** — alle 11 Bundle-Felder gerendert; populated → JSON-Preview + Download, leer → Dashed-Card mit Hinweis
2. **Artifact Library** — agent_outcome_artifacts pro Bundle (Title, Kind, Format, Download als JSON)
3. **Agent-Outputs** — Roh-Output pro Agent-Slug (Debug + Audit-Lineage)
4. **Vertical DNA** — Branchen-Kontext der dem Team injiziert wurde

HITL-Block (nicht terminal): Reason ≥8 Zeichen Pflicht, Buttons `In Review` (proposed→in_review), `Approve`, `Reject`, `Apply` (approved→applied). Alle gehen durch `admin_decide_outcome_bundle` RPC mit Audit-Pflicht.

## Run → Bundle → Artifact Library
Edge `berufs-agent-outcome-run` materialisiert nach Bundle-Insert sofort Artifacts aus allen populated Sections.
Mapping section→artifact_kind:
- business_case→business_case · process_model/workflow_graph→workflow · kpi_impact/dashboard_spec→dashboard
- sops→sop · risk_register/rollback_plan→compliance_note · roadmap/rollout_plan→roadmap · test_matrix→test

Response um `artifacts` (count) erweitert. Audit-Payload trägt artifact-count.

## Empty/Error/Loading
- KPI-Strip: Skeleton bei isLoading, Error-Card bei ccErr
- Bundles-Liste: Skeleton (3 Rows), Error-Card, Empty-Hint ("Starte oben einen Outcome-Run …")
- Bundle-Detail: Skeleton bei isLoading, Error-Card mit Back-Button bei nicht-ladbar
- Bundle-Liste: Rows sind jetzt `<Link>` zu `/admin/berufs-ki/outcome-bundles/:id` (hover-state)

## Smoke
`scripts/berufagentos-cut1-smoke.mjs`:
1. Route-Existenz in AppRoutes.tsx (4 Pattern + 2 Lazy-Imports)
2. Edge-Smoke: POST `/functions/v1/berufs-agent-outcome-run` unauth → erwartet 401
Result 2026-05-27: ✓ alle Checks green, Edge lebt.

## Out of Scope (Cut 2+)
- Vertical-DNA-Editor unter `/admin/berufs-ki/vertical-dna`
- Apply-Engine (PR-Bot aus Build-Agent-Output)
- Multi-Agent-Parallel-Execution via berufs_ki_agent_orchestrations
- Public-Landing `/berufos/agent-os` Outcome-Claims
- Bridge zu berufs_ki_graph_nodes
