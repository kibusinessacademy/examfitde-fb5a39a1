---
name: Custom-Domain Prerequisite for External SEO Intelligence
description: Hard architecture constraint — no external SEO intelligence, attribution, or opportunity scoring (Semrush S2/S3, GSC, Bing WMT, Backlink-Profile, LLM-Citation-Measurement) is authoritative before canonical custom-domain migration off *.lovable.app.
type: constraint
---

## The Rule

> **No external SEO intelligence, attribution, or opportunity scoring is authoritative
> before canonical custom-domain migration off `*.lovable.app`.**

This applies to:
- Semrush S2 (persistence layer `growth_semrush_keyword_metrics`)
- Semrush S3 (Opportunity Score, adaptive E3e signal)
- Google Search Console (Property, Sitemap submission, Performance reports)
- Bing Webmaster Tools
- Backlink profile interpretation
- LLM-Citation / AI-Visibility measurement (Cron 138, `llm_visibility_probes`)
- Any future revenue-attribution that uses external organic data

## Why (S1 Recon 2026-05-18 evidence)

`examfitde.lovable.app` returns **0 organic keywords / 0 organic traffic** in Semrush across all 30+ databases probed. The Authority Score (52) is *pool inheritance* from the `lovable.app` SLD (anchored to unrelated terms like `casino`, `phishing`, `vpn`). External SEO tooling cannot distinguish ExamFit's signal from the noise of the shared subdomain pool — meaning:

- **Semrush** → blind to ExamFit content entirely
- **GSC** → registers the subdomain as part of `lovable.app`, brand-mixed reports
- **Backlink-Authority** → flows into the Lovable pool, not ExamFit's brand entity
- **LLM-Citations** → models cite `examfit.de` if they cite at all; subdomain is invisible
- **E3e Wirkungsmessung** → no ground truth to verify whether bridge promotions move rankings
- **Conversion-Attribution** → cannot tie organic → funnel → revenue without canonical host

## What this BLOCKS (hard gate)

1. **Phase S2** — building `growth_semrush_keyword_metrics`, `semrush-sync-keyword` edge function, or any opportunity-score view. Would persist synthetic / noise data and corrupt the SSOT.
2. **Phase S3** — Opportunity Score feeding into E3e bridge promotion. Mixing internal graph mutations with external signals that don't see the domain = false promotions.
3. **GSC Property setup** for `examfitde.lovable.app` (subdomain). Only `https://examfit.de/` (or chosen canonical) gets a property — after migration.
4. **LLM-Visibility baseline interpretation** as "real". Current Cron 138 runs are operational health checks only; not strategy input.

## What this DOES NOT block

- Internal SSOT graph work (E3d, E3e, Bridge-Layer) — operates on internal data, no external dependency.
- Read-only Semrush recon on **competitors** (Plakos, Ausbildungspark, Testhelden) — they have real domains, real data.
- Internal funnel/conversion analytics (`conversion_events`) — first-party data, domain-agnostic.
- Content production (Wave 1/2/3 SEO pages) — content can ship; just don't measure external lift yet.

## Unblock condition (Phase R1)

All of the following must be live + verified before lifting this constraint:

- [ ] Custom domain (e.g. `examfit.de`) connected + DNS resolves + SSL active
- [ ] Per-route HTML actually served (Cloudflare Pages or Vercel — Lovable Hosting SPA-fallback known-blocking, see `seo/hosting-spa-fallback-blocks-prerender-v1`)
- [ ] Canonical drift = 0 on sample of 5 routes (`scripts/seo/post-cutover-smoke.mjs`)
- [ ] GSC Property added + verified + sitemap submitted
- [ ] Bing WMT property added + sitemap submitted
- [ ] 1 Semrush re-probe after 14d showing ≥1 organic keyword for `examfit.de` (proves the domain enters the index pool)

Only after **all 6** ticks → S2 schema + persistence is meaningful.

## Audit / cross-refs

- S1 Recon report: `/mnt/documents/s1-semrush-recon-2026-05-18.md`
- Plakos/Ausbildungspark/Testhelden deep-dive: `/mnt/documents/s1-competitor-funnel-deepdive-2026-05-18.md`
- Hosting blocker: `mem://architektur/seo/hosting-spa-fallback-blocks-prerender-v1`
- Migration runbooks: `docs/runbooks/cloudflare-pages-migration.md` + `docs/runbooks/vercel-migration.md`
