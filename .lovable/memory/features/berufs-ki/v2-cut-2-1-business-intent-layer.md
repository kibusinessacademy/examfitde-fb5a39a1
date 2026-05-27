---
name: BerufAgentOS v2 Cut 2.1 — Business Intent Layer
description: SSOT business_intents + Bridge agent_outcome_bundles.business_intent_id + 3 Admin-RPCs + 3 Audit-Contracts + /admin/berufs-ki/business-intents UI
type: feature
---
# BerufAgentOS v2 — Cut 2.1: Business Intent Layer

## SSOT
- `business_intents` (intent_key UNIQUE, vertical_key, title, goal, target_kpi_json, monetary_impact_eur, risk_level enum, governance_level enum, no_go_constraints jsonb, target_audience, desired_transformation, owner_actor_id, is_active)
- Bridge: `agent_outcome_bundles.business_intent_id` FK SET NULL
- Enums: `business_intent_risk_level` (low/medium/high/critical), `business_intent_governance_level` (standard/sensitive/regulated/board_approval)

## RPCs (SECURITY DEFINER + has_role admin)
- `admin_register_business_intent(...)` — upsert by intent_key; goal min 8 chars; emit `business_intent_registered`/`business_intent_updated`
- `admin_list_business_intents(_vertical_key, _active_only, _limit)` — joins linked_bundle_count + last_bundle_at
- `admin_link_bundle_to_intent(_bundle_id, _intent_id)` — emit `bundle_linked_to_intent`

## Audit Contracts
- `business_intent_registered` (intent_id, intent_key, vertical_key, actor_id)
- `business_intent_updated` (intent_id, intent_key, actor_id, changed_fields)
- `bundle_linked_to_intent` (bundle_id, intent_id, intent_key, actor_id)

## UI
- `/admin/berufs-ki/business-intents` (`BusinessIntentsPage.tsx`) — List + Dialog-Editor + Empty/Loading/Error-States, Risk/Governance-Badges, linked-bundle counter
- Client-Lib: `src/lib/berufs-ki/outcome.ts` — `listBusinessIntents` / `registerBusinessIntent` / `linkBundleToIntent`

## Architekturkonformität
- Bridge-don't-fork: keine Parallel-Tabelle, nur FK auf existierende `agent_outcome_bundles`
- Auditable: alle Mutations via `fn_emit_audit` mit registriertem Contract
- Security-Inherits: RLS admin-only read, RPCs admin-gated, anon revoked
- No autonomous writes: nur HITL via UI/RPC

## Nächster Cut
2.2 — Persistent Intelligence Memory (project_intelligence_memory mit 8 kind-Enum + retired-state)
