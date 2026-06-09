---
name: Post-Deploy VibeOS Separation Verification v1
description: Automated post-deploy guard that curls forbidden VibeOS routes per host with retry/backoff/timeout and fails on content-grep
type: feature
---

# Post-Deploy VibeOS Separation Verification

Status: live, runs automatically nach jedem Production-Deploy.

## SSOT-Files

- `scripts/guards/post-deploy-vibeos-separation.mjs`
  - `fetchWithRetry()` mit `AbortController` (TIMEOUT_MS, default 10s).
  - Exponential Backoff `BACKOFF_MS * 2^(attempt-1)`, capped bei `MAX_BACKOFF_MS`.
  - `isTransient()`: 5xx, 0, 408/425/429, Network/Abort → retry.
  - CLI: `--retries`, `--timeout`, `--backoff`, `--max-backoff`, `--host`.
  - Geprüfte Pfade: `/vibeos`, `/avatar`, `/runtime`, `/apps/new`.
  - Pass-Kriterium: HTTP 404 ODER (200 + Body enthält KEINE VibeOS-Identifier).
- `.github/workflows/post-deploy-vibeos-separation.yml`
  - Trigger: `workflow_run` nach `Vercel Deploy` & `Cloudflare Pages Deploy + SPA Smoke`, plus `schedule`/`workflow_dispatch`.
  - `concurrency` pro Host (kein doppelter Run).
  - Default: 6 retries, 12s timeout, 2s backoff, 30s max-backoff.
  - Artifact-Upload `verify-logs/` (30d Retention).

## Hosts (allowlist)

- `https://berufos.com`
- `https://www.berufos.com`

## Regeln

- Workflow MUSS bei VibeOS-Content-Hit oder HTTP 200 mit Identifier fehlschlagen.
- Lokal reproduzierbar: `node scripts/guards/post-deploy-vibeos-separation.mjs --host=https://berufos.com`.
- Bei Deploy-Propagation-Delay (5xx/timeout): Retry mit Backoff statt False-Fail.

## Warum

Build-Guard verhindert lokale Regression, aber CDN-Cache/Routing-Drift kann nach Deploy auftreten. Reality-Check gegen den echten Host ist Pflicht.
