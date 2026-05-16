---
name: Track M8 Pricing Activation Auto-Loop v1
description: AFTER-Trigger trg_m8_auto_activate_product_on_publish flippt products.status='active'+visibility='public' beim Publish wenn fn_pricing_activation_eligible (curriculum_id+slug+aktiver stripe_price). Backfill-RPC admin_pricing_activation_backfill heilte 124 stuck Pakete. SEO_DEAD_END-Cleanup via admin_m8_cancel_seo_dead_end_jobs (12 stale Jobs cancelled). UI TrackM8StatusCard im Heal-Cockpit.
type: feature
---

# Track M8 — Pricing Activation Auto-Loop

## Problem (Snapshot 2026-05-16)
- 190 published course_packages, aber nur 66 mit `products.status='active' AND visibility='public'`.
- 124 published Pakete hatten `products.status='draft' AND visibility='private'` — obwohl alle 124 bereits `curriculum_id + slug + active product_prices mit stripe_price_id` besaßen. Reine Activation-Lücke, kein Pricing-Setup-Loch.
- Folge: 124 Kurse waren technisch nicht verkaufbar (kein Public-Slug, kein active Product → fällt aus `v_public_sellable_courses`).
- Side-Quest: 12 `seo_intent_page_generate` Jobs in `failed` mit `SEO_DEAD_END` (Target-Paket noch building), blockierten Queue.

## Fix

### 1) SSOT View `v_pricing_activation_status`
Pro published Paket: package_id, product_id, slug, status, visibility, has_active_stripe_price, `activation_state` ∈ {ACTIVATED, ELIGIBLE_FOR_ACTIVATION, NO_PRODUCT, NO_CURRICULUM, NO_SLUG, NO_STRIPE_PRICE}.
REVOKE from public/anon/authenticated; GRANT to service_role.

### 2) Helper `fn_pricing_activation_eligible(_product_id uuid) → boolean`
STABLE SECURITY DEFINER. Prüft curriculum_id + slug + (active price mit stripe_price_id).

### 3) RPC `admin_pricing_activation_backfill(_limit int=200, _dry_run boolean=false)`
- has_role-Gate (admin) wenn auth.uid() gesetzt; sonst service_role.
- Iteriert ELIGIBLE_FOR_ACTIVATION, flippt `status='active', visibility='public'` (nur wenn aktueller Stand draft/private — idempotent).
- Audit pro Product: `auto_heal_log` action_type='m8_pricing_activation'.
- Run-Audit: `m8_pricing_activation_run` mit counts.

### 4) Trigger `trg_m8_auto_activate_product_on_publish`
AFTER INSERT OR UPDATE OF status/is_published/product_id ON course_packages.
Bei status→published + eligibility-true: auto-flip Product. Audit action_type='m8_pricing_activation_auto'.

### 5) RPC `admin_get_track_m8_status() → jsonb`
Aggregate für Cockpit: published_total, activated, eligible, blocked_no_{product,curriculum,slug,stripe_price}, recent_auto_runs, samples_eligible (top 10).

### 6) RPC `admin_m8_cancel_seo_dead_end_jobs() → int`
Cancelt alle failed `seo_intent_page_generate` mit `last_error LIKE '%SEO_DEAD_END%'`. Audit action_type='m8_seo_dead_end_cleanup'.

### 7) UI
`src/components/admin/heal/cards/TrackM8StatusCard.tsx` im Heal-Cockpit Stage 4 (neben M4-M7).
KPI-Grid + Eligible-Samples + 2 Buttons (Backfill / SEO-Heal).

## Smoke 2026-05-16
- Backfill: **124 activated, 0 skipped** → fully sellable count v_public_sellable_courses sprang von 37 → 59 (Rest blockt durch modules/lessons/lesson_ready, nicht Pricing).
- SEO-Cleanup: **12 dead-end Jobs cancelled**.
- v_pricing_activation_status: 190 ACTIVATED / 0 ELIGIBLE.

## Komplementär
- **Bestehende Hard-Gate** `trg_guard_publish_requires_pricing` blockt FUTURE publishes ohne komplettes Pricing (siehe pricing-integrity-guard-v2).
- M8 schließt die Restmenge an Paketen, die VOR dem Hard-Gate publish-ed wurden ohne dass das Product nachfolgend auf active geflippt wurde.

## Rollback
```sql
DROP TRIGGER IF EXISTS trg_m8_auto_activate_product_on_publish ON course_packages;
DROP FUNCTION IF EXISTS fn_auto_activate_product_on_publish();
-- View + RPCs können bleiben (read-only).
```
