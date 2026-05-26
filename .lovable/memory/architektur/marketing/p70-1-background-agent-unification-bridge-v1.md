---
name: P70.1 Background Agent Runtime Unification Bridge
description: Canonical SSOT view + admin RPCs aggregating 5 existing background sources, no new tables, contract-tested
type: feature
---
# P70.1 — Background Agent Unification Bridge (Pfad A)

**Continuity-Guard**: SSOT_FIRST, EXTEND_EXISTING, NO_PARALLEL_SYSTEMS, BRIDGE_DONT_FORK alle erfüllt. Keine neuen Tabellen, keine zweite Runtime, kein neuer Planner.

## SSOT
- View `public.v_background_agent_runtime` (DROP+CREATE, read-only auf service_role).
- UNION ALL über 5 bestehende Quellen: `job_queue`, `system_intents`, `berufs_ki_agent_runs`, `runtime_action_results`, `heal_permanent_fix_tasks`.
- 14-Tage-Fenster auf Hot-Tables (`job_queue`, `system_intents`, `runtime_action_results`); volle Historie für agent_runs + permanent_fix_tasks (low-volume).

## Kanonische Spalten (Akzeptanz #4)
`source_type` · `source_id` · `task_kind` · `status` (pending|running|awaiting_approval|completed|failed|rejected) · `risk_level` (low|medium|high) · `capability_summary` · `approval_state` (not_required|pending|approved|rejected) · `cost_eur` · `budget_eur` · `artifact_count` · `last_event_at` · `created_at` · `package_id` · `actor` · `meta`.

## Source-Dedupe (Akzeptanz #7)
`system_intents.id` ↔ `job_queue.correlation_id` → Intents, die bereits einen Job erzeugt haben, werden NICHT doppelt gelistet.

## Admin-RPCs (has_role-gated, Akzeptanz #2)
- `admin_get_background_agent_runtime_summary()` → KPIs pro Source inkl. `high_risk` Count.
- `admin_get_background_agent_tasks(_source_type,_status,_risk_level,_approval_only,_limit)` → gefilterte Task-Liste (max 500).
- `admin_get_background_agent_capabilities()` → Read-only Sicht auf `runtime_safe_actions` + `berufs_ki_agents` (Capability-Gate).

## Cockpit
`/admin/governance/background-agent-runtime` → 3 Tabs (Quellen-KPIs · Arbeitseinheiten · Capability-Registry). Rendert Work-Units, nicht Roh-Jobs. **Keine Direct-Table-Reads im Client** (Akzeptanz #5).

## Contract-Tests
`src/test/contracts/background-agent-runtime-contract.test.ts` — 9 statische Garantien gegen Drift:
1. Pflichtspalten der View
2. nur 5 erlaubte Quellen + keine neuen Background-Tabellen
3. View read-only auf service_role
4. 3 RPCs has_role(admin)-gated
5. system_intents Dedupe via correlation_id
6. Status-Mapping kanonisch
7. Kein neuer Queue/Planner/FSM
8. Cockpit nur via RPCs
9. Empty-State + Work-Unit-Sprache (Arbeitseinheit/Risiko/Approval/Artefakte)

## Migrationen
- `20260526112253_*.sql` — initiale Bridge (severity-Form, prä-canonical).
- `20260526113xxx_*.sql` — Canonical-Shape DROP+CREATE.

## Nächster Cut
**P70.2 — First Agent Cockpit Actions**: Approval öffnen, Artifact ansehen, Source öffnen, Retry — alles ausschließlich über bestehende Systeme (`runtime-safe-action-dispatcher`, `berufs-ki-agent-runner`, `admin_nudge_atomic_trigger`). Keine neue Action-Pipeline.
