---
name: Pricing Integrity Hard Gate v2
description: SSOT-Hardening für Pricing. fn_package_pricing_ready + Trigger blocken Publish ohne Stripe-Preis. Publish-Readiness erweitert. CI failed bei status != green.
type: feature
---

# Pricing Integrity Hard Gate v2

**Ziel:** Der grüne Zustand von `v_pricing_integrity_check` ist dauerhaft eingefroren. Drift wird auf 3 Ebenen verhindert.

## 3-Schicht Hard Gate

### 1. CI-Gate (`scripts/pricing-integrity-check.mjs`)
- Fail wenn `v_pricing_integrity_check.status != 'green'`
- Fail wenn `published_without_price > 0`, `duplicate_product_cases > 0`, `manual_review_cases > 0`
- Fail wenn cluster `action_needed='none'` ≠ `total_published_packages`
- Output zeigt **alle** 4 Kennzahlen + Remediation-Runbook (admin_seed_missing_product_prices, admin_merge_duplicate_certification_products)
- Workflow `.github/workflows/pricing-integrity-guard.yml` läuft auf push/PR/hourly cron

### 2. DB-Trigger (`trg_guard_publish_requires_pricing` on `course_packages`)
- BEFORE INSERT/UPDATE OF status
- Bei Übergang nach `status='published'`: ruft `fn_package_pricing_ready(id)`
- RAISE EXCEPTION bei Reasons: `PRICING_PRODUCT_ID_MISSING`, `PRICING_NO_ACTIVE_PRICE`, `PRICING_STRIPE_PRICE_ID_MISSING`
- Bypass: `session_replication_role='replica'` (Restore/Replication)
- Garantie: kein Paket erreicht `published` ohne `product_id` + aktiven `product_price` mit `stripe_price_id`

### 3. Auto-Publish-Readiness (`fn_package_publish_readiness`)
- Erweitert um Pricing-Reasons aus `fn_package_pricing_ready`
- Reasons: `PRICING_PRODUCT_ID_MISSING`, `PRICING_NO_ACTIVE_PRICE`, `PRICING_STRIPE_PRICE_ID_MISSING`
- Returnt `pricing` jsonb-Block mit `product_id`, `active_prices`, `prices_with_stripe`
- Auto-Publish-Step bleibt im Trigger `trg_guard_auto_publish_preconditions` blockiert, solange Pricing-Reasons offen sind

## SSOT-Funktion `fn_package_pricing_ready(uuid) → jsonb`
- SECURITY DEFINER, REVOKE PUBLIC/anon/authenticated, GRANT service_role
- Prüft: `course_packages.product_id IS NOT NULL` → `product_prices.active=true` count > 0 → mit `stripe_price_id IS NOT NULL` count > 0
- Returnt `{ ready, reasons[], product_id, active_prices, prices_with_stripe }`

## Remediation-Pfad (bei Drift)
1. Diagnose: `SELECT * FROM v_pricing_backfill_dryrun WHERE action_needed <> 'none';`
2. Preview: `SELECT * FROM admin_seed_missing_product_prices(false);`
3. Apply: `SELECT * FROM admin_seed_missing_product_prices(true);`
4. Duplicate-Cleanup: `SELECT * FROM admin_merge_duplicate_certification_products(true);`

## Baseline 2026-05-01
- 49 published packages, alle Pricing-Hard-Gate-konform (active_prices=1, with_stripe=1)
- `v_pricing_integrity_check`: status=green, alle Kennzahlen=0
- Trigger-Smoke: `fn_package_pricing_ready` returnt ready=true für alle 49

## Invarianten
- Stripe-Preis-SSOT bleibt `product_prices`
- Tier-Mapping via `pricing_tier_stripe_map` (3 Bundle-Tiers: 24.90/29.90/49.90 EUR)
- Niemals direkter INSERT in product_prices ohne Tier-Mapping
- Keine pro-Produkt Stripe-Products — nur Tier-Prices unter Bundle-Product
