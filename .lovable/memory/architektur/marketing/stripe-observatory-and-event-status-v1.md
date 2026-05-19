---
name: Stripe Observatory + Event-Status-Tracking v1
description: stripe_event_log um process_status/error_message erweitert; Webhook markiert ok/error; Admin-UI /admin/observatory mit Test-Trigger via admin-stripe-webhook-test (signed real webhook POST).
type: feature
---

# Stripe Webhook Observatory (2026-05-19)

## Schema-Erweiterung `stripe_event_log`
- Neue Spalten: `process_status` (received|ok|error|skipped, default 'received'), `error_message`, `handler_duration_ms`, `handler_notes jsonb`.
- Index `idx_stripe_event_log_received_at_desc` + `idx_stripe_event_log_status_type`.

## RPCs (SECURITY DEFINER + has_role('admin'))
- `admin_get_stripe_event_log(_limit, _event_type_filter, _status_filter)` — letzte 500 max.
- `admin_get_stripe_event_log_summary()` — total/24h/7d, by_status, by_type, recent_errors (top10).

## Webhook-Edits (`supabase/functions/stripe-webhook/index.ts`)
- Hoisted `_trackedEventId` vor try-Block.
- Upsert in stripe_event_log setzt explizit `process_status='received'`.
- Vor finalem 200-Return: UPDATE auf `process_status='ok'` + `processed_at=now()`.
- Outer-catch: UPDATE auf `process_status='error'` + `error_message` (best-effort, fresh client weil adminClient try-scoped).

## Admin-Trigger `admin-stripe-webhook-test` (verify_jwt=true)
- Auth: JWT + RPC `has_role(_user_id, 'admin')`.
- Allowed events: checkout.session.completed, checkout.session.expired, payment_intent.payment_failed, charge.refunded.
- Baut synthetisches Event, HMAC-signiert mit STRIPE_WEBHOOK_SECRET (gleich wie Stripe), POSTet an Live `/stripe-webhook`.
- checkout.session.completed nutzt `payment_status='unpaid'` → Handler skipt sicher, kein DB-Side-Effect.
- Schreibt `handler_notes.triggered_by` in stripe_event_log Audit.

## UI `/admin/observatory` (StripeObservatoryPage.tsx)
- Summary-KPIs (Total / 24h / 7d-ok / 7d-error).
- Test-Trigger-Card mit Event-Type-Select + Response-JSON-Anzeige.
- Filter (Event-Typ + Status), Tabelle, Payload-Modal mit Fehlerblock.
- Nav-Entry in AdminV2Shell SECONDARY_ITEMS (Webhook-Icon).
