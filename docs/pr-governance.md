# PR Governance · Required Status Checks

Diese Datei dokumentiert die in GitHub Branch-Protection als **required**
hinterlegten Status-Checks für `main`. Sie ist die SSOT — wer einen Check
required machen will, ergänzt ihn hier *und* in der Repo-Settings UI.

## Required (PR-Merge wird ohne diese Checks blockiert)

| Workflow | Datei | Zweck |
| --- | --- | --- |
| `contrast-token-audit` | `.github/workflows/contrast-token-audit.yml` | Statische Token-Hygiene. Strict (Baseline 0). |
| `a11y-learner-regression` | `.github/workflows/a11y-learner-regression.yml` | jest-axe für Lesson/Continue/Module. |
| `a11y-smoke-routes` | `.github/workflows/a11y-smoke-routes.yml` | Playwright + axe auf alle Routen aus `tests/e2e/a11y-routes.ts`. |
| `a11y-routes-parity` | `.github/workflows/a11y-routes-parity.yml` | SSOT-Parität: smoke-Routen ↔ AppRoutes.tsx (kein Drift, kein Typo). |
| `status-revert-guard` | `.github/workflows/status-revert-guard.yml` | Verhindert unsichere `course_packages.status`-Demotes. |
| `badge-visual-regression` | `.github/workflows/badge-visual-regression.yml` | Pixel-Snapshots der Status-Badges. **Required ab 2026-05-05.** |

## Optional / Nightly

| Workflow | Datei | Zweck |
| --- | --- | --- |
| `nightly-pipeline-guards` | `.github/workflows/nightly-pipeline-guards.yml` | Cron-only. |
| `seo-cluster-guard` | `.github/workflows/seo-cluster-guard.yml` | Soft-Audit, kein PR-Block. |

## Setup-Schritte (Repo-Admin)

1. GitHub → Settings → Branches → Branch-Protection-Rule für `main`.
2. Unter **Require status checks to pass** alle Workflows aus der
   "Required"-Tabelle hinzufügen (Job-Name = Workflow-Name).
3. **Require branches to be up to date** aktivieren.
4. Diese Datei updaten, wenn ein Check rein- oder rauskommt.

## Neue Routen

`tests/e2e/a11y-routes.ts` ist SSOT. Optional kann eine Route inline mit
`// @a11y-smoke` markiert werden — der Parity-Guard erzwingt dann die
Aufnahme in die SSOT.
