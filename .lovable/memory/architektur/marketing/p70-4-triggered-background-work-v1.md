---
name: P70.4 Triggered Background Work
description: Workflow-Start-Trigger via existing dispatcher choke point. source_type='workflow' + action='trigger' routes to fn_detect_seo_discovery_drift / run_azav_compliance_check / admin_repair_quality_council_drift. Admin-gated, capability kill-switch, audited via background_agent_action_dispatched. Keine neuen Tabellen.
type: feature
---

# P70.4 — Triggered Background Work

**Continuity-Guard**: SSOT_FIRST · EXTEND_EXISTING · NO_PARALLEL_SYSTEMS · BRIDGE_DONT_FORK · GOVERNANCE_BEFORE_AUTOMATION · AUDITABLE_MUTATIONS · NO_AUTONOMOUS_PRODUCTION_WRITES — alle erfüllt.

## Was gebaut wurde
- **Dispatcher-Erweiterung** `admin_background_agent_dispatch_action`:
  - Source-Whitelist um `'workflow'` erweitert, Action-Whitelist um `'trigger'`.
  - `source_type='workflow'` + `action='trigger'` + `source_id ∈ {seo_opportunity, compliance_drift, operational_quality}`.
  - Routet ausschließlich in bestehende RPCs:
    - `seo_opportunity` → `fn_detect_seo_discovery_drift()`
    - `compliance_drift` → `run_azav_compliance_check()`
    - `operational_quality` → `admin_repair_quality_council_drift(false, 50)`
  - Bestehende Pfade (job_queue retry/cancel/nudge, berufs_ki_agent_runs approve) unverändert.
- **Resolver/Wrapper** `src/lib/governance/backgroundAgentWorkflowTriggers.ts`:
  - `WORKFLOW_TRIGGER_REGISTRY` mit kundennaher Sprache (Curriculum-Repair/Council nie external).
  - `resolveWorkflowTrigger(type, { isAdmin, capabilities })` — pure Funktion, allow-by-default, Kill-Switch via Capability-Registry-Key (`workflow.*`).
  - `dispatchWorkflowTrigger(type, reason)` — Single RPC Aufruf.
- **Cockpit-Integration** in `BackgroundAgentRuntimePage.tsx`:
  - Workflows-Tab rendert jetzt alle 3 Outcome-Cards registry-getrieben (auch ohne Tasks).
  - Pro Card Start-Button (Play-Icon) mit AlertDialog-Confirm.
  - `operational_quality` als `destructive`-Variant + dangerous-Confirm-Pfad.
  - `data-workflow-trigger` Attribut für E2E-Tests.

## Akzeptanzkriterien (CI-gehärtet)
1. ✅ Start-Buttons nur admin-/capability-gated (`isAdmin` + Capability-Kill-Switch).
2. ✅ Jede Start-Aktion läuft über `admin_background_agent_dispatch_action`.
3. ✅ Jedes Starten erzeugt Audit `background_agent_action_dispatched` (denied + ok Branches).
4. ✅ Keine Curriculum-Repair-/Council-Sprache in customer-visible Labels.
5. ✅ Tests für Trigger-Visibility, Dispatch-Payload, Audit-Contract, Disabled-States.

## Invarianten
- Single Choke Point bleibt `admin_background_agent_dispatch_action` (gleiche Signatur, gleiche Audit-Schreibstelle).
- Kein neuer Migration-/Code-Pfad für Workflow-Triggers außerhalb der existierenden 3 RPCs.
- Resolver ist pure (kein `supabase.from` / `supabase.rpc` im Resolver-Body).
- Audit-Contract `background_agent_action_dispatched` (P70.2) wird ohne Schema-Bump wiederverwendet — `route` enthält den Ziel-RPC-Namen.

## Tests
`src/test/contracts/background-agent-workflow-triggers-contract.test.ts` — 16 grüne Tests:
- Registry-Shape + Curriculum-Repair-/Council-Sprachverbot
- Resolver: non-admin → hidden+disabled, admin → enabled, kill-switch → visible+disabled
- Resolver-Purity (kein RPC/from im Funktionsbody)
- Dispatch-Wrapper Payload-Form
- SQL: Workflow-Whitelist, `trigger`-Action, Routing auf existierende 3 RPCs, admin-gate, Audit beidseitig
- Cockpit: Imports, Start-Button-Rendering pro Type, Confirm-Dialog-Pfad

Kombiniert mit P70.1+P70.2+P70.3+P70.4: **67/67 grün**.

## Nächster sinnvoller Cut (NICHT in P70.4)
**P70.5 — Scheduled Background Work via existing pg_cron + system_intents**:
- Sichtbar machen welcher Workflow durch welchen Cron-Job/Intent regelmäßig getriggert wird (read-only Aggregation aus `cron.job` + `system_intents`).
- Erst sinnvoll wenn das Cockpit live mit echten Trigger-Läufen demo-tauglich aussieht.

## Files
- Migration: `20260526124500_<hash>_*_p70_4_workflow_triggers.sql` (CREATE OR REPLACE dispatcher)
- `src/lib/governance/backgroundAgentWorkflowTriggers.ts` (neu)
- `src/pages/admin/governance/BackgroundAgentRuntimePage.tsx` (Workflows-Tab + 2. AlertDialog)
- `src/test/contracts/background-agent-workflow-triggers-contract.test.ts` (neu, 16 Tests)
