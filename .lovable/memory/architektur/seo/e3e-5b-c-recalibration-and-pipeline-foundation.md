---
name: E3e.5b/c Cornerstone Recalibration + Pipeline Foundation
description: Score-Gewichte rebalanciert, s_anchor neu definiert; 2 job_types + Dispatch-RPC für Hero/Anchor-Enrichment registriert
type: feature
---

# E3e.5b — Score-Rekalibrierung v2

`v_cornerstone_blog_score` neu gewichtet:
- depth 0.25 · faq 0.15 · **quality 0.15** · **hero 0.15** · **anchor 0.15** · winner 0.05 · views 0.05 · perf 0.05
- **s_anchor v2**: `min(1.0, jsonb_array_length(internal_links_json) / 4)`. Alte Proxy `competency_id IS NOT NULL` hatte 0/256 Coverage → strukturell blockierend.

Cold-Start-Signale (winner/views/perf) gemeinsam noch 0.15 statt 0.30 — Cornerstone-Reife jetzt **vor** Traffic erreichbar.

## Baseline 2026-05-25 (post-recalibration)
- new_top = **0.5954** (vorher 0.4011), new_avg = 0.2041
- 0/256 ≥0.60, **25/256 ≥0.45** → nach hero+4 internal_links (Δ=0.30) clearen Top-30 die Schwelle.
- Re-snapshotted Top-30 mit neuen Gap-Dims geschrieben (alter Snapshot ersetzt).

# E3e.5c — Pipeline Foundation

## DB (geliefert)
- Storage-Bucket `public-assets` (public read, service_role write)
- ops_job_type_registry: `seo_blog_hero_generate`, `seo_blog_anchor_section_generate` (pool=seo, lane=growth, requires_package_id=false)
- 3 Audit-Verträge: `cornerstone_enrichment_dispatched`, `seo_blog_hero_generated`, `seo_blog_anchor_section_generated`
- RPC `admin_seo_cornerstone_enrich_dispatch(snapshot_id, dims, limit_n)` — admin-gated, idempotent über `correlation_id = cornerstone_enrich|<blog_id>|<dim>`, fan-out 1 Job/(blog × dim) nur wenn Dim in `gap_dimensions`. Audit Pflicht.

## NOCH offen (nächster Cut)
1. **Edge `seo-blog-hero-generate`** — claimed job → Gemini-Image → upload nach `public-assets/blog-heroes/<slug>.png` → UPDATE blog_articles.hero_image_url/alt → audit + job-finalize.
2. **Edge `seo-blog-anchor-section-generate`** — claimed job → 4–6 verwandte blogs aus selbem `source_curriculum_id` → internal_links_json schreiben → audit + finalize.
3. **seo-pool-runner Patch** — Routing per job_type (heute hart auf `seo-intent-page-generator`). Switch-Map: `seo_intent_page_generate` | `seo_blog_hero_generate` | `seo_blog_anchor_section_generate`.

Bis (1)+(2)+(3) deployed sind, schiebt der Dispatch Jobs in die Queue, die nicht abgearbeitet werden → kein Schaden (status=pending, kein Auto-Cron für Dispatch selbst).

## Human-Gate unverändert
Pillar-Flip `pillar_to_cornerstone_blog` bleibt OFF bis ≥1 Blog tatsächlich 0.60 reißt — und das passiert erst nach erfolgreicher Edge-Welle.
