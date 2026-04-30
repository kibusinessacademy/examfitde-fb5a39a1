---
name: SEO Production Architecture v2 — Per-Route Prerender + Noindex Guard + LLM Visibility
description: Hosting-Migration zu Vercel löst SPA-Fallback Duplicate-Content. Quick-Wins (RouteNoindex, Canonical-Drift-Fix, X-Robots-Tag) + LLM-Visibility-Measurement (10 Queries × 3 Modelle, weekly Cron, UI-Card im /admin/growth Tab "Audit").
type: feature
---

## Root Cause (bekannt)
Lovable Hosting liefert `index.html` als Fallback für ALLE SPA-Routen → identisches HTML, identischer canonical=https://examfit.de/, kein Per-Route-Prerender möglich (siehe `seo/hosting-spa-fallback-blocks-prerender-v1`).

## Quick-Wins (deployed, hostingunabhängig)
- `src/components/seo/RouteNoindex.tsx`: pfadbasiert `noindex,nofollow` auf `/dashboard`, `/account`, `/checkout`, `/auth`, `/admin*`, `/org/*`, `/exam-trainer`, etc. + entfernt Canonical/hreflang auf diesen Pfaden.
- `index.html`: statischer `<link rel=canonical href=https://examfit.de/>` ENTFERNT — sonst leakt er auf jede SPA-Route.
- `public/robots.txt`: Disallow geschützte Routen für `*`, Googlebot, Bingbot.
- `public/_headers`: X-Robots-Tag noindex (greift auf Vercel/CF Pages, nicht auf Lovable).

## LLM-Visibility-Measurement
- Tabellen: `llm_visibility_queries` (10 Baseline-Queries seeded), `llm_visibility_probes`.
- View: `v_llm_visibility_score` (7-Tage-Score pro Modell: Brand-Mention-Rate, Citation-Rate, avg visibility_score 0..1).
- Edge Function: `llm-visibility-probe` — pingt 3 Modelle (gemini-2.5-flash, gemini-2.5-pro, gpt-5-mini) via Lovable AI Gateway, scored Brand-Mention + URL-Citation.
- Cron Job 138: `0 4 * * 1` (Mo 04:00 UTC).
- UI: `LlmVisibilityCard` im `/admin/growth` Tab "Audit" (über SEOAuditManager).
- **Use:** Baseline VOR Vercel-Migration messen, dann Lift verifizieren.

## Vercel-Migration-Pack (bereit)
- `vercel.json`: framework=vite, output=dist, SPA-Rewrite ohne dist/<route>/index.html zu überfahren, X-Robots-Tag-Headers, redirects.
- `docs/runbooks/vercel-migration.md`: Schritt-für-Schritt + Rollback-Plan.
- Backend bleibt komplett auf Supabase/Lovable Cloud — nur Frontend-Hosting wechselt.

## Verifikations-Befehle
```bash
diff <(curl -s https://examfit.de/) <(curl -s https://examfit.de/aevo-pruefung)  # nach Migration: DIFF
curl -sI https://examfit.de/dashboard | grep x-robots  # nach Migration: noindex
```
