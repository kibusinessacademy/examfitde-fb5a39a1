---
name: Loop D Admin-Cockpit (6 Status-Ampeln)
description: Live-Cockpit + Daily-Snapshot mit 6 Domain-Ampeln (SEO/Funnel/CRM/Revenue/Learning/Pipeline), Drilldown, 14d-Sparklines, kontextueller Action-CTAs
type: feature
---
# Loop D — Admin-Cockpit

## Architektur
- **Tabelle `cockpit_daily_snapshots`** (snapshot_date, domain, status, primary_kpi, primary_value, secondary jsonb, reasons text[]) — UNIQUE(date,domain). RLS: nur Admin lesen.
- **RPC `get_cockpit_status()`** SECURITY DEFINER, role=admin, liefert Live-JSON `{ as_of, cards: [6] }`. Karten: `seo`, `funnel`, `crm`, `revenue`, `learning`, `pipeline` mit `status` (green/yellow/red/grey), `primary_kpi`, `primary_value`, `secondary`, `reasons[]`, `cta`, `route`.
- **RPC `persist_cockpit_daily_snapshot()`** schreibt Tages-Snapshot pro Domain (UPSERT). Cron `cockpit-daily-snapshot` 06:00 UTC.

## Datenquellen pro Ampel
| Domain | Quelle | Schwellen |
|---|---|---|
| SEO | `seo_content_pages` (status=live/draft) | green ≥50, yellow ≥10, sonst red |
| Funnel | `v_funnel_overview_24h` | green wenn checkout_completes>0, yellow bei pricing_views/starts, grey bei 0 visitors |
| CRM | `crm_contacts`, `newsletter_subscribers`, `email_delivery_queue` | red bei >5 email_failed/24h oder 0 contacts |
| Revenue | `orders.status='paid'` | green bei orders 24h>0, yellow bei revenue_7d>0 |
| Learning | `learner_course_grants`, `v_ai_tutor_audit_kpis` | red wenn block_rate>30% |
| Pipeline | `job_queue` | red bei >50 failed/24h, yellow bei >10 |

## UI (`src/pages/admin/v2/CockpitPage.tsx`)
- 6 Cards in 1/2/3-col responsive Grid, Top-Stripe in Status-Farbe, pulsierender Status-Dot, Sparkline (14d) aus `cockpit_daily_snapshots`.
- Overall-Badge (red>yellow>grey>green) im Header. Auto-Refresh 60s.
- Klick auf "Details" → Drilldown der `secondary`-KPIs (humanizeKey + Tabellen-View).
- Action-CTA pro Card (z.B. "Funnel-Audit ausführen", "Email-Worker triggern") routet zur passenden Admin-Page.
- Manueller Snapshot-Button → ruft `persist_cockpit_daily_snapshot`.

## Navigation
- `/admin/cockpit` ist neuer Top-Eintrag in `AdminV2Shell` (vor Leitstelle).
- Default-Redirect `/admin` → `/admin/cockpit`.

## Endpunkt-Test
```sql
SELECT public.get_cockpit_status(); -- als Admin
SELECT public.persist_cockpit_daily_snapshot(); -- service_role
```
