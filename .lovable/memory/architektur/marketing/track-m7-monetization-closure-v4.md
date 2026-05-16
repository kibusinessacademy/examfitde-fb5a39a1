---
name: Track M7 Monetization Closure v4
description: Schließt die 4 Sales-E2E-Lücken nach M6 — Stripe-paid Reverse von checkout_abandoned, Self-Service-Renewal-Links pro Org-Lizenz, Variant-aware Paywall-Notify (variant_key in payload), Org-Owner Digest-Preference-Center (weekly/monthly/disabled).
type: feature
---
# Track M7 — Monetization Closure v4 (2026-05-16)

## Scope
Vier echte E2E-Lücken aus dem Monetarisierungs-Audit nach M6:

1. **Stripe-Paid Reverse für checkout_abandoned**
   - Trigger `trg_m7_reverse_checkout_abandoned` (AFTER INSERT auf `conversion_events`).
   - Bei event_type ∈ {`payment_succeeded`,`checkout_completed`,`order_paid`} → setzt pending `notification_jobs.kind='checkout_abandoned'` desselben Users auf `state='suppressed'` mit `suppression_reason='m7_paid_after_abandon'`.
   - Audit in `auto_heal_log` (`action_type='m7_checkout_abandoned_reversed'`, payload mit suppressed_count + trigger_event).

2. **Self-Service Renewal Links**
   - Tabelle `org_renewal_links(license_id, org_id, token UNIQUE, expires_at, used_at, metadata)`.
   - RPC `org_create_self_service_renewal_link(p_license_id, p_ttl_days=30)` → owner/admin der Org **oder** Plattform-Admin. Generiert hex(24)-Token, default 30d TTL, gibt URL `https://examfit.de/renew?token=<token>` zurück.
   - RLS: Owner/Admin der Org sehen ihre eigenen Links; Plattform-Admin sieht alle; service_role full.

3. **Variant-Aware Paywall Notify**
   - Helper `fn_resolve_user_paywall_variant(p_user_id, p_experiment_key default null)` — joined `experiment_assignments` → `paywall_variants` → `paywall_experiments`, gibt jüngsten variant_key zurück. SECURITY DEFINER, STABLE.
   - Producer für `paywall_abandoned` Jobs sollen den Return-Value als `payload.variant_key` stempeln.
   - View `v_paywall_variant_attribution_drift` (30d, per Tag): with_variant / without_variant / coverage_pct. Lockdown: GRANT SELECT nur service_role.

4. **Org-Owner Digest-Preference-Center**
   - Tabelle `org_owner_digest_preferences(org_id, owner_user_id, cadence text CHECK weekly|monthly|disabled, enabled bool)` mit UNIQUE(org_id, owner_user_id).
   - RPC `org_owner_update_digest_preference(p_org_id, p_cadence, p_enabled)` — Owner/Admin der Org. UPSERT.
   - RLS: Owner sieht eigene; Plattform-Admin alle; service_role full.

## SSOT (Admin)
- `admin_get_track_m7_audit(p_window_hours=168)` — reverse_paid_suppressed_count, renewal_links_total/active, paywall_jobs_with/without_variant, digest_prefs_{weekly,monthly,disabled}.
- `admin_smoke_track_m7()` — trigger_reverse_exists + renewal_rpc_exists + variant_helper_exists + prefs_table_exists + drift_view_exists.

## UI
`TrackM7StatusCard` im `HealCockpitPage` nach `TrackM6StatusCard`. Zeigt 4 KPI-Kacheln + Smoke-Button.

## Producer-TODOs (außerhalb dieses Tracks)
- `paywall_abandoned` Producer: bei enqueue `payload.variant_key = fn_resolve_user_paywall_variant(user_id, experiment_key)` stempeln.
- `send-org-owner-digest` Edge: vor Send `org_owner_digest_preferences.enabled+cadence` prüfen; bei `cadence='disabled'` skip + audit.
- Renewal-Landing `/renew?token=...` (Frontend): Token → resolve license → vorausgefüllter Stripe-Checkout.

## Files
- Migration `supabase/migrations/2026051615*.sql` (siehe Datum der Anwendung)
- UI `src/components/admin/heal/cards/TrackM7StatusCard.tsx`
- Edit `src/pages/admin/v2/HealCockpitPage.tsx` (Card-Mount)
