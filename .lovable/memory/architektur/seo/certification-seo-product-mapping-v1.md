---
name: SEO ↔ Product Mapping v2 (override + auto-publish + tracking SSOT)
description: meta_override Top-Source, Auto-Publish-Trigger seo_content_pages, paketgebundene Funnel-Events via track-funnel-event Edge Function (anon-fähig).
type: feature
---

# SEO ↔ Product Mapping v2

## Match-Priorität (View v_certification_seo_with_product)
1. `meta_override` — `certification_seo_pages.product_slug_override` → SSOT-View canonical_slug
2. `id_chain` — catalog.linked_certification_id → course_packages.certification_id
3. `catalog_slug` — catalog.slug → certifications.slug → course_packages
4. `slug_base` — Regex `<base>-pruefung` ↔ `<base>-<uuid8>`
5. `unmatched`

`product_slug_override` (text, nullable) auf `certification_seo_pages` für gezielte manuelle Mappings.

## Auto-Publish (Growth-Kopplung)
- Trigger `trg_seo_pages_auto_publish_on_package` AFTER INSERT/UPDATE OF status, integrity_passed ON course_packages
- Bedingung: `status='published' AND integrity_passed=true`
- Wirkung: `seo_content_pages.status='draft' → 'published'` für betroffenes Paket
- Audit: `auto_heal_log.action_type='auto_publish_seo_pages_v1'`
- Manuell: `admin_publish_eligible_seo_pages(p_package_id uuid DEFAULT NULL)` (admin-gated)
- Initialer Backfill (2026-04-30): 31 SEO-Pages auto-published

## Tracking SSOT (paketgebunden)
- Hook: `useTrackGrowthEvent` v2
- Authed: direkter `conversion_events` insert
- **Anon: Edge Function `track-funnel-event`** (RLS verbietet anon-insert direkt → war Wurzel des 80% Funnel-Drops)
- Pflicht-Events mit `package_id`: `lead_magnet_view`, `quiz_started`, `quiz_completed`, `lead_capture_submitted`
- Persona-/source_page-Felder als first-class

## Buy-CTA
`buildBuyCtaUrl(mapping)`:
- product vorhanden → `/pruefungstraining/<canonical_slug>`
- sonst `/shop?ref=<seo_slug>&category=<segment>&q=<title>`

## Aktuelle Match-Quote
3/42 `id_chain` (Backfill linked_certification_id 313/313 eindeutig durchgeführt), 39/42 unmatched = course_packages-Datenlücke.
