---
name: User-Backend Phase 1 (Loop A — DB-Foundation)
description: gdpr_deletion_requests + get_user_account_summary + fn_revoke_grant_on_refund. /app-Account-Bereich (Pages) + Stripe-Webhook-Erweiterung folgen in Loop B.
type: feature
---

# User-Backend Phase 1

**Scope:** Eigener Account-Bereich `/app/*` parallel zu `/dashboard` (Lern-Hub).
`/dashboard` bleibt unangetastet.

## Loop A — DB-Foundation (✅ done 2026-05-01)

### Neue Tabelle
- `gdpr_deletion_requests` — Art. 17 DSGVO. UNIQUE-Index verhindert Mehrfach-Anträge pro User. 30-Tage-Frist via `scheduled_deletion_at`. Status: pending → confirmed → completed | cancelled | rejected.

### Neue RPCs
- `get_user_account_summary()` — SSOT für `/app/dashboard`. Liefert in einem Call: active_courses (aus learner_course_grants + course_packages), invoice_count, latest_invoice, license_packages_owned (mit assigned-seats-count), pending_gdpr_request. Auth-only.
- `request_gdpr_deletion(reason)` — User-self-service. Idempotent: returnt existing wenn pending/confirmed.
- `cancel_gdpr_deletion(request_id)` — User cancelt eigenen Antrag.
- `fn_revoke_grant_on_refund(payment_intent_id, refund_id, reason)` — service_role only. Wird von Stripe-Webhook (Loop B) bei `charge.refunded` aufgerufen. Setzt grant.status='refunded' + entitlement.valid_until=now(). Idempotent + audited via admin_actions.

### Bestehende Infrastruktur (NICHT angetastet)
- `orders`, `invoices` (mit pdf_url + stripe_invoice_id), `invoice_items` — Schema vorhanden, aktuell 0 rows (Webhook spiegelt noch nicht).
- `learner_course_grants` (2 rows, läuft via trg_orders_paid_grant).
- `license_packages`, `license_seats`, `org_license_*` — komplett vorhanden.
- `admin_actions` (204k rows) — wird für jede gdpr/refund-Aktion benutzt.

## Loop B — TODO
1. **stripe-webhook**: `invoice.paid` → upsert in invoices; `charge.refunded` → fn_revoke_grant_on_refund.
2. **Edge Functions**: `gdpr-export-user-data` (Art. 15 JSON-Export), `gdpr-confirm-deletion` (Token-Confirm).
3. **UI `/app/*`**: Layout mit Sidebar + 6 Pages (meine-kurse, rechnungen, downloads, lizenzen, profil, dsgvo).
4. Smoke: Test-User → Account-Summary → DSGVO-Request → Cancel.

## Konventionen (für Loop B)
- Alle /app-Reads gehen über `get_user_account_summary` oder direkt RLS-policy'd Tabellen.
- Niemals Service-Role-Key im Frontend.
- Refund-Pipeline ausschließlich serverseitig (stripe-webhook → fn_revoke_grant_on_refund).
- Downloads in Phase 1 = nur `invoices.pdf_url` (Stripe Hosted Invoice URL). Kein eigener Download-Layer/Bucket in Phase 1.
