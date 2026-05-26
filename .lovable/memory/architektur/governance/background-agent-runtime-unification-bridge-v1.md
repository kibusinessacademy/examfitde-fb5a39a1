---
name: Background Agent Runtime Unification Bridge v1
description: Pfad-A-Implementierung — SSOT-View über 5 lebende Background-Quellen ohne neue Tabellen, Cockpit /admin/governance/agents, Capability-Registry aus runtime_safe_actions + berufs_ki_agents
type: feature
---

# Background Agent Runtime — Unification Bridge (Pfad A)

**Datum:** 2026-05-26
**Auslöser:** User-Vorschlag "P70 Background Agent Runtime analog Claude Code"
**Entscheidung:** Pfad A (von 3 Optionen). Strenge Continuity-Guard-Konformität, Market-Activation-konform.

## Warum keine neuen Tabellen

Recon ergab: 80%+ der vorgeschlagenen P70-Komponenten existieren bereits:

| Proposed P70 | Bereits live |
|---|---|
| `background_tasks` | `job_queue`, `system_intents`, `berufs_ki_agent_runs`, `runtime_action_results`, `heal_permanent_fix_tasks` |
| `background_task_steps` | `berufs_ki_agent_orchestrations.step_definitions` |
| `background_task_events` | `auto_heal_log`, `ops_runtime_signals` |
| `background_task_artifacts` | `runtime_action_results`, `runtime_action_evidence`, `standalone_artifact_versions`, `document_agent_exports` |
| `background_task_approvals` | `berufs_ki_agent_runs.{approval_required, approved_at, governance_violations}`, `ops_phantom_council_approvals` |
| `background_task_budgets` | `ai_cost_budgets`, `executive_budget_caps`, `qa_budgets`, `marketing_budget_requests` |
| `background_task_locks` | `job_queue.{locked_at, locked_by, idempotency_key, last_heartbeat_at}` |
| Capability Registry | `runtime_safe_actions` (8) + `berufs_ki_agents.{allowed_tools, allowed_workflows, blocked_actions}` (6) |
| Memory | `berufs_ki_agent_memory` |
| Worker Fleet | 28+ Edge Functions inkl. 6 Orchestratoren |
| Event-Trigger | `system_intents` + `system-intent-worker` — **17.656 Intents/30d live** |

**Telemetrie-Befund:** `berufs_ki_agent_runs` und `berufs_ki_workflow_runs` hatten **0 Läufe/30d** — Schema gebaut, nie genutzt. Echte Background-Arbeit läuft über `job_queue` + `system_intents`. Eine P70-Foundation wäre das **dritte parallele System** geworden (Verstoß gegen NO_PARALLEL_SYSTEMS).

## Was gebaut wurde

### SSOT-View `v_background_agent_runtime`

UNION ALL über 5 Quellen, kanonisches Schema:
`source, source_id, task_kind, status, severity, requires_approval, approved_at, created_at, completed_at, package_id, actor, cost_eur, meta`

- Hochfrequenzquellen (`job_queue`, `system_intents`, `runtime_action_results`): 14-Tage-Fenster
- Niedrigfrequenzquellen (`berufs_ki_agent_runs`, `heal_permanent_fix_tasks`): all-time
- View hart gelockt: `REVOKE FROM PUBLIC,anon,authenticated`, `GRANT TO service_role`

### 3 Admin-RPCs (SECURITY DEFINER + has_role-Gate)

- `admin_get_background_agent_runtime_summary()` — KPI pro Quelle
- `admin_get_background_agent_tasks(_source,_status,_severity,_approval_only,_limit≤500)` — Task-Liste mit Filtern
- `admin_get_background_agent_capabilities()` — Unified-View über `runtime_safe_actions` + `berufs_ki_agents`

### Cockpit `/admin/governance/agents`

- KPI-Strip: Total, Pending, Running, Approval offen, Failed
- 3 Tabs: Quellen-Übersicht | Tasks-Liste | Capability-Registry
- Tasks-Filter: Quelle × Status × Approval-only
- Legacy-Redirect `/admin/agents → /admin/governance/agents`

## Was NICHT gebaut wurde (bewusst)

- Keine neuen Tabellen (`background_tasks` etc.)
- Keine neue Planner-Engine (6 Orchestratoren existieren)
- Kein neuer Worker-Pool (28+ Edge Functions existieren)
- Kein neuer Approval-Schreibpfad (`berufs_ki_agent_runs.approved_by` existiert + `ops_phantom_council_approvals`)
- Keine eigene Capability-Registry (`runtime_safe_actions` + `berufs_ki_agents` existieren)

## Verifizierte Baseline (2026-05-26)

```
v_background_agent_runtime aggregiert:
  job_queue                 = 113.661 rows / 14d
  system_intents            =  10.654 rows / 14d
  heal_permanent_fix_tasks  =     103 rows / all-time
  runtime_action_results    =       1 row  / 14d
  berufs_ki_agent_runs      =       0     ← Schema bereit, ungenutzt
```

## Nächste sinnvolle Schritte (NICHT in v1)

1. **Berufs-KI Agents aktivieren** — 2-3 echte Orchestrationen wiring (SEO-Gap-Agent, Compliance-Drift-Agent), nutzt bestehendes Schema
2. **Approval-Write-Pfad** — RPC `admin_approve_background_task(source, source_id, decision, reason)` mit fn_emit_audit
3. **Realtime-Subscription** — postgres_changes auf 5 Quellen für Live-Cockpit
4. **Cost-Ledger-Aggregation** — Summe `cost_eur` pro Source-Aktor-Zeitfenster

Diese Schritte sind **erst nach Market-Activation-Welle** sinnvoll.

## Market-Activation-Konformität

- ✅ Distribution: Enterprise Sales Asset ("Wir machen Background-Arbeit kontrolliert sichtbar")
- ✅ Packaging: Klare USP-Folie für Governance-Tier
- ✅ Demo-tauglich: `/admin/governance/agents` zeigt 124k aggregierte Tasks in einer Sicht
- ✅ Kein neuer Core: 0 neue Tabellen, 0 neue Queues, 0 neue Worker

## Continuity-Guard-Konformität

| Regel | Status |
|---|---|
| SSOT_FIRST | ✅ Eine View, 5 Quellen, kein Schreibpfad |
| EXTEND_EXISTING | ✅ Nur Bridge auf vorhandene Strukturen |
| NO_PARALLEL_SYSTEMS | ✅ Keine neue Runtime |
| BRIDGE_DONT_FORK | ✅ Klassischer UNION-Bridge |
| GOVERNANCE_BEFORE_AUTOMATION | ✅ Read-only, kein Auto-Action |
| NO_HIDDEN_STATE | ✅ View deterministisch aus 5 Tabellen |
| AUDITABLE_MUTATIONS | n/a (keine Mutationen) |
| FAIL_VISIBLE | ✅ Toasts + KPI-Strip zeigt Failed prominent |
| SECURITY_INHERITS | ✅ has_role-Gate auf allen 3 RPCs, View service_role-only |
| NO_AUTONOMOUS_PRODUCTION_WRITES | ✅ Keine Writes |

## Files

- `supabase/migrations/<ts>_background_agent_runtime_ssot_view_and_rpcs.sql`
- `src/pages/admin/governance/BackgroundAgentRuntimePage.tsx`
- `src/routes/AppRoutes.tsx` (Route + Legacy-Redirect)
