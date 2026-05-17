---
name: E3e.3 Bridge Pilot Selective Activation v1
description: Kontrollierte Überführung pilot_candidate → seo_internal_link_suggestions.status='suggested' mit Approval-Gates, Audit-Kette und Rollback-Fähigkeit
type: feature
---

# E3e.3 — Bridge Pilot Selective Activation

Schließt die Kette E3e.0 → E3e.1 → E3e.2 → **E3e.3** mit einer kontrollierten,
audit-fähigen Promotion von Pilot-Kandidaten in die produktive
`seo_internal_link_suggestions`-SSOT — ohne Silent-Flip auf `active`.

## Komponenten

- **Tabellen**
  - `seo_bridge_activation_runs` — Batch-Metadaten (link_type, batch_label,
    requested_by, requested/activated/skipped_count, dry_run,
    governance_snapshot, correlation_id, rolled_back_at, rollback_reason)
  - `seo_bridge_activations` — pro Kandidat: status ∈ {planned, activated,
    skipped, rolled_back}, suggestion_id FK, skip_reason, rolled_back_at,
    UNIQUE(run_id, pilot_candidate_id)
- **RPCs (admin/service_role)**
  - `admin_seo_bridge_activation_execute(link_type, candidate_ids[], batch_label, dry_run default true)`
  - `admin_seo_bridge_activation_rollback(run_id, reason)` — reason ≥5 chars, nicht für dry-run
  - `admin_get_bridge_activation_snapshot()` — KPI pro Bridge-Typ
- **UI** `SeoBridgeActivationCard` (Heal-Cockpit) — read-only KPI; Aktionen bewusst
  RPC-only (Ops-Skript), kein One-Click damit Batch-Label gewählt wird

## Hard-Caps pro Batch

| link_type             | cap_per_batch | min_sim (governance) |
|-----------------------|---------------|----------------------|
| blog_to_pillar        | 60            | 0.55                 |
| blog_to_exam_package  | 25            | 0.65                 |

User-Vorgabe respektiert: Pillar konservativ 30–60, Exam-Package zuerst 15–25
weil conversion-näher und riskanter.

## Skip-Reasons (deterministisch)

`CANDIDATE_NOT_FOUND`, `LINK_TYPE_MISMATCH`, `URL_MISSING`, `BELOW_MIN_SIM`,
`NOT_READY`, `DUPLICATE_SUGGESTION`, `CAP_EXCEEDED`, `RACE_DUPLICATE`.

Cap-Reihenfolge: skip_reason-Check → ROW_NUMBER über eligible (sim DESC) → CAP.
Live-Commit: `INSERT … ON CONFLICT (source_url, target_url, link_type) DO NOTHING`
→ alles was nicht zurückkommt wird `RACE_DUPLICATE` (Idempotenz-Schutz).

## Status-Contract

- **Activation** schreibt `seo_internal_link_suggestions.status = 'suggested'`
  (NIE `active`). Wechsel auf `active` ist explizit zweiter human gate.
- **Rollback** setzt Suggestions auf `status = 'rejected'` + reason-Tag,
  Activations auf `status = 'rolled_back'`. Idempotent per Run.

## Audit (registriert in ops_audit_contract)

- `seo_bridge_activation_proposed` — jeder Lauf (dry oder live)
- `seo_bridge_activation_committed` — nur live
- `seo_bridge_activation_rolled_back` — nur explizite Rollbacks

## NICHT enthalten (Scope-Disziplin)

- Kein Cron — Aktivierung manuell via RPC
- Kein UI-Button mit Candidate-Picker (bewusst — verhindert versehentliche Mass-Activation)
- Keine Promotion auf `active` (Phase E3e.4 misst erst Outcome)

## Nächste Cuts

- **E3e.4** Empirical outcome measurement (CTR, assisted_conversion, crawl-depth, ranking-lift)
- **E3e.5** Adaptive bridge weighting + perf-Cornerstone-Score reaktiviert
  `pillar_to_cornerstone_blog`
