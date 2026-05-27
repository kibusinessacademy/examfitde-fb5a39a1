---
name: BerufAgentOS v2 Cut 2.2 — Persistent Intelligence Memory
description: SSOT project_intelligence_memory (9 kinds × 3 status) + 4 Admin-RPCs + 3 Audit-Contracts + /admin/berufs-ki/intelligence-memory UI. Lernschicht, keine Autonomie.
type: feature
---
# BerufAgentOS v2 — Cut 2.2: Persistent Intelligence Memory

## Zweck
Dauerhafte Lernschicht über alle Outcome-Runs, Business-Intents und Verticals. Bewahrt institutionelles Wissen über Sessions und Releases hinweg — Fundament für Continuous Intelligence (2.3) und Fix-Loops (2.4).

## SSOT
- `project_intelligence_memory` (memory_key UNIQUE, kind enum, vertical_key, title, summary, payload jsonb, confidence 0..1, status enum, source_run_id, business_intent_id, bundle_id, tags TEXT[], recorded_by, retired_at, retired_reason, superseded_by self-FK)
- Enums:
  - `intelligence_memory_kind` (9): successful_pattern, quality_issue, risk_incident, conversion_learning, ux_learning, seo_learning, workflow_failure, security_pattern, architecture_decision
  - `intelligence_memory_status` (3): active, retired, superseded
- Indizes: kind, vertical_key, status, business_intent_id, bundle_id, tags (GIN)

## RPCs (SECURITY DEFINER + has_role admin)
- `admin_record_intelligence_memory(...)` — upsert by memory_key; title ≥4 / summary ≥8 Zeichen; emit `intelligence_memory_recorded`
- `admin_list_intelligence_memory(_kind, _vertical_key, _status, _business_intent_id, _limit)` — JOIN business_intents.title als intent_title
- `admin_retire_intelligence_memory(_memory_id, _reason)` — reason ≥5 Zeichen; emit `intelligence_memory_retired`
- `admin_classify_intelligence_memory(_memory_id, _new_status, _superseded_by)` — emit `intelligence_memory_classified`

## Audit Contracts (ops_audit_contract, owner_module='berufs-ki')
- `intelligence_memory_recorded` — required: memory_id, memory_key, kind, actor_id
- `intelligence_memory_retired` — required: memory_id, memory_key, actor_id, reason
- `intelligence_memory_classified` — required: memory_id, memory_key, actor_id, new_status

## UI
- `/admin/berufs-ki/intelligence-memory` (`IntelligenceMemoryPage.tsx`)
  - Liste mit kind+status Filter, Empty/Loading/Error States
  - Dialog: memory_key, kind, vertical, title, summary, confidence, business_intent_id (Dropdown), tags
  - Archivieren via Prompt (reason ≥5)
- Client-Lib `src/lib/berufs-ki/outcome.ts`: `listIntelligenceMemory` / `recordIntelligenceMemory` / `retireIntelligenceMemory` / `classifyIntelligenceMemory`

## Verknüpfung
- FK `business_intent_id` → `business_intents.id` (SET NULL) — bindet Learning an "Warum existiert dieses Projekt?"
- FK `source_run_id` + `bundle_id` → `agent_outcome_bundles.id` (SET NULL) — bindet Learning an konkreten Run
- self-FK `superseded_by` → für Wissens-Versionierung

## Architekturkonformität
- Bridge-don't-fork: nutzt bestehende `business_intents` + `agent_outcome_bundles`
- Auditable: alle Mutations via `fn_emit_audit`
- Security-Inherits: RLS admin-only SELECT, RPCs admin-gated, anon revoked
- No autonomous writes: ausschließlich HITL — keine Auto-Generation in 2.2
- No fix-loops: reine Lese-/Schreibschicht, keine Aktion auf Memory-Inhalt

## NICHT in 2.2
- Auto-Generation aus Runs (folgt in 2.3 read-only signals, 2.4 fix-loop)
- Embedding/Semantic-Search
- Cross-Project Memory
- Recommendation-Engine

## Nächster Cut
2.3 — Continuous Outcome Intelligence (read-only Views v_bundle_outcome_impact, v_vertical_health_signals, v_intent_kpi_progression + Mission-Control-Page)
