---
name: Selective Stale-Exhaustion UI + Marketing Intelligence Panel v1
description: PurgeExhaustionButton mit Confirm-Dialog (single + bulk), neue StaleMarkerDiffPage Route /admin/command/ops/stale-marker-diff, integriertes MarketingIntelligencePanel als neuer Tab in GrowthPage mit CRM/Orders/Email-Diagnose und Fix-CTAs.
type: feature
---

## UI für RPC admin_purge_stale_exhaustion

- **PurgeExhaustionButton** (`src/components/admin/heal/PurgeExhaustionButton.tsx`)
  - AlertDialog mit Checkbox "Sofort neu füllen" (default true)
  - Ruft `supabase.rpc('admin_purge_stale_exhaustion', {p_package_id, p_trigger_refill})`
  - Disabled wenn driftClass nicht STALE_EXHAUSTION_*
  - Eingebunden im PackageDrawer neben RefreshIntegrityWithDiffButton
  - Eingebunden pro Zeile in StaleMarkerDiffPage

- **StaleMarkerDiffPage** (`src/pages/admin/v2/StaleMarkerDiffPage.tsx`)
  - Route: `/admin/command/ops/stale-marker-diff`
  - Liest `v_admin_stale_marker_diff` direkt
  - Filter (STALE_ALL default), Suche, KPI-Tiles (5 Drift-Klassen)
  - Bulk-Selection nur für eligible (active_jobs=0 + STALE_EXHAUSTION_*)
  - Bulk-Confirm-Dialog mit Refill-Toggle, sequentielle RPC-Calls

## Marketing Intelligence Panel

- **MarketingIntelligencePanel** (`src/components/admin/marketing/MarketingIntelligencePanel.tsx`)
  - Eingebunden als neuer Tab "Marketing-Intel" in GrowthPage
  - Aggregiert 16 Tabellen: orders, order_items, conversion_events, crm_*,
    leads/b2b_leads/partner_leads, newsletter_*, email_campaigns,
    email_sequences, lead_magnets
  - Master-Diagnose-Alert mit 5 Health-Indikatoren (Sales/CRM/Email/Tracking/Leads)
  - 8 KPI-Tiles mit Health-Badges
  - 4 Sektionen mit DiagBlock + Fix-CTA: Orders, CRM, Email, Lead Magnets
  - Priorisierter 5-Schritte Action-Plan mit done/todo State und Deep-Links

## Health-Klassifikation
- Orders: count=0 → critical, count>0 aber 30d=0 → warning
- CRM: contacts=0 → critical, deals=0 → warning
- Email: 0 campaigns AND 0 newsletter → critical, subs=0 → warning
- Tracking: events=0 → critical, 7d<10 → warning
- Leads: total=0 → critical sonst warning

## Sicherheit
RPC ist SECURITY DEFINER und prüft serverseitig drift_class + active_jobs=0.
Frontend disabled-Logik dient nur UX, nicht Authority.
