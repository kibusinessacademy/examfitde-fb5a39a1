---
name: SEO Canonical-Parity + Buy-CTA A/B + Funnel-Dropoff-Heatmap v1
description: seo_content_pages.last_canonical_check + Cron seo-canonical-parity-hourly demoted Orphans automatisch. Buy-CTA A/B (experiments.buy_cta_persona_v1) wird von ProductPersonaPage via useBuyCtaExperiment in primaryLabel injiziert + experiment_variant in cta_click metadata. v_funnel_dropoff_per_lead_magnet + admin_get_funnel_dropoff_heatmap zeigen DISTINCT-Visitor-Dropoffs pro (package_id, persona) im Growth-Dashboard.
type: feature
---

## SEO Canonical Parity (SSOT)
- `seo_content_pages.last_canonical_check` + `canonical_check_status` Spalten
- View `v_seo_canonical_drift` (severity: OK / NEVER_CHECKED / STALE_24H / ORPHAN_PUBLISHED / DRAFT_BUT_PKG_LIVE)
- RPC `admin_seo_canonical_parity_run` (admin-gated; Cron läuft als service_role) — demoted ORPHAN_PUBLISHED → draft, audit in `auto_heal_log` (action_type='seo_canonical_parity_run')
- RPC `admin_seo_canonical_drift_summary` (gegated read)
- Cron `seo-canonical-parity-hourly` (cron-id 166, `17 * * * *`)
- UI: `SeoCanonicalParityCard` im Growth/Audit-Tab

## Buy-CTA A/B
- `experiments.buy_cta_persona_v1` (type=frontend, status=running, allocation 34/33/33, kpi=checkout_start_rate)
- Variants: A=Control "Jetzt Prüfung trainieren", B=Outcome "Bestehensgarantie sichern", C=Time "In 30 Tagen prüfungsbereit"
- Hook `useBuyCtaExperiment()` → `useExperimentVariant(experiment.id)` (sticky via experiment-api / localStorage)
- ProductPersonaPage merged variant in `mergedProduct.ctas.primaryLabel` (überschreibt overlay.primaryCta wenn aktiv)
- `cta_click`-Event metadata enthält jetzt `experiment_id|experiment_variant|cta_label`

## Funnel-Dropoff-Heatmap
- View `v_funnel_dropoff_per_lead_magnet` — DISTINCT visitor_keys (anonymous_id|user_id|session_id) pro 8 Steps × 30 Tage Window
- RPC `admin_get_funnel_dropoff_heatmap(p_days int)` — berechnet 6 Drop-off Prozente + overall_conversion
- UI: `FunnelDropoffHeatmapCard` im Growth/Dashboard mit Heat-Color (≤25 grün, 25–50 gelb, 50–75 orange, ≥75 rot)
