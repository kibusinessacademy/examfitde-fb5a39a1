# Vercel Domain Mapping SSOT — berufos.com (single authority)

**Status:** Sunset examfit.de 2026-06-04 — `berufos.com` ist die einzige Domain.
**SSOT:** `src/lib/seo/authorityHost.ts`, `src/lib/berufos/brand.ts`,
`mem://constraints/hosting-and-seo-authority-topology-v1`.

## Soll-Zustand (Vercel Project Settings → Domains)

| Domain | Rolle | Verhalten | Production? |
|---|---|---|---|
| `berufos.com` | **Primary / Authority** | Serve build output (inkl. Prerender-HTMLs) | ✅ Production |
| `www.berufos.com` | Authority-Alias | 308 → `https://berufos.com$1` | ✅ Production |
| `examfitde.lovable.app` | Lovable-Publish | noindex, kein SEO-Traffic | ❌ |
| `*.vercel.app` | Preview | noindex | ❌ |

> **examfit.de wird nicht mehr betrieben.** Domain läuft aus, keine Redirects,
> keine DNS-Pflege, keine Vercel-Zuordnung. Alle Inhalte leben ausschließlich
> auf `berufos.com`. Wenn alte Inbound-Links auftauchen, ignorieren — die
> Domain antwortet schlicht nicht mehr.

## DNS (Apex + www → Vercel)

```
berufos.com         A     216.198.79.1
www.berufos.com     CNAME cname.vercel-dns.com.
```

Kein Cloudflare-Proxy davor (`DNS only` falls noch in Cloudflare verwaltet).
Sonst greifen `/sitemaps/*` Rewrites nicht.

## Failure-Modi (genau diese suchen, wenn Drift)

1. **`berufos.com` hängt am alten Project ohne Prerender-Plugin**
   → liefert SPA-Shell (~20 KB) statt per-Route-HTML.
   → Fix: Domain auf das Project umziehen, das `vite.config.ts` mit `seoPrerenderPlugin` baut.

2. **`berufos.com` ist Alias eines alten Deployments** (nicht "Production")
   → neuer Build erzeugt neuen Deployment, aber Domain bleibt am alten.
   → Fix: In Vercel → Project → Domains → `berufos.com` → "Edit" → assign to Production.

3. **Cloudflare-Proxy sitzt vor Vercel**
   → `/sitemaps/*` Rewrites greifen nie, weil CF vorher 404 liefert.
   → Fix: CF DNS-only ODER CF Page Rule `/sitemaps/*` → Supabase Edge Function.

## Live-Check

```bash
node scripts/seo/vercel-domain-mapping-check.mjs
node scripts/seo/verify-authority-live.mjs
```

Gibt für jede Authority-Domain HTTP-Status, Body-Size, `x-vercel-id`,
Title und ein verdict ("authority ok" / "drift").
