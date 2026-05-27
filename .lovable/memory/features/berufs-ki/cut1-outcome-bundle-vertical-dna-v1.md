---
name: BerufAgentOS Cut 1 — Outcome Bundle + Vertical DNA
description: SSOT Outcome-Bundles (11 Sektionen, generated completeness_pct) + Vertical DNA Registry (10 Branchen) + 10 Outcome-Agenten als Erweiterung von Phase-6-AgentOS. HITL via review_status, Audit-Pflicht, Edge-Orchestrator sequentiell.
type: feature
---

# BerufAgentOS Cut 1

## SSOT
- `vertical_dna` — 10 Seed-Branchen (public_admin, hr, real_estate, healthcare, banking, crafts, education, funding, consulting, support) mit roles/kpis/risks/pain_points/sops/automation_potential/regulatory_context. Public-Read (active).
- `agent_outcome_bundles` — Container je Run, 11 Pflicht-Sektionen (business_case, process_model, kpi_impact, workflow_graph, risk_register, sops, roadmap, rollout_plan, dashboard_spec, test_matrix, rollback_plan), `completeness_pct` GENERATED STORED, `review_status` enum proposed|in_review|approved|rejected|applied|rolled_back.
- `agent_outcome_artifacts` — kind enum sop|workflow|api_contract|ui_spec|dashboard|test|seo_brief|compliance_note|business_case|roadmap.
- Trigger `fn_validate_outcome_bundle`: outcome_goal ≥8 Zeichen + workflow_graph mit Nodes → ≥1 kpi_impact Pflicht.

## RPCs (SECURITY DEFINER + has_role)
- `admin_list_outcome_bundles(_vertical, _status, _limit)` (cap 500)
- `admin_get_outcome_bundle(_bundle_id)` → {bundle, vertical, artifacts}
- `admin_decide_outcome_bundle(_bundle_id, _decision, _reason)` — Reason ≥8, emittiert outcome_bundle_<decision> via fn_emit_audit (Fallback auto_heal_log)
- `admin_get_vertical_dna(_industry_key)`
- `admin_outcome_control_center()` — KPIs + Agent-Team-Status

## Agent-Team (10 neue Rows in berufs_ki_agents, kein Parallelschema)
outcome-strategy · outcome-product · outcome-workflow · outcome-build · outcome-ux · outcome-seo-authority · outcome-growth · outcome-security · outcome-compliance · outcome-executive. Jeder mit `governance_rules.outcome_contract` (welche Bundle-Sektion er produziert), HITL=true, Threshold 0.7–0.85.

## Edge
- `berufs-agent-outcome-run` — Orchestrator: lädt Vertical-DNA, ruft sequentiell jeden Agenten via Lovable AI Gateway mit `response_format=json_object`, mergt Outputs per Contract in Aggregation-Buckets, persistiert Bundle mit `review_status=proposed`. Child-Runs in `berufs_ki_agent_runs` für Audit-Lineage.

## UI
- `/admin/berufs-ki/outcome-control` — Mission-Control: KPI-Strip · Run-Form · Agent-Team-Board · Bundles-Liste. Premium-Look, keine Chatbot-Optik.
- Lib: `src/lib/berufs-ki/outcome.ts` (listOutcomeBundles, getOutcomeBundle, decideOutcomeBundle, runOutcomeAgentTeam, fetchOutcomeControlCenter).

## Audit-Contracts (ops_audit_contract, owner_module='berufagentos')
vertical_dna_seeded · outcome_bundle_created · outcome_bundle_{approve,reject,apply,rollback,in_review}.

## North-Star-Override
Bewusste Übersteuerung des Market-Activation-Pivot (2026-05-26: KEINE neue Core-Architektur). Begründung: User-Direct-Request für Premium Enterprise Vertical Outcome AgentOS als Marktdifferenzierung. Wird NICHT als generische Plattform-Erweiterung gewertet, sondern als Verkaufs-Layer (Distribution/Packaging/Demo) für BerufOS-Enterprise.

## Offen (Cut 2+)
- Apply-Engine (PR-Bot, Code-Mutation aus Build-Agent-Output).
- Bundle-Detail-Page mit 11 Tabs + Approve/Reject-Dialog (RPC vorhanden, UI fehlt).
- Vertical-DNA-Editor unter /admin.
- Multi-Agent-Parallel-Execution via berufs_ki_agent_orchestrations.
- Bridge zu berufs_ki_graph_nodes (Bundle als Node spiegeln).
- Route-Registration im AdminLayout (Komponente existiert, Wire-up offen).
- Public-Landing `/berufos/agent-os` um Outcome-Claims erweitern.
