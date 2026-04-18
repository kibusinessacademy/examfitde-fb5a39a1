---
name: SSOT Heal Service v9
description: Alle manuellen Heal-Buttons im Admin laufen über einen zentralen Service mit zwei Modi (Soft Reentry / Hard Heal) und einheitlicher Query-Invalidation
type: feature
---

Die Admin-Heal-UI nutzt **einen einzigen SSOT-Entry-Point** statt fragmentierter Legacy-Pfade.

## Architektur

- **`src/lib/admin/heal/healService.ts`** — `runPackageHealAction({packageId, mode, resetFromStep, reason, cancelActiveJobs?, enqueuePlan?})`
  - `mode: 'soft'` → `runAdminOpsAction('reset_to_step', …)` (kein Job-Cancel)
  - `mode: 'hard'` → RPC `admin_manual_heal_package` (Cancel Jobs + Step-Reset + Clear `blocked_reason` + Audit)
  - Optionaler `enqueuePlan: HealEnqueueStep[]` für Folge-Repair-Jobs nach erfolgreichem Heal
- **`src/lib/admin/heal/healService.ts → recommendHeal()`** — leitet aus `hardFailReasons`, `blockReason`, `releaseClass`, `isStuck` automatisch `mode + resetFromStep + enqueuePlan` ab.
- **`src/lib/admin/heal/usePackageHealAction.ts`** — React-Hook mit Toasts, automatischer Invalidation aller Heal-Queries (`admin`, `admin-auto-heal-queue`, `release-classifications`, `blocked-packages-detail`, `stuck-packages-detail`, `command-data`, `package-steps`, `job-queue`, `admin-actions`, `heal-cockpit`).

## UI-Komponenten (alle umgestellt)

- `ContextSensitiveHealActions` — pure Präsentation, Buttons: **Soft Reentry → Publish** (release_ok), **Hard Heal + Repair** (warn/block), **Mark content_gap** (warn/block).
- `RepairToolboxActions` (v9) — drei klare Aktionen mit Step-Selector: **Soft Reentry**, **Hard Heal**, **content_gap**, plus optional **Hard Rebuild** (depublish).
- `BlockedPackagesSheet` — pro Paket: Empfehlungs-Hinweis (`recommendHeal.rationale`) + Soft Reentry / Hard Heal / content_gap / Admin-Hold-Aufhebung.
- `AdminAutoHealQueue` — kontextsensitive Buttons rufen `runHeal(...)`, der intern `recommendHeal()` + Hook nutzt; Queue-Item wird automatisch nach Erfolg auf `done` gesetzt.

## Legacy-Status

- `src/lib/admin/recoverAndReenterPackage.ts` ist auf `@deprecated` gesetzt — keine UI-Komponente verwendet es mehr.
- Direkte Aufrufe von `forcePublishReleaseOk` / `reconcilePipelineTail` aus `AdminAutoHealQueue` entfernt.
- `mapHardFailsToHealActions` aus `BlockedPackagesSheet` entfernt — ersetzt durch `recommendHeal()`.

## Heal-Matrix (recommendHeal)

| Signal | mode | resetFromStep | enqueue |
|---|---|---|---|
| `pipeline_repair_required` / `repair_no_effect` / `queued_without_job` / `active_jobs_exist` / `isStuck` | hard | aus reasons abgeleitet | `repair_*` passend |
| MINICHECK reason | (hard wenn stuck) | `fanout_learning_content` | `repair_minichecks` |
| LESSON / PLACEHOLDER / TIER1 | (hard wenn stuck) | `scaffold_learning_course` | `repair_lessons` |
| HANDBOOK | (hard wenn stuck) | `generate_handbook` | `repair_handbook` |
| ORAL_EXAM | (hard wenn stuck) | `generate_oral_exam` | `repair_oral_exam` |
| EXAM_POOL / BLOOM / COVERAGE / HARDISH / TRAP | (hard wenn stuck) | `generate_exam_pool` | `repair_exam_pool_quality` |
| `release_ok` + keine Jobs | soft | `auto_publish` | – |
| Fallback | soft | `run_integrity_check` | – |
