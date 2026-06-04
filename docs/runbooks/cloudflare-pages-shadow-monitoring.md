# Shadow Monitoring 24–48h — Cloudflare Pages

**Status:** active  
**Started:** 2026-05-14  
**Target:** examfit.pages.dev (Shadow), Domain-Switch erst nach grünem Lauf.

## Hard-Checks (alle 12h wiederholen)

| # | Check | Tool / Befehl | Pass-Kriterium |
|---|---|---|---|
| 1 | Build-Stabilität | CF Pages Dashboard → Deployments | letzte 3 Builds = Success |
| 2 | Asset-Caching | `curl -I https://examfit.pages.dev/assets/<hash>.js` | `cache-control: public, max-age=31536000, immutable` |
| 3 | RPC-Ladezeit | DevTools Network /supabase | p95 < 600ms |
| 4 | Hydration-Errors | DevTools Console (3 Routen) | 0 errors / 0 warnings |
| 5 | Canonical-Konsistenz | `node scripts/seo/initial-html-smoke.mjs` (HOST=pages.dev) | 51/51 routes canonical match |
| 6 | Sitemap reachability | `curl -sf https://examfit.pages.dev/sitemap.xml \| head -c 200` | 200 + valid XML |
| 7 | Mobile Rendering | CF Pages Preview @ 411×763 (Pixel 7) | LCP < 2.5s, CLS < 0.1 |
| 8 | Core Web Vitals | PageSpeed Insights (3 sample URLs) | LCP < 2.5, INP < 200, CLS < 0.1 |

## Social-Crawler Smoke (einmalig)

- [ ] LinkedIn Post Inspector: https://www.linkedin.com/post-inspector/
- [ ] Facebook Sharing Debugger: https://developers.facebook.com/tools/debug/
- [ ] Google Rich Results Test: https://search.google.com/test/rich-results
- [ ] JS-disabled smoke: `curl -s https://examfit.pages.dev/kurse/<slug> | grep -c '<h1'` → ≥1

## 404-Härtung (jetzt deployed)

- `public/_routes.json` — exclude pattern für statische Asset-Pfade (verhindert SPA-Fallback auf prerendered HTML)
- `public/404.html` — true 404 mit `noindex,follow`, wird von CF Pages für unbekannte excluded Pfade ausgeliefert
- React Router `NotFound` Route — bleibt für app-side unknown paths (200 + meta noindex)

## Go/No-Go für Domain-Migration

**GO** wenn:
- alle 8 Hard-Checks an 2 aufeinanderfolgenden 12h-Slots grün
- 0 Hydration-Errors über 24h
- Social-Crawler Smoke 4/4 grün

**NO-GO** wenn:
- Build-Failure ohne Auto-Recovery
- Canonical-Drift > 0
- LCP regression > 20% vs Lovable Hosting baseline

## Audit

Nach jedem 12h-Slot:
```sql
INSERT INTO auto_heal_log(action_type, target_type, result_status, metadata)
VALUES ('seo_hosting_shadow_slot', 'system', 'pass'|'fail', '{...}'::jsonb);
```

## Nächste Schritte nach GO

1. DNS Cutover gemäß `docs/runbooks/cloudflare-pages-migration.md`
2. Canonical Final-Check (alle Routes auf `https://berufos.com`)
3. GSC Property re-validate + Sitemap resubmit
4. Indexing-Watch 7 Tage
5. Wave 3 freigeben
