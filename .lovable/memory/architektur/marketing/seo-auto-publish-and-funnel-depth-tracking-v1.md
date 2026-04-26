---
name: SEO Auto-Publish + Funnel-Depth Tracking v1
description: AFTER-Trigger fn_auto_publish_seo_pages_on_package_publish setzt seo_content_pages.status='draft' → 'published' wenn course_packages auf published+is_published wechselt. Backfill 84 Pages live. track_conversion_event_v2 RPC + FunnelEventType erlauben jetzt page_view + add_to_cart.
type: feature
---

# SEO Auto-Publish + Funnel-Depth v1 — 2026-04-26

## Problem
- 112 SEO-Landingpages in `seo_content_pages` waren `status='draft'`, davon 84 zu bereits published Paketen — kein organischer Traffic möglich.
- conversion_events.v2 erlaubte nur Bottom-Funnel (`pricing_view` → `checkout_start` → `checkout_complete`). Top-of-Funnel `page_view` und Mid-Funnel `add_to_cart` fehlten → keine Absprungratenanalyse.

## Fix

### 1) `fn_auto_publish_seo_pages_on_package_publish` (AFTER-UPDATE Trigger)
- Auf `course_packages`, feuert wenn `is_published` ODER `status` sich ändert.
- Bedingung: `NEW.is_published=true AND NEW.status='published'`.
- Aktion: Setzt alle `seo_content_pages.status='draft'` mit `package_id=NEW.id` auf `published`.
- Audit in `auto_heal_log` (action_type='seo_pages_auto_publish').

### 2) Backfill (einmalig)
- 84 Pages zu published-Paketen sofort live geschaltet.
- 28 Pages bleiben draft (Pakete noch im Build/blocked) — werden vom Trigger übernommen sobald deren Pakete livegehen.

### 3) Funnel-Tiefe
- `track_conversion_event_v2` RPC: Whitelist um `page_view` und `add_to_cart` erweitert.
- `src/lib/conversionTracking.ts` `FunnelEventType` ebenfalls erweitert.
- `PruefungstrainingDetailPage.tsx`:
  - `useEffect`: `trackFunnel('page_view', {metadata:{source,slug,cert_id}})` beim Mount mit cert.
  - Checkout-CTA: feuert `add_to_cart` + `checkout_start` parallel zum bestehenden `seo-tracking.trackConversion`.

## Funnel-Reihenfolge ab jetzt
`page_view` → `pricing_view` → `add_to_cart` → `checkout_start` → `checkout_complete`

## Komplementär
- `src/lib/seo-tracking.ts` (Loop A bestehend) bleibt erhalten — `conversionTracking.ts` (SSOT v2) ist die kanonische Quelle für Funnel-Metriken.
