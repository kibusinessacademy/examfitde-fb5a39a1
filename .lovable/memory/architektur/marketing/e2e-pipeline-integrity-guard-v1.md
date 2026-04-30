---
name: E2E Pipeline Integrity Guard v2 (mapping-based)
description: v_package_e2e_integrity bewertet READINESS via Mappings (has_active_price, has_published_seo_page, has_funnel_tracking_mapping) — NICHT via Traffic. Traffic-Spalten bleiben info-only. auto_healable enthält NIE Funnel/Traffic. v_platform_integrity um e2e_pipeline_status erweitert. fn_e2e_integrity_guard heilt SEO-Drafts, alertet nur echte Blocker (manual_pricing/duplicate_product/seo_missing). Funnel-Mapping fehlt → soft-log only. Cron e2e-integrity-guard-hourly Min 17 + CI scripts/e2e-integrity-check.mjs.
type: feature
---

# E2E Pipeline Integrity Guard v2 — 2026-04-30

## Zentrale Architektur-Regel
**Traffic ≠ Readiness.** E2E-Status misst, ob ein Paket vollständig **verkauft & getrackt werden kann**, nicht ob es Besucher hatte.

## Readiness-Booleans (pro Paket)
- `has_product` — ≥1 nicht-archiviertes Produkt für die Zertifizierung
- `has_active_price` — aktiver `product_prices`-Eintrag
- `has_published_seo_page` — `seo_content_pages.status='published'`
- `has_funnel_tracking_mapping` — Proxy: published SEO-Page (TODO: spätere Tabelle `package_funnel_mappings`)

## Ampel
| Status | Regel |
|---|---|
| **red** | `!has_active_price` ODER `!has_published_seo_page` |
| **yellow** | `!has_funnel_tracking_mapping` ODER `product_count > 1` ODER (nur SEO-Draft, kein published) |
| **green** | alles vorhanden, exakt 1 Produkt |

## Info-only (NICHT in e2e_status)
- `funnel_traffic_events_7d`
- `funnel_traffic_distinct_strict_7d`

## auto_healable (deckt NIE Funnel/Traffic)
```
(active_price OR (1 product + tier confidence=high))
AND (seo_published OR seo_draft_exists)
AND product_count <= 1
```

## Heal-Matrix (fn_e2e_integrity_guard)
| Drift | Pfad |
|---|---|
| `seo_publish_drafts` | **AUTO** publish |
| `pricing_create` (1 Produkt + tier high) | **SAFE** — log pending_admin |
| `manual_pricing` (mehrdeutig) | **ALERT** admin_notifications |
| `manual_duplicate_product` | **ALERT** |
| `manual_seo_missing` (kein draft, kein published) | **ALERT** |
| `manual_funnel_mapping` | **SOFT-LOG only** (Code/Mapping-Entscheidung, kein Alert-Spam) |

## Master-Status
`platform_status = worst(pricing, funnel, seo_publish, e2e_pipeline)`.
`e2e_pipeline_status = red` ⇔ ≥1 Paket red **und** nicht auto_healable.

## Baseline v2 (2026-04-30, Live)
```
e2e_pipeline_status=green  red=0  yellow=0  green=29  alerts=0
```
(`platform_status=red` separat wegen Tracking-Completeness 0% in v_funnel_integrity_check — das ist Traffic-Qualität, nicht E2E-Readiness.)

## Komponenten
- View `public.v_package_e2e_integrity` (security_invoker)
- View `public.v_platform_integrity` mit `e2e_pipeline_status` + Counts
- RPC `public.fn_e2e_integrity_guard(p_dry_run)` — service_role only
- Cron `e2e-integrity-guard-hourly` (Min 17)
- CI `.github/workflows/e2e-integrity-guard.yml` (Min 23) + `scripts/e2e-integrity-check.mjs`

## Migration v1 → v2 (Architektur-Fix)
- v1 nutzte `events_7d > 0` als Funnel-Gate → jedes Paket ohne Live-Traffic war rot. **FALSCH**.
- v2: Mapping (published SEO-Page) als Readiness-Proxy. Traffic separat als Info-Spalte.
- v1-Alerts (29 false-positive `manual_funnel_mapping`) per UPDATE `is_read=true` abgeräumt.
