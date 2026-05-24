---
name: Trigger-Gate 7-Day Stability Reporting
description: SPA-Fallback-Fix in vercel.json + korrigierte Smoke-Routen + tägliches 7d-Stabilitätsreport via GH Actions
type: feature
---

# Trigger-Gate Stability v1

## Fixes (2026-05-24)

- `vercel.json` rewrites: Negative-Lookahead durch path-to-regexp `:path*` ersetzt (4 explizite Rewrites: api/assets/sitemaps Pass-through + Catch-all → /index.html). Behebt 4×404 für nicht-prerenderte Routen (/berufe, /berufe/:slug, /aevo-pruefungsvorbereitung, /fiae-pruefungsvorbereitung).
- `scripts/seo/route-html-verify.mjs` + `CutoverPanel.tsx` DEFAULT_ROUTES: `/aevo-pruefung` → `/aevo-pruefungsvorbereitung`, `/fiae-pruefung` → `/fiae-pruefungsvorbereitung` (existierten nie als Route).

## 7-Tage-Stability

- `scripts/seo/stability-7d-report.mjs`: aggregiert `post-deploy-go-status.yml` Runs der letzten 168h via GitHub-API + Artifact-Naming (`post-deploy-go-status-{GO|BLOCKED}-…`). Verdict GREEN ≥99% / AMBER ≥95% / RED <95%.
- `.github/workflows/seo-stability-7d-report.yml`: schedule cron `30 6 * * *` (täglich 06:30 UTC) + workflow_dispatch (`window_hours` override). Auto-Issue bei RED.

## Anti-Drift

- Smoke-Default-Routen müssen mit `seoRoutes`-SSOT (`src/content/seoRoutes.ts`) übereinstimmen — entweder `live` (prerendered) oder `stub` mit funktionierendem SPA-Fallback.
- Niemals `cleanUrls:true` + Negative-Lookahead-Rewrites kombinieren — Vercel 404t für nicht-existierende Pfade vor Rewrite.
