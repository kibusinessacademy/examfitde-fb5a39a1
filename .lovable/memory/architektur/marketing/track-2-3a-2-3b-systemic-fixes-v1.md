---
name: Track 2.3a + 2.3b Systemic Growth Fixes v1
description: Canonical Drift Runbook (diagnose-only, 7 Ursachen × severity × fix_scope) + Attribution Propagation Audit (policy-Registry, soft→strict pro event_type, Trigger trg_conversion_events_attribution_audit). Kein customer_safe-Touch.
type: feature
---

# Track 2.3a + 2.3b — 2026-05-16

## 2.3a Canonical Drift Runbook
- `v_canonical_drift_classification_v1` (service_role only) — eine Zeile pro published Paket × Page-Match.
- Ursachen: `MISSING_CANONICAL`, `DUPLICATE_CANONICAL`, `NEVER_CHECKED`, `STALE_ARTIFACT`, `ROUTE_MISMATCH`, `DRAFT_BUT_PKG_LIVE`, `OK`.
- `severity`: critical / warn / info / ok.
- `fix_scope`: `platform` (1 Fix → N Pakete) vs `package` (Per-Paket-Heal).
- RPCs (has_role): `admin_get_canonical_drift_summary()` + `admin_get_canonical_drift_packages(_cause,_severity,_limit)`.
- UI: `CanonicalDriftRunbookCard` im HealCockpit (nach GrowthClassificationCard).
- **Diagnose-only** — kein Auto-Fix. Verhindert Phantom-Repair-Welle (siehe Loop-A Lehre).

## 2.3b Attribution Propagation
- Tabelle `conversion_event_attribution_policy(event_type PK, requires_package, strict, scope, notes, …)` — Registry pro Event-Type.
- 17 Events seed (quiz_*, checkout_*, lead_*, cta_*, product_view, pricing_hero_view, package_published, shop_view, lernplan_viewed, landing_view, heatmap_scroll_depth).
- Trigger `trg_conversion_events_attribution_audit BEFORE INSERT`:
  - Findet keine Policy oder `requires_package=false` → pass-through.
  - `package_id IS NOT NULL` ODER `metadata->>'package_id' IS NOT NULL` → pass-through.
  - Sonst: Audit-Insert in `auto_heal_log` (action_type=`conversion_event_attribution_violation`).
  - Wenn `strict=true` → RAISE EXCEPTION (22023 check_violation), Insert geblockt.
- RPCs: `admin_get_attribution_audit_summary(_window_days)` (7/30/90), `admin_set_attribution_policy(event,req,strict,scope,notes)`.
- UI: `AttributionAuditCard` — Per-Event Tabelle mit attribution_pct, soft↔strict Toggle, recent violations.

## Rollout-Pfad
1. **Phase 1 (jetzt, soft)**: Alle 17 Events `strict=false`. Audit zeigt Drift-Quellen pro event_type (Baseline 2026-05-16: ~95% Events ohne pkg, daher massiv).
2. **Phase 2 (nach 7d Beobachtung)**: Pro Event-Type schrittweise `strict=true` schalten — beginnend mit `checkout_started`/`checkout_complete` (server-resolved, sollten 100% sein) → dann `quiz_*` (LeadQuizRunner bridge) → dann CTA/View-Events.
3. **Phase 3**: Wenn alle strict Events stabil → Trigger ist Hard-Guard, neue Producer ohne package_id failen sofort.

## Pitfalls
- Trigger ist SECURITY DEFINER + EXCEPTION-safe für Audit-Insert (NULL bei Fehler). Strict-Block dagegen mit USING ERRCODE='check_violation' für klare Client-Errors.
- `conversion_events.package_id` ist GENERATED STORED aus `metadata->>'package_id'` (siehe conversion-events-package-id-generated-column-v1) — Producer schreiben weiterhin `metadata.package_id`, nie top-level.
- View nutzt LEFT JOIN seo_content_pages → Pakete ohne Page erscheinen als `MISSING_CANONICAL` (typischer Bootstrap-Gap).
- DUPLICATE_CANONICAL: gleicher slug bei ≥2 published Pages — strukturelles SEO-Cannibalization-Risiko.

## Baseline-Audit
`auto_heal_log.action_type = 'track_2_3a_2_3b_init'` — 2026-05-16, 7 Komponenten.
