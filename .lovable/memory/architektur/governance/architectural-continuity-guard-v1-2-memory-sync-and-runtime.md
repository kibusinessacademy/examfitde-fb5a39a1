---
name: Architectural Continuity Guard v1.2
description: Memory-Sync-Guard + Runtime-Proposal-Adapter + Runtime-Preflight-Tab — kein DB-Write, keine zweite Registry.
type: feature
---

# Architectural Continuity Guard v1.2

Erweitert v1.1 um drei Schichten:

## 1. Memory ↔ Registry Sync
- `src/lib/governance/memory-sync.ts` (pure): `extractMemoryReferences` + `syncMemoryAgainstRegistry`.
- Heuristik: snake_case-Tokens auf Memory-Zeilen mit Keywords (ssot|queue|audit|event|gateway|worker|cron|registry|ledger|artifact) + Tokens in Backticks. Filter auf System-Suffixe (`_events|_queue|_log|_registry|_contract|_ledger|_grants|...`) oder DB-Präfixe (`v_|fn_|admin_|ops_|trg_|cron_`).
- Vergleich gegen `KNOWN_SYSTEMS` Namen + Hints-Corpus + Allowlist.
- Script: `scripts/guards/known-systems-memory-sync.mjs` (esbuild-bundle wie v1.1, exit 1 bei missing).
- Allowlist: `scripts/guards/known-systems-memory-sync.allowlist.json` — seeded mit 415 Sub-SSOT-Helpern (Views/Trigger/lokale RPCs). Nur registrieren, was echte plattformweite SSOT ist.
- Baseline 2026-05-23: 12 covered / 415 allowed / 0 missing.

## 2. Runtime Proposal Adapter
- `src/lib/governance/runtime-proposal-adapter.ts` (pure): `runtimePlanToProposal(plan)` mappt Runtime-/Safe-Action-/Scaffold-Plan auf `ArchitectureProposal`.
- Kein Supabase-Import. Keine Mutation. Deterministisch (Listen sortiert).
- Heuristik für `kind`: explizit > planned_jobs(queue) > planned_audit_actions(audit_log) > planned_events(table) > planned_edge_functions > planned_tables > rpc.

## 3. Admin UI: Runtime Preflight Tab
- `/admin/governance/architecture` jetzt `<Tabs>` mit `Proposal Review` + `Runtime Preflight`.
- Eingaben: action_type, target_type, target_name, planned_tables/jobs/events/audit_actions, tags, touches, governance-toggles.
- Ausgabe: identische `ReviewResult`-Komponente (verdict, reuse, bridge, evidence, migration_strategy, copy-button).

## 4. CI Scripts
- `npm run guard:architecture` — v1.1 Static Guard (gegen JSON-Proposals).
- `npm run guard:architecture:examples` — v1.1 Examples (non-blocking | true).
- `npm run guard:known-systems-sync` — neuer Sync gegen Memory.

## 5. Tests
- `architecture-review.test.ts` — 7 Tests (v1.1, weiterhin grün).
- `runtime-proposal-adapter.test.ts` — 4 Tests: Reine Funktion, neue Queue blockiert, Bridge-View nicht geblockt, kein Supabase-Import.
- `memory-sync.test.ts` — 5 Tests: Extraktion, bekannte Refs covered, fehlende Refs missing, Allowlist verschiebt, Determinismus.
- Total 16/16 grün.

## Leitplanken (eingehalten)
- Review-Core bleibt pure (kein Supabase-Import, vitest prüft Source).
- Keine DB-Writes, keine neue Governance-Tabelle.
- `known-systems.ts` bleibt Registry-SSOT — Memory ergänzt nur, ersetzt nicht.
- Allowlist ist Waiver, nicht zweite Registry.
- UI bleibt Preflight, kein Execution-Pfad.
- Adapter ist pure function, mappt nur, mutiert nichts.

## v2 (geplant, NICHT in v1.2)
Persistente `architecture_review_run`-Einträge via bestehendes `fn_emit_audit` + neuer registrierter `action_type=architecture_review_recorded`. Keine eigene Tabelle.
