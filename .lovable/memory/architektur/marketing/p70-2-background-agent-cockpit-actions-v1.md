---
name: P70.2 Background Agent Cockpit Actions
description: Capability-/status-gated Cockpit-Actions ausschließlich über bestehende Dispatcher (admin_retry_failed_step, cancel_jobs_for_package, admin_bronze_manual_approve_for_publish, admin_nudge_atomic_trigger). Single RPC choke point + Audit. Keine neuen Tabellen.
type: feature
---

# P70.2 — Background Agent Cockpit Actions

**Continuity-Guard**: SSOT_FIRST · EXTEND_EXISTING · NO_PARALLEL_SYSTEMS · BRIDGE_DONT_FORK · GOVERNANCE_BEFORE_AUTOMATION · AUDITABLE_MUTATIONS · NO_AUTONOMOUS_PRODUCTION_WRITES — alle erfüllt.

## Was gebaut wurde
- **Single Choke Point**: `admin_background_agent_dispatch_action(source_type, source_id, action, reason)` — SECURITY DEFINER, has_role(admin)-gated, routet ausschließlich in bestehende RPCs.
- **Client-Resolver**: `src/lib/governance/backgroundAgentActions.ts` — pure Funktion `resolveBackgroundAgentActions(task)` → kapselt Visibility/Enabled/Dangerous/ApprovalRequired pro Row. Reine Funktion, keine Side-Effects.
- **Cockpit-Integration**: `BackgroundAgentRuntimePage.tsx` rendert Action-Buttons + AlertDialog-Confirm für Dispatches. Navigation öffnet `/admin/packages/<id>` (kein Direct-Table-Read).
- **Audit-Contract**: `background_agent_action_dispatched` registriert in `ops_audit_contract` mit required_keys `[source_type, source_id, action, route, outcome]`. Jeder Pfad (denied/ok) schreibt via `fn_emit_audit`.

## Action-Matrix (capability-/status-gated)
| Source | open_source | open_artifacts | open_approval | retry | cancel | approve | nudge |
|---|---|---|---|---|---|---|---|
| job_queue | always | if artifacts | if pending | failed/cancelled/blocked | active states (dangerous) | — | blocked only |
| system_intents | always | — | if pending | — | — | — | — |
| berufs_ki_agent_runs | always | if artifacts | if pending | — | — | if pending+package_id (dangerous) | — |
| runtime_action_results | always | if artifacts | — | — | — | — | — |
| heal_permanent_fix_tasks | always | — | — | — | — | — | — |

## Invarianten (CI-getestet)
1. Client ruft **nur** `admin_background_agent_dispatch_action` für Mutationen.
2. Client liest **keine** der 5 Source-Tabellen direkt (`supabase.from(...)`-Guard).
3. SQL-Dispatcher routet **nur** in existierende Dispatcher.
4. Keine neuen Tabellen, kein neuer Queue, kein paralleler Planner.
5. `has_role(admin)`-Gate verpflichtend.
6. `fn_emit_audit` auf jedem Pfad (denied + ok).
7. Dangerous Actions: `dangerous=true` + AlertDialog-Confirm im Cockpit.
8. Approval-pflichtige Actions: `approvalRequired=true`, retry pausiert bei `approval_state=pending`.

## Tests
`src/test/contracts/background-agent-actions-contract.test.ts` — 18 Tests, alle grün:
- Action visibility (open_source/artifacts/approval/retry/cancel/approve/nudge)
- Status-Gating (retry nur failed/cancelled/blocked, cancel nur active)
- Risk-Flagging (high → dangerous)
- Source-Scoping (system_intents/runtime_action_results/heal_permanent_fix_tasks → navigation-only)
- Approval-Gating (retry disabled wenn pending; berufs_ki_agent_runs approve nur mit package_id)
- SQL: admin-gate, audit on every branch, no new tables, only existing dispatchers
- Cockpit: AlertDialog-Confirm-Pfad

Kombiniert mit P70.1-Tests: **27/27 grün**.

## Nächster Cut
**P70.3 — First Real Agent Workflows sichtbar machen.**
Kunden-Sprache strikt entkoppeln von interner Runtime-Sprache:
- *SEO Gap Agent* → customer-facing ("Sichtbarkeit überwacht und optimiert")
- *Compliance Drift Agent* → customer-facing ("Rechtskonformität laufend geprüft")
- *Curriculum Repair Runtime* → **intern**, customer-facing als "Continuous Exam Quality Intelligence" / "Automatische Prüfungsqualitäts-Optimierung"
