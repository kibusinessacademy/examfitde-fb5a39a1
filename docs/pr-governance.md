# PR Governance · Required Status Checks

Diese Datei dokumentiert die in GitHub Branch-Protection als **required**
hinterlegten Status-Checks für `main`. Sie ist die SSOT — wer einen Check
required machen will, ergänzt ihn hier *und* synchronisiert anschließend
über `scripts/governance/apply-branch-protection.mjs`.

## Required (PR-Merge wird ohne diese Checks blockiert)

| Workflow | Datei | Zweck |
| --- | --- | --- |
| `contrast-token-audit` | `.github/workflows/contrast-token-audit.yml` | Statische Token-Hygiene. Strict (Baseline 0). |
| `a11y-learner-regression` | `.github/workflows/a11y-learner-regression.yml` | jest-axe für Lesson/Continue/Module. |
| `a11y-smoke-routes` | `.github/workflows/a11y-smoke-routes.yml` | Playwright + axe auf alle Routen aus `tests/e2e/a11y-routes.ts`. |
| `a11y-routes-parity` | `.github/workflows/a11y-routes-parity.yml` | SSOT-Parität: smoke-Routen ↔ AppRoutes.tsx (kein Drift, kein Typo). |
| `status-revert-guard` | `.github/workflows/status-revert-guard.yml` | Verhindert unsichere `course_packages.status`-Demotes. |
| `badge-visual-regression` | `.github/workflows/badge-visual-regression.yml` | Pixel-Snapshots der Status-Badges. **Required ab 2026-05-05.** |
| `learner-course-readiness` | `.github/workflows/learner-course-readiness.yml` | DB-Gate: published Courses ohne Module/Lessons → block. Baseline `--max-empty=34`. |
| `learner-course-smoke` | `.github/workflows/learner-course-smoke.yml` | Playwright Smoke auf 8 Sample-Courses (PR) / volles Set (nightly). |
| `qa-pins-validation` | `.github/workflows/qa-pins-validation.yml` | Validiert `E2E_QA_COURSE_ID` / `E2E_QA_LESSON_ID` gegen Live-Daten (existiert, published, ready, lesson gehört zum Kurs). |
| `learner-progress-persistence` | `.github/workflows/learner-progress-persistence.yml` | readiness → qa-pins → Login → Lesson abschließen → Reload → Fortschritt persistiert. Plus Negative-States. Klassifizierter Retry (nur transient infra). |

## Optional / Nightly

| Workflow | Datei | Zweck |
| --- | --- | --- |
| `nightly-pipeline-guards` | `.github/workflows/nightly-pipeline-guards.yml` | Cron-only. |
| `seo-cluster-guard` | `.github/workflows/seo-cluster-guard.yml` | Soft-Audit, kein PR-Block. |

## Branch-Protection setzen

Scriptbasiert — nicht über UI-Klicks. Hält Doku und tatsächliche Settings garantiert in Sync.

```bash
GITHUB_TOKEN=<PAT mit repo+admin> \
GITHUB_REPO=<owner>/<repo> \
node scripts/governance/apply-branch-protection.mjs --dry-run
# danach ohne --dry-run
```

Das Script parst die "Required"-Tabelle aus dieser Datei und übergibt die
Checks per `PUT /repos/{owner}/{repo}/branches/main/protection`. Zusätzlich:
`enforce_admins=true`, 1 PR-Review (stale dismiss), strict (branch must be
up-to-date), `required_conversation_resolution=true`,
`allow_force_pushes=false`, `allow_deletions=false`.

## Neue Routen / neue Required-Checks

`tests/e2e/a11y-routes.ts` ist SSOT. Optional kann eine Route inline mit
`// @a11y-smoke` markiert werden — der Parity-Guard erzwingt dann die
Aufnahme in die SSOT.

Neue Required-Checks: Tabelle oben ergänzen, dann
`apply-branch-protection.mjs` re-runnen — fertig.

## Learner Readiness Guard — Ratchet

`scripts/guards/learner-course-readiness.mjs` ruft die SSOT-RPC
`public.public_learner_course_readiness()` und failed bei
`empty > --max-empty`. Aktuelle Baseline: 34 (Stand 2026-05-05).
Nach jedem Sweep `--max-empty` im Workflow heruntersetzen, bis 0 erreicht.
