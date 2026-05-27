---
name: Vercel Deploy Workflow v1
description: GitHub Actions Workflow für expliziten Vercel-Deploy via CLI nach erfolgreichem Merge → Publish Gate
type: feature
---

## Scope

Ergänzt den Merge → Publish Gate (Pfad A) um einen echten Auto-Deploy zu Vercel.
Lovable Published-Update bleibt manueller Klick; Vercel-Deploy ist jetzt automatisch.

## Workflow: .github/workflows/vercel-deploy.yml

**Trigger:**
- `workflow_run` auf erfolgreichen "Merge → Publish Gate" auf `main`
- `workflow_dispatch` für manuelle Deploys

**Jobs:**
1. Production build (`npm run build`)
2. Dist verification
3. Vercel secrets validation
4. Vercel CLI deploy (`vercel deploy --prod`)
5. Issue-on-fail via `scripts/ci/issue-on-fail.mjs`

**Secrets benötigt (GitHub Repo → Settings → Secrets):**
- `VERCEL_TOKEN` — von https://vercel.com/account/tokens
- `VERCEL_ORG_ID` — aus Projekt-Settings oder `vercel teams list`
- `VERCEL_PROJECT_ID` — aus Projekt-Settings oder `.vercel/project.json`
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID` — für den Build

## Beziehung zu bestehenden Workflows

- `merge-publish-gate.yml` — Gates (Build, Tests, Security, Guards) → muss grün sein
- `vercel-prerender-gate.yml` — Post-deploy smoke (per-route HTML drift, X-Robots-Tag) → läuft unabhängig
- `vercel-deploy.yml` — Neuer Workflow, führt den echten Deploy aus

## Hosting-Status

- `vercel.json` im Repo-Root vorhanden (bereits migriert)
- Custom Domain `examfit.de` auf Vercel
- Lovable bleibt Code-Editor; Vercel ist Production-Hosting
