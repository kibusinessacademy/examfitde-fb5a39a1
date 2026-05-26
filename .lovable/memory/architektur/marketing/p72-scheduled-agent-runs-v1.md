---
name: P72 Scheduled Agent Runs
description: Read-only SSOT-Bridge `admin_get_background_agent_schedules` aggregiert cron.job + cron.job_run_details + system_intents zu den 3 customer-facing Workflows. Scheduled-Runs-Tab im Background Agent Cockpit mit Run-now via P70.2-Chokepoint, Enable/Disable bewusst disabled (kein Cron-Mutations-Dispatcher vorhanden), Evidence Chain (schedule→trigger→task→artifact→audit), Empty-State, P71 Artifact Preview Re-Use. Keine neuen Tabellen/Queues/Cron-Primitiven.
type: feature
---

# P72 — Scheduled Agent Runs

**Continuity-Guard**: SSOT_FIRST · EXTEND_EXISTING · NO_PARALLEL_SYSTEMS · NO_HIDDEN_STATE · GOVERNANCE_BEFORE_AUTOMATION · NO_AUTONOMOUS_PRODUCTION_WRITES — alle erfüllt.

## Was gebaut wurde
- **Admin RPC** `public.admin_get_background_agent_schedules()` — SECURITY DEFINER, has_role(admin)-gated. Mappt cron.job per jobname-Regex auf 3 Workflows, joint cron.job_run_details (7-Tage-Fenster) für last_run + last_status, aggregiert system_intents 24h. Keine Mutation, kein neuer Scheduler.
- **Pure Resolver** `src/lib/governance/backgroundAgentSchedules.ts`
  - `buildScheduleCards(rows, tasks)` → genau 3 Cards (auch leer)
  - Aggregiert active/last_run/last_status/intent_24h/risk_level/latest_artifact/latest_task
  - Evidence Chain: 5 feste Steps (schedule · trigger · task · artifact · audit)
  - `canToggleSchedule()` → bewusst `{enabled:false, reason}` weil kein Cron-Toggle-Dispatcher existiert (dokumentierte Capability-Lücke)
- **Cockpit-Tab** „Scheduled Runs" in `BackgroundAgentRuntimePage.tsx`
  - 3 Cards mit Status-Badges, KPIs, Schedule-Liste, Risk, Evidence Chain
  - „Jetzt ausführen" → `dispatchWorkflowTrigger` (P70.2-Chokepoint, workflow|trigger)
  - „Aktivieren/Deaktivieren" disabled mit Tooltip-Reason
  - „Letztes Artefakt" öffnet P71 `ArtifactPreviewDrawer`
  - Empty-State: „Noch kein automatischer Lauf geplant."

## Invarianten (CI-getestet, 17 Tests)
1. Resolver pure (kein supabase.from/rpc/fetch/Date.now/Math.random)
2. Migration mit `admin_get_background_agent_schedules` erstellt KEINE neuen Tabellen, KEINE cron.schedule()/unschedule()-Mutation, hat admin-Gate
3. Cockpit liest ausschließlich via Admin-RPC (kein `cron.*`-Direct-Read, kein system_intents-Direct-Read)
4. Run-now-Pfad nutzt `dispatchWorkflowTrigger` / `admin_background_agent_dispatch_action`
5. Customer-Labels nie „curriculum repair" / „council"
6. Evidence-Chain genau 5 geordnete Steps
7. Empty-State + active=false + lastRunAt=null wenn keine Cron-Zeile

Kombiniert P70.1+P70.2+P70.3+P70.4+P71+P72: **109/109 grün**.

## Files
- `src/lib/governance/backgroundAgentSchedules.ts` (neu)
- `src/test/contracts/background-agent-schedules-contract.test.ts` (neu, 17 Tests)
- `src/pages/admin/governance/BackgroundAgentRuntimePage.tsx` (Tab + Tab-Content + loadAll)
- Migration `20260526133652_*` — `admin_get_background_agent_schedules`

## Bewusst NICHT gebaut
- Kein Cron-Mutations-Dispatcher (Enable/Disable). UI dokumentiert die Lücke statt sie zu verbergen.
- Kein Next-Run-Forecast (Cron-Parser in PG zu komplex; aktueller Wert: schedule-Expression sichtbar).
- Keine eigene Schedules-Tabelle (SSOT bleibt cron.job).

## Nächster Cut
**P73 — kein automatischer Cut.** Vorschlag: Distribution/Activation-Asset auf Basis P70–P72 (Vertriebs-Demo des Cockpits), nicht weitere Plattform-Tiefe.
