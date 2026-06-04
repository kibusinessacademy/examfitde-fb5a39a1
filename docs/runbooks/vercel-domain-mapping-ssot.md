# Vercel Domain Mapping SSOT — berufos.com vs. examfit.de

**Status:** Hardcut 2026-05-25 — `berufos.com` ist alleinige SEO-Authority.
**SSOT:** `src/lib/seo/authorityHost.ts`, `mem://constraints/hosting-and-seo-authority-topology-v1`.

## Soll-Zustand (Vercel Project Settings → Domains)

| Domain | Rolle | Verhalten | Production? |
|---|---|---|---|
| `berufos.com` | **Primary / Authority** | Serve build output (inkl. Prerender-HTMLs) | ✅ Production |
| `www.berufos.com` | Authority-Alias | 308 → `https://berufos.com$1` | ✅ Production |
| `examfit.de` | **Legacy Redirect** | 308 → `https://berufos.com$1` | ❌ Nur Redirect |
| `www.examfit.de` | Legacy Redirect | 308 → `https://berufos.com$1` | ❌ Nur Redirect |
| `examfitde.lovable.app` | Lovable-Publish | noindex, kein SEO-Traffic | ❌ |
| `*.vercel.app` | Preview | noindex | ❌ |

## Failure-Modi (genau diese suchen, wenn Drift)

1. **`berufos.com` hängt am alten Project ohne Prerender-Plugin**
   → liefert SPA-Shell (~20 KB) statt per-Route-HTML.
   → Fix: Domain auf das Project umziehen, das `vite.config.ts` mit `seoPrerenderPlugin` baut.

2. **`berufos.com` ist Alias eines alten Deployments** (nicht "Production")
   → neuer Build erzeugt neuen Deployment, aber Domain bleibt am alten.
   → Fix: In Vercel → Project → Domains → `berufos.com` → "Edit" → assign to Production.

3. **`examfit.de` zeigt eigene Inhalte** statt zu redirecten
   → Brand-Split, SEO-Leak.
   → Fix: Entweder als Redirect-Domain konfigurieren (Vercel → Domains → Redirect to `berufos.com`),
     oder in `vercel.json` einen Host-basierten Redirect ergänzen.

4. **Cloudflare-Proxy sitzt vor Vercel**
   → `/sitemaps/*` Rewrites greifen nie, weil CF vorher 404 liefert.
   → Fix: CF DNS-only ODER CF Page Rule `/sitemaps/*` → Supabase Edge Function.

## Live-Check

```bash
node scripts/seo/vercel-domain-mapping-check.mjs
```

Gibt für jede Domain HTTP-Status, Body-Size, `x-vercel-id`, `cf-ray`,
Title und ein verdict ("authority ok" / "redirect ok" / "drift").
