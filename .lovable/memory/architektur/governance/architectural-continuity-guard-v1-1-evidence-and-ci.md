---
name: Architectural Continuity Guard v1.1
description: Evidence-Layer + CI-Static-Guard + Proposal-Inventar + Admin-UI-Upgrade auf v1
type: feature
---

# Architectural Continuity Guard v1.1

Erweitert v1 um drei Schichten:

## 1. Evidence-Layer (RuleFinding)
Jedes Finding trägt jetzt:
- `evidence` (begründet auf Proposal-Feldern)
- `matched_known_systems[]` (welche SSOT triggert)
- `recommended_reuse_path` (1-Satz-Pfad)
- `required_bridge_target` (Brückenziel)
- `migration_strategy[]` (konkrete Schritte)

## 2. Proposal-Inventar
ArchitectureProposal hat jetzt zusätzlich:
- `proposed_tables[]`, `proposed_jobs[]`, `proposed_events[]`
- `proposed_audit_actions[]`, `proposed_routes[]`, `proposed_edge_functions[]`

Trigger-Regeln:
- proposed_audit_actions / `kind=audit_log` / Tabellen mit `audit|guard|event_log` → Block + Bridge auf `auto_heal_log` + `ops_audit_contract`.
- proposed_jobs / `kind=queue` / Tabellen mit `queue|outbox|jobs` → Block + Bridge auf `job_queue` (oder `email_delivery_queue` wenn email-tagged) + `ops_job_type_registry`.
- proposed_events / Tabellen mit `conversion|funnel|tracking|events` → Block + Bridge auf `conversion_events`.
- View/RPC mit ≥2 touches gilt als Bridge-Intent (kein EXTEND_EXISTING-Block).

## 3. CI Static Guard
`scripts/guards/architecture-continuity-guard.mjs`:
- Bundle der TS-SSOT via esbuild-on-the-fly (kein Node-TS-Loader-Edge-Case, keine zweite JS-Kopie).
- `--dir <dir>` oder `<file.json …>`.
- Exit 1 bei `verdict=blocked` ODER hard finding ohne `recommended_reuse_path`/`required_bridge_target`.
- npm script: `guard:architecture` läuft default gegen `docs/examples/architecture-proposals/`.
- Beispiele: `email-outbox-blocked.json`, `new-audit-table-blocked.json`, `activation-bridge-approved.json`.

## 4. Admin UI Upgrade (`/admin/governance/architecture`)
- Proposal-Inventar als ausklappbares `<details>` (proposed_tables/jobs/events/...).
- Findings gruppiert: Blocked / Review Required / Info.
- Pro Finding: Evidence-Zeile, matched_known_systems-Badges, Reuse-Path mit CopyButton, Bridge-Target-Tag, per-Finding Migration-Strategie.
- Kopfzeile: CopyButton "Strategy" (recommended implementation strategy als Markdown).
- "Proposal als JSON" CopyButton speist die CI-Guard-Pipeline.

## Leitplanken (eingehalten)
- Kein neues Package-System, keine zweite Governance-Tabelle.
- Kein DB-Write, kein Supabase-Import im Review-Core (vitest-Test prüft Source).
- Deterministisches Ergebnis (vitest-Test prüft Idempotenz).
- UI bleibt rein review-basiert; v1-Struktur erhalten.

## Tests
`src/lib/governance/__tests__/architecture-review.test.ts` — 7 Tests:
- doppelte Queue blockiert + bridge=email_delivery_queue
- neue Audit-Tabelle blockiert + bridge=auto_heal_log + matched ops_audit_contract
- parallele Funnel-Event-Tabelle blockiert + bridge=conversion_events
- Bridge-View zwischen 2 SSOTs nicht blockiert
- jedes hard finding hat evidence
- Determinismus
- keine Supabase-Imports im Core

## v2 (geplant, NICHT in v1.1)
Persistente `architecture_review_run`-Einträge via bestehendes Audit-System (`fn_emit_audit` + neuer registrierter `action_type=architecture_review_recorded`). Keine eigene Tabelle.
