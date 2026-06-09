---
name: ProductScope BerufOS/VibeOS Separation v1
description: Hard separation of BerufOS/ExamFit and VibeOS/AvatarOS in production build via ProductScope + host allowlist + bundle guard
type: feature
---

# ProductScope — BerufOS/VibeOS Hard Separation

Status: live, regression-guarded.

## SSOT-Files

- `src/lib/product-scope.ts` — `currentScope()`, `isVibeOSAllowed(host)` Host-Allowlist.
- `src/routes/AppRoutes.tsx` — `/vibeos`, `/avatar`, `/runtime`, `/apps/new` host-gated; auf BerufOS-Hosts → `NotFound`.
- `src/__tests__/product-scope.test.ts` — Vitest-Suite (Host-Matrix + Scope-Resolver).
- `scripts/guards/vibeos-public-bundle-guard.mjs` — Eager-Guard: grep `dist/index.html` + initial Entry-Chunks auf `VibeOS|AvatarOS|RuntimeIdentifier`. Admin-Chunks (auth-gated) erlaubt.
- `scripts/guards/post-deploy-vibeos-separation.mjs` — Curl-basierte Post-Deploy-Verifikation pro Host (Retry+Backoff+Timeout).
- `.github/workflows/post-deploy-vibeos-separation.yml` — automatisch nach Vercel/Cloudflare Deploy.

## Regeln (hart)

- `VibeOSLandingPage.tsx` ist **gelöscht** — nicht wiederherstellen.
- Verbotene VibeOS-Public-Routen auf BerufOS-Host liefern `NotFound`, NICHT Redirect auf `/`.
- VibeOS-Identifier dürfen NICHT in `dist/index.html` oder im initial geladenen Entry-Chunk vorkommen.
- Admin-Runtime-Module bleiben auth-gated im Admin-Scope erlaubt (Lazy-Chunk hinter Auth).
- Neuer öffentlicher Code in BerufOS-Scope darf VibeOS-Surfaces NICHT referenzieren.

## CI-Enforcement

- Pre-build: `vibeos-public-bundle-guard.mjs` (in `release-candidate-checklist.yml`).
- Post-deploy: `post-deploy-vibeos-separation.mjs` für `berufos.com`, `www.berufos.com`.

## Warum

Ein einziger Vercel-Build-Artefakt mit VibeOS-Komponenten erzeugt Brand-, SEO- und Routing-Kontamination auf `berufos.com`. Trennung muss build-, route- und runtime-seitig erzwungen sein.
