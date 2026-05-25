---
name: Phase 6 Agent Operating System
description: Berufs-KI Agent Registry, HITL-Approval, Multi-Agent-Orchestration Foundation, Performance + Control Center
type: feature
---

## Tabellen
- `berufs_ki_agents` — Agent Contract (slug, category, role, governance_rules, confidence_threshold, requires_human_approval, blocked_actions, runtime_profile). 6 Seed-Agenten (communication/workflow/analysis/compliance/career/recruiting).
- `berufs_ki_agent_runs` — Run-Log mit confidence_score, status (queued|running|awaiting_approval|approved|rejected|completed|failed|escalated), audit_trail.
- `berufs_ki_agent_orchestrations` — Multi-Agent-Flows (Schema vorbereitet, noch keine Engine).
- `berufs_ki_agent_memory` — Pro-Agent-Patterns/Regeln.

## Knowledge-Graph-Bridge
- Trigger `trg_bki_sync_agent_node` spiegelt jeden Agent als Node `ai_agent` in `berufs_ki_graph_nodes`.

## Edge Function
- `berufs-ki-agent-run` — auth-gated; baut System-Prompt aus Contract; ruft Lovable AI Gateway (default `google/gemini-3-flash-preview`); Heuristik-Confidence; Auto-Status `awaiting_approval` wenn HITL=true ODER confidence<threshold.

## RPCs (admin)
- `admin_bki_list_agents`, `admin_bki_upsert_agent`, `admin_bki_list_agent_runs`, `admin_bki_decide_agent_run` (approve|reject|escalate), `admin_bki_agent_performance(window)`, `admin_bki_control_center`.

## UI
- `/admin/berufs-ki/agents` — Registry-CRUD + Inline-Run-Dialog + 7d-Performance pro Agent.
- `/admin/berufs-ki/control-center` — KPIs (Agenten/Runs24h/Governance/Graph) + Approval-Queue mit Approve/Reject/Escalate.

## Governance-Invarianten
- HITL Default `true`. Confidence < threshold → forced `awaiting_approval`.
- Keine autonomen Writes auf published Entitäten.
- audit_trail JSONB-Append bei jeder Decision (event/by/at/notes).

## Offen
- 6A Multi-Agent-Orchestrierung (Engine fehlt — nur Schema da).
- 6B Memory-Auto-Capture aus Runs.
- 6D Marketplace.
