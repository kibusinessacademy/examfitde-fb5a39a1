---
name: E3e.4 Bridge Promotion Human Gate v1
description: Kontrollierter 2nd-gate suggested→active für Bridge-Edges. Batch-capped, Pilot-Herkunft + Bronze + Duplicate Re-Check, Dry-Run default, Rollback active→suggested.
type: feature
---

# E3e.4 — Human Gate & Controlled Active Promotion

Zweiter human gate nach E3e.3. Hebt geprüfte Bridge-Suggestions in
`seo_internal_link_suggestions` von `status='suggested'` auf
`status='active'` — kein Silent-Flip, kein Auto-Cron.

## Komponenten

- **Tabellen**
  - `seo_bridge_promotion_runs` — Batch-Metadaten (link_type, batch_label,
    requested_by, requested/promoted/skipped_count, dry_run,
    governance_snapshot, correlation_id, rolled_back_at, rollback_reason)
  - `seo_bridge_promotions` — pro Suggestion: status ∈ {planned, promoted,
    skipped, rolled_back}, suggestion_id, skip_reason, rolled_back_at,
    UNIQUE(run_id, suggestion_id)
- **RPCs (admin/service_role)**
  - `admin_get_bridge_promotion_snapshot()` — KPI per Bridge-Typ
  - `admin_get_bridge_promotion_preview(link_type, suggestion_ids[])` —
    READY/SKIP decision pro Kandidat ohne Write
  - `admin_seo_bridge_promotion_execute(link_type, suggestion_ids[], batch_label, dry_run default true)`
  - `admin_seo_bridge_promotion_rollback(run_id, reason)` — reason ≥5 chars,
    nicht für dry-run, idempotent
- **UI** `SeoBridgePromotionCard` (Heal-Cockpit Erweitert) — read-only KPI;
  Aktionen RPC-only damit Batch-Label + ID-Liste bewusst gesetzt werden

## Hard-Caps pro Batch

| link_type             | cap_per_batch | Empfehlung Wave 1 |
|-----------------------|---------------|--------------------|
| blog_to_pillar        | 30            | 20–30              |
| blog_to_exam_package  | 20            | 0 (erst nach Pillar-Messung) |

User-Vorgabe respektiert: erst Pillar promoten, messen, dann Exam-Package.

## Skip-Reasons (deterministisch)

`SUGGESTION_NOT_FOUND`, `LINK_TYPE_MISMATCH`, `NOT_SUGGESTED`,
`NOT_FROM_PILOT` (kein matching Eintrag in seo_bridge_pilot_candidates),
`BRONZE_LOCKED` (nur exam_package), `ACTIVE_DUPLICATE`,
`RACE_NOT_SUGGESTED` (zwischen plan und commit weggeflippt).

## Status-Contract

- Promotion schreibt `seo_internal_link_suggestions.status = 'active'`
  via deterministische UPDATE…FROM Join, gefiltert auf `status='suggested'`
  (verhindert race-flip auf rejected/active anderswo).
- Rollback setzt nur `promoted`-Items zurück auf `suggested` und markiert
  Promotion-Row `rolled_back`. Run wird `rolled_back_at` gestempelt.

## Audit (registriert in ops_audit_contract)

- `seo_bridge_promotion_proposed` — jeder Lauf (dry oder live)
- `seo_bridge_promotion_committed` — nur live
- `seo_bridge_promotion_rolled_back` — nur explizite Rollbacks

## Nächste Cuts

- **E3e.5** Empirical outcome measurement (CTR / assisted_conversion /
  crawl-depth / ranking-lift) der live-promoted Edges
- **E3e.6** Adaptive bridge weighting + perf-Cornerstone-Score reaktiviert
  `pillar_to_cornerstone_blog`
