---
name: E2E Pipeline Integrity Guard v1
description: v_package_e2e_integrity (per Paket Produkt→Pricing→SEO→Funnel + heal_flags + auto_healable). v_platform_integrity um e2e_pipeline_status erweitert. fn_e2e_integrity_guard(dry_run) heilt SEO-Drafts, klassifiziert sichere Pricing-Lücken, alerts nur Rest. Cron e2e-integrity-guard-hourly (Min 17). CI scripts/e2e-integrity-check.mjs.
type: feature
---

# E2E Pipeline Integrity Guard v1 — 2026-04-30

## Architektur
```
cron 17 * * * *  →  fn_e2e_integrity_guard(false)
                       ├─ scan v_package_e2e_integrity (e2e_status<>'green')
                       ├─ AUTO-HEAL: SEO drafts → published
                       ├─ CLASSIFY: pricing_create (1 product + tier high) → log only
                       ├─ ALERT: manual_pricing | manual_duplicate_product
                       │         | manual_seo_missing | manual_funnel_mapping
                       │         → admin_notifications (category='e2e_integrity')
                       └─ summary → auto_heal_log action_type='e2e_guard_run_summary'

CI (Min 23, 6min nach DB-Cron) → scripts/e2e-integrity-check.mjs
   → fail nur bei e2e_pipeline_status='red' (= manuelle Fälle nach Auto-Heal)
```

## Heal-Matrix
| Drift | Pfad |
|---|---|
| `seo_publish_drafts` (drafts vorhanden) | **AUTO** publish |
| `pricing_create` (1 Produkt + tier confidence=high) | **SAFE** — log pending_admin (admin tool wendet an) |
| `manual_pricing` (mehrdeutig / unknown tier) | **ALERT** |
| `manual_duplicate_product` (>1 Produkt/Cert) | **ALERT** |
| `manual_seo_missing` (kein draft, kein published) | **ALERT** |
| `manual_funnel_mapping` (0 Events 7d mit pkg_id) | **ALERT** (Code/Mapping-Entscheidung) |

## Master-Status
`platform_status = worst(pricing, funnel, seo_publish, e2e_pipeline)`.
`e2e_pipeline_status = red` ⇔ ≥1 Paket red **und** nicht auto_healable.

## Baseline (2026-04-30, Live-Run)
```
platform=red  e2e=red  red=29  yellow=0  green=16  auto_healable=0  manual=29
seo_healed=0  pricing_safe=0  alerts=29
```
Alle 29 manuelle Alerts = `manual_funnel_mapping` (Live-Traffic-Leak, bekannt — Tracking-SSOT-Konsolidierung in 24h-Beobachtung).

## Komponenten
- View `public.v_package_e2e_integrity` (security_invoker, authenticated/service_role)
- View `public.v_platform_integrity` erweitert: `e2e_pipeline_status`, `e2e_red_count`, `e2e_yellow_count`, `e2e_green_count`, `e2e_auto_healable_count`, `e2e_manual_count`
- RPC `public.fn_e2e_integrity_guard(p_dry_run boolean)` → service_role only
- Cron `e2e-integrity-guard-hourly` (DB pg_cron, Min 17)
- CI `.github/workflows/e2e-integrity-guard.yml` (Min 23, +PR/push migrations)
- Smoke `scripts/e2e-integrity-check.mjs`

## Regel
Du musst nicht überwachen — Alert nur bei nicht-heilbaren Fällen oder wenn nach Auto-Heal weiterhin red.
