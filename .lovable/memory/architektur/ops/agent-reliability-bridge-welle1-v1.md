---
name: Agent Reliability Bridge Welle 1
description: safeTool ToolResult envelope + trajectory in berufs_ki_agent_runs (BRIDGE_DONT_FORK), failure-cluster view, audit contracts
type: feature
---

# Welle 1 — Agent Reliability Bridge (2026-05-30)

## Ziel
Silent Failures, Endlosschleifen und nicht-reproduzierbare Agentenfehler eliminieren — ohne neue Parallel-Tabelle.

## SSOT-Bridge (NO_PARALLEL_SYSTEMS)
- **Trajectory** → `berufs_ki_agent_runs.tool_calls jsonb` (NICHT neue `agent_tool_calls` Tabelle)
- **Taxonomie** → `berufs_ki_agent_runs.error_category` + `error_code` + `error_retryable`
- **Diagnose** → `v_agent_failure_clusters` (service_role only) + `admin_get_agent_failure_clusters(_min_count_24h)` RPC (has_role-gated)

## ToolResult<T> Contract
```ts
type ToolResult<T> =
  | { ok: true; data: T; meta: ToolCallMeta }
  | { ok: false; error_code; error_category; error_message; retryable; meta };
```

### Error-Taxonomie (defaultClassifyError)
| error_code | error_category | retryable |
|---|---|---|
| RATE_LIMITED | llm_error | true |
| TIMEOUT | tool_error | true |
| CONTEXT_OVERFLOW | context_overflow | false |
| FORBIDDEN | governance_block | false |
| INVALID_OUTPUT | tool_error | false |
| NETWORK_ERROR | tool_error | true |
| SILENT_EMPTY | silent_empty | false |
| UNKNOWN_ERROR | unknown | false |

## Audit-Contracts (ops_audit_contract)
- `agent_tool_call_completed` — required: `agent_run_id, tool, ok, duration_ms`
- `agent_run_classified` — required: `agent_run_id, error_category`

## Files
- `supabase/functions/_shared/agent-runtime/safe-tool.ts` — wrapper + classifier
- `scripts/guards/agent-reliability-guard.mjs` — contract-drift guard (8 symbols + 7 codes)
- Migration 20260530: tool_calls/error_category/error_code/error_retryable + view + RPC + contracts

## Anti-Drift
- **Verboten:** neue Tabelle `agent_tool_calls` (Guard blockt)
- **Verboten:** `tool_calls` schreiben ohne safeTool() (Trajectory-Drift)
- **Verboten:** View direkt an authenticated granten (siehe SQL Pitfalls)

## Folgewellen (separat)
- Welle 2: Memory-Consolidation (ALTER `berufs_ki_agent_memory` + `v_organizational_memory_unified`)
- Welle 3: Memory→KG Trigger (high-confidence learnings → `knowledge_graph_nodes`)
