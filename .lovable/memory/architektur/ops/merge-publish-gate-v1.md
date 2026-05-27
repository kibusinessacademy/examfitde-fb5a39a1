---
name: Merge → Publish Gate v1
description: Workflow-Orchestrator für Merge nach main — CI-Gate (Build/Tests/Security/SSOT-Guards) + Edge-Function-Drift Auto-Deploy + Regression-Freeze. Lovable Published bleibt manueller Klick (kein API-Trigger verfügbar).
type: feature
---

# Merge → Publish Gate v1 (Pfad A)

**Entscheidung 2026-05-27:** Pfad A — CI-Gate + Freeze. Lovable Published bleibt manueller Klick.

## Warum kein vollautomatischer Lovable-Re-Publish?
Lovable bietet **keine öffentliche API/Webhook** zum Trigger des Published-Re-Deploys. Frontend-Push aktualisiert nur `id-preview--*.lovable.app` automatisch — `examfit.de` braucht den manuellen "Update"-Klick im Publish-Dialog. Auto-Fix-Loops gegen Production verletzen zusätzlich `NO_AUTONOMOUS_PRODUCTION_WRITES` (Architectural Continuity Guard #10).

## Workflow `.github/workflows/merge-publish-gate.yml`

**Trigger:** `push` auf main, `pull_request` gegen main, `workflow_dispatch`.

**Jobs:**
1. `build` — `tsc --noEmit` + `vite build`, lädt dist als Artefakt.
2. `tests` — `vitest run`.
3. `security-rescan` — `npm audit --audit-level=high`, fail bei high+critical.
4. `ssot-guards` — bündelt: architecture-continuity, audit-write-contract, canonical-identity-contract, strict-event-package-id, status-revert.
5. `edge-auto-deploy` — **nur push→main**: detektiert geänderte Funktionen via `git diff before..HEAD`. Wenn `_shared/` betroffen → alle Funktionen. Deployed via `supabase functions deploy <fn> --project-ref <ref>`. Bei Fehler → GitHub-Issue.
6. `publish-ready` — aggregiert Resultate. Bei 4/4 grün → Step-Summary "Published-Update freigegeben". Bei Fail → exit 1 + Issue (Regression Freeze).

## Secrets erforderlich
- `SUPABASE_ACCESS_TOKEN` (https://supabase.com/dashboard/account/tokens)
- `SUPABASE_PROJECT_REF` = `ubdvvvsiryenhrfmqsvw`

Fehlen die Secrets → Workflow warnt + überspringt Edge-Deploy (kein hard fail), Rest läuft durch.

## Auto-Fix-Scope (User-Entscheidung)
**Nur** Edge-Function-Drift wird autonom redeployed (deckt User-Memory-Core-Regel "Edge functions sofort nach Code-Änderungen deployen"). Migrationen/DB-Drift bleiben manuell.

## Regression Freeze
Bei rotem Gate:
- Workflow exit 1 → Branch-Protection (separat konfiguriert) blockt weitere Merges.
- Auto-Issue via `scripts/ci/issue-on-fail.mjs` mit Run-URL.
- Step-Summary: "🛑 Regression Freeze aktiv. Publish NICHT klicken."

## Branch Protection (manuell durch Maintainer)
Empfohlen in GitHub-Repo-Settings → Branches → main:
- Required status checks: `build`, `tests`, `security-rescan`, `ssot-guards`, `publish-ready`.
- Require branches to be up to date before merging.

## Files
- `.github/workflows/merge-publish-gate.yml` (neu)
- Wiederverwendet: `scripts/guards/*.mjs`, `scripts/ci/issue-on-fail.mjs`

## Verworfen
- **Auto-Republish auf Lovable** — nicht möglich (kein API).
- **Migration-Re-Apply bei DB-Drift** — User hat es bewusst aus dem Auto-Fix-Scope ausgeschlossen.
- **Vercel-Migration** — als optionaler Folge-Cut markiert (würde echten Auto-Deploy ermöglichen, Runbook liegt unter `docs/runbooks/vercel-migration.md`).
