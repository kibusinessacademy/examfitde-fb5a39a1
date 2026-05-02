---
name: Pricing Hard Gate Publish-Block v1
description: WIP-Deadlock-Root-Fix. trg_block_publish_enqueue_without_pricing verhindert package_auto_publish-Enqueue ohne aktiven stripe_price_id (cancelled+audit). admin_terminate_pricing_blocked_publish_jobs RPC räumt Bestand auf + erzeugt Backlog 'pricing_missing_stripe_price'. fn_package_has_active_stripe_price (service_role) ist SSOT.
type: feature
---

## Problem
51 Pakete saßen seit bis zu 33h pending in package_auto_publish ohne stripe_price_id. Worker claimte nie (WIP=71/71 voll). completed_6h=0 auf control lane.

## Fix-Layer
1. **fn_package_has_active_stripe_price(uuid)** — SSOT-Check (course_packages → product_prices wo active=true + stripe_price_id NOT NULL).
2. **trg_block_publish_enqueue_without_pricing** BEFORE INSERT auf job_queue — markiert Inserts mit job_type=package_auto_publish ohne aktiven Preis sofort als status='cancelled' + audit 'publish_enqueue_blocked_no_pricing'.
3. **admin_terminate_pricing_blocked_publish_jobs()** Service-Role-RPC — cancelt pending Bestand + setzt package_steps.auto_publish→failed + erzeugt heal_permanent_fix_tasks(pattern_key='pricing_missing_stripe_price', cluster='pricing', priority='high'). Idempotent via partial unique index.
4. created_by Pflicht-Spalte: COALESCE(auth.uid(), '00000000-…') als Sentinel.

## Beobachtung
- Edge-Function package-auto-publish behandelt PRICING_HARD_GATE_BLOCKED bereits korrekt als terminal+422 (line 441-485). Aber: Jobs werden vom Worker nicht geclaimt wenn WIP voll → Edge-Function wird nie erreicht → Pre-Claim-Termination via RPC nötig.
