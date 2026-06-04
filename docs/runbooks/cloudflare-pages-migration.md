# ExamFit → Cloudflare Pages Migration Runbook (Loop C3 Hosting Eval)

**Goal:** Per-Route Static HTML statt SPA-Fallback → Duplicate-Content beheben + LLM-Sichtbarkeit ermöglichen, mit minimalem Delta gegenüber dem aktuellen Lovable-Setup.

**Why CF Pages first** (vor Vercel-Fallback):
- `public/_headers` existiert bereits und wird von CF Pages nativ respektiert.
- `public/_routes.json` (neu in diesem Loop) steuert Function-Bypass — keine `vercel.json`-spezifische Logik nötig.
- Free-Tier reicht (unbegrenzte Requests/Bandbreite, 500 Builds/Monat).
- Cloudflare-DNS ist bereits aktiv → Origin-Switch ohne Provider-Wechsel.

**Backend bleibt:** Lovable Cloud / Supabase (DB, Auth, Edge Functions, Cron, Storage). Nur Frontend-Hosting wechselt.

---

## Vorher-Checks (alle ✅ vor Migration)

- [x] `public/_headers` (X-Robots-Tag-Tabelle)
- [x] `public/_routes.json` (Function-Bypass für statische Assets)
- [x] `scripts/seo/prerender.mjs` schreibt `dist/<route>/index.html` für SSOT-Routen UND **48 Intent-Pages** (`/kurse/<curriculum>/intent_<x>/<competency>`) — neu in diesem Loop
- [x] `RouteNoindex` mountet auf jeder SPA-Route (Failsafe falls `_headers` mal nicht greifen)
- [x] `index.html` enthält KEINEN statischen Canonical
- [x] LLM-Visibility-Baseline läuft (Cron Job 138)

```bash
# Lokal: per-route HTML aus dem Build verifizieren
npm run build
ls -la dist/kurse/rahmenlehrplan-bauzeichner/intent_typische_fehler/lf01-k03-kommunikation-im-team-gestalten/index.html
diff <(cat dist/index.html | head -20) <(cat dist/kurse/.../index.html | head -20)
# → soll DIFF zeigen (Title, Description, Canonical, JSON-LD pro Route)
```

---

## Schritt 1 — CF Pages Projekt anlegen (Preview-Build)

1. https://dash.cloudflare.com → Workers & Pages → Create → Pages → Connect to Git
2. Repo `examfit` auswählen, Branch z.B. `cf-pages-preview` oder `main`
3. Framework preset: **Vite** (auto-detected)
4. Build Command: `npm run build`
5. Build output directory: `dist`
6. Environment variables (1:1 aus Lovable `.env`):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `VITE_SUPABASE_PROJECT_ID`
   - `SUPABASE_URL` (gleicher Wert; vom prerender im CI gelesen)
   - `SUPABASE_PUBLISHABLE_KEY` (anon, gleicher Wert)
7. Node version: in Cloudflare Build env `NODE_VERSION=22` setzen (für `--experimental-strip-types`).

## Schritt 2 — Test-Deploy auf `*.pages.dev`

```bash
# Vergleich Lovable ↔ CF Pages für 3 Intent-URLs:
HOST=https://examfitde.lovable.app node scripts/seo/initial-html-smoke.mjs
HOST=https://examfit.pages.dev    node scripts/seo/initial-html-smoke.mjs
```

**Erwartung:**
- Lovable: ❌ alle 3 schlagen fehl (canonical drift = `https://berufos.com/`, h1 drift, kein Article-JSON-LD pro Route → SPA-Fallback bestätigt).
- CF Pages: ✅ alle 3 grün, intent-spezifischer H1, Title, Description, Canonical, Article-JSON-LD pro Route, Noindex-Header auf `/dashboard`.

## Schritt 3 — OG/Social-Crawler Smoke

```bash
# Twitter/Facebook-Crawler simulieren (kein JS):
curl -s -A "facebookexternalhit/1.1" https://examfit.pages.dev/kurse/<slug> | grep -E '(<title|og:|<h1|canonical)'
curl -s -A "Twitterbot/1.0"          https://examfit.pages.dev/kurse/<slug> | grep -E '(<title|og:|<h1|canonical)'
```

**Erwartung:** intent-spezifischer Title + og:title + og:description ohne JS-Hydration.

## Schritt 4 — Sitemap Smoke

```bash
curl -sI https://examfit.pages.dev/sitemap.xml | head -3   # 200, application/xml
curl -s  https://examfit.pages.dev/sitemap.xml | head -20  # sitemapindex
curl -s  https://ubdvvvsiryenhrfmqsvw.supabase.co/functions/v1/generate-sitemap?type=content | grep -c '<loc>'
# → Anzahl Intent-URLs in der content-Sub-Sitemap (nach Wave 2: 48)
```

## Schritt 5 — Vergleich gegen Lovable-Fallback dokumentieren

Akzeptanz-Tabelle (in `auto_heal_log` als `seo_hosting_eval_cf_pages` ablegen):

| Check                         | Lovable       | CF Pages      |
|-------------------------------|---------------|---------------|
| `/kurse/<slug>` HTTP 200      | ✓             | ✓             |
| Per-Route `<title>`           | ❌ identisch  | ✅ pro Route  |
| Per-Route `<meta description>`| ❌ identisch  | ✅ pro Route  |
| Per-Route canonical           | ❌ `/`        | ✅ exakt      |
| Per-Route `<h1>`              | ❌ leer       | ✅ pro Route  |
| Article + FAQ + Breadcrumb LD | ❌ fehlt      | ✅ vorhanden  |
| Noindex Header `/dashboard`   | ❌ fehlt      | ✅ X-Robots   |
| OG für Social-Crawler         | ❌ generisch  | ✅ pro Route  |

Wenn ≥7/8 ✅ → Domain-Migration planen (Schritt 6). Sonst → Vercel als Fallback (`docs/runbooks/vercel-migration.md`).

## Schritt 6 — Custom Domain umziehen (erst nach grünem Smoke)

1. CF Pages → Project → Custom domains → Add `berufos.com` + `berufos.com`
2. Da Cloudflare-DNS bereits aktiv ist: Records werden automatisch konfiguriert (CNAME → `<project>.pages.dev`, Cloudflare-proxied).
3. SSL: automatisch (Cloudflare Universal SSL).
4. Lovable Custom Domain entfernen **NACHDEM** CF Pages Live ist + 5 Min Smoke grün.

## Schritt 7 — Rollback-Plan

Falls Migration fehlschlägt:
1. CF Pages Custom Domain entfernen.
2. Cloudflare DNS-Records zurück auf Lovable IP `185.158.133.1` (A) bzw. `cname.lovable.app`.
3. Custom Domain in Lovable wieder verbinden.
4. SSL wird automatisch reissued.

`vercel.json`, `_headers`, `_routes.json` koexistieren konfliktfrei — alle bleiben im Repo.

---

## Was bleibt auf Lovable / Supabase?

- Backend: Supabase Cloud (unverändert)
- Edge Functions: Supabase (unverändert; `generate-sitemap` Function bleibt SSOT für sub-sitemaps)
- Cron Jobs: pg_cron (unverändert)
- Lovable AI Gateway (Tutor + Visibility-Probe) (unverändert)
- Lovable Editor: Code-Änderungen → Push GitHub → CF Pages auto-deploy

**Lovable bleibt der Code-Editor; Cloudflare Pages wird das Frontend-Hosting.**
