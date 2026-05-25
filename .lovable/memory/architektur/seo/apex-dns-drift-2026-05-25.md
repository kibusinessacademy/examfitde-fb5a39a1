---
name: Apex DNS Drift 2026-05-25 (examfit.de)
description: Live-Befund vom 25.05.2026 16:04 UTC — Apex examfit.de zeigt A 185.158.133.1 (Lovable-Host alt) statt Vercel. www korrekt auf Vercel-CNAME. Cloudflare ist DNS-Owner+Proxy (cf-ray) und reicht 403 vom toten Lovable-Origin durch. Fix: Cloudflare A `@` → 76.76.21.21 ODER CNAME `@` → cname.vercel-dns.com (Flattening). Verify via scripts/seo/apex-cutover-verify.mjs.
type: feature
---

## Befund (DoH via 1.1.1.1, curl)

| Host | DNS | Origin | HTTP |
|------|-----|--------|------|
| `examfit.de` | A `185.158.133.1` | Lovable Hosting (alt) | 403 (server: cloudflare, cf-ray gesetzt) |
| `www.examfit.de` | CNAME `0c4af80fffb239e9.vercel-dns-017.com.` | Vercel | 308 → `https://examfit.de/` |
| NS | `albert/june.ns.cloudflare.com` | Cloudflare DNS-Owner | — |

## Root Cause

Apex-A-Record am Cloudflare-DNS wurde nie vom alten Lovable-Host (`185.158.133.1`) auf Vercel umgezogen. www läuft korrekt, redirected zum Apex, Apex landet im toten Lovable-Origin → 403 Forbidden für alle User auf `examfit.de`.

## Fix (DNS-only, in Cloudflare-Dashboard)

Variante A (klassisch, getestet):
```
Type: A,  Name: @,  Content: 76.76.21.21,  Proxy: 🟠 Proxied,  TTL: Auto
```

Variante B (sauber, CNAME-Flattening am Apex):
```
Type: CNAME,  Name: @,  Target: cname.vercel-dns.com,  Proxy: 🟠 Proxied
```

In Vercel → Project → Settings → Domains muss `examfit.de` als Domain stehen, „Valid Configuration". Bei Verify-Fail TXT `_vercel` aus Vercel UI nachsetzen.

Cloudflare SSL/TLS muss auf **Full (strict)** stehen (sonst Redirect-Loop mit Vercel HTTPS).

## Verify

```bash
node scripts/seo/apex-cutover-verify.mjs
```

Prüft 8 Checks: DoH-A, kein Lovable-IP, www-CNAME, Apex 200, cf-ray, x-vercel-id, www→apex 308, /aevo-pruefung 200. Exit 0 = grün.

## Cross-refs

- `mem://constraints/hosting-and-seo-authority-topology-v1` — SSOT-Topologie
- `mem://architektur/seo/hosting-spa-fallback-blocks-prerender-v1` — Warum NICHT zurück auf Lovable
- `docs/runbooks/vercel-migration.md` — Vollständiger Cutover-Pfad
- `vercel.json` — www→apex 301 + protected-paths X-Robots-Tag
