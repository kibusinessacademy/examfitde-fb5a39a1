---
name: Loop B Email-Activation
description: 4 Sequenzen (welcome_doi/pricing_nurture/post_purchase/reengagement_30) mit Behavioral-Triggern, Worker, Cron, Admin-Live-Panel
type: feature
---
# Loop B — Email-Aktivierung (vertriebsoptimiert)

## Architektur
- **email_sequences**: text-Spalte sequence_type; 31 Steps (12 alt + 19 neu für 4 neue Sequenzen × Audiences)
- **email_delivery_queue**: erweitert um contact_id, recipient_email, audience, personalization (jsonb), attempts, last_error, sent_at, idempotency_key (UNIQUE)
- **enroll_email_sequence(contact_id, sequence_type, audience, cta_url)**: SECURITY DEFINER, idempotent. Step 1 sofort, danach +48h pro Step. Skipt unsubscribed.

## Behavioral Trigger
| Event | Trigger-Function | Action |
|---|---|---|
| `newsletter_subscribers.is_subscribed=true` (DOI) | `fn_enroll_welcome_on_doi` | enroll `welcome_doi` (audience aus segments) |
| `conversion_events.event_type='pricing_view'` | `fn_enroll_pricing_nurture` | enroll `pricing_nurture`, Step 1 +24h delay |
| `conversion_events.event_type='checkout_complete'` | `fn_enroll_post_purchase` | cancel pricing_nurture/reengagement, enroll `post_purchase` |
| `newsletter_subscribers.is_subscribed=false` | `fn_cancel_on_unsubscribe` | cancel alle pending |

## Worker
`supabase/functions/email-sequence-worker/index.ts`:
- Pulled max 50 fällige (scheduled_for <= now, status=pending)
- Suppression-Check (newsletter_subscribers.is_subscribed=false)
- Token-Render `{{first_name}}`, `{{cta_url}}` aus personalization
- MD→HTML mini-renderer (white bg, footer mit Unsubscribe-Link)
- Primär: send-transactional-email (Lovable Email infra), Fallback: Resend
- Bei Erfolg: status=sent + crm_activities.activity_type='email_sent'
- Bei Fehler: attempts++, retry in +1h, nach 3× → status=failed
- `dry_run=true` für Smoke-Tests

## Cron
`email-sequence-worker-5min` alle 5 Min via pg_cron + vault `email_queue_service_role_key`.

## Admin UI
`src/components/admin/marketing/EmailSequencesPanel.tsx` (eingebunden in MarketingIntelligencePanel):
- KPIs: Pending/Sent/Failed/Cancelled, refetch 30s
- Sequenz-Verteilung
- Live-Tabelle der letzten 200 Versand-Items, refetch 15s
- Manueller Worker-Trigger-Button

## SSOT-Hinweis
Keine separate sequence_id-FK; Sequenzen werden via (sequence_type, audience, step_number) zusammengeführt. Audience-Mapping aus `newsletter_subscribers.segments` (ausbilder/quereinsteiger/azubi).

## Test-Pfad
1. `INSERT INTO crm_contacts(email, first_name) VALUES (...)`
2. `SELECT enroll_email_sequence(contact_id, 'welcome_doi', 'azubi', 'https://...')`
3. Erwartung: 3 Rows in queue (sofort/+48h/+96h)
4. `POST /email-sequence-worker {dry_run:true}` → rendert subject mit Token
