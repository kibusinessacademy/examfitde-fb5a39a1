---
name: M7 Closure Producer + Frontend
description: Schließt die 3 offenen M7-TODOs — paywall_abandoned Producer stempelt payload.variant_key via fn_resolve_user_paywall_variant, send-org-owner-digest respektiert org_owner_digest_preferences (disabled + cadence-mismatch → suppress), /renew Landing mit org_resolve_renewal_token + org_consume_renewal_token.
type: feature
---
# M7 Closure — Producer + Frontend (2026-05-16)

## Änderungen
1. **Producer-Stamping (variant_key)**
   - `fn_emit_monetization_intents` patcht den paywall_abandoned-INSERT:
     `payload = jsonb_strip_nulls(jsonb_build_object('intent_key','paywall_abandoned_24h','package_id', a.package_id, 'variant_key', fn_resolve_user_paywall_variant(a.user_id, NULL)))`.
   - Audit-Detail erweitert um `variant_stamping: 'enabled'`.
   - checkout_abandoned-Pfade unverändert (kein A/B-Bezug).

2. **Digest-Preference-Gate (send-org-owner-digest)**
   - Vor Resend-Send: Lookup `org_owner_digest_preferences(org_id, owner_user_id)`.
   - `enabled=false` ∨ `cadence='disabled'` → state=suppressed, reason=`m7_owner_pref_disabled`.
   - `cadence != payload.period` → state=suppressed, reason=`m7_owner_pref_cadence_mismatch:<pref>_vs_<period>`.
   - Response erweitert um `skipped_pref`.

3. **`/renew?token=...` Landing**
   - Route public (anon erlaubt) → `src/pages/org/RenewPage.tsx`.
   - RPC `org_resolve_renewal_token(p_token)` (SECURITY DEFINER, GRANT anon/auth) — validiert Token (existence/expiry/used) und liefert org_name + product_name + seat_count + license_valid_until.
   - Klick „Jetzt verlängern" → `org_consume_renewal_token` markiert `used_at`, danach `create-product-checkout` invoke mit `license_id` + `renewal_token` + `source='self_service_renewal'` → Stripe-Redirect.
   - Error-Pfade rendern menschliche Texte für expired/already_used/not_found/missing_token.

## SSOT
- Producer SSOT bleibt `fn_emit_monetization_intents`; variant_key ist optional (NULL-safe via jsonb_strip_nulls).
- `org_resolve_renewal_token` ist die einzige Read-RPC für anonyme Token-Resolution. `org_consume_renewal_token` ist die einzige Mark-Used-RPC (authenticated, idempotent).
- Digest-Pref-Check passiert ausschließlich im Sender — Producer enqueuet weiterhin alle Kandidaten.

## Files
- Migration `supabase/migrations/2026051615*.sql` (Producer-Update + 2 RPCs)
- Edit `supabase/functions/send-org-owner-digest/index.ts` (Preference-Gate)
- New `src/pages/org/RenewPage.tsx`
- Edit `src/routes/AppRoutes.tsx` (Route-Mount + lazy import)
