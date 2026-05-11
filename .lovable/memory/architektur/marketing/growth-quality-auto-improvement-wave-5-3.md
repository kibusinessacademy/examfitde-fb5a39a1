---
name: Growth Quality Auto-Improvement Wave 5.3
description: Audit-to-Action — Klassifikator + Cockpit "Next Best Growth Fix" für CTA/Funnel-Audits, keine Content-Mutation
type: feature
---

## Scope
- CTA/Funnel-Audit-Runs werden in 4 kanonische Aktionen klassifiziert.
- Cockpit zeigt priorisierte „Next Best Fix"-Liste pro Package.
- Read-only intelligence — kein neuer Content, keine Mutation.

## Aktionen (kanonisch)
- `check_landing_page_cta_render` — Landing-Render/CTA-Render fehlt oder zeigt keine Impressions.
- `review_cta_copy_for_engagement` — CTA sichtbar, aber kein Klick / unter Schwelle.
- `verify_checkout_event_wiring` — Pflicht-Checkout-Events fehlen.
- `verify_lead_form_wiring` — Lead-/Quiz-Events fehlen.

## Routing-Logik (`fn_growth_classify_next_best_fix`)
- subscore=`funnel_events`:
  - missing has `checkout_started|checkout_complete` → verify_checkout_event_wiring
  - missing has `lead_capture_submitted|quiz_started` → verify_lead_form_wiring
  - missing has `cta_visible|landing_view` → check_landing_page_cta_render
- subscore=`cta`:
  - cta_assets=0 → check_landing_page_cta_render
  - visible>0 ∧ click=0 → review_cta_copy_for_engagement
  - visible=0 → check_landing_page_cta_render
  - else (red) → review_cta_copy_for_engagement

## SSOT
- View `v_growth_next_best_fix` (latest run per (package_id, subscore), severity_rank red>yellow>green).
- RPC `admin_get_growth_next_best_fix(limit)` — has_role('admin')-gate, sortiert nach severity asc + created_at desc.
- View hard locked (REVOKE PUBLIC/anon/authenticated, GRANT service_role).

## Tests
- Regression: passive Assertion in der Migration verifiziert ≥1 historischer `post_score_unavailable`-Rollback existiert (Fail-Closed Beweis aus 5.2).
- Smoke: alle 4 Aktionen werden vom Klassifikator über repräsentative Artefakte erreicht.

## UI
- `GrowthNextBestFixCard` im Tab `fanout` zwischen Score- und Foundation-Karte.
- Verdict-Badges (red/yellow/green) + lokalisierte Action- und Reason-Labels.

## Audit
- `auto_heal_log` action_type=`welle_5_3_audit_to_action_deployed` mit Aktionsliste + RPC-/View-Refs.
