---
name: Hosting & SEO Authority Topology v1
description: Production-Topologie examfit.de → Cloudflare (DNS/CDN/WAF) → Vercel (App-Host) → Supabase/Lovable Cloud (Backend) → GitHub (SSOT) → Lovable (Builder). examfit.de ist die einzige SEO-autoritative Domain. Keine SEO/Tracking/Semrush/GSC-Entscheidung auf Basis von Plattform-Subdomains.
type: constraint
---

## Production Topology (verbindlich)

```
User / Google
   ↓
examfit.de / www.examfit.de        ← einzige SEO-autoritative Domain
   ↓
Cloudflare (DNS / CDN / WAF / Redirects)
   ↓
Vercel (Production Deployment, Per-Route Prerender)
   ↓
React App + Supabase + Edge Functions (Lovable Cloud)
   ↓
GitHub (SSOT für Code)
   ↓
Lovable (Builder / Editor / Iteration — NICHT Source of Truth, NICHT SEO-Anker)
```

## Harte Regeln

1. **Nur `examfit.de` zählt.** Keine SEO-, Tracking-, Semrush-, GSC-, Bing-WMT- oder LLM-Visibility-Entscheidung darf auf Basis einer Plattform-Subdomain (`*.lovable.app`, `*.vercel.app`, Preview-URLs) getroffen werden.
2. **Cloudflare ist DNS/CDN/WAF-Layer**, nicht zwingend App-Host. Per-Route-HTML wird von Vercel ausgeliefert.
3. **Lovable = Builder.** Push → GitHub → Vercel Auto-Deploy. Lovable-Hosting wird nicht als Produktions-Anker verwendet (SPA-Fallback bekannt-blockend, siehe `seo/hosting-spa-fallback-blocks-prerender-v1`).
4. **Preview/Staging-Domains MÜSSEN** `noindex,nofollow` + `X-Robots-Tag: noindex` + canonical → `https://examfit.de/...` setzen. Gilt für `*.lovable.app`, `*.vercel.app`, `id-preview--*.lovable.app`.
5. **`www.examfit.de` → `examfit.de` 301** (apex canonical). Konfiguriert in `vercel.json` redirects.

## Konsequenzen für laufende Cuts

- **S2/S3 Semrush-Persistence**: bleibt eingefroren bis Cutover + 14d Re-Probe (siehe `constraints/custom-domain-prerequisite-for-seo-intelligence-v1`).
- **GSC/Bing WMT Property**: nur für `https://examfit.de/` (apex) anlegen, NIE für `*.lovable.app` oder `*.vercel.app`.
- **LLM-Visibility (Cron 138)**: Probes weiterlaufen lassen als Baseline; Interpretation als "real" erst NACH Cutover.
- **Conversion-/Funnel-Attribution**: First-Party-Events bleiben SSOT (domain-agnostisch). Externe Organic-Attribution erst nach Cutover.
- **SEO Wave-Live-Enqueue**: keine externe Wirkungsmessung vor Cutover. Interner Graph (E3d/E3e) bleibt unblockiert.

## Cutover-Pfad

Runbook: `docs/runbooks/vercel-migration.md`. Verify: `scripts/seo/post-cutover-smoke.mjs`. Backend bleibt 1:1 auf Supabase/Lovable Cloud — nur Frontend-Host wechselt.

## Audit / cross-refs

- `constraints/custom-domain-prerequisite-for-seo-intelligence-v1` — S2/S3-Gate
- `architektur/seo/hosting-spa-fallback-blocks-prerender-v1` — Warum nicht Lovable-Host
- `architektur/seo/production-architecture-v2-vercel-prerender-llm-visibility` — Vercel-Pack
- `docs/runbooks/vercel-migration.md` — Schritt-für-Schritt
- `vercel.json` — Headers, Redirects, Rewrites
