---
name: SEO Cloudflare Pages Eval Pack v1 (Loop C3 Hosting)
description: Per-Route HTML für seo_content_pages (intent landing) im Build, _routes.json, Smoke-Skript, CF Pages Runbook. Lovable Hosting bleibt blind, CF Pages/Vercel servieren echtes Per-Route HTML.
type: feature
---

## Was ändert sich
- `scripts/seo/load-dynamic-routes.mjs`: neue `loadIntentRoutes()` lädt published `seo_content_pages` (intent_template not null), erzeugt `kind:'intent'` Route-Objekte mit title/description/sections (h1, intro, pain_points, expert_tip, breadcrumbs, internal_links, cta), faq_json, JSON-LD (Article + BreadcrumbList + FAQPage). `loadDynamicRoutes()` returned jetzt `{blog, products, intents}`.
- `scripts/seo/prerender.mjs`:
  - `renderAboveTheFold`: neuer `kind === 'intent'` Branch (Breadcrumb-Nav, h1, intro, pain_points, expert_tip, FAQ-Details, internal-links, siblings, CTA).
  - `validate`: intent-Branch (title≥20, desc 70-165, h1+jsonLd Pflicht).
  - `runSeoPrerender`: intent-Routes werden **geschrieben** (nicht nur Sitemap), Validation + postValidate inkludiert.
  - `postValidateHtml`: Soft-Floor 600 Zeichen für intent (statt 1200) — Body ist kompakter als SSOT-Hubs.
- `public/_routes.json`: Cloudflare Pages Bypass-Liste (assets, sitemaps, robots, llms, favicons, indexnow). Alle anderen Pfade fallen auf static dist/<path>/index.html oder SPA `/index.html`.
- `scripts/seo/initial-html-smoke.mjs`: prüft 3 (env `SAMPLE`) Intent-URLs gegen `HOST` — title/description/canonical/h1 vs DB, Article-JSON-LD, plus sitemap + Noindex-Header `/dashboard`.
- `docs/runbooks/cloudflare-pages-migration.md`: Schritt-für-Schritt CF Pages Setup + Akzeptanz-Tabelle Lovable vs CF Pages + Rollback.

## Build-Beweis (lokal, 2026-05-14)
```
[seo-dynamic] loaded 51 intent routes
[seo-prerender] Wrote 16 SSOT + 51 intent route HTMLs; sitemap also includes 237 blog + 190 product URLs
```
Stichprobe `dist/kurse/.../index.html`: korrekter `<title>`, `<link rel=canonical>`, `<h1>`, Article+BreadcrumbList JSON-LD vorhanden.

## Hosting-Verhalten
- **Lovable**: ignoriert dist/<route>/index.html → SPA-Fallback liefert weiter root index.html → Smoke-Skript schlägt fehl (canonical drift `/`, h1 leer). Kein Regress, weil Status quo.
- **Cloudflare Pages / Vercel**: liefern dist/<route>/index.html verbatim → Smoke grün → Indexierung + Social-Crawler bekommen intent-spezifische Snippets.

## Use
1. Auf CF Pages deployen (Runbook Schritt 1-2, ENV inkl. `SUPABASE_URL`+`SUPABASE_PUBLISHABLE_KEY` für Build-Zeit-Loader).
2. `HOST=https://examfit.pages.dev node scripts/seo/initial-html-smoke.mjs` → Verdict.
3. Nur bei ≥7/8 Akzeptanz-Punkten Domain-Migration; sonst Vercel-Runbook (`docs/runbooks/vercel-migration.md`).

## Bleibt offen (nicht in diesem Loop)
- LLM-Visibility Re-Probe nach Migration (Cron 138).
- Lighthouse-Baseline pre/post pro Intent-URL.
- Auto-Heal-Log Tag `seo_hosting_eval_cf_pages` einsetzen, sobald CF Pages Preview live ist.
