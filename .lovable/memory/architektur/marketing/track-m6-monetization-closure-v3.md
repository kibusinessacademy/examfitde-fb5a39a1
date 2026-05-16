---
name: Track M6 Tracking-URL Injection + Resend Webhook + Tuning UI
description: Schließt die 3 M5-Auslassungen — send-org-owner-digest injiziert Tracking-URLs (open pixel + click-wrap via owner-digest-track), resend-webhook + admin_ingest_resend_event speist bounce/complaint → suppressed_emails, TrackM6StatusCard ist UI-CRUD für curriculum_upsell_promote_tuning.
type: feature
---
# Track M6 — Monetization Closure v3 (2026-05-16)

## Scope
Closure für drei Auslassungen aus Track M5:

1. **Tracking-URL Injection** — `send-org-owner-digest` resolved `tracking_token` aus `org_owner_digests` (via `payload.digest_id` oder `payload.tracking_token`), wrapped alle `href="https://…"` durch `owner-digest-track?type=click&u=<url>`, hängt `<img src=".../?type=open">` Pixel an `</body>`. Recipient ist per-Job aufgelöst → personalisiertes Tracking pro Empfänger.

2. **Resend Webhook → suppressed_emails** — Neue Edge `resend-webhook` (verify_jwt=false, optional `RESEND_WEBHOOK_SECRET` header gate). Ruft `admin_ingest_resend_event(p_event jsonb)` (SECURITY DEFINER, service_role only). Tabelle `email_provider_events` (append-only, RLS admin read + service all). RPC parsed Resend-Eventformat (`type`, `data.to[]`, `data.email_id`), insert ein Audit-Row, und bei `email.bounced`/`email.complained` UPSERT in `suppressed_emails` mit `reason ∈ {bounce, complaint}` und metadata.source=`resend_webhook`. ON CONFLICT (email) DO NOTHING — kein Re-Suppress-Spam.

3. **Tuning UI-CRUD** — `TrackM6StatusCard.tsx` ist Inline-Editor auf `curriculum_upsell_promote_tuning` (Admin-RLS reicht). Felder min_confidence/min_support/min_lift/max_promote_per_run + enabled-Switch. `__default__` row ist nicht löschbar. Add-Row legt neue Persona mit Default-Werten an. Speichern via Blur → upsert.

## SSOT
- `admin_get_track_m6_audit(p_window_hours=168)` — provider_events nach event_type, suppressed_via_webhook count, tuning rows enabled/total.
- `admin_smoke_track_m6()` — ingest_rpc_exists + events_table_exists + default_tuning_enabled.

## UI
- `TrackM6StatusCard` im `HealCockpitPage` nach `TrackM5StatusCard`.

## Setup (Operator)
1. Optional: secret `RESEND_WEBHOOK_SECRET` setzen, dann Header `X-Webhook-Secret` in Resend konfigurieren.
2. In Resend Dashboard → Webhooks: `https://<project>.functions.supabase.co/resend-webhook` für email.bounced + email.complained (optional delivered/opened).

## Files
- Migration: `supabase/migrations/2026051615*.sql` (email_provider_events + admin_ingest_resend_event + audit/smoke)
- Edge: `supabase/functions/resend-webhook/index.ts` (new)
- Edge: `supabase/functions/send-org-owner-digest/index.ts` (+ injectTracking helper)
- UI: `src/components/admin/heal/cards/TrackM6StatusCard.tsx`
