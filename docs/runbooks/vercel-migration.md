# ExamFit → Vercel Migration Runbook

**Goal:** Per-Route Static HTML statt SPA-Fallback → Duplicate Content beheben + LLM-Sichtbarkeit ermöglichen.

**Backend bleibt:** Lovable Cloud / Supabase (DB, Auth, Edge Functions, Storage). Nur Frontend-Hosting wechselt.

---

## Vorher-Checks

- [x] `vercel.json` im Repo-Root vorhanden
- [x] `scripts/seo/run-prerender.mjs` schreibt `dist/<route>/index.html` (war bereits ready, Lovable Hosting hat es nur ignoriert)
- [x] `RouteNoindex` mountet auf jeder Route
- [x] `index.html` enthält KEINEN statischen Canonical (würde sonst Per-Route-Prerender überschreiben)
- [x] LLM-Visibility-Baseline läuft (Cron Job 138, weekly Monday 04:00 UTC) — **vor Migration mind. eine Probe laufen lassen**

---

## Schritt 1 — Vercel-Projekt anlegen

1. https://vercel.com → New Project → Import GitHub Repo `examfit`
2. Framework auto-detected: **Vite**
3. Build Command: `npm run build` (lässt `seoPrerenderPlugin` automatisch laufen)
4. Output Directory: `dist`
5. Install Command: `npm install`
6. Environment Variables (aus Lovable `.env` 1:1 übernehmen):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `VITE_SUPABASE_PROJECT_ID`

## Schritt 2 — Test-Deploy auf `*.vercel.app`

```bash
# Test-URLs nach erstem Deploy:
curl -s https://examfit.vercel.app/aevo-pruefung | grep -E '<title|canonical' | head -5
curl -s https://examfit.vercel.app/fiae-pruefung | grep -E '<title|canonical' | head -5
```

**Erwartung:** Unterschiedliche `<title>` und canonical pro Route — nicht mehr identisch.

## Schritt 3 — Custom Domain umziehen

1. In Vercel: Project → Settings → Domains → Add `berufos.com` + `berufos.com`
2. DNS bei Cloudflare:
   - `berufos.com` A → `76.76.21.21` (Vercel)  *(oder CNAME-Variante laut Vercel-Dialog)*
   - `www` CNAME → `cname.vercel-dns.com`
3. SSL: Vercel provisioniert automatisch (Let's Encrypt)
4. Lovable: Custom Domain in Project Settings → Domains entfernen, **NACHDEM** Vercel grün ist

## Schritt 4 — Verifikation

```bash
# Per-Route-HTML
diff <(curl -s https://berufos.com/) <(curl -s https://berufos.com/aevo-pruefung) | head
# → soll DIFF zeigen, nicht identisch

# X-Robots-Tag auf geschützten Routen
curl -sI https://berufos.com/dashboard | grep -i x-robots
# → "X-Robots-Tag: noindex, nofollow, noarchive"

# Sitemap erreichbar
curl -sI https://berufos.com/sitemap.xml | head -3

# LLM-Visibility nach 1 Woche neu prüfen → erwarte Mention/Citation-Anstieg
```

## Schritt 5 — Lighthouse / PageSpeed Baseline

```bash
npx lighthouse https://berufos.com/aevo-pruefung --output=json --output-path=./baseline-aevo.json --chrome-flags="--headless"
```

Oder PSI-API in CI: `.github/workflows/lighthouse-ci.yml` (existiert bereits).

---

## Rollback-Plan

Falls Migration scheitert:
1. DNS bei Cloudflare zurück auf `185.158.133.1` (Lovable IP)
2. Custom Domain in Lovable wieder verbinden (Project Settings → Domains)
3. SSL re-issued automatisch nach DNS-Propagation

`vercel.json` und `_headers` koexistieren konfliktfrei — beide bleiben im Repo.

---

## Was bleibt auf Lovable?

- Backend: Supabase Cloud (unverändert)
- Edge Functions: Supabase (unverändert)
- Cron Jobs: pg_cron (unverändert)
- Lovable AI Gateway: für Tutor + Visibility-Probe (unverändert)
- Lovable Editor: für Code-Änderungen → push in GitHub → Vercel auto-deploy

**Lovable bleibt der Code-Editor; Vercel wird nur das Hosting.**
